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
import { ApiError } from './api-client';
import { errorDiagnostic, errorMessage, hasError } from './errors';

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

  it('still falls back to the server message for a code it does not know', () => {
    expect(errorMessage(new ApiError('SOME_NEW_CODE', 'very specific', 400), 'ar')).toBe(
      'very specific',
    );
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
