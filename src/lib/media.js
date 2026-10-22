// Getting photos and videos ready to upload, in the browser.

// A phone photo is 3-5MB at a size no screen on this site shows it at. Shrunk
// to 1600px on its longest side it still looks sharp on any screen, and takes
// a tenth of the storage: the photo store is a fixed free allowance.
const MAX_SIDE = 1600;
const SHRINK_OVER_BYTES = 400 * 1024;

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Browsers apply the photo's own rotation when drawing an <img>, so a
    // portrait phone photo stays upright.
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

/**
 * A smaller copy of a photo, or the photo itself when it is already small,
 * animated (GIF), or anything goes wrong: shrinking is a saving, never a
 * reason an upload fails.
 */
export async function shrinkImage(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_OVER_BYTES) return file;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    // WebP keeps a logo's see-through background. A browser that cannot make
    // WebP hands back PNG instead, which would often be bigger than the
    // original; a JPEG is fine as JPEG.
    let blob = await toBlob(canvas, 'image/webp', 0.82);
    if (blob?.type !== 'image/webp') blob = file.type === 'image/jpeg' ? await toBlob(canvas, 'image/jpeg', 0.82) : null;
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.\w+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg');
    return new File([blob], name, { type: blob.type });
  } catch {
    return file;
  }
}

/**
 * How long a video runs, in seconds, or null when this browser cannot read it
 * (some phone formats only play on the phone that made them). Null is not a
 * reason to refuse: the size limit still holds.
 */
export function videoSeconds(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (s) => { URL.revokeObjectURL(url); resolve(s); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

/**
 * Sends a video straight to storage with a link the server signed for it.
 * XMLHttpRequest rather than fetch, for the progress a 50MB upload needs.
 */
export function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The video did not upload. Please try again.')));
    xhr.onerror = () => reject(new Error('The video did not upload. Please check your connection and try again.'));
    xhr.send(file);
  });
}

// iOS shows a blank box for a video it has not started; asking for the first
// instant makes it draw the opening frame as the preview.
export const videoSrc = (url) => (url && !url.includes('#') ? `${url}#t=0.001` : url);
