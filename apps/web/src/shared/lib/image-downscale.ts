// A photo made small enough to send from a phone, in the browser.
//
// A phone's camera writes 4000 × 3000 pixels and three to eight megabytes a photo; a report of five
// of them over mobile data is a long wait at a car's door, and the server keeps every byte (it never
// decodes an image). So a photo is drawn again before it goes up — its longest edge at most
// `maxSide`, as a JPEG — which also leaves the camera's location data behind: a canvas carries no
// EXIF. First used by IT's «فحص أجهزة السيارة» (docs/12-planning/it-vehicle-checks-design.md §6.3).
//
// Fleet's fuel-card thumbnail (`fleet/lib/fuel-card-thumb.ts`) is NOT this: its blur hides a card's
// PIN, and that path stays as it is. `fitWithin` is a copy of its `thumbSize` rule.

/**
 * The size a photo is drawn at: the longest side brought to `maxSide`, the ratio kept, never
 * enlarged, each side at least 1px. A photo with no size gives `null`.
 */
export const fitWithin = (
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.min(maxSide, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxSide, Math.round(height * scale))),
  };
};

const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });

/**
 * The photo as a JPEG whose longest edge is at most `maxSide`, turned the way the camera held it
 * (`imageOrientation: 'from-image'`). `null` whenever the browser cannot decode the file — a HEIC
 * on a browser without it, a file that is not an image — or has no canvas: the caller then decides
 * what to do with the original.
 */
export const downscaleToJpeg = async (
  file: Blob,
  { maxSide = 1600, quality = 0.82 }: { maxSide?: number; quality?: number } = {},
): Promise<Blob | null> => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = fitWithin(bitmap.width, bitmap.height, maxSide);
    if (size === null) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await toJpeg(canvas, quality);
    return blob !== null && blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};
