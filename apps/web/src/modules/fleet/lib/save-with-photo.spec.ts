// A receipt saved, then its photo: a refused photo must not read as a refused receipt, or the
// clerk presses Save again and the card pays twice.
import { describe, expect, it, vi } from 'vitest';
import { saveThenAttachPhoto } from './save-with-photo';

const photo = { name: 'receipt.heic' } as File;

describe('saving a record, then its photo', () => {
  it('saves once and uploads the photo against the saved record', async () => {
    const save = vi.fn(async () => ({ id: 'r-1' }));
    const upload = vi.fn(async () => undefined);
    await expect(saveThenAttachPhoto(save, photo, upload)).resolves.toEqual({
      saved: { id: 'r-1' },
      photo: 'uploaded',
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('r-1', photo);
  });

  it('uploads nothing when no photo was picked', async () => {
    const upload = vi.fn(async () => undefined);
    await expect(saveThenAttachPhoto(async () => ({ id: 'r-1' }), null, upload)).resolves.toEqual({
      saved: { id: 'r-1' },
      photo: 'none',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports a refused photo instead of throwing — the record IS saved, and saved once', async () => {
    const save = vi.fn(async () => ({ id: 'r-1' }));
    const upload = vi.fn(async () => {
      throw new Error('415 unsupported image');
    });
    await expect(saveThenAttachPhoto(save, photo, upload)).resolves.toEqual({
      saved: { id: 'r-1' },
      photo: 'failed',
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('still throws when the save itself fails — nothing was written, the form stays to retry', async () => {
    const upload = vi.fn(async () => undefined);
    await expect(
      saveThenAttachPhoto(
        async () => {
          throw new Error('409 version');
        },
        photo,
        upload,
      ),
    ).rejects.toThrow('409 version');
    expect(upload).not.toHaveBeenCalled();
  });
});
