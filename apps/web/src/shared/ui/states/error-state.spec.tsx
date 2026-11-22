// The shared error panel never prints the server's error CODE — in either language.
//
// Owner, 2026-11-22, asked whether to fix «رسالة الغلط اللي بتطلع فيها كلمة إنجليزي (INTERNAL)»:
// «صلحها». The panel printed `diagnostic.code` («INTERNAL», «BUSINESS_RULE» …) in a quiet line
// under the friendly message, on ~114 screens and every `DataTable`. The code is gone; what stays
// is the request's reference, under its Arabic name «الرقم المرجعي» (the one the login message
// already uses), so a screenshot still finds the request in the API log. The id itself is the
// log's — Latin letters, left to right, isolated in a `bdi` so it never reorders the label.
//
// The web suite has no DOM, so the panel is rendered to static markup inside a locale store.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';
import { ErrorState } from './ErrorState';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const draw = (error: unknown, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <ErrorState error={error} onRetry={() => undefined} />
    </Provider>,
  );
};

/** What a reader sees: the markup without its tags (class names and attributes are not read). */
const visibleText = (markup: string): string => markup.replace(/<[^>]*>/g, ' ');

/** The one quiet reference line, when there is one. */
const referenceLine = (markup: string): string | undefined =>
  /<p [^>]*data-error-reference="true"[^>]*>([\s\S]*?)<\/p>/.exec(markup)?.[1];

/**
 * Every code the friendly-message table words, read from the table itself — the codes a server
 * really sends. A guard over a hand-kept copy would miss the next one added.
 */
const KNOWN_CODES = (() => {
  const source = read('../../lib/errors.ts');
  const start = source.indexOf('const FRIENDLY');
  const table = source.slice(start, source.indexOf('\n};\n', start));
  return [...new Set([...table.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gmu)].map((m) => m[1] ?? ''))];
})();

const failure = (code: string, requestId?: string): ApiError =>
  new ApiError(code, 'server english', 500, undefined, requestId);

describe('the reference words (fixes-web.json, merged into i18n by the HUB)', () => {
  it('«الرقم المرجعي» in Arabic, “Reference” in English', () => {
    expect(translate('ar', 'common.error.reference')).toBe('الرقم المرجعي');
    expect(translate('en', 'common.error.reference')).toBe('Reference');
  });
});

describe('a server failure with a reference: the reference, never the code', () => {
  const ar = draw(failure('INTERNAL', 'req_abc'), 'ar');
  const en = draw(failure('INTERNAL', 'req_abc'), 'en');

  it('Arabic: the friendly message and «الرقم المرجعي», no «INTERNAL», no server English', () => {
    expect(ar).toContain(errorMessage(failure('INTERNAL'), 'ar'));
    expect(ar).not.toContain('INTERNAL');
    expect(ar).not.toContain('server english');
    const line = referenceLine(ar) ?? '';
    expect(line, 'the reference line is drawn').not.toBe('');
    expect(line).toContain('الرقم المرجعي');
    // The label first, then the id — isolated left to right, in the face the Fleet boards restyle.
    expect(line).toMatch(/^الرقم المرجعي: <bdi dir="ltr" class="font-mono">req_abc<\/bdi>$/u);
    // …and the one thing on an Arabic panel written in Latin letters is that id.
    expect(visibleText(ar).replace('req_abc', '')).not.toMatch(/[A-Za-z]/u);
  });

  it('English: “Reference” and the same id, no «INTERNAL»', () => {
    expect(en).not.toContain('INTERNAL');
    expect(en).not.toContain('server english');
    expect(referenceLine(en)).toBe('Reference: <bdi dir="ltr" class="font-mono">req_abc</bdi>');
  });

  it('the line itself carries no direction — it follows the page; only the id is pinned ltr', () => {
    for (const markup of [ar, en]) {
      const open = /<p [^>]*data-error-reference="true"[^>]*>/.exec(markup)?.[0] ?? '';
      expect(open).not.toBe('');
      expect(open).not.toContain('dir=');
      expect(open).not.toContain('font-mono');
      expect(markup.match(/font-mono/g)?.length, 'one monospace hook: the id').toBe(1);
    }
  });
});

describe('nothing to reference: no line at all', () => {
  it('a server failure without a request id prints neither a reference nor the code', () => {
    for (const locale of ['ar', 'en'] as const) {
      const markup = draw(failure('INTERNAL'), locale);
      expect(markup, locale).not.toContain('INTERNAL');
      expect(markup, locale).not.toContain('data-error-reference');
      expect(markup, locale).not.toContain(translate(locale, 'common.error.reference'));
      expect(markup, locale).not.toContain('font-mono');
      expect(markup, locale).toContain(errorMessage(failure('INTERNAL'), locale));
    }
  });

  it('an empty request id is no reference either', () => {
    expect(draw(failure('INTERNAL', ''), 'ar')).not.toContain('data-error-reference');
  });

  it('a network drop (TypeError) has nothing to correlate — the network message, no line', () => {
    for (const locale of ['ar', 'en'] as const) {
      const markup = draw(new TypeError('Failed to fetch'), locale);
      expect(markup, locale).toContain(errorMessage(new TypeError('Failed to fetch'), locale));
      expect(markup, locale).not.toContain('Failed to fetch');
      expect(markup, locale).not.toContain('data-error-reference');
    }
  });

  it('a successful query (`error` is null) is no failure: no message, no line', () => {
    const markup = draw(null, 'ar');
    expect(markup).not.toContain('data-error-reference');
    expect(markup).not.toContain(errorMessage(undefined, 'ar'));
  });
});

describe('no code the server sends ever reaches the markup', () => {
  it('reads the codes from the friendly table — a guard over nothing passes forever', () => {
    expect(KNOWN_CODES.length).toBeGreaterThan(40);
    for (const code of ['INTERNAL', 'UNKNOWN', 'CONFLICT', 'BUSINESS_RULE', 'FORBIDDEN']) {
      expect(KNOWN_CODES).toContain(code);
    }
  });

  it.each(['ar', 'en'] as const)('in %s, with and without a reference', (locale) => {
    // The table's codes, and one it does not know yet (worded by the server's own message).
    for (const code of [...KNOWN_CODES, 'FLEET_A_REFUSAL_NOT_WORDED_YET']) {
      for (const requestId of ['req_abc', undefined]) {
        const markup = draw(failure(code, requestId), locale);
        expect(markup, `${locale} ${code} ${requestId ?? '—'}`).not.toContain(code);
      }
    }
  });

  it('the panel never reads the code at all', () => {
    const source = read('ErrorState.tsx');
    expect(source).not.toMatch(/\bdiagnostic\.code\b/u);
    expect(source).not.toMatch(/\.code\b/u);
    // …and it still gates on `hasError`, as errors.spec.ts pins for every reader of `error`.
    expect(source).toContain('hasError(error)');
  });
});
