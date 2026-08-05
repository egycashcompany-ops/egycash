// The app-level signed-URL abstraction: HMAC capability tokens with expiry.
import { describe, expect, it } from 'vitest';
import { hmacSha256 } from '../../shared/utils/crypto';
import { env } from '../../infrastructure/config/env';
import { fileService } from './file.service';
import { signedFileUrl } from './signed-url';

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

// The URL a browser is handed, and why its SHAPE decides whether an image appears at all.
describe('signed download URL shape', () => {
  const base = {
    fileId: FILE_ID,
    expiresAtEpoch: future,
    signature: 'deadbeef',
    basePath: '',
    apiPublicUrl: 'http://localhost:3000',
  };

  it('is origin-relative when this process also serves the web app', () => {
    // Same-origin by construction: the browser is already on this origin, so `img-src 'self'`
    // is satisfied and no configured origin can contradict the one the user is browsing.
    const url = signedFileUrl({ ...base, servesWebApp: true });
    expect(url).toBe(`/api/v1/platform/files/signed/${FILE_ID}?e=${future}&s=deadbeef`);
    expect(url.startsWith('http')).toBe(false);
  });

  it('ignores API_PUBLIC_URL entirely in that mode — a wrong value cannot break an image', () => {
    // This is the regression. `localhost` vs `127.0.0.1` are different origins to a CSP, so an
    // absolute URL built from a merely-equivalent (or stale, or default) value made the browser
    // refuse every stored image while the server logged nothing.
    const wrong = signedFileUrl({ ...base, apiPublicUrl: 'http://127.0.0.1:9999', servesWebApp: true });
    expect(wrong).toBe(signedFileUrl({ ...base, servesWebApp: true }));
  });

  it('is absolute when the web app is served from somewhere else', () => {
    // A path would resolve against the WEB host, which does not serve files.
    expect(signedFileUrl({ ...base, servesWebApp: false })).toBe(
      `http://localhost:3000/api/v1/platform/files/signed/${FILE_ID}?e=${future}&s=deadbeef`,
    );
  });

  it('keeps a subpath deployment under its prefix', () => {
    expect(signedFileUrl({ ...base, basePath: '/ecms', servesWebApp: true })).toBe(
      `/ecms/api/v1/platform/files/signed/${FILE_ID}?e=${future}&s=deadbeef`,
    );
  });
});
