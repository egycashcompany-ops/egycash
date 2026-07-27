// A23 — the verification URL is the QR's payload; its shape is a public contract.
import { describe, expect, it } from 'vitest';
import { buildVerificationUrl, verificationQrDataUri } from './contract-verify';

const SHA = 'a'.repeat(64);

describe('buildVerificationUrl', () => {
  it('builds the public verify URL from the web origin', () => {
    expect(buildVerificationUrl('https://ecms.example.com', 'ECMS-CON-2026-000001', SHA)).toBe(
      `https://ecms.example.com/verify/contract?code=ECMS-CON-2026-000001&key=${SHA}`,
    );
  });

  it('strips a trailing slash and URL-encodes the contract number', () => {
    expect(buildVerificationUrl('https://ecms.example.com/', 'EGY/2026/0001', SHA)).toBe(
      `https://ecms.example.com/verify/contract?code=EGY%2F2026%2F0001&key=${SHA}`,
    );
  });
});

describe('verificationQrDataUri', () => {
  it('produces an embeddable PNG data URI', async () => {
    const uri = await verificationQrDataUri('ECMS-CON-2026-000001', SHA);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });
});
