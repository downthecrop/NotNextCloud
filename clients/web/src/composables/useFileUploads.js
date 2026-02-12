import { onMounted, onUnmounted, ref } from 'vue';

export function useFileUploads({
  apiJson,
  apiUrls,
  canUpload,
  getRootId,
  getCurrentPath,
  getUploadChunkBytes,
  getUploadOverwrite,
  onUploadComplete,
}) {
  const fileInput = ref(null);
  const dragActive = ref(false);
  const dragDepth = ref(0);
  const uploading = ref(false);
  const uploadMessage = ref('');
  const uploadErrors = ref([]);
  const uploadProgress = ref({ file: '', percent: 0 });

  const rootId = () => (typeof getRootId === 'function' ? getRootId() : null);
  const currentPath = () => (typeof getCurrentPath === 'function' ? getCurrentPath() : '');
  const chunkBytes = () => Math.max(1024 * 1024, Number(getUploadChunkBytes?.() || 0) || 8 * 1024 * 1024);
  const uploadOverwrite = () => Boolean(getUploadOverwrite?.());
  const canUploadNow = () => Boolean(canUpload?.value) && Boolean(rootId()) && !uploading.value;
  const hasFileDrag = (event) => event?.dataTransfer?.types?.includes('Files');

  function resetUploadState() {
    uploadMessage.value = '';
    uploadErrors.value = [];
    uploadProgress.value = { file: '', percent: 0 };
    dragDepth.value = 0;
    dragActive.value = false;
  }

  function openFilePicker() {
    if (!canUploadNow()) {
      return;
    }
    fileInput.value?.click();
  }

  function handleFileSelect(event) {
    const files = Array.from(event.target?.files || []);
    if (!files.length) {
      return;
    }
    event.target.value = '';
    uploadFiles(files);
  }

  function handleDragOver(event) {
    if (!canUploadNow() || !hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragActive.value = true;
  }

  function handleDragEnter(event) {
    if (!canUploadNow() || !hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepth.value += 1;
    dragActive.value = true;
  }

  function handleDragLeave(event) {
    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepth.value = Math.max(0, dragDepth.value - 1);
    if (dragDepth.value === 0) {
      dragActive.value = false;
    }
  }

  function handleDrop(event) {
    if (!canUploadNow() || !hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragActive.value = false;
    dragDepth.value = 0;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      return;
    }
    uploadFiles(files);
  }

  async function uploadFiles(files) {
    if (!Array.isArray(files) || !files.length || !canUploadNow()) {
      return;
    }
    const targetRootId = rootId();
    if (!targetRootId) {
      return;
    }
    uploading.value = true;
    uploadMessage.value = 'Uploading...';
    uploadErrors.value = [];
    uploadProgress.value = { file: '', percent: 0 };
    let stored = 0;
    let skipped = 0;
    const errors = [];
    try {
      for (const file of files) {
        const name = file.webkitRelativePath || file.name;
        if (!name) {
          skipped += 1;
          errors.push({ file: '(unknown)', error: 'Missing filename' });
          continue;
        }

        const getStatus = async (overwriteFlag) => {
          const result = await apiJson(
            apiUrls.uploadStatus({
              root: targetRootId,
              path: currentPath(),
              file: name,
              size: file.size,
              overwrite: overwriteFlag ? 1 : 0,
            })
          );
          if (!result.ok) {
            if (result.error?.code === 'exists') {
              return { status: 'exists' };
            }
            throw new Error(result.error?.message || 'Upload failed');
          }
          return result.data;
        };

        try {
          uploadProgress.value = { file: name, percent: 0 };
          uploadMessage.value = `Preparing ${name}...`;
          let overwriteFlag = uploadOverwrite();
          let status = await getStatus(overwriteFlag);
          if (status?.status === 'exists' && !overwriteFlag) {
            const confirmOverwrite = confirm(`"${name}" already exists. Overwrite it?`);
            if (!confirmOverwrite) {
              skipped += 1;
              errors.push({ file: name, error: 'File already exists' });
              continue;
            }
            overwriteFlag = true;
            status = await getStatus(true);
          }
          if (status?.status === 'complete') {
            stored += 1;
            uploadProgress.value = { file: name, percent: 100 };
            continue;
          }

          let offset = Number.isFinite(status?.offset) ? status.offset : 0;
          if (offset < 0 || offset > file.size) {
            offset = 0;
          }
          if (offset > 0) {
            uploadMessage.value = `Resuming ${name}...`;
          }

          while (offset < file.size) {
            const end = Math.min(file.size, offset + chunkBytes());
            const chunk = file.slice(offset, end);
            const percent = file.size ? Math.floor((offset / file.size) * 100) : 100;
            uploadProgress.value = { file: name, percent };
            uploadMessage.value = `Uploading ${name} (${percent}%)`;
            const response = await apiJson(
              apiUrls.uploadChunk({
                root: targetRootId,
                path: currentPath(),
                file: name,
                size: file.size,
                offset,
                overwrite: overwriteFlag ? 1 : 0,
              }),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunk,
              }
            );
            if (!response.ok) {
              if (response.error?.code === 'offset_mismatch') {
                const expected = Number(response.error?.details?.expectedOffset);
                if (Number.isFinite(expected) && expected >= 0 && expected <= file.size) {
                  offset = expected;
                  continue;
                }
              }
              throw new Error(response.error?.message || 'Upload failed');
            }
            const nextOffset = Number(response.data?.offset);
            if (!Number.isFinite(nextOffset) || nextOffset < offset || nextOffset > file.size) {
              throw new Error('Upload returned invalid offset');
            }
            offset = nextOffset;
          }

          uploadProgress.value = { file: name, percent: 100 };
          stored += 1;
        } catch (error) {
          skipped += 1;
          errors.push({ file: name, error: error?.message || 'Upload failed' });
        }
      }

      uploadMessage.value = `Uploaded ${stored} file${stored === 1 ? '' : 's'}${
        skipped ? `, skipped ${skipped}` : ''
      }.`;
      if (errors.length) {
        uploadErrors.value = errors.slice(0, 5);
      }
      await onUploadComplete?.();
    } finally {
      uploading.value = false;
    }
  }

  const handleWindowDragOver = (event) => {
    if (hasFileDrag(event)) {
      event.preventDefault();
    }
  };

  const handleWindowDrop = (event) => {
    if (hasFileDrag(event)) {
      event.preventDefault();
      dragDepth.value = 0;
      dragActive.value = false;
    }
  };

  onMounted(() => {
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
  });

  onUnmounted(() => {
    window.removeEventListener('dragover', handleWindowDragOver);
    window.removeEventListener('drop', handleWindowDrop);
  });

  return {
    fileInput,
    dragActive,
    uploading,
    uploadMessage,
    uploadErrors,
    uploadProgress,
    openFilePicker,
    handleFileSelect,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    uploadFiles,
    resetUploadState,
  };
}
