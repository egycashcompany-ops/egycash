// Azure Blob Storage provider.
import { type Readable } from 'node:stream';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import {
  assertSafeKey,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
} from './storage-provider';

export class AzureBlobProvider implements StorageProvider {
  readonly driver = 'azure' as const;
  private readonly container: ContainerClient;
  private readonly credential: StorageSharedKeyCredential | null;
  private ensured = false;

  constructor(connectionString: string, containerName: string) {
    if (connectionString === '') {
      throw new Error('storage driver "azure" requires AZURE_STORAGE_CONNECTION_STRING');
    }
    const service = BlobServiceClient.fromConnectionString(connectionString);
    this.container = service.getContainerClient(containerName);
    // Shared-key credentials allow SAS generation; other auth falls back to app signing.
    this.credential =
      service.credential instanceof StorageSharedKeyCredential ? service.credential : null;
  }

  private async ensureContainer(): Promise<void> {
    if (this.ensured) return;
    await this.container.createIfNotExists();
    this.ensured = true;
  }

  async put(key: string, data: Buffer, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    await this.ensureContainer();
    await this.container.getBlockBlobClient(key).uploadData(data, {
      blobHTTPHeaders: { blobContentType: options.contentType },
    });
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeKey(key);
    const response = await this.container.getBlockBlobClient(key).download();
    const body = response.readableStreamBody;
    if (body === undefined) throw new Error(`azure blob has no readable body: ${key}`);
    return body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    options: SignedUrlOptions,
  ): Promise<string | null> {
    assertSafeKey(key);
    if (this.credential === null) return null;
    const blobClient = this.container.getBlockBlobClient(key);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + ttlSeconds * 1000),
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(options.filename)}`,
        contentType: options.contentType,
      },
      this.credential,
    );
    return `${blobClient.url}?${sas.toString()}`;
  }
}
