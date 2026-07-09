// Provider selection: STORAGE_DRIVER decides once at boot; misconfiguration
// fails the boot loudly (ADR-007 spirit), never at first upload.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, isTest } from '../config/env';
import { logger } from '../logging/logger';
import { LocalDiskProvider } from './local-disk.provider';
import { S3Provider } from './s3.provider';
import { AzureBlobProvider } from './azure-blob.provider';
import { type StorageProvider } from './storage-provider';

const buildProvider = (): StorageProvider => {
  if (isTest) {
    return new LocalDiskProvider(join(tmpdir(), 'ecms-test-storage'));
  }
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalDiskProvider(env.STORAGE_LOCAL_ROOT);
    case 'railway':
      return new LocalDiskProvider(
        env.RAILWAY_VOLUME_MOUNT_PATH === '' ? env.STORAGE_LOCAL_ROOT : env.RAILWAY_VOLUME_MOUNT_PATH,
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
