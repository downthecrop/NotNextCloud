import { useApi } from './useApi';

export function useTrashApi() {
  const { apiJson, apiUrls } = useApi();

  const listTrash = ({ rootId = '__all__', limit = 50, offset = 0 }) =>
    apiJson(
      apiUrls.trash({
        root: rootId,
        limit,
        offset,
      })
    );

  const deletePaths = ({ rootId, paths }) =>
    apiJson(apiUrls.delete(), {
      method: 'POST',
      body: JSON.stringify({ root: rootId, paths }),
    });

  const restoreTrash = (ids) =>
    apiJson(apiUrls.trashRestore(), {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

  const deleteTrash = (ids) =>
    apiJson(apiUrls.trashDelete(), {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

  const clearTrash = (rootId = '__all__') =>
    apiJson(apiUrls.trashClear(), {
      method: 'POST',
      body: JSON.stringify({ root: rootId }),
    });

  return {
    listTrash,
    deletePaths,
    restoreTrash,
    deleteTrash,
    clearTrash,
  };
}
