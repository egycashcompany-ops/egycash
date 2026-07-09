import { z } from 'zod';

// ── Localized data (Platform Core §15) ──────────────────────────────────────

export const LocalizedStringSchema = z.object({
  ar: z.string().min(1),
  en: z.string().min(1),
});
export type LocalizedString = z.infer<typeof LocalizedStringSchema>;

export const LocaleSchema = z.enum(['ar', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;
