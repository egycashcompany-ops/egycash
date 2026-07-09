// Local filesystem provider — also serves the Railway volume (a mounted disk):
// the `railway` driver is this provider rooted at RAILWAY_VOLUME_MOUNT_PATH.
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Readable } from 'node:stream';
import { type StorageDriver } from '@ecms/contracts';
import { assertSafeKey, type PutOptions, type StorageProvider } from './storage-provider';

export class LocalDiskProvider implements StorageProvider {
  constructor(
    private readonly root: string,
    readonly driver: StorageDriver = 'local',
  ) {}

  private pathFor(key: string): string {
    assertSafeKey(key);
    return resolve(join(this.root, key));
  }

  async put(key: string, data: Buffer, _options: PutOptions): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await access(path); // surface a clean error before piping
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  // Disks cannot presign — the app-level HMAC endpoint takes over.
  async getSignedUrl(): Promise<string | null> {
    return null;
  }
}
