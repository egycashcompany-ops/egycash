// The fuel card photo's thumbnail (6d), made in the browser. A card photo shows the PIN written on
// its sticker, so the FULL photo is served only to a holder of `fleetFuelCard.reveal`; everyone else
// sees a small blurred thumbnail. The server never decodes an image (no image library in the API):
// the go-live photos' thumbnails were made once with ImageMagick and committed, and a photo
// uploaded later carries its own, made here the same way — the longer side at most
// `FLEET_FUEL_CARD_THUMB_MAX_SIDE` pixels, a Gaussian blur of `FLEET_FUEL_CARD_THUMB_BLUR_PX`, then
// JPEG at `FLEET_FUEL_CARD_THUMB_JPEG_QUALITY`. At that size and blur the embossed digits and the
// sticker's handwriting cannot be read. The server only reads the file's header (type, both sides,
// bytes) and refuses anything larger.
//
// Made from the picked file before the upload, and — for a photo uploaded before this release —
// from the full photo an edit + reveal holder opens (a back-fill). Any failure (a browser without
// `createImageBitmap`, a HEIC it cannot read) gives `null`: the photo goes up without one and the
// card reads «no thumbnail» until someone with both grants opens it.
import {
  FLEET_FUEL_CARD_THUMB_BLUR_PX,
  FLEET_FUEL_CARD_THUMB_JPEG_QUALITY,
  FLEET_FUEL_CARD_THUMB_MAX_BYTES,
  FLEET_FUEL_CARD_THUMB_MAX_SIDE,
} from '@ecms/contracts';

/**
 * The thumbnail's size: the longer side brought down to `max`, the shorter in proportion (at least
 * one pixel); never enlarged. A photo with no size gives `null`.
 */
export const thumbSize = (
  width: number,
  height: number,
  max: number = FLEET_FUEL_CARD_THUMB_MAX_SIDE,
): { width: number; height: number } | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.min(max, Math.round(width * scale))),
    height: Math.max(1, Math.min(max, Math.round(height * scale))),
  };
};

/**
 * Without a canvas `filter` (an older Safari), the blur is made by drawing the photo this small and
 * scaling it back up: the same loss of detail, by a different road.
 */
export const FALLBACK_SIDE = 48;

/** The JPEG qualities tried in turn until the thumbnail fits `FLEET_FUEL_CARD_THUMB_MAX_BYTES`. */
export const THUMB_QUALITIES: readonly number[] = [FLEET_FUEL_CARD_THUMB_JPEG_QUALITY, 0.4, 0.3];

const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });

/** The blurred thumbnail of a picked or fetched photo; `null` whenever it cannot be made. */
export const makeFuelCardThumb = async (photo: Blob): Promise<Blob | null> => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
    const size = thumbSize(bitmap.width, bitmap.height);
    if (size === null) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    // `filter` is typed on every context, but an older Safari leaves it undefined.
    const filters = typeof (ctx as { filter?: unknown }).filter === 'string';
    if (filters) {
      ctx.filter = `blur(${FLEET_FUEL_CARD_THUMB_BLUR_PX}px)`;
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    } else {
      const small = thumbSize(size.width, size.height, FALLBACK_SIDE) ?? size;
      const step = document.createElement('canvas');
      step.width = small.width;
      step.height = small.height;
      step.getContext('2d')?.drawImage(bitmap, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(step, 0, 0, size.width, size.height);
    }
    for (const quality of THUMB_QUALITIES) {
      const blob = await toJpeg(canvas, quality);
      if (blob !== null && blob.size > 0 && blob.size <= FLEET_FUEL_CARD_THUMB_MAX_BYTES) {
        return blob;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};
