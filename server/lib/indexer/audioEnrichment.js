const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

let musicMetadata = null;
let musicMetadataLoading = null;
const NON_TRACK_AUDIO_EXT = new Set(['.m3u', '.m3u8', '.pls', '.xspf', '.asx', '.cue']);

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

function albumKeyFor({ albumArtist = '', artist = '', album = '', parent = '' } = {}) {
  const normalizedAlbum = normalizeMetadataText(album).toLowerCase() || 'unknown album';
  const normalizedAlbumArtist = normalizeMetadataText(albumArtist).toLowerCase();
  const normalizedArtist = normalizeMetadataText(artist).toLowerCase();
  const normalizedParent = normalizeMetadataText(parent).toLowerCase();
  let scope = 'artist:unknown artist';
  if (normalizedAlbumArtist) {
    scope = `albumartist:${normalizedAlbumArtist}`;
  } else if (normalizedParent) {
    scope = `folder:${normalizedParent}`;
  } else if (normalizedArtist) {
    scope = `artist:${normalizedArtist}`;
  }
  return crypto
    .createHash('sha1')
    .update(`${scope}::${normalizedAlbum}`)
    .digest('hex');
}

function normalizeMetadataText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\s+/g, ' ');
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

function normalizeDurationSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function resolveAudioDuration(format, fallbackSizeBytes = null) {
  const sampleRate = Number(format?.sampleRate);
  const numberOfSamples = Number(format?.numberOfSamples);
  const formatSize = Number(format?.size);
  const size =
    Number.isFinite(formatSize) && formatSize > 0
      ? formatSize
      : Number.isFinite(Number(fallbackSizeBytes)) && Number(fallbackSizeBytes) > 0
        ? Number(fallbackSizeBytes)
        : null;
  const bitrate = Number(format?.bitrate);
  const direct = normalizeDurationSeconds(format?.duration);
  const sampleEstimate =
    Number.isFinite(sampleRate) && sampleRate > 0 && Number.isFinite(numberOfSamples) && numberOfSamples > 0
      ? normalizeDurationSeconds(numberOfSamples / sampleRate)
      : null;
  const bitrateEstimate =
    Number.isFinite(bitrate) && bitrate > 0 && Number.isFinite(size) && size > 0
      ? normalizeDurationSeconds((size * 8) / bitrate)
      : null;

  // Ogg/Vorbis files can occasionally report a tiny bogus duration while still exposing
  // usable bitrate/size metadata. Prefer metadata-derived estimates in that case.
  const directLooksBrokenForLargeFile =
    direct !== null &&
    Number.isFinite(size) &&
    size >= 1024 * 1024 &&
    direct < 5 &&
    ((bitrateEstimate !== null && bitrateEstimate >= 15) ||
      (sampleEstimate !== null && sampleEstimate >= 15));
  const sampleLooksBrokenForLargeFile =
    sampleEstimate !== null &&
    Number.isFinite(size) &&
    size >= 1024 * 1024 &&
    sampleEstimate < 5 &&
    ((bitrateEstimate !== null && bitrateEstimate >= 15) ||
      (direct !== null && direct >= 15));

  if (direct !== null && !directLooksBrokenForLargeFile) {
    return direct;
  }
  if (bitrateEstimate !== null) {
    return bitrateEstimate;
  }
  if (sampleEstimate !== null && !sampleLooksBrokenForLargeFile) {
    return sampleEstimate;
  }
  if (direct !== null) {
    return direct;
  }
  return null;
}

async function enrichAudioEntry({
  safeMime,
  existingEntry,
  isSameStat,
  extractMetadata = true,
  fullPath,
  fileSize,
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
  if (NON_TRACK_AUDIO_EXT.has(path.extname(name || '').toLowerCase())) {
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
    // Preserve previously-derived grouping when file stats are unchanged.
    albumKey =
      existingEntry.album_key ||
      albumKeyFor({
        artist: existingEntry.artist,
        album: existingEntry.album,
        parent,
      });
  } else {
    const metadataLib = await getMusicMetadata();
    if (extractMetadata && metadataLib) {
      try {
        const metadata = await metadataLib.parseFile(fullPath, { duration: true });
        const common = metadata.common || {};
        const rawTitle = common.title || '';
        const rawArtist = common.artist || (Array.isArray(common.artists) ? common.artists[0] : '');
        const rawAlbumArtist =
          common.albumartist || (Array.isArray(common.albumartists) ? common.albumartists[0] : '');
        const rawAlbum = common.album || '';
        const parentFolder = parent ? path.basename(parent) : '';
        const normalizedTitle = normalizeMetadataText(rawTitle);
        const normalizedArtist = normalizeMetadataText(rawArtist);
        const normalizedAlbumArtist = normalizeMetadataText(rawAlbumArtist);
        const normalizedAlbum = normalizeMetadataText(rawAlbum);
        title = normalizedTitle || path.parse(name).name;
        artist = normalizedArtist || normalizedAlbumArtist || 'Unknown Artist';
        album = normalizedAlbum || parentFolder || 'Unknown Album';
        duration = resolveAudioDuration(metadata.format, fileSize);
        albumKey = albumKeyFor({
          albumArtist: normalizedAlbumArtist,
          artist,
          album,
          parent,
        });

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
        albumKey = albumKeyFor({ artist, album, parent });
      }
    } else {
      const parentFolder = parent ? path.basename(parent) : '';
      title = path.parse(name).name;
      artist = 'Unknown Artist';
      album = parentFolder || 'Unknown Album';
      albumKey = albumKeyFor({ artist, album, parent });
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
