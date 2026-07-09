// Feature flags (Review R27): declared in code, evaluated through the settings hierarchy
// (organization → branch → user), exposed to the frontend via the session bootstrap.
// A flag past its expiry date FAILS CI (scripts/check-flag-expiry.mjs) — flags are
// temporary by construction.
import { z } from 'zod';

export const FeatureFlagDefSchema = z.object({
  /** `<area>.<flagName>` — e.g. `hr.ocrIntake`. */
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/),
  description: z.string().min(1),
  defaultValue: z.boolean(),
  /** Team/person accountable for removing the flag. */
  owner: z.string().min(1),
  /** ISO date after which CI fails — the flag must be removed or re-justified. */
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FeatureFlagDef = z.infer<typeof FeatureFlagDefSchema>;

/**
 * The flag catalog. Empty at phase 2.1 — the first real flag arrives with the first
 * dark-shipped feature (e.g. per-branch OCR intake pilots in phase 2.2/2.3).
 */
export const featureFlags: FeatureFlagDef[] = [];
