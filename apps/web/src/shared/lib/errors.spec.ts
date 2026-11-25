// WHY THIS EXISTS. Every table on all eleven Operations screens rendered
// "تعذّر التحميل / حدث خطأ ما. يُرجى المحاولة مجددًا." while the requests behind them all
// returned 200. The screenshot showed the proof side by side: the pager read «عرض 0 من 0 شحنة»
// — a count that can only come from a SUCCESSFUL response — directly above the error panel.
//
// The cause was a presence test. TanStack Query reports "this query has not failed" as
// `error: null`; `DataTable` asked `error !== undefined`, which `null` passes. So the error
// branch won on every successful load, and `errorMessage(null)` matched none of its branches and
// fell through to the generic UNKNOWN copy — a screen-wide failure with no diagnosis attached,
// which is why it survived three rounds of debugging.
//
// These cases pin the predicate at the exact decision point, and the source guards stop the
// `!== undefined` form returning to the shared state components.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from './api-client';
import { errorDiagnostic, errorMessage, hasError, validationDetails } from './errors';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('hasError — which values mean "a fetch failed"', () => {
  it('treats null as no error (the TanStack Query success value)', () => {
    expect(hasError(null)).toBe(false);
  });

  it('treats undefined as no error (the prop simply not passed)', () => {
    expect(hasError(undefined)).toBe(false);
  });

  it('treats a thrown value as an error', () => {
    expect(hasError(new Error('boom'))).toBe(true);
    expect(hasError(new ApiError('FORBIDDEN', 'no', 403))).toBe(true);
  });

  it('treats a falsy non-nullish throw as an error — something WAS thrown', () => {
    // A `throw 0` / `throw ''` is pathological but it is still a failure, and a truthiness test
    // would silently swallow it. Only the two absent forms mean "no error".
    expect(hasError(0)).toBe(true);
    expect(hasError('')).toBe(true);
    expect(hasError(false)).toBe(true);
  });
});

describe('errorMessage', () => {
  it('localizes INTERNAL instead of showing the server’s raw English', () => {
    // A 500 answers `{ code: 'INTERNAL', message: 'Unexpected error' }`. With no entry in the
    // table the fallback handed that untranslated string to an Arabic user.
    const boom = new ApiError('INTERNAL', 'Unexpected error', 500);
    expect(errorMessage(boom, 'ar')).not.toBe('Unexpected error');
    expect(errorMessage(boom, 'ar')).toContain('الخادم');
    expect(errorMessage(boom, 'en')).not.toBe('Unexpected error');
  });

  // Round 28c critic — «المناطق» refuses a name another area holds in any spelling, naming that
  // area in its detail. The catalog's own dialog said the server's English sentence to an Arabic
  // reader («the area «المعادي» already has this name»); it is worded, naming the area, now.
  it('words a name «المناطق» already holds, naming the area — and saying when it is archived', () => {
    const held = (code: string, area: string) =>
      new ApiError(ErrorCodes.DUPLICATE, `the area «${area}» already has this name`, 409, [
        { field: 'name', code, message: area },
      ]);
    expect(errorMessage(held('AREA_ACTIVE', 'المعادي'), 'ar')).toBe(
      'في «المناطق» منطقة «المعادي» بهذا الاسم.',
    );
    expect(errorMessage(held('AREA_ARCHIVED', 'الدقي'), 'ar')).toContain('«الدقي»');
    expect(errorMessage(held('AREA_ARCHIVED', 'الدقي'), 'ar')).toContain('موقوفة');
    expect(errorMessage(held('AREA_ACTIVE', 'المعادي'), 'en')).toBe(
      '«Areas» already has “المعادي” under this name.',
    );
    expect(errorMessage(held('AREA_ARCHIVED', 'الدقي'), 'en')).toContain('archived');
    // Any other duplicate keeps the server's own words, as before.
    expect(errorMessage(new ApiError(ErrorCodes.DUPLICATE, 'taken', 409), 'ar')).toBe('taken');
  });

  it('still falls back to the server message for a code it does not know', () => {
    expect(errorMessage(new ApiError('SOME_NEW_CODE', 'very specific', 400), 'ar')).toBe(
      'very specific',
    );
  });

  // Round 10 — the secured shipment's refusals reach a reader whose board was read before the act
  // that changed it (the vault's ✓, a colleague's pickup ✓). The global notifier words them, so
  // each has its own sentence in both languages, never the server's English.
  it('words the secured shipment’s lock and pickup refusals in both languages', () => {
    const words: string[] = [];
    for (const code of [
      ErrorCodes.OPERATIONS_SECURED_LOCKED,
      ErrorCodes.OPERATIONS_SECURED_NOT_PICKED_UP,
      ErrorCodes.OPERATIONS_SECURED_ALREADY_PICKED_UP,
      ErrorCodes.OPERATIONS_SECURED_NOT_IN_VAULT,
    ]) {
      const refused = new ApiError(code, 'server english', 409);
      for (const locale of ['ar', 'en'] as const) {
        const text = errorMessage(refused, locale);
        expect(text, `${locale}: ${code}`).not.toBe('server english');
        words.push(text);
      }
      expect(errorMessage(refused, 'ar')).toMatch(/المحصنة/);
    }
    expect(new Set(words).size).toBe(words.length);
  });

  // Round 33 critic — the shipment form's edit of «من فرع» / «إلى فرع» on a delivery confirmed with
  // its receipt: the form says the refusal with `errorMessage`, so it must name the way out — the
  // undo on «الشحنات المسلَّمة» — in the reader's language, never the server's English.
  it('words the confirmed delivery’s branch lock in both languages, naming the way out', () => {
    const refused = new ApiError(
      ErrorCodes.OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED,
      'server english',
      409,
    );
    const ar = errorMessage(refused, 'ar');
    const en = errorMessage(refused, 'en');
    expect(ar).not.toBe('server english');
    expect(en).not.toBe('server english');
    expect(ar).toContain('«الشحنات المسلَّمة»');
    expect(ar).toContain('«من فرع»');
    expect(ar).toContain('«إلى فرع»');
    expect(en).toContain('“Delivered shipments”');
  });

  // «صرف الخزينة» (Round 10) — its two dialogs say a refusal themselves (`errorMessage`): a crew
  // from another day than the shipment's, a captain no longer on the van, a release of a shipment
  // with no crew. Each in both languages, never the server's English.
  it('words the dispatch screen’s crew and release refusals in both languages', () => {
    const words: string[] = [];
    for (const code of [
      ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH,
      ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH,
      ErrorCodes.OPERATIONS_DELIVERY_LEG_REQUIRED,
    ]) {
      const refused = new ApiError(code, 'server english', 422);
      for (const locale of ['ar', 'en'] as const) {
        const text = errorMessage(refused, locale);
        expect(text, `${locale}: ${code}`).not.toBe('server english');
        words.push(text);
      }
    }
    expect(new Set(words).size).toBe(words.length);
  });

  // «تسليم المحصنات» (Round 17) — the server now refuses a handover of any van but today's. The
  // screen offers «تسليم» on today's vans only, so this reaches a page left open from another day;
  // it must read as the screen's own rule, in the reader's language, never the server's English.
  it('words the handover’s today-only refusal as the screen says it', () => {
    const refused = new ApiError(ErrorCodes.OPERATIONS_DISPATCH_NOT_TODAY, 'server english', 422);
    const ar = errorMessage(refused, 'ar');
    const en = errorMessage(refused, 'en');
    expect(ar).not.toBe('server english');
    expect(en).not.toBe('server english');
    // The handover screen's own words for the rule (`operations.handover.notToday`).
    expect(ar).toContain('التسليم يتم يوم خروج السيارة فقط');
    expect(en).toMatch(/only on the day it goes out/);
  });

  // «لوحة التشغيلة» (Round 20) — a save refused for a type archived since it was picked, or a
  // direction no area answers. The board marks the row; these are the words said beside it. Round 28
  // retired the direction's refusal: its words stay, harmless, for an older server only.
  it('words the crew board’s two row refusals, each its own, never the server’s English', () => {
    const words: string[] = [];
    for (const code of [
      ErrorCodes.OPERATIONS_UNKNOWN_SHIFT_TYPE,
      ErrorCodes.OPERATIONS_DIRECTION_NOT_AN_AREA,
    ]) {
      const refused = new ApiError(code, 'server english', 422);
      for (const locale of ['ar', 'en'] as const) {
        const text = errorMessage(refused, locale);
        expect(text, `${locale}: ${code}`).not.toBe('server english');
        words.push(text);
      }
    }
    expect(new Set(words).size).toBe(words.length);
    expect(words[0]).toContain('البيانات المرجعية');
    expect(words[2]).toContain('المناطق');
  });

  // Administrative Affairs (P1a.W) — the master data's refusals reach the module's dialogs, which say
  // them in their alert box with `errorMessage`, and any other surface through the global notifier.
  // EVERY code the module declares is worded, read off the contracts rather than listed by hand, so
  // a refusal a later slice adds fails here until it has its words — in both languages, each its
  // own, the Arabic in Arabic, never the server's English.
  it('words every Administrative Affairs refusal in both languages, each its own', () => {
    const codes = Object.values(ErrorCodes).filter((code) => code.startsWith('ADMINISTRATION_'));
    expect(codes, 'the module declares its refusals').toEqual(
      expect.arrayContaining([
        ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID,
        ErrorCodes.ADMINISTRATION_DUPLICATE,
        ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER,
        ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE,
        ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED,
        ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED,
        ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED,
        ErrorCodes.ADMINISTRATION_ATTACHMENT_LIMIT,
      ]),
    );
    for (const locale of ['ar', 'en'] as const) {
      const words = codes.map((code) => {
        const text = errorMessage(new ApiError(code, 'server english', 422), locale);
        expect(text, `${locale}: ${code}`).not.toBe('server english');
        if (locale === 'ar') expect(text, code).toMatch(/[\u0621-\u064A]/u);
        return text;
      });
      expect(new Set(words).size, locale).toBe(words.length);
    }
    // The duplicate's own sentence names what a retired record asks for: bringing it back.
    expect(
      errorMessage(new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, 'taken', 409), 'ar'),
    ).toContain('تفعيله');
  });

  // P1b.W — the supplier screens meet two of them: a full papers list, and a retired category. The
  // retired reference is no longer an item's alone (a supplier names categories too, P1b.1), so its
  // sentence names what was chosen and never one kind of record; the full list says what to do.
  it('words a full papers list and a retired reference for every record that meets them', () => {
    const inactive = (locale: 'ar' | 'en'): string =>
      errorMessage(new ApiError(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, 'x', 422), locale);
    expect(inactive('en')).not.toMatch(/\bitem/iu);
    expect(inactive('en')).toMatch(/\bcategory\b/u);
    expect(inactive('ar')).not.toContain('الصنف');
    expect(inactive('ar')).toContain('تصنيف');
    const full = (locale: 'ar' | 'en'): string =>
      errorMessage(new ApiError(ErrorCodes.ADMINISTRATION_ATTACHMENT_LIMIT, 'x', 422), locale);
    expect(full('en')).toContain('20');
    expect(full('en')).toMatch(/\bremove\b/u);
    expect(full('ar')).toContain('عشرين');
    expect(full('ar')).toContain('أزِل');
  });
});

describe('errorDiagnostic — a failure has to be findable in the API log', () => {
  it('carries the code and the server’s requestId', () => {
    const failure = new ApiError('BUSINESS_RULE', 'nope', 422, undefined, 'req_abc123');
    expect(errorDiagnostic(failure)).toEqual({ code: 'BUSINESS_RULE', requestId: 'req_abc123' });
  });

  it('omits an empty requestId rather than showing a blank reference', () => {
    expect(errorDiagnostic(new ApiError('CONFLICT', 'nope', 409, undefined, ''))).toEqual({
      code: 'CONFLICT',
    });
  });

  it('has nothing to correlate for a client-side throw', () => {
    expect(errorDiagnostic(new TypeError('Failed to fetch'))).toBeNull();
  });
});

describe('the shared state components decide presence through hasError', () => {
  // The guard, not the behaviour: these two are what every table in the system renders through,
  // so a `!== undefined` test reintroduced in either is a system-wide outage.
  const sources = {
    'DataTable.tsx': read('../ui/DataTable.tsx'),
    'ErrorState.tsx': read('../ui/states/ErrorState.tsx'),
  };

  for (const [name, source] of Object.entries(sources)) {
    it(`${name} gates on hasError`, () => {
      expect(source).toContain('hasError(error)');
    });

    it(`${name} does not test the error prop against undefined alone`, () => {
      expect(source).not.toMatch(/\berror !== undefined\b/);
      expect(source).not.toMatch(/\berror === undefined\b/);
    });
  }
});

// ── a validation refusal reaches an Arabic reader in Arabic ────────────────
//
// The server emits code `VALIDATION_FAILED`; the friendly table keyed it `VALIDATION_ERROR`, so
// the lookup always missed and fell through to the server's own top-level message — the bare
// English constant `Validation failed`, shown to an Arabic reader on every screen in the app.
//
// The fix is the key, and ONLY the key. The `details` the server sends alongside are English-only
// strings, so preferring them here would trade one English leak for a worse one: a specific
// English sentence on all twelve screens that call this. A screen that genuinely needs the detail
// reads it itself through `validationDetails` — Fixed Roster does — and localising validation
// details properly is its own change.
describe('a validation refusal is localised, and stays localised', () => {
  const validation = (details: unknown) =>
    new ApiError('VALIDATION_FAILED', 'Validation failed', 400, details as never);

  it('answers in the reader’s own language', () => {
    expect(errorMessage(validation([]), 'ar')).toBe('بعض الحقول تحتاج إلى مراجعة.');
    expect(errorMessage(validation(undefined), 'en')).toBe('Some fields need your attention.');
  });

  it('never shows the server’s bare English constant', () => {
    // What the wrong key produced. The top-level message is the same string for every cause, so
    // it was both untranslated AND uninformative.
    expect(errorMessage(validation(undefined), 'ar')).not.toBe('Validation failed');
  });

  it('does NOT leak the server’s English detail into the global message', () => {
    // The regression this guards: a detail preferred here would reach an Arabic reader in English
    // on every screen. Fixed Roster opts in deliberately; nobody else does.
    const message = errorMessage(
      validation([
        {
          field: 'body.rows.missionTypeId',
          code: 'UNKNOWN',
          message: 'mission type not found or inactive',
        },
      ]),
      'ar',
    );
    expect(message).toBe('بعض الحقول تحتاج إلى مراجعة.');
    expect(message).not.toContain('mission type not found or inactive');
  });

  it('still hands the details to a caller that asks for them', () => {
    // How a screen opts in: the detail is available, it is simply not the default copy.
    const error = validation([
      { field: 'body.rows.0.driver1EmployeeId', code: 'UNKNOWN', message: 'employee not found' },
    ]);
    expect(validationDetails(error)).toEqual([
      { field: 'body.rows.0.driver1EmployeeId', code: 'UNKNOWN', message: 'employee not found' },
    ]);
    expect(validationDetails(validation(undefined))).toEqual([]);
  });

  it('leaves every other error code exactly as it was', () => {
    expect(errorMessage(new ApiError('FORBIDDEN', 'nope', 403), 'ar')).toBe(
      'ليس لديك صلاحية للقيام بذلك.',
    );
    expect(errorMessage(new ApiError('CONFLICT', 'clash', 409), 'en')).toBe(
      'That action conflicts with the current state.',
    );
  });
});
