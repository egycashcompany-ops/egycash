// Amazon S3 provider — also serves MinIO and any S3-compatible store via a
// custom endpoint with path-style addressing (ADR-010 S3CompatibleAdapter).
import { type Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { type StorageDriver } from '@ecms/contracts';
import {
  assertSafeKey,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
} from './storage-provider';

export interface S3ProviderConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint + path-style addressing — required for MinIO. */
  endpoint?: string | undefined;
}

export class S3Provider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: S3ProviderConfig,
    readonly driver: StorageDriver = 's3',
  ) {
    if (config.bucket === '' || config.accessKeyId === '' || config.secretAccessKey === '') {
      throw new Error(`storage driver "${driver}" requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY`);
    }
    if (driver === 'minio' && (config.endpoint === undefined || config.endpoint === '')) {
      throw new Error('storage driver "minio" requires S3_ENDPOINT');
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint === undefined || config.endpoint === ''
        ? {}
        : { endpoint: config.endpoint, forcePathStyle: true }),
    });
  }

  async put(key: string, data: Buffer, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: options.contentType,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    options: SignedUrlOptions,
  ): Promise<string | null> {
    assertSafeKey(key);
    return presign(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(options.filename)}`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}
