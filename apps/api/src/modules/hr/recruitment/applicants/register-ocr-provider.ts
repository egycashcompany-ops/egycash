// Opt-in registration of the local PaddleOCR provider (OQ-30).
//
// Called once at boot. Without `NATIONAL_ID_OCR_URL` nothing is registered and the null stub stays
// in place — an existing deployment that does not run the sidecar behaves exactly as before, and
// `/hr/applicants/ocr/national-id` keeps answering `available: false`. That is what makes this
// safe to merge ahead of the sidecar actually being deployed anywhere.
//
// Registration deliberately does NOT probe the sidecar. A health check here would either block
// boot on a slow model load or, worse, decide the provider is unavailable because the sidecar
// happened to still be starting — and then stay wrong until the next restart. The provider
// degrades per request instead: an unreachable sidecar yields no fields, the review dialog opens
// empty, and the user types the card in manually. Recruitment never stops because OCR is down.
import { env } from '../../../../infrastructure/config/env';
import { logger } from '../../../../infrastructure/logging/logger';
import { setNationalIdOcrProvider } from './national-id-ocr';
import { PaddleNationalIdOcrProvider } from './paddle-ocr-provider';

let registered = false;

/** Idempotent — safe to call from module load and from tests. */
export const registerNationalIdOcrProvider = (): void => {
  if (registered) return;
  const baseUrl = env.NATIONAL_ID_OCR_URL;
  if (baseUrl === undefined || baseUrl === '') {
    logger.info('national-id OCR: no NATIONAL_ID_OCR_URL — staying on the null stub');
    return;
  }
  registered = true;
  setNationalIdOcrProvider(
    new PaddleNationalIdOcrProvider({
      baseUrl,
      timeoutMs: env.NATIONAL_ID_OCR_TIMEOUT_MS,
    }),
  );
  logger.info({ baseUrl }, 'national-id OCR: local PaddleOCR provider registered');
};

/** Test-only: allow a suite to re-register after resetting the seam. */
export const resetNationalIdOcrProviderRegistration = (): void => {
  registered = false;
};
