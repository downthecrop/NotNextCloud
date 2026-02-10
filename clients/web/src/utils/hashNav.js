const defaultMusic = { mode: 'songs', albumKey: null, artist: null, playlistId: null };
const defaultFiles = { rootId: null, path: '' };

export function encodePath(pathValue) {
  if (!pathValue) {
    return '';
  }
  return pathValue
    .split('/')
    .filter((part) => part.length)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function parseHash(rawHash) {
  const raw = (rawHash || '').replace(/^#/, '');
  if (!raw) {
    return { view: 'files', music: { ...defaultMusic }, files: { ...defaultFiles } };
  }
  const parts = raw.split('/').filter(Boolean);
  const view = parts[0];
  if (view === 'music') {
    let mode = 'songs';
    let albumKey = null;
    let artist = null;
    let playlistId = null;
    if (parts[1] === 'albums') {
      mode = 'albums';
      albumKey = parts[2] ? decodeURIComponent(parts[2]) : null;
    } else if (parts[1] === 'artists') {
      mode = 'artists';
      artist = parts[2] ? decodeURIComponent(parts[2]) : null;
    } else if (parts[1] === 'playlists') {
      mode = 'playlists';
      playlistId = parts[2] ? decodeURIComponent(parts[2]) : null;
    }
    return { view, music: { mode, albumKey, artist, playlistId }, files: { ...defaultFiles } };
  }
  if (view === 'photos') {
    return { view: 'photos', music: { ...defaultMusic }, files: { ...defaultFiles } };
  }
  let rootId = null;
  let path = '';
  if (view === 'files') {
    rootId = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (parts.length > 2) {
      path = parts.slice(2).map((part) => decodeURIComponent(part)).join('/');
    }
  }
  return { view: 'files', music: { ...defaultMusic }, files: { rootId, path } };
}

export function buildHash({ view, music, files }) {
  if (view === 'music') {
    const mode = music?.mode || 'songs';
    if (mode === 'albums') {
      return music?.albumKey
        ? `#music/albums/${encodeURIComponent(music.albumKey)}`
        : '#music/albums';
    }
    if (mode === 'artists') {
      return music?.artist
        ? `#music/artists/${encodeURIComponent(music.artist)}`
        : '#music/artists';
    }
    if (mode === 'playlists') {
      return music?.playlistId
        ? `#music/playlists/${encodeURIComponent(music.playlistId)}`
        : '#music/playlists';
    }
    return '#music';
  }
  if (view === 'photos') {
    return '#photos';
  }
  const filesRoot = files?.rootId;
  const filesPath = encodePath(files?.path || '');
  if (filesRoot) {
    return filesPath
      ? `#files/${encodeURIComponent(filesRoot)}/${filesPath}`
      : `#files/${encodeURIComponent(filesRoot)}`;
  }
  return '#files';
}
