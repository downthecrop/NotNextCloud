const { parentPort } = require('worker_threads');
const { ensurePreview } = require('../preview');

if (!parentPort) {
  throw new Error('Preview worker requires a parent port');
}

parentPort.on('message', async (message) => {
  const id = message?.id;
  if (typeof id !== 'number' || !message?.payload) {
    return;
  }

  try {
    const result = await ensurePreview(message.payload);
    parentPort.postMessage({ id, ok: true, result: result || null });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        message: error?.message || 'Preview generation failed',
        stack: error?.stack || '',
      },
    });
  }
});
