// Each photo of the bulk upload, made ready the way the profile's own photo is.
//
// The profile's dialog cuts every photo it is given to the ID card's head-and-shoulders frame, by
// finding the face (`face-crop/a4-face.ts`): «قص الوجه». A photo uploaded in bulk is the same
// photo on the same card, so it is cut the same way, here, in the browser — only the crop travels.
//
// A photo with NO face found is not lost: it goes as it is, as the profile's dialog keeps it, and
// its row says so, so HR can look at it and crop it by hand from the profile. When it is larger
// than the server accepts (5 MB) it is shrunk first, in its own proportions, so a camera's photo
// never needs editing before it is picked. A picture that cannot be opened at all fails instead.
import { EMPLOYEE_PHOTO_MAX_MB, EMPLOYEE_PHOTO_MIME_TYPES } from '@ecms/contracts';
import { cropToFile, locateFace, readyFaceSearch } from '../face-crop/a4-face';

export { readyFaceSearch };

export const PHOTO_MAX_BYTES = EMPLOYEE_PHOTO_MAX_MB * 1024 * 1024;
/** The longest side a shrunk photo keeps: plenty for a card and a profile. */
export const SHRINK_LONG_SIDE = 1600;
/** The JPEG qualities tried, best first, until the shrunk photo is under the limit. */
export const SHRINK_QUALITIES: readonly number[] = [0.88, 0.75, 0.6, 0.45];

export interface PreparedPhoto {
  file: File;
  /** Cut to the card's frame around the face found. */
  cropped: boolean;
  /** No face was found: the photo goes uncropped. */
  noFace: boolean;
  /** Made smaller to fit the server's limit. */
  shrunk: boolean;
}

/** Does this photo, as it is, pass the server's own rule? */
export const fitsAsIs = (file: Pick<File, 'size' | 'type'>): boolean =>
  (EMPLOYEE_PHOTO_MIME_TYPES as readonly string[]).includes(file.type) && file.size <= PHOTO_MAX_BYTES;

/** A size that fits `longSide`, in the picture's own proportions (never enlarged). */
export const shrinkSize = (
  width: number,
  height: number,
  longSide: number = SHRINK_LONG_SIDE,
): { width: number; height: number } => {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const shrink = async (file: File, name: string): Promise<File> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = shrinkSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  for (const quality of SHRINK_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob !== null && blob.size <= PHOTO_MAX_BYTES) {
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    }
  }
  throw new Error('the photo could not be made small enough');
};

/**
 * The photo to upload for one employee: cut to the card's frame around the face, else the photo as
 * it is (shrunk when over the limit). `name` names the file sent — the employee's code.
 *
 * A picture this browser cannot open at all — a copy cut short, a HEIC renamed `.jpg` — throws, and
 * its row fails: sent as it is, it would replace a photo that works with one that shows nothing.
 */
/** The picture could not be opened in this browser: its row fails and nothing is sent. */
export class UnreadablePhotoError extends Error {
  constructor() {
    super('the picture could not be opened');
    this.name = 'UnreadablePhotoError';
  }
}

export const prepareBatchPhoto = async (file: File, name: string): Promise<PreparedPhoto> => {
  let located: Awaited<ReturnType<typeof locateFace>>;
  try {
    located = await locateFace(file);
  } catch {
    throw new UnreadablePhotoError();
  }
  const { sheet, crop } = located;
  if (crop !== null) {
    const cut = await cropToFile(sheet, crop, `${name}.jpg`);
    return { file: cut, cropped: true, noFace: false, shrunk: false };
  }
  if (fitsAsIs(file)) return { file, cropped: false, noFace: true, shrunk: false };
  return { file: await shrink(file, name), cropped: false, noFace: true, shrunk: true };
};
