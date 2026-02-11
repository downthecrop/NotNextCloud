import { ALL_ROOTS_ID } from '../constants';
import { useApi } from './useApi';

export function useTrashApi() {
  const { apiJson, apiUrls } = useApi();
  const request = (urlFactory, params) => apiJson(urlFactory(params));
  const post = (urlFactory, body) =>
    apiJson(urlFactory(), {
      method: 'POST',
      body: JSON.stringify(body),
    });

  const listTrash = ({ rootId = ALL_ROOTS_ID, limit = 50, offset = 0 }) =>
    request(apiUrls.trash, {
      root: rootId,
      limit,
      offset,
    });

  const deletePaths = ({ rootId, paths }) =>
    post(apiUrls.delete, { root: rootId, paths });

  const restoreTrash = (ids) => post(apiUrls.trashRestore, { ids });

  const deleteTrash = (ids) => post(apiUrls.trashDelete, { ids });

  const clearTrash = (rootId = ALL_ROOTS_ID) => post(apiUrls.trashClear, { root: rootId });

  return {
    listTrash,
    deletePaths,
    restoreTrash,
    deleteTrash,
    clearTrash,
  };
}
