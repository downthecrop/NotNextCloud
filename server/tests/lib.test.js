const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sanitizeRootPayload } = require('../lib/roots');
const { trashRelName } = require('../lib/trash');
const { parseRangeHeader } = require('../lib/httpRange');
const { resolveUploadTarget } = require('../lib/uploadTarget');

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

test('resolveUploadTarget applies camera YYYY-MM bucket from cameraMonth', () => {
  const result = resolveUploadTarget({
    basePath: 'Camera Uploads',
    filePath: 'IMG_0001.jpg',
    camera: 1,
    cameraMonth: '2025-02',
  });
  assert.equal(result.targetRel, 'Camera Uploads/2025-02/IMG_0001.jpg');
});

test('resolveUploadTarget applies camera YYYY-MM bucket from timestamp metadata', () => {
  const result = resolveUploadTarget({
    basePath: 'Camera Uploads',
    filePath: 'IMG_0002.jpg',
    camera: 'true',
    capturedAt: '2025-01-15T09:10:11Z',
  });
  assert.equal(result.targetRel, 'Camera Uploads/2025-01/IMG_0002.jpg');
});

test('resolveUploadTarget applies camera YYYY-MM bucket from now fallback', () => {
  const result = resolveUploadTarget({
    basePath: 'Camera Uploads',
    filePath: 'IMG_0003.jpg',
    camera: 'true',
    now: '2025-03-02T12:00:00Z',
  });
  assert.equal(result.targetRel, 'Camera Uploads/2025-03/IMG_0003.jpg');
});

test('resolveUploadTarget defaults camera uploads under Camera Uploads', () => {
  const result = resolveUploadTarget({
    filePath: 'IMG_0004.jpg',
    camera: 'true',
    cameraMonth: '2025-04',
  });
  assert.equal(result.targetRel, 'Camera Uploads/2025-04/IMG_0004.jpg');
});

test('listAudioBackfillParents selects stale audio metadata rows', (t) => {
  let initDb;
  try {
    ({ initDb } = require('../db'));
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      t.skip('better-sqlite3 unavailable in host test environment');
      return;
    }
    throw error;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnc2-db-test-'));
  const dbPath = path.join(tmpDir, 'metadata.sqlite');
  const db = initDb(dbPath);
  try {
    db.upsertEntry.run({
      root_id: 'media',
      rel_path: 'Music/Album/fix-me.ogg',
      parent: 'Music/Album',
      name: 'fix-me.ogg',
      ext: '.ogg',
      size: 1024,
      mtime: 1,
      mime: 'audio/ogg',
      is_dir: 0,
      scan_id: 1,
      title: 'Fix Me',
      artist: 'Tester',
      album: 'Album',
      duration: 0,
      album_key: 'album-key',
      inode: 1,
      device: 1,
    });
    db.upsertEntry.run({
      root_id: 'media',
      rel_path: 'Music/Album/ok.ogg',
      parent: 'Music/Album',
      name: 'ok.ogg',
      ext: '.ogg',
      size: 2048,
      mtime: 2,
      mime: 'audio/ogg',
      is_dir: 0,
      scan_id: 1,
      title: 'Okay',
      artist: 'Tester',
      album: 'Album',
      duration: 120,
      album_key: 'album-key',
      inode: 2,
      device: 1,
    });

    const parents = db.listAudioBackfillParents.all('media').map((row) => row.parent);
    assert.deepEqual(parents, ['Music/Album']);
  } finally {
    db.db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
