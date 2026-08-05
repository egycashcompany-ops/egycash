// A file record whose bytes are gone.
//
// This is not hypothetical: it is what a container filesystem does to every upload on the next
// deploy. The record is perfect — the list returns it, a download ticket is issued for it, the
// signature verifies — and only the final byte read finds nothing. It used to surface as a 500
// "Unexpected error", which every image on every screen renders as its own empty state: the record
// looked like one that never had a file.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { hmacSha256 } from '../../shared/utils/crypto';
import { env } from '../../infrastructure/config/env';
import { setStorageProviderForTests, type StorageProvider } from '../../infrastructure/storage';
import { AppError } from '../../shared/errors';

vi.mock('./file.repository', () => ({
  fileRepository: { findById: vi.fn(), getById: vi.fn() },
}));

const { fileService } = await import('./file.service');
const { fileRepository } = await import('./file.repository');

const FILE_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
const expiry = Math.floor(Date.now() / 1000) + 300;
const signature = hmacSha256(env.STORAGE_SIGNING_SECRET, `${FILE_ID}.${expiry}`);

const docWithoutBytes = {
  _id: new Types.ObjectId(FILE_ID),
  mime: 'image/png',
  size: 70,
  displayName: 'logo',
  extension: '.png',
  scanStatus: 'unscanned',
  storage: { driver: 'railway', key: 'files/abc/1-def.png' },
};

/** A store that lost its contents — `getStream` is the only method reached. */
const emptyStore = {
  driver: 'railway',
  put: vi.fn(),
  delete: vi.fn(),
  getSignedUrl: vi.fn(),
  getStream: vi.fn().mockRejectedValue(
    Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
  ),
} as unknown as StorageProvider;

afterEach(() => {
  setStorageProviderForTests(null);
  vi.mocked(fileRepository.findById).mockReset();
  vi.mocked(emptyStore.getStream).mockClear();
});

describe('a stored object that is no longer there', () => {
  it('answers 404 FILE_OBJECT_MISSING, not a generic server error', async () => {
    setStorageProviderForTests(emptyStore);
    vi.mocked(fileRepository.findById).mockResolvedValue(
      docWithoutBytes as unknown as Awaited<ReturnType<typeof fileRepository.findById>>,
    );

    const failure = await fileService
      .openSignedStream(FILE_ID, expiry, signature)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe(ErrorCodes.FILE_OBJECT_MISSING);
    expect((failure as AppError).httpStatus).toBe(404);
  });

  it('still rejects a bad signature before ever touching storage', async () => {
    setStorageProviderForTests(emptyStore);
    await expect(fileService.openSignedStream(FILE_ID, expiry, 'deadbeef')).rejects.toMatchObject({
      code: ErrorCodes.FILE_SIGNATURE_INVALID,
    });
    expect(vi.mocked(emptyStore.getStream)).not.toHaveBeenCalled();
  });
});
