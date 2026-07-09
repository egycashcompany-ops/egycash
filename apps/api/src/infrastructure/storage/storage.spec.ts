import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskProvider } from './local-disk.provider';
import { S3Provider } from './s3.provider';
import { assertSafeKey } from './storage-provider';

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
