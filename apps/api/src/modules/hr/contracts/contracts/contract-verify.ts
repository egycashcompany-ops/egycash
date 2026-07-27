// A23 — document verification. The QR on every PDF encodes a public URL whose key is
// the A14 SHA-256: unguessable, bound to the exact stored snapshot. The verdict is
// deliberately non-PII — it confirms authenticity, never leaks employee data.
import QRCode from 'qrcode';
import { type ContractVerificationDto } from '@ecms/contracts';
import { env } from '../../../../infrastructure/config/env';
import { contractRepository } from './contract.repository';

/** Pure: the URL the QR encodes (and the /verify web page consumes). */
export const buildVerificationUrl = (baseUrl: string, code: string, sha256: string): string => {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/verify/contract?code=${encodeURIComponent(code)}&key=${sha256}`;
};

/** QR as a data URI for embedding into the PDF footer; null when QR encoding fails. */
export const verificationQrDataUri = async (code: string, sha256: string): Promise<string | null> => {
  try {
    return await QRCode.toDataURL(buildVerificationUrl(env.WEB_PUBLIC_URL, code, sha256), {
      margin: 0,
      width: 120,
      errorCorrectionLevel: 'M',
    });
  } catch {
    return null;
  }
};

/** The public verdict: match the number + integrity hash against stored generations. */
export const verifyContract = async (code: string, key: string): Promise<ContractVerificationDto> => {
  const versions = await contractRepository.findByCode(code);
  const match = versions.find((doc) => doc.generation.integrity?.sha256 === key);
  if (match === undefined || match.generation.integrity === null) return { valid: false };
  return {
    valid: true,
    code: match.code,
    contractVersion: match.contractVersion,
    status: match.status,
    generatedAt: match.generation.integrity.generatedAt.toISOString(),
    templateVersion: match.generation.integrity.templateVersion,
    generatorVersion: match.generation.integrity.generatorVersion,
  };
};
