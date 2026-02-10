const assert = require('node:assert/strict');
const test = require('node:test');

const { sanitizeRootPayload } = require('../lib/roots');
const { trashRelName } = require('../lib/trash');
const { parseRangeHeader } = require('../lib/httpRange');

test('sanitizeRootPayload rejects unsafe root ids', () => {
  assert.throws(
    () => sanitizeRootPayload([{ id: '../../bad', path: '/tmp/data' }]),
    /Root id must use only letters, numbers, underscores, or dashes/
  );
});

test('sanitizeRootPayload normalizes generated ids', () => {
  const roots = sanitizeRootPayload([{ name: 'My Root!', path: '/tmp/data' }]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, 'My-Root');
});

test('trashRelName constrains root segment to a safe folder name', () => {
  const rel = trashRelName('../../bad/root', 'song.mp3');
  const firstSegment = rel.split('/')[0];
  assert.match(firstSegment, /^[A-Za-z0-9_-]+$/);
  assert.equal(firstSegment.includes('..'), false);
});

test('parseRangeHeader supports suffix and open-ended ranges', () => {
  const suffix = parseRangeHeader('bytes=-500', 1000);
  assert.deepEqual(suffix, { start: 500, end: 999 });

  const openEnded = parseRangeHeader('bytes=500-', 1000);
  assert.deepEqual(openEnded, { start: 500, end: 999 });

  const explicit = parseRangeHeader('bytes=100-200', 1000);
  assert.deepEqual(explicit, { start: 100, end: 200 });
});
