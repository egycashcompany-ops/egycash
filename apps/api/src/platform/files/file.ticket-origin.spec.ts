// A download ticket is handed to the BROWSER, so its URL has to be one the app's own document is
// allowed to load.
//
// The app sets its Content-Security-Policy and mints this URL in the same process from the same
// configuration, and until now neither knew about the other: with an object-store driver the
// provider's presigned URL is absolute and on the store's origin, `img-src 'self' data: blob:`
// refuses it, and the browser never issues a request. Nothing server-side sees a thing — the
// ticket is 200, the object is 200 — and every screen showing a stored image falls back to its
// empty state, which reads as "this record has no image".
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStorageProviderForTests, type StorageProvider } from '../../infrastructure/storage';
import { type AuthContext } from '../../shared/types';

vi.mock('./file.repository', () => ({ fileRepository: { getById: vi.fn() } }));
vi.mock('../audit', () => ({ auditService: { record: vi.fn().mockResolvedValue(undefined) } }));

const { fileService } = await import('./file.service');
const { fileRepository } = await import('./file.repository');

const FILE_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
const BUCKET = 'https://ecms-files.s3.eu-central-1.amazonaws.com';

const publicFile = {
  _id: new Types.ObjectId(FILE_ID),
  mime: 'image/png',
  size: 70,
  displayName: 'logo',
  extension: '.png',
  visibility: 'public',
  scanStatus: 'clean',
  storage: { driver: 's3', key: 'files/abc/1-def.png' },
};

/** `S3Provider`'s distinguishing behaviour: it CAN presign, and the URL is another origin. */
const presigningStore = {
  driver: 's3',
  put: vi.fn(),
  getStream: vi.fn(),
  delete: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue(`${BUCKET}/files/abc/1-def.png?X-Amz-Signature=abc`),
} as unknown as StorageProvider;

const ctx = { userId: new Types.ObjectId().toString(), permissions: {} } as unknown as AuthContext;

afterEach(() => {
  setStorageProviderForTests(null);
  vi.mocked(fileRepository.getById).mockReset();
  vi.mocked(presigningStore.getSignedUrl).mockClear();
});

describe('the URL a download ticket hands the browser', () => {
  it('stays on the app’s own origin even when the store can presign', async () => {
    setStorageProviderForTests(presigningStore);
    vi.mocked(fileRepository.getById).mockResolvedValue(
      publicFile as unknown as Awaited<ReturnType<typeof fileRepository.getById>>,
    );

    const ticket = await fileService.issueDownloadTicket(ctx, FILE_ID);

    // The app's own signed endpoint, never the bucket. Whether that comes out relative or absolute
    // is `signed-url.ts`'s decision (and its own spec's subject) — what matters here is that the
    // store's origin does not reach the browser at all.
    expect(ticket.url).not.toContain(BUCKET);
    expect(ticket.url).not.toContain('X-Amz-');
    expect(ticket.url).toContain(`/platform/files/signed/${FILE_ID}`);
  });

  it('does not even ask the store to presign while the option is off', async () => {
    setStorageProviderForTests(presigningStore);
    vi.mocked(fileRepository.getById).mockResolvedValue(
      publicFile as unknown as Awaited<ReturnType<typeof fileRepository.getById>>,
    );

    await fileService.issueDownloadTicket(ctx, FILE_ID);

    // Not merely "the presigned URL is unused" — the call is not made, so a store that charges or
    // rate-limits signing is untouched, and the default cannot be defeated by a provider that
    // ignores it.
    expect(vi.mocked(presigningStore.getSignedUrl)).not.toHaveBeenCalled();
  });
});
