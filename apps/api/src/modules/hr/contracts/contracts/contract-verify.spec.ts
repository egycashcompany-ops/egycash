// A23 — the verification URL is the QR's payload; its shape is a public contract.
import { describe, expect, it, vi } from 'vitest';
import { buildVerificationUrl, verificationQrDataUri, verifyContract } from './contract-verify';
import { contractRepository } from './contract.repository';

vi.mock('./contract.repository', () => ({ contractRepository: { findByCode: vi.fn() } }));

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

// The answer is world-readable: it says whether the document is genuine and which issue it is,
// and nothing else — no employee data, and not which release generated it, which on an endpoint
// anybody can call is a version banner.
describe('verifyContract', () => {
  const CODE = 'ECMS-CON-2026-000042';
  const issued = {
    code: CODE,
    contractVersion: 2,
    status: 'signed',
    generation: {
      integrity: {
        sha256: SHA,
        generatedAt: new Date('2026-10-01T10:00:00.000Z'),
        templateVersion: 3,
        generatorVersion: 'ecms-api/2.2.0',
      },
    },
  };

  it('confirms a genuine document, without saying which release generated it', async () => {
    vi.mocked(contractRepository.findByCode).mockResolvedValue([issued] as never);
    const verdict = await verifyContract(CODE, SHA);
    expect(verdict).toEqual({
      valid: true,
      code: CODE,
      contractVersion: 2,
      status: 'signed',
      generatedAt: '2026-10-01T10:00:00.000Z',
      templateVersion: 3,
    });
    expect(JSON.stringify(verdict)).not.toContain('ecms-api');
  });

  it('says only «not valid» when the key matches no issue', async () => {
    vi.mocked(contractRepository.findByCode).mockResolvedValue([issued] as never);
    expect(await verifyContract(CODE, 'b'.repeat(64))).toEqual({ valid: false });
  });
});
