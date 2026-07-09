// The app-level signed-URL abstraction: HMAC capability tokens with expiry.
import { describe, expect, it } from 'vitest';
import { hmacSha256 } from '../../shared/utils/crypto';
import { env } from '../../infrastructure/config/env';
import { fileService } from './file.service';

const FILE_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
const future = Math.floor(Date.now() / 1000) + 300;
const signatureFor = (id: string, exp: number): string =>
  hmacSha256(env.STORAGE_SIGNING_SECRET, `${id}.${exp}`);

describe('app-signed download URLs', () => {
  it('accepts a valid, unexpired signature', () => {
    expect(fileService.verifyAppSignature(FILE_ID, future, signatureFor(FILE_ID, future))).toBe(
      true,
    );
  });

  it('rejects an expired signature', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(fileService.verifyAppSignature(FILE_ID, past, signatureFor(FILE_ID, past))).toBe(false);
  });

  it('rejects a tampered file id', () => {
    const otherId = '64b1f0bbbbbbbbbbbbbbbbbb';
    expect(fileService.verifyAppSignature(otherId, future, signatureFor(FILE_ID, future))).toBe(
      false,
    );
  });

  it('rejects a tampered expiry (extending the window)', () => {
    expect(
      fileService.verifyAppSignature(FILE_ID, future + 9999, signatureFor(FILE_ID, future)),
    ).toBe(false);
  });

  it('rejects malformed signatures without throwing', () => {
    expect(fileService.verifyAppSignature(FILE_ID, future, 'zz-not-hex')).toBe(false);
    expect(fileService.verifyAppSignature(FILE_ID, Number.NaN, signatureFor(FILE_ID, future))).toBe(
      false,
    );
  });
});
