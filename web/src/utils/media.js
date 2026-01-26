export function isImage(item) {
  return item?.mime?.startsWith('image/');
}

export function isVideo(item) {
  return item?.mime?.startsWith('video/');
}

export function isAudio(item) {
  return item?.mime?.startsWith('audio/');
}

export function isMedia(item) {
  return isImage(item) || isVideo(item) || isAudio(item);
}
