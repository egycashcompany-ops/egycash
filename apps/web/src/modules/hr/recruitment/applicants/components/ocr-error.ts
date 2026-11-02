// What to tell somebody whose card would not read.
//
// The message this replaces was «لا توجد فئة ملفات للصور مُهيّأة» — «no image file category is
// configured» — shown to an HR user whose real problem was that listing file categories needs
// `file.view`, which their role does not hold. It named a piece of configuration the reader has no
// way to check, blamed the wrong thing, and gave nobody a next step.
//
// Two answers replace it, and the split is the only one that changes what the reader should DO:
//   · 403 — the account is missing a permission. Nothing they can retry; somebody has to grant it.
//   · anything else, timeout included — the read did not work this time. Try again.
//
// It is a plain function over the thrown value so it can be tested without a browser: the web
// suite has no DOM, so a message chosen inside a component is a message no test can read.
import { ApiError } from '../../../../../shared/lib/api-client';

/** The i18n key for a failed card read. */
export const ocrErrorKey = (error: unknown): string =>
  error instanceof ApiError && error.status === 403
    ? 'applicants.ocr.forbidden'
    : 'applicants.ocr.failed';
