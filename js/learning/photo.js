// Client-side photo prep before upload — downscale + EXIF-orientation
// correction (plan Phase G / review finding I4: a naive canvas draw can
// silently ignore EXIF rotation and store a sideways page). createImageBitmap
// with imageOrientation:"from-image" bakes the correct rotation into the
// decoded bitmap, so nothing downstream needs to special-case orientation.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

// Decodes via createImageBitmap, which bakes in EXIF orientation itself.
async function decodeViaBitmap(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

// Fallback for formats createImageBitmap chokes on in some browsers (e.g.
// Safari has a history of failing to decode HEIC here even though it
// displays fine in an <img> via the OS-level decoder). Browsers auto-apply
// EXIF orientation when drawing an <img> to canvas, so this stays upright
// without extra logic.
async function decodeViaImg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't decode that photo."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// file: a File from <input type=file>. Returns a Blob (JPEG), always
// upright and no larger than MAX_EDGE on its longest side.
export async function prepPhoto(file) {
  let canvas;
  try {
    canvas = await decodeViaBitmap(file);
  } catch (e1) {
    try {
      canvas = await decodeViaImg(file);
    } catch (e2) {
      throw new Error(`Couldn't process that photo (${e1.name || e1.message}).`);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that photo."))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

// Preps a whole batch and reports per-file failures without throwing away
// the ones that succeeded, so the caller can decide (per plan Phase G
// decision #11, all-or-nothing: any failure here means the caller shows one
// error and uploads nothing).
export async function prepPhotoBatch(files) {
  const results = [];
  for (const file of files) {
    try {
      results.push({ file, blob: await prepPhoto(file), ok: true });
    } catch (e) {
      results.push({ file, ok: false, error: e.message || "Couldn't process that photo." });
    }
  }
  return results;
}
