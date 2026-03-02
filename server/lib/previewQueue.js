const path = require('path');
const { Worker } = require('worker_threads');

function createAbortError() {
  const error = new Error('Preview request aborted');
  error.name = 'AbortError';
  return error;
}

function attachSubscriber(record, signal) {
  record.subscribers += 1;
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    record.subscribers = Math.max(0, record.subscribers - 1);
    if (record.subscribers === 0) {
      record.cancelQueued?.();
    }
  };

  if (!signal) {
    return record.promise.finally(release);
  }
  if (signal.aborted) {
    release();
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      release();
      reject(createAbortError());
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    record.promise.then(
      (value) => {
        cleanup();
        release();
        resolve(value);
      },
      (error) => {
        cleanup();
        release();
        reject(error);
      }
    );
  });
}

function createPreviewQueue({ concurrency = 2 } = {}) {
  const workerCount = Math.max(1, Number(concurrency) || 1);
  const inflight = new Map();
  const highPriorityJobs = [];
  const lowPriorityJobs = [];
  const pendingById = new Map();
  const workers = [];
  let nextJobId = 1;
  let destroyed = false;

  function normalizePriority(priority) {
    return priority === 'low' ? 'low' : 'high';
  }

  function enqueueJob(job) {
    if (normalizePriority(job.priority) === 'low') {
      lowPriorityJobs.push(job);
      return;
    }
    highPriorityJobs.push(job);
  }

  function dequeueJob() {
    if (highPriorityJobs.length) {
      return highPriorityJobs.shift();
    }
    if (lowPriorityJobs.length) {
      return lowPriorityJobs.shift();
    }
    return null;
  }

  function removeQueuedJob(job) {
    if (!job) {
      return false;
    }
    const highIdx = highPriorityJobs.indexOf(job);
    if (highIdx >= 0) {
      highPriorityJobs.splice(highIdx, 1);
      return true;
    }
    const lowIdx = lowPriorityJobs.indexOf(job);
    if (lowIdx >= 0) {
      lowPriorityJobs.splice(lowIdx, 1);
      return true;
    }
    return false;
  }

  function dispatch() {
    if (destroyed) {
      return;
    }
    for (const slot of workers) {
      if (slot.busy) {
        continue;
      }
      const job = dequeueJob();
      if (!job) {
        break;
      }
      if (job.settled) {
        continue;
      }
      slot.busy = true;
      slot.jobId = job.id;
      job.started = true;
      pendingById.set(job.id, { job, slot });
      slot.worker.postMessage({
        id: job.id,
        payload: job.payload,
      });
    }
  }

  function completeJob(id, result, error) {
    const pending = pendingById.get(id);
    if (!pending) {
      return;
    }
    pendingById.delete(id);
    if (pending.slot) {
      pending.slot.busy = false;
      pending.slot.jobId = null;
    }
    if (error) {
      pending.job.reject(error);
    } else {
      pending.job.resolve(result);
    }
    dispatch();
  }

  function spawnWorker() {
    const workerPath = path.join(__dirname, 'previewWorker.js');
    const worker = new Worker(workerPath);
    const slot = {
      worker,
      busy: false,
      jobId: null,
    };
    worker.on('message', (message) => {
      if (!message || typeof message.id !== 'number') {
        return;
      }
      if (message.ok === false) {
        const err = new Error(message.error?.message || 'Preview worker failed');
        if (message.error?.stack) {
          err.stack = message.error.stack;
        }
        completeJob(message.id, null, err);
        return;
      }
      completeJob(message.id, message.result || null, null);
    });
    worker.on('error', (error) => {
      if (slot.jobId !== null) {
        completeJob(slot.jobId, null, error);
      }
    });
    worker.on('exit', (code) => {
      const idx = workers.indexOf(slot);
      if (idx >= 0) {
        workers.splice(idx, 1);
      }
      if (slot.jobId !== null) {
        completeJob(slot.jobId, null, new Error(`Preview worker exited with code ${code}`));
      }
      if (!destroyed) {
        workers.push(spawnWorker());
        dispatch();
      }
    });
    return slot;
  }

  for (let index = 0; index < workerCount; index += 1) {
    workers.push(spawnWorker());
  }

  function getStats() {
    const workersBusy = workers.reduce((count, slot) => count + (slot.busy ? 1 : 0), 0);
    return {
      workersTotal: workers.length,
      workersBusy,
      queuedHigh: highPriorityJobs.length,
      queuedLow: lowPriorityJobs.length,
      queuedTotal: highPriorityJobs.length + lowPriorityJobs.length,
      runningJobs: pendingById.size,
      inflightKeys: inflight.size,
      destroyed,
    };
  }

  const shutdown = () => {
    destroyed = true;
    let job = dequeueJob();
    while (job) {
      job.reject(new Error('Preview queue shutting down'));
      job = dequeueJob();
    }
    for (const slot of workers) {
      slot.worker.terminate().catch(() => {});
    }
    workers.length = 0;
  };

  process.once('exit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  function createJobRecord(key, payload, options = {}) {
    const id = nextJobId++;
    const priority = normalizePriority(options.priority);
    let jobRef = null;
    const promise = new Promise((resolve, reject) => {
      const job = {
        id,
        key,
        payload,
        priority,
        started: false,
        settled: false,
        resolve: (value) => {
          if (job.settled) {
            return;
          }
          job.settled = true;
          resolve(value);
        },
        reject: (error) => {
          if (job.settled) {
            return;
          }
          job.settled = true;
          reject(error);
        },
      };
      jobRef = job;
      enqueueJob(job);
      dispatch();
    });
    promise.catch(() => {});
    const cancelQueued = () => {
      if (!jobRef || jobRef.started || jobRef.settled || !removeQueuedJob(jobRef)) {
        return false;
      }
      jobRef.reject(createAbortError());
      return true;
    };
    const promote = () => {
      if (!jobRef || jobRef.started || jobRef.settled || jobRef.priority === 'high') {
        return false;
      }
      if (!removeQueuedJob(jobRef)) {
        return false;
      }
      jobRef.priority = 'high';
      enqueueJob(jobRef);
      dispatch();
      return true;
    };
    return {
      key,
      promise,
      subscribers: 0,
      cancelQueued,
      promote,
    };
  }

  const queuePreview = function queuePreview(key, payload, options = {}) {
    const signal = options?.signal || null;
    const priority = normalizePriority(options?.priority);
    if (destroyed) {
      return Promise.reject(new Error('Preview queue unavailable'));
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (key) {
      let record = inflight.get(key);
      if (!record) {
        record = createJobRecord(key, payload, { priority });
        inflight.set(key, record);
        record.promise.finally(() => {
          inflight.delete(key);
        });
      } else if (priority === 'high') {
        record.promote?.();
      }
      return attachSubscriber(record, signal);
    }
    const record = createJobRecord(null, payload, { priority });
    return attachSubscriber(record, signal);
  };

  queuePreview.getStats = getStats;
  return queuePreview;
}

module.exports = {
  createPreviewQueue,
};
