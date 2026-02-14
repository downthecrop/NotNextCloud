const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

let musicMetadata = null;
let musicMetadataLoading = null;

async function getMusicMetadata() {
  if (musicMetadata !== null) {
    return musicMetadata;
  }
  if (!musicMetadataLoading) {
    musicMetadataLoading = (async () => {
      try {
        const mod = await import('music-metadata');
        return mod.parseFile ? mod : mod.default || null;
      } catch {
        return null;
      }
    })();
  }
  musicMetadata = await musicMetadataLoading;
  return musicMetadata;
}

function albumKeyFor(artist, album) {
  const safeArtist = artist || 'Unknown Artist';
  const safeAlbum = album || 'Unknown Album';
  return crypto
    .createHash('sha1')
    .update(`${safeArtist.toLowerCase()}::${safeAlbum.toLowerCase()}`)
    .digest('hex');
}

async function ensureDir(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.promises.mkdir(targetPath, { recursive: true });
}

async function writeAlbumArt({ albumKey, album, artist, picture, albumArtDir, db, logger }) {
  if (!picture?.data || !albumArtDir) {
    return false;
  }
  const existing = db.getAlbumArt.get(albumKey);
  if (existing?.path) {
    return true;
  }
  try {
    await ensureDir(albumArtDir);
    const extension = mime.extension(picture.format || '') || 'jpg';
    const filePath = path.join(albumArtDir, `${albumKey}.${extension}`);
    await fs.promises.writeFile(filePath, picture.data);
    db.upsertAlbumArt.run({
      album_key: albumKey,
      album,
      artist,
      path: filePath,
      updated_at: Date.now(),
    });
    return true;
  } catch (error) {
    logger?.warn?.({ err: error }, 'Failed to write album art');
    return false;
  }
}

function getAlbumArtPresence({ db, albumKey, albumArtCache }) {
  if (!albumKey) {
    return false;
  }
  if (albumArtCache && albumArtCache.has(albumKey)) {
    return albumArtCache.get(albumKey) === true;
  }
  const exists = Boolean(db.getAlbumArt.get(albumKey)?.path);
  if (albumArtCache) {
    albumArtCache.set(albumKey, exists);
  }
  return exists;
}

async function enrichAudioEntry({
  safeMime,
  existingEntry,
  isSameStat,
  extractMetadata = true,
  fullPath,
  relPath,
  parent,
  name,
  folderArtMap,
  albumArtDir,
  albumArtCache,
  db,
  logger,
}) {
  const emptyResult = {
    title: null,
    artist: null,
    album: null,
    duration: null,
    albumKey: null,
  };
  if (!safeMime || !safeMime.startsWith('audio/')) {
    return emptyResult;
  }

  let title = null;
  let artist = null;
  let album = null;
  let duration = null;
  let albumKey = null;

  if (existingEntry && isSameStat) {
    title = existingEntry.title;
    artist = existingEntry.artist;
    album = existingEntry.album;
    duration = existingEntry.duration;
    albumKey = existingEntry.album_key;
  } else {
    const metadataLib = await getMusicMetadata();
    if (extractMetadata && metadataLib) {
      try {
        const metadata = await metadataLib.parseFile(fullPath, { duration: true });
        const common = metadata.common || {};
        const rawTitle = common.title || '';
        const rawArtist = common.artist || (Array.isArray(common.artists) ? common.artists[0] : '');
        const rawAlbum = common.album || '';
        const parentFolder = parent ? path.basename(parent) : '';
        title = rawTitle || path.parse(name).name;
        artist = rawArtist || 'Unknown Artist';
        album = rawAlbum || parentFolder || 'Unknown Album';
        duration = metadata.format?.duration || null;
        albumKey = albumKeyFor(artist, album);

        if (Array.isArray(common.picture) && common.picture.length && albumKey) {
          const hasArt = getAlbumArtPresence({ db, albumKey, albumArtCache });
          if (!hasArt) {
            const wrote = await writeAlbumArt({
              albumKey,
              album,
              artist,
              picture: common.picture[0],
              albumArtDir,
              db,
              logger,
            });
            if (albumArtCache) {
              albumArtCache.set(albumKey, wrote);
            }
          }
        }
      } catch (error) {
        logger?.warn?.({ err: error, relPath }, 'Failed to parse audio metadata');
        const parentFolder = parent ? path.basename(parent) : '';
        title = path.parse(name).name;
        artist = 'Unknown Artist';
        album = parentFolder || 'Unknown Album';
        albumKey = albumKeyFor(artist, album);
      }
    } else {
      const parentFolder = parent ? path.basename(parent) : '';
      title = path.parse(name).name;
      artist = 'Unknown Artist';
      album = parentFolder || 'Unknown Album';
      albumKey = albumKeyFor(artist, album);
    }
  }

  const folderArtPath = folderArtMap?.get(parent)?.path || null;
  if (albumKey && folderArtPath) {
    const hasArt = getAlbumArtPresence({ db, albumKey, albumArtCache });
    if (!hasArt) {
      db.upsertAlbumArt.run({
        album_key: albumKey,
        album,
        artist,
        path: folderArtPath,
        updated_at: Date.now(),
      });
      if (albumArtCache) {
        albumArtCache.set(albumKey, true);
      }
    }
  }

  return {
    title,
    artist,
    album,
    duration,
    albumKey,
  };
}

module.exports = {
  enrichAudioEntry,
};
