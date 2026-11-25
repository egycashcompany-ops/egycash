// The shared error panel shows an Arabic reader no English at all — no error code, no server
// sentence, no Latin id.
//
// Owner, 2026-11-22, asked whether to fix «رسالة الغلط اللي بتطلع فيها كلمة إنجليزي (INTERNAL)»:
// «صلحها». The panel printed `diagnostic.code` («INTERNAL», «BUSINESS_RULE» …) in a quiet line
// under the friendly message, on ~114 screens and every `DataTable`. Now:
// - the code is never printed, in either language;
// - in Arabic, a message with no Arabic letter (the server's own English for a code the friendly
//   table does not word, a client `Error`) gives way to the general Arabic line;
// - the request's reference stays for support, under its Arabic name «الرقم المرجعي» (the one the
//   login message already uses), with the shared copy button: in Arabic the id is on the
//   clipboard, in the tooltip and in `data-request-id`, never in the text; English still prints it.
//
// The web suite has no DOM, so the panel is rendered to static markup inside a locale store.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ErrorCodes, type Locale } from '@ecms/contracts';
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

/** The codes the Arabic friendly table words — read from the table's Arabic half itself. */
const ARABIC_WORDED = (() => {
  const source = read('../../lib/errors.ts');
  const start = source.indexOf('  ar: {', source.indexOf('const FRIENDLY'));
  const table = source.slice(start, source.indexOf('\n};\n', start));
  return new Set([...table.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gmu)].map((m) => m[1] ?? ''));
})();

/** Every code the server can send that the Arabic table does NOT word yet. */
const UNWORDED = Object.values(ErrorCodes).filter((code) => !ARABIC_WORDED.has(code));

describe('the reference words (fixes-web.json, merged into i18n by the HUB)', () => {
  it('«الرقم المرجعي» in Arabic, “Reference” in English', () => {
    expect(translate('ar', 'common.error.reference')).toBe('الرقم المرجعي');
    expect(translate('en', 'common.error.reference')).toBe('Reference');
  });
});

describe('a server failure with a reference: the reference, never the code', () => {
  const ar = draw(failure('INTERNAL', 'req_abc'), 'ar');
  const en = draw(failure('INTERNAL', 'req_abc'), 'en');

  it('Arabic: the friendly message and «الرقم المرجعي», no «INTERNAL», no Latin letter at all', () => {
    expect(ar).toContain(errorMessage(failure('INTERNAL'), 'ar'));
    expect(ar).not.toContain('INTERNAL');
    expect(ar).not.toContain('server english');
    const line = referenceLine(ar) ?? '';
    expect(line, 'the reference line is drawn').not.toBe('');
    expect(visibleText(line).trim()).toBe('الرقم المرجعي');
    // The id is not in the text: no `bdi`, no monospace — it is the copy button's.
    expect(line).not.toContain('<bdi');
    expect(ar).not.toContain('font-mono');
    expect(visibleText(ar), 'nothing on an Arabic panel is written in Latin letters').not.toMatch(
      /[A-Za-z]/u,
    );
  });

  it('Arabic: the id stays reachable — on the line, and on the shared copy button', () => {
    const open = /<p [^>]*data-error-reference="true"[^>]*>/.exec(ar)?.[0] ?? '';
    expect(open).toContain('data-request-id="req_abc"');
    const line = referenceLine(ar) ?? '';
    const button = /<button [^>]*>/.exec(line)?.[0] ?? '';
    expect(button, 'the copy button sits on the line').not.toBe('');
    expect(button).toContain(`title="${translate('ar', 'common.copyId')}: req_abc"`);
    expect(read('ErrorState.tsx')).toContain('<CopyIdButton code={requestId} />');
  });

  it('English: “Reference”, the same id on one line, and the copy button; no «INTERNAL»', () => {
    expect(en).not.toContain('INTERNAL');
    expect(en).not.toContain('server english');
    const line = referenceLine(en) ?? '';
    expect(line).toContain(
      '<span>Reference:</span><bdi dir="ltr" class="whitespace-nowrap font-mono">req_abc</bdi>',
    );
    expect(line).toContain(`title="${translate('en', 'common.copyId')}: req_abc"`);
  });

  it('the line itself carries no direction — it follows the page; only the id is pinned ltr', () => {
    for (const markup of [ar, en]) {
      const open = /<p [^>]*data-error-reference="true"[^>]*>/.exec(markup)?.[0] ?? '';
      expect(open).not.toBe('');
      expect(open).not.toContain('dir=');
      expect(open).not.toContain('font-mono');
    }
    expect(en.match(/font-mono/g)?.length, 'English: one monospace hook, the id').toBe(1);
  });
});

describe('Arabic: no sentence without an Arabic letter reaches the panel', () => {
  const UNKNOWN_AR = errorMessage(undefined, 'ar');

  it('reads the unworded codes from the catalog — a guard over nothing passes forever', () => {
    expect(ARABIC_WORDED.size).toBeGreaterThan(40);
    expect(ARABIC_WORDED.has('INTERNAL')).toBe(true);
    expect(UNWORDED.length).toBeGreaterThan(10);
    expect(UNWORDED).toContain('DUPLICATE');
    expect(UNWORDED).toContain('BUSINESS_RULE_VIOLATION');
  });

  it.each(['req_abc', undefined])(
    'every code the Arabic table does not word, reference %s: the general Arabic line',
    (requestId) => {
      for (const code of UNWORDED) {
        const markup = draw(failure(code, requestId), 'ar');
        expect(markup, code).toContain(UNKNOWN_AR);
        expect(visibleText(markup), code).not.toMatch(/[A-Za-z]/u);
      }
    },
  );

  it('a client-side Error in English: the general Arabic line, not its message', () => {
    const markup = draw(new Error('x went wrong'), 'ar');
    expect(markup).toContain(UNKNOWN_AR);
    expect(visibleText(markup)).not.toMatch(/[A-Za-z]/u);
  });

  it('an Arabic sentence is kept, from the server or the client', () => {
    expect(draw(new Error('تعذّر قراءة الملف'), 'ar')).toContain('تعذّر قراءة الملف');
    expect(draw(new ApiError('DUPLICATE', 'مكرر', 409), 'ar')).toContain('مكرر');
  });

  it('English keeps the server’s sentence — the rule is the Arabic reader’s', () => {
    expect(draw(failure('DUPLICATE'), 'en')).toContain('server english');
    expect(draw(new Error('x went wrong'), 'en')).toContain('x went wrong');
  });

  it('a caller’s own description is the caller’s: shown as given', () => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer },
      preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
    });
    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <ErrorState error={failure('DUPLICATE')} description="وصف الصفحة" />
      </Provider>,
    );
    expect(markup).toContain('وصف الصفحة');
    expect(markup).not.toContain(UNKNOWN_AR);
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
