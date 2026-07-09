// StorageProvider abstraction (ADR-010): metadata lives in MongoDB, binaries live
// behind this interface — call sites never change when the backing store does.
import { type Readable } from 'node:stream';
import { type StorageDriver } from '@ecms/contracts';

export interface PutOptions {
  contentType: string;
}

export interface SignedUrlOptions {
  /** Download filename presented to the client. */
  filename: string;
  contentType: string;
}

export interface StorageProvider {
  readonly driver: StorageDriver;

  put(key: string, data: Buffer, options: PutOptions): Promise<void>;

  getStream(key: string): Promise<Readable>;

  delete(key: string): Promise<void>;

  /**
   * Presigned URL pointing straight at the backing store, or `null` when the
   * provider cannot presign — the files service then falls back to the
   * app-level HMAC-signed download endpoint (the "signed URL abstraction").
   */
  getSignedUrl(key: string, ttlSeconds: number, options: SignedUrlOptions): Promise<string | null>;
}

/** Keys are service-generated; reject anything that could escape the storage root. */
export const assertSafeKey = (key: string): void => {
  if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`unsafe storage key: ${key}`);
  }
};
