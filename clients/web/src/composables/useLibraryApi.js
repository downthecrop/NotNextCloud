import { useApi } from './useApi';

export function useLibraryApi() {
  const { apiJson, apiUrls } = useApi();

  const request = (urlFactory, params) => apiJson(urlFactory(params));
  const withPathPrefix = (pathPrefix) => (pathPrefix ? { pathPrefix } : {});
  const requestWithRoot = (urlFactory, { rootId, pathPrefix, ...params }) =>
    request(urlFactory, { root: rootId, ...withPathPrefix(pathPrefix), ...params });

  const withPage = ({ limit = 50, offset = 0, cursor = null, includeTotal = true }) => {
    const base = cursor ? { limit, cursor } : { limit, offset };
    if (includeTotal === false) {
      return { ...base, includeTotal: false };
    }
    return base;
  };

  const requestPaged = (urlFactory, options) =>
    request(urlFactory, {
      root: options.rootId,
      ...withPathPrefix(options.pathPrefix),
      ...withPage(options),
      ...options.extra,
    });

  const listDirectory = ({
    rootId,
    path = '',
    limit = 50,
    offset = 0,
    cursor = null,
    includeTotal = true,
    sort,
  }) =>
    requestPaged(apiUrls.list, {
      rootId,
      limit,
      offset,
      cursor,
      includeTotal,
      extra: { path, sort: sort || undefined },
    });

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
    requestPaged(apiUrls.search, {
      rootId,
      pathPrefix,
      limit,
      offset,
      cursor,
      includeTotal,
      extra: { q: query, type },
    });

  const listMedia = ({
    rootId,
    type,
    pathPrefix,
    limit = 50,
    offset = 0,
    cursor = null,
    includeTotal = true,
  }) =>
    requestPaged(apiUrls.media, {
      rootId,
      pathPrefix,
      limit,
      offset,
      cursor,
      includeTotal,
      extra: { type },
    });

  const listAlbums = ({ rootId, pathPrefix, limit = 50, offset = 0 }) =>
    requestWithRoot(apiUrls.musicAlbums, { rootId, pathPrefix, limit, offset });

  const listArtists = ({ rootId, pathPrefix, limit = 50, offset = 0 }) =>
    requestWithRoot(apiUrls.musicArtists, { rootId, pathPrefix, limit, offset });

  const listAlbumTracks = ({ rootId, key, pathPrefix }) =>
    requestWithRoot(apiUrls.musicAlbum, { rootId, pathPrefix, key });

  const listArtistTracks = ({ rootId, artist, pathPrefix }) =>
    requestWithRoot(apiUrls.musicArtist, { rootId, pathPrefix, artist });

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
