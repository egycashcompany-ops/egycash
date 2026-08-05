// Provider selection: STORAGE_DRIVER decides once at boot; misconfiguration
// fails the boot loudly (ADR-007 spirit), never at first upload.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, isTest, storageLocalRootIsExplicit } from '../config/env';
import { logger } from '../logging/logger';
import { LocalDiskProvider } from './local-disk.provider';
import { S3Provider } from './s3.provider';
import { AzureBlobProvider } from './azure-blob.provider';
import { type StorageProvider } from './storage-provider';

/**
 * Where the `railway` driver keeps its bytes — and the one configuration it must refuse.
 *
 * Railway injects `RAILWAY_VOLUME_MOUNT_PATH` only when a volume is actually attached to the
 * service. When it is absent there is nothing to fall back to that KEEPS anything: the container's
 * own filesystem is rebuilt on every deploy. Uploads still succeed, their database rows still
 * survive, and the bytes are gone by the next release — a data loss nothing reports, because
 * everything except the final byte read is satisfied by the row alone. A stored file that reads
 * back as "this record simply has no image" is worse than an upload that never happened.
 *
 * An explicit `STORAGE_LOCAL_ROOT` is an operator saying "the disk is over there", and is honoured;
 * only the silent default is refused. Pure, so the rule is testable without an environment.
 */
export const railwayStorageRoot = (input: {
  volumeMountPath: string;
  localRoot: string;
  localRootIsExplicit: boolean;
}): string => {
  if (input.volumeMountPath !== '') return input.volumeMountPath;
  if (input.localRootIsExplicit) return input.localRoot;
  throw new Error(
    'STORAGE_DRIVER=railway requires persistent storage: attach a Volume to this service ' +
      '(Railway then injects RAILWAY_VOLUME_MOUNT_PATH), or set STORAGE_LOCAL_ROOT to a path that ' +
      'survives a deploy. Refusing to write uploads to the container filesystem, which every ' +
      'deploy erases — the records would outlive their files.',
  );
};

const buildProvider = (): StorageProvider => {
  if (isTest) {
    return new LocalDiskProvider(join(tmpdir(), 'ecms-test-storage'));
  }
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalDiskProvider(env.STORAGE_LOCAL_ROOT);
    case 'railway':
      return new LocalDiskProvider(
        railwayStorageRoot({
          volumeMountPath: env.RAILWAY_VOLUME_MOUNT_PATH,
          localRoot: env.STORAGE_LOCAL_ROOT,
          localRootIsExplicit: storageLocalRootIsExplicit,
        }),
        'railway',
      );
    case 's3':
      return new S3Provider({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        endpoint: env.S3_ENDPOINT === '' ? undefined : env.S3_ENDPOINT,
      });
    case 'minio':
      return new S3Provider(
        {
          bucket: env.S3_BUCKET,
          region: env.S3_REGION,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          endpoint: env.S3_ENDPOINT,
        },
        'minio',
      );
    case 'azure':
      return new AzureBlobProvider(
        env.AZURE_STORAGE_CONNECTION_STRING,
        env.AZURE_STORAGE_CONTAINER,
      );
  }
};

let provider: StorageProvider | null = null;

export const getStorageProvider = (): StorageProvider => {
  if (provider === null) {
    provider = buildProvider();
    logger.info({ driver: provider.driver }, 'storage provider ready');
  }
  return provider;
};

/** Test-only: swap the provider (e.g. a failing fake). */
export const setStorageProviderForTests = (override: StorageProvider | null): void => {
  provider = override;
};

export { LocalDiskProvider } from './local-disk.provider';
export { S3Provider, type S3ProviderConfig } from './s3.provider';
export { AzureBlobProvider } from './azure-blob.provider';
export {
  assertSafeKey,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
} from './storage-provider';
