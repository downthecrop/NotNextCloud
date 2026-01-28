function createAsyncQueue(concurrency = 2) {
  const limit = Number.isFinite(concurrency) ? Math.max(1, concurrency) : 1;
  const queue = [];
  let active = 0;

  const runNext = () => {
    if (active >= limit || queue.length === 0) {
      return;
    }
    const { task, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(task)
      .then((result) => {
        active -= 1;
        resolve(result);
        runNext();
      })
      .catch((error) => {
        active -= 1;
        reject(error);
        runNext();
      });
  };

  return function enqueue(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  };
}

module.exports = {
  createAsyncQueue,
};
