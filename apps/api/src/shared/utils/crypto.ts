// Pure crypto helpers (no I/O).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const sha256Buffer = (value: Buffer): string =>
  createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

/** Constant-time comparison for signature checks. */
export const safeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
};

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

/** Human-friendly backup code, e.g. `X7K2-M9Q4-T1WZ`. */
export const randomBackupCode = (): string => {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const pick = () => {
    let out = '';
    const buf = randomBytes(4);
    for (const byte of buf) out += alphabet[byte % alphabet.length];
    return out;
  };
  return `${pick()}-${pick()}-${pick()}`;
};
