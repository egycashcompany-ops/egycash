// The vehicle check's photos (docs/12-planning/it-vehicle-checks-design.md §2 item 5, §6.3): which
// photo is taken and in what form, and how they go up once the report is filed.
//
// A PHOTO GOES UP AFTER THE REPORT, never with it: the report must exist before anything is filed
// against it. So, as with Fleet's `saveThenAttachPhoto`, a failed upload is an OUTCOME, never a
// throw — the report is filed whatever became of its photos, and the sent view says which did not
// go up. Each photo carries its own `clientPhotoId`, so sending a photo again (after a lost answer)
// returns the report as it is and never takes a second of the five places.
import {
  IT_VEHICLE_CHECK_MAX_PHOTOS,
  IT_VEHICLE_CHECK_PHOTO_MAX_MB,
  IT_VEHICLE_CHECK_PHOTO_MIME_TYPES,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

/** At most five photos on one report. */
export const VEHICLE_CHECK_MAX_PHOTOS = IT_VEHICLE_CHECK_MAX_PHOTOS;

/** The server's own cap per photo, in bytes (the file category's 10 MB). */
export const VEHICLE_CHECK_PHOTO_MAX_BYTES = IT_VEHICLE_CHECK_PHOTO_MAX_MB * 1024 * 1024;

/** The device's file dialog offers what the server takes: JPEG, PNG, WebP. */
export const VEHICLE_CHECK_PHOTO_ACCEPT = IT_VEHICLE_CHECK_PHOTO_MIME_TYPES.join(',');

/** Each photo is drawn again as a JPEG this size before it goes up (`downscaleToJpeg`). */
export const VEHICLE_CHECK_PHOTO_DOWNSCALE = { maxSide: 1600, quality: 0.82 } as const;

const ACCEPTED: readonly string[] = IT_VEHICLE_CHECK_PHOTO_MIME_TYPES;

/** Why a picked photo is not taken — each a toast on the page. */
export type PhotoRefusal = 'type' | 'size';

/**
 * Which bytes go up for one picked photo.
 *
 * The browser drew it again (`downscaled` is a JPEG): that is what is sent, whatever the original
 * was — a HEIC the browser can read included. The browser could NOT decode it (`downscaled` is
 * null): the original goes up as it is, when the server would take it — JPEG, PNG or WebP, at most
 * 10 MB — and is refused otherwise, by type first, then by size.
 */
export const photoToSend = (
  original: Pick<Blob, 'type' | 'size'>,
  downscaled: Blob | null,
): { blob: 'downscaled' } | { blob: 'original' } | { refused: PhotoRefusal } => {
  if (downscaled !== null && downscaled.size <= VEHICLE_CHECK_PHOTO_MAX_BYTES) {
    return { blob: 'downscaled' };
  }
  if (!ACCEPTED.includes(original.type)) return { refused: 'type' };
  if (original.size > VEHICLE_CHECK_PHOTO_MAX_BYTES) return { refused: 'size' };
  return { blob: 'original' };
};

/**
 * The name a photo goes up under. The server names the stored file itself
 * (`vehicle-check-<day>-<car>-<n>.jpg`); this only keeps the extension honest.
 */
export const photoFileName = (type: string, index: number): string => {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `photo-${String(index + 1)}.${ext}`;
};

/** How many more photos the report takes. */
export const photoRoom = (held: number): number => Math.max(0, VEHICLE_CHECK_MAX_PHOTOS - held);

// ── Uploading, one at a time ──────────────────────────────────────────────────────────────────

/** One photo as it goes up: its own id, the bytes, and the name they go up under. */
export interface VehicleCheckPhotoUpload {
  clientPhotoId: string;
  file: Blob;
  fileName: string;
}

/**
 * What became of one photo:
 *  • `uploaded` — it is on the report;
 *  • `failed` — no answer, a network error or a 5xx: kept for «إعادة رفع الصور», which sends it
 *    again with the same `clientPhotoId`;
 *  • `refused` — a 4xx, with its code (the limit, the window, the type, the size): sending it
 *    again would be refused again, so it is never retried.
 */
export type PhotoOutcome<P> =
  | { photo: P; status: 'uploaded' }
  | { photo: P; status: 'failed' }
  | { photo: P; status: 'refused'; code: string };

/** A failure is an unknown outcome — worth one more try — unless the server answered 4xx. */
const outcomeOf = <P>(photo: P, error: unknown): PhotoOutcome<P> =>
  error instanceof ApiError && error.status >= 400 && error.status < 500
    ? { photo, status: 'refused', code: error.code }
    : { photo, status: 'failed' };

/**
 * Send the photos to one report, in the order they were added, ONE AT A TIME: a phone on mobile
 * data sends one photo faster than five at once, and the server keeps them in the order they
 * arrive. Never throws — every photo gets exactly one outcome.
 */
export const uploadPhotosInOrder = async <P extends { clientPhotoId: string }>(
  reportId: string,
  photos: readonly P[],
  upload: (reportId: string, photo: P) => Promise<unknown>,
): Promise<PhotoOutcome<P>[]> => {
  const outcomes: PhotoOutcome<P>[] = [];
  for (const photo of photos) {
    try {
      await upload(reportId, photo);
      outcomes.push({ photo, status: 'uploaded' });
    } catch (error) {
      outcomes.push(outcomeOf(photo, error));
    }
  }
  return outcomes;
};

/** The sent view's photo line, from the outcomes so far. */
export interface PhotoTally<P> {
  uploaded: number;
  /** For «إعادة رفع الصور». */
  failed: P[];
  /** Dropped from the retry list, each with the server's code — «لم تُرفع n صور:». */
  refused: { photo: P; code: string }[];
}

export const tallyPhotos = <P>(outcomes: readonly PhotoOutcome<P>[]): PhotoTally<P> => ({
  uploaded: outcomes.filter((o) => o.status === 'uploaded').length,
  failed: outcomes.flatMap((o) => (o.status === 'failed' ? [o.photo] : [])),
  refused: outcomes.flatMap((o) =>
    o.status === 'refused' ? [{ photo: o.photo, code: o.code }] : [],
  ),
});

/** Why a refused photo was refused — one reason per code, for the sent view. */
export type PhotoRefusalReason = 'limit' | 'window' | 'tooLarge' | 'badType' | 'other';

export const photoRefusalReason = (code: string): PhotoRefusalReason => {
  switch (code) {
    case 'IT_VEHICLE_CHECK_PHOTO_LIMIT':
      return 'limit';
    case 'IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED':
      return 'window';
    case 'FILE_TOO_LARGE':
      return 'tooLarge';
    case 'FILE_TYPE_NOT_ALLOWED':
      return 'badType';
    default:
      return 'other';
  }
};
