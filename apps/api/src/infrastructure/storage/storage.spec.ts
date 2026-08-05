import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { railwayStorageRoot } from './index';
import { LocalDiskProvider } from './local-disk.provider';
import { S3Provider } from './s3.provider';
import { assertSafeKey } from './storage-provider';

describe('railwayStorageRoot', () => {
  it('uses the volume Railway injected', () => {
    expect(
      railwayStorageRoot({
        volumeMountPath: '/data',
        localRoot: './storage',
        localRootIsExplicit: false,
      }),
    ).toBe('/data');
  });

  it('honours an explicitly configured root when there is no volume', () => {
    expect(
      railwayStorageRoot({
        volumeMountPath: '',
        localRoot: '/mnt/files',
        localRootIsExplicit: true,
      }),
    ).toBe('/mnt/files');
  });

  // The regression this whole change exists for: without a volume the driver used to fall back to
  // `./storage` INSIDE the container. Uploads succeeded, their rows persisted, and the bytes were
  // erased by the next deploy — the records outlived their files and nothing said so.
  it('refuses the container filesystem — no volume and no configured root is a boot failure', () => {
    expect(() =>
      railwayStorageRoot({
        volumeMountPath: '',
        localRoot: './storage',
        localRootIsExplicit: false,
      }),
    ).toThrow(/requires persistent storage/);
  });
});

describe('assertSafeKey', () => {
  it.each([['../etc/passwd'], ['/abs/path'], ['a\\b'], ['a\0b'], ['files/../../x']])(
    'rejects %s',
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(/unsafe storage key/);
    },
  );

  it('accepts service-generated keys', () => {
    expect(() => assertSafeKey('files/64b1f0/1-uuid.pdf')).not.toThrow();
  });
});

describe('LocalDiskProvider', () => {
  let root: string;
  let provider: LocalDiskProvider;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ecms-storage-spec-'));
    provider = new LocalDiskProvider(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips put → getStream → delete', async () => {
    const key = 'files/group1/1-abc.txt';
    const payload = Buffer.from('chain of custody', 'utf8');
    await provider.put(key, payload, { contentType: 'text/plain' });

    const stream = await provider.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('chain of custody');

    await provider.delete(key);
    await expect(provider.getStream(key)).rejects.toThrow();
  });

  it('delete is idempotent and cannot presign (app signing takes over)', async () => {
    await expect(provider.delete('files/never/existed.bin')).resolves.toBeUndefined();
    await expect(provider.getSignedUrl()).resolves.toBeNull();
  });

  it('blocks path traversal through keys', async () => {
    await expect(
      provider.put('../outside.txt', Buffer.from('x'), { contentType: 'text/plain' }),
    ).rejects.toThrow(/unsafe storage key/);
  });
});

describe('S3Provider configuration (fails the boot loudly, no network)', () => {
  it('rejects missing credentials', () => {
    expect(
      () =>
        new S3Provider({ bucket: '', region: 'us-east-1', accessKeyId: '', secretAccessKey: '' }),
    ).toThrow(/requires S3_BUCKET/);
  });

  it('rejects minio without an endpoint', () => {
    expect(
      () =>
        new S3Provider(
          { bucket: 'b', region: 'r', accessKeyId: 'k', secretAccessKey: 's' },
          'minio',
        ),
    ).toThrow(/requires S3_ENDPOINT/);
  });

  it('accepts a complete minio configuration', () => {
    const provider = new S3Provider(
      {
        bucket: 'b',
        region: 'r',
        accessKeyId: 'k',
        secretAccessKey: 's',
        endpoint: 'http://localhost:9000',
      },
      'minio',
    );
    expect(provider.driver).toBe('minio');
  });
});
