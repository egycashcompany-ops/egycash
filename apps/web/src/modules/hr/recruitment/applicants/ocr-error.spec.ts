// What an HR user is told when a card will not read.
//
// The bug this exists for: an HR user on the live site got «لا توجد فئة ملفات للصور مُهيّأة» — «no
// image file category is configured» — on every attempt, while the admin account worked. Nothing
// was misconfigured. The screen listed `/platform/file-categories` to find the National-ID
// category, that route needs `file.view`, no HR role holds it, and the empty 403 answer was
// reported as a missing category. The message named a piece of configuration the reader cannot
// check, blamed the wrong thing, and offered no next step.
//
// So the two messages that replaced it are pinned here, in both languages, and so is the one
// distinction that changes what the reader should do: a 403 is somebody else's to fix, everything
// else is worth retrying.
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { ApiError } from '../../../../shared/lib/api-client';
import { translate } from '../../../../platform/localization/i18n';
import { ocrErrorKey } from './components/ocr-error';

const LOCALES: Locale[] = ['en', 'ar'];

describe('the message a failed card read carries', () => {
  it('asks for an administrator when the account is refused', () => {
    expect(ocrErrorKey(new ApiError('FORBIDDEN', 'forbidden', 403))).toBe(
      'applicants.ocr.forbidden',
    );
  });

  /** Everything else is the same answer: it did not work, try again. */
  it.each([
    ['a server error', new ApiError('INTERNAL', 'boom', 500)],
    ['a gateway timeout', new ApiError('TIMEOUT', 'timed out', 504)],
    ['a bad request', new ApiError('VALIDATION_FAILED', 'bad', 400)],
    ['a thrown Error', new Error('socket hang up')],
    ['something that is not an error at all', 'nope'],
  ])('says try again for %s', (_label, error) => {
    expect(ocrErrorKey(error)).toBe('applicants.ocr.failed');
  });

  /**
   * The old key is GONE from the catalogue, not merely unused. Left in place it would be one
   * `t('applicants.ocr.noCategory')` away from being shown to somebody again.
   */
  it('no longer has a «no image category» message to show', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'applicants.ocr.noCategory')).toBe('applicants.ocr.noCategory');
    }
  });

  it('says both of its sentences in English and in formal Arabic', () => {
    for (const locale of LOCALES) {
      for (const key of ['applicants.ocr.forbidden', 'applicants.ocr.failed']) {
        const text = translate(locale, key);
        expect(text, `${locale}/${key}`).not.toBe(key);
        expect(text.length, `${locale}/${key}`).toBeGreaterThan(10);
      }
    }
  });

  /** The permission message has to name the remedy, or it is just «no». */
  it('tells the reader who can fix a refusal', () => {
    expect(translate('en', 'applicants.ocr.forbidden')).toContain('administrator');
    expect(translate('ar', 'applicants.ocr.forbidden')).toContain('مدير النظام');
  });
});
