// The vehicle check's photos (docs/12-planning/it-vehicle-checks-design.md §6.3): the upload loop
// against a fake upload (the order, one at a time, the three outcomes), the type and size check,
// and the rule for a photo the browser cannot decode.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/lib/api-client';
import {
  VEHICLE_CHECK_MAX_PHOTOS,
  VEHICLE_CHECK_PHOTO_ACCEPT,
  VEHICLE_CHECK_PHOTO_MAX_BYTES,
  photoFileName,
  photoRefusalReason,
  photoRoom,
  photoToSend,
  tallyPhotos,
  uploadPhotosInOrder,
} from './vehicle-check-photos';

const MB = 1024 * 1024;
const photo = (n: number): { clientPhotoId: string; n: number } => ({
  clientPhotoId: `00000000-0000-4000-8000-00000000000${String(n)}`,
  n,
});

describe('uploadPhotosInOrder', () => {
  it('sends them in the order they were added, one at a time', async () => {
    const log: string[] = [];
    let inFlight = 0;
    let most = 0;
    const upload = async (reportId: string, p: { n: number }): Promise<void> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      log.push(`${reportId}:${String(p.n)}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
    };
    const outcomes = await uploadPhotosInOrder('r1', [photo(1), photo(2), photo(3)], upload);
    expect(log).toEqual(['r1:1', 'r1:2', 'r1:3']);
    expect(most, 'never two at once').toBe(1);
    expect(outcomes.map((o) => o.status)).toEqual(['uploaded', 'uploaded', 'uploaded']);
  });

  it('gives every photo exactly one of the three outcomes, and never throws', async () => {
    const upload = (_id: string, p: { n: number }): Promise<void> => {
      if (p.n === 2) return Promise.reject(new TypeError('Failed to fetch'));
      if (p.n === 3) return Promise.reject(new ApiError('INTERNAL', 'boom', 502));
      if (p.n === 4) {
        return Promise.reject(
          new ApiError('IT_VEHICLE_CHECK_PHOTO_LIMIT', 'limit', 422),
        );
      }
      if (p.n === 5) return Promise.reject(new ApiError('NOT_FOUND', 'gone', 404));
      return Promise.resolve();
    };
    const outcomes = await uploadPhotosInOrder(
      'r1',
      [photo(1), photo(2), photo(3), photo(4), photo(5)],
      upload,
    );
    expect(outcomes).toEqual([
      { photo: photo(1), status: 'uploaded' },
      // No answer or a 5xx: kept for «إعادة رفع الصور».
      { photo: photo(2), status: 'failed' },
      { photo: photo(3), status: 'failed' },
      // A 4xx: refused with its code, never retried.
      { photo: photo(4), status: 'refused', code: 'IT_VEHICLE_CHECK_PHOTO_LIMIT' },
      { photo: photo(5), status: 'refused', code: 'NOT_FOUND' },
    ]);
  });

  it('goes on after a failure — one photo does not stop the rest', async () => {
    const sent: number[] = [];
    const upload = (_id: string, p: { n: number }): Promise<void> => {
      sent.push(p.n);
      return p.n === 1 ? Promise.reject(new TypeError('offline')) : Promise.resolve();
    };
    await uploadPhotosInOrder('r1', [photo(1), photo(2)], upload);
    expect(sent).toEqual([1, 2]);
  });

  it('tallies what the sent view says: uploaded, the retry list, the refused with their codes', async () => {
    const upload = (_id: string, p: { n: number }): Promise<void> =>
      p.n === 2
        ? Promise.reject(new TypeError('offline'))
        : p.n === 3
          ? Promise.reject(new ApiError('IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED', 'late', 422))
          : Promise.resolve();
    const tally = tallyPhotos(await uploadPhotosInOrder('r1', [photo(1), photo(2), photo(3)], upload));
    expect(tally.uploaded).toBe(1);
    expect(tally.failed).toEqual([photo(2)]);
    expect(tally.refused).toEqual([
      { photo: photo(3), code: 'IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED' },
    ]);
  });

  it('names a reason for each refusal code', () => {
    expect(photoRefusalReason('IT_VEHICLE_CHECK_PHOTO_LIMIT')).toBe('limit');
    expect(photoRefusalReason('IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED')).toBe('window');
    expect(photoRefusalReason('FILE_TOO_LARGE')).toBe('tooLarge');
    expect(photoRefusalReason('FILE_TYPE_NOT_ALLOWED')).toBe('badType');
    expect(photoRefusalReason('NOT_FOUND')).toBe('other');
  });
});

describe('the type and size the server takes', () => {
  it('offers JPEG, PNG and WebP in the file dialog', () => {
    expect(VEHICLE_CHECK_PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });

  it('caps a photo at 10 MB, and a report at five', () => {
    expect(VEHICLE_CHECK_PHOTO_MAX_BYTES).toBe(10 * MB);
    expect(VEHICLE_CHECK_MAX_PHOTOS).toBe(5);
    expect(photoRoom(0)).toBe(5);
    expect(photoRoom(4)).toBe(1);
    expect(photoRoom(5)).toBe(0);
    expect(photoRoom(7)).toBe(0);
  });

  it('names a photo by its type', () => {
    expect(photoFileName('image/jpeg', 0)).toBe('photo-1.jpg');
    expect(photoFileName('image/png', 1)).toBe('photo-2.png');
    expect(photoFileName('image/webp', 2)).toBe('photo-3.webp');
  });
});

describe('photoToSend — the decode-failure rule', () => {
  const jpeg = new Blob(['x'], { type: 'image/jpeg' });

  it('sends the downscaled JPEG whenever the browser drew one — whatever the original', () => {
    expect(photoToSend({ type: 'image/heic', size: 3 * MB }, jpeg)).toEqual({ blob: 'downscaled' });
    expect(photoToSend({ type: 'image/jpeg', size: 30 * MB }, jpeg)).toEqual({
      blob: 'downscaled',
    });
  });

  it('sends the original when it cannot be decoded but the server takes it', () => {
    expect(photoToSend({ type: 'image/png', size: 2 * MB }, null)).toEqual({ blob: 'original' });
    expect(photoToSend({ type: 'image/webp', size: 10 * MB }, null)).toEqual({ blob: 'original' });
  });

  it('refuses an undecodable original of another type', () => {
    expect(photoToSend({ type: 'image/heic', size: 2 * MB }, null)).toEqual({ refused: 'type' });
    expect(photoToSend({ type: '', size: 1 }, null)).toEqual({ refused: 'type' });
  });

  it('refuses an undecodable original over 10 MB', () => {
    expect(photoToSend({ type: 'image/jpeg', size: 10 * MB + 1 }, null)).toEqual({
      refused: 'size',
    });
  });
});
