const { createAsyncQueue } = require('./asyncQueue');

function createPreviewQueue({ concurrency = 2 } = {}) {
  const enqueue = createAsyncQueue(concurrency);
  const inflight = new Map();

  return function queuePreview(key, task) {
    if (key && inflight.has(key)) {
      return inflight.get(key);
    }
    const promise = enqueue(task).finally(() => {
      if (key) {
        inflight.delete(key);
      }
    });
    if (key) {
      inflight.set(key, promise);
    }
    return promise;
  };
}

module.exports = {
  createPreviewQueue,
};
