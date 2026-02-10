function createBatchWriter(db, logger, batchSize, reportError) {
  const safeBatchSize = Number.isFinite(batchSize) ? Math.max(1, batchSize) : 1;
  if (safeBatchSize <= 1) {
    return {
      enqueue: (fn) => fn(),
      flush: () => {},
    };
  }
  let pending = [];
  const tx = db.db.transaction((ops) => {
    for (const op of ops) {
      op();
    }
  });
  const flush = () => {
    if (!pending.length) {
      return;
    }
    const ops = pending;
    pending = [];
    try {
      tx(ops);
    } catch (error) {
      logger?.error?.({ err: error }, 'Batch write failed');
      reportError?.({
        error,
        operation: 'batch_write',
      });
      for (const op of ops) {
        try {
          op();
        } catch (err) {
          logger?.error?.({ err }, 'Fallback write failed');
          reportError?.({
            error: err,
            operation: 'batch_write_fallback',
          });
        }
      }
    }
  };
  const enqueue = (fn) => {
    pending.push(fn);
    if (pending.length >= safeBatchSize) {
      flush();
    }
  };
  return { enqueue, flush };
}

module.exports = {
  createBatchWriter,
};
