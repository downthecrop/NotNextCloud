import { useApi } from './useApi';

export function useLibraryApi() {
  const { apiJson, apiUrls } = useApi();

  const withPage = ({ limit = 50, offset = 0, cursor = null, includeTotal = true }) => {
    const base = cursor ? { limit, cursor } : { limit, offset };
    if (includeTotal === false) {
      return { ...base, includeTotal: false };
    }
    return base;
  };

  const listDirectory = ({
    rootId,
    path = '',
    limit = 50,
    offset = 0,
    cursor = null,
    includeTotal = true,
  }) =>
    apiJson(
      apiUrls.list({
        root: rootId,
        path,
        ...withPage({ limit, offset, cursor, includeTotal }),
      })
    );

  const searchEntries = ({
    rootId,
    query,
    type = 'all',
    pathPrefix,
    limit = 50,
    offset = 0,
    cursor = null,
    includeTotal = true,
  }) =>
    apiJson(
      apiUrls.search({
        root: rootId,
        q: query,
        type,
        pathPrefix: pathPrefix || undefined,
        ...withPage({ limit, offset, cursor, includeTotal }),
      })
    );

  const listMedia = ({
    rootId,
    type,
    pathPrefix,
    limit = 50,
    offset = 0,
    cursor = null,
    includeTotal = true,
  }) =>
    apiJson(
      apiUrls.media({
        root: rootId,
        type,
        pathPrefix: pathPrefix || undefined,
        ...withPage({ limit, offset, cursor, includeTotal }),
      })
    );

  const listAlbums = ({ rootId, pathPrefix, limit = 50, offset = 0 }) =>
    apiJson(
      apiUrls.musicAlbums({
        root: rootId,
        pathPrefix: pathPrefix || undefined,
        limit,
        offset,
      })
    );

  const listArtists = ({ rootId, pathPrefix, limit = 50, offset = 0 }) =>
    apiJson(
      apiUrls.musicArtists({
        root: rootId,
        pathPrefix: pathPrefix || undefined,
        limit,
        offset,
      })
    );

  const listAlbumTracks = ({ rootId, key, pathPrefix }) =>
    apiJson(
      apiUrls.musicAlbum({
        root: rootId,
        key,
        pathPrefix: pathPrefix || undefined,
      })
    );

  const listArtistTracks = ({ rootId, artist, pathPrefix }) =>
    apiJson(
      apiUrls.musicArtist({
        root: rootId,
        artist,
        pathPrefix: pathPrefix || undefined,
      })
    );

  return {
    listDirectory,
    searchEntries,
    listMedia,
    listAlbums,
    listArtists,
    listAlbumTracks,
    listArtistTracks,
  };
}
