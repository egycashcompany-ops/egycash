// How the ATM pages read (2026-11-03): «خلى حجم الكلام فى الصفحات وإذا كان Bold أو لأ + درجة لون خطوط
// الجداول .. أقدر أتحكم فيها من /atm/settings» — and how their tables copy: «لما أخد Copy من الجدول
// تطلعهولى بشكل جدول … لما أبعته واتساب». Pinned here:
//
//   · the scope around the pages carries ONLY what differs from their own look — at the defaults no
//     attribute, so every page draws exactly as before; the card's preview carries all three;
//   · the card on /atm/settings offers the sizes, the weight and the line shades, previews the
//     choice before it is saved, and saves only a change;
//   · every ATM page sits inside the scope, and `styles.css` holds a rule for each attribute;
//   · the scope listens for a copy, so every ATM table copies as rows a chat can read.
//
// Every name below is synthetic.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ATM_DEFAULT_DISPLAY,
  ATM_TABLE_LINES,
  ATM_TEXT_SIZES,
  type AtmDisplaySetting,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { atmDisplayKey } from './api/settings-queries';
import { atmDisplayScopeProps } from './lib/atm-display';
import { DisplaySettingsCard, sameDisplay } from './components/settings/DisplaySettingsCard';
import { AtmDisplayScope } from './components/AtmDisplayScope';

const here = dirname(fileURLToPath(import.meta.url));
const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmSettings.manage': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (node: JSX.Element, display: AtmDisplaySetting | undefined): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (display !== undefined) qc.setQueryData(atmDisplayKey(), display);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/replenishments']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const CHOSEN: AtmDisplaySetting = { textSize: 125, bold: true, tableLines: 'stronger' };

describe('the scope around the pages', () => {
  it('carries nothing but its mark at the defaults — the pages draw exactly as before', () => {
    expect(atmDisplayScopeProps(ATM_DEFAULT_DISPLAY)).toEqual({ 'data-atm-display': 'true' });
  });

  it('carries only what differs: the size as a scale, bold, the line shade', () => {
    expect(atmDisplayScopeProps({ ...ATM_DEFAULT_DISPLAY, textSize: 110 })).toEqual({
      'data-atm-display': 'true',
      'data-atm-text': 'scaled',
      style: { '--atm-text-scale': '1.1' },
    });
    expect(atmDisplayScopeProps({ ...ATM_DEFAULT_DISPLAY, bold: true })).toEqual({
      'data-atm-display': 'true',
      'data-atm-weight': 'bold',
      style: { '--atm-bold': '1' },
    });
    expect(atmDisplayScopeProps({ ...ATM_DEFAULT_DISPLAY, tableLines: 'soft' })).toEqual({
      'data-atm-display': 'true',
      'data-atm-lines': 'soft',
    });
  });

  it('carries all three for the preview, defaults included — so it shows the choice inside any page', () => {
    expect(atmDisplayScopeProps(ATM_DEFAULT_DISPLAY, true)).toEqual({
      'data-atm-display': 'true',
      'data-atm-text': 'scaled',
      'data-atm-weight': 'regular',
      'data-atm-lines': 'normal',
      style: { '--atm-text-scale': '1', '--atm-bold': '0' },
    });
  });

  it('draws the page under it with the stored value, and as before until it is read', () => {
    const page = (
      <Routes>
        <Route element={<AtmDisplayScope />}>
          <Route path="/atm/replenishments" element={<p data-page="true">SYN</p>} />
        </Route>
      </Routes>
    );
    const stored = render(page, CHOSEN);
    expect(stored).toMatch(
      /<div class="contents" data-atm-display="true" data-atm-text="scaled" data-atm-weight="bold" data-atm-lines="stronger" style="--atm-text-scale:1\.25;--atm-bold:1"><p data-page="true">/,
    );
    const unread = render(page, undefined);
    expect(unread).toContain('<div class="contents" data-atm-display="true"><p data-page="true">');
  });
});

describe('every ATM page sits inside the scope', () => {
  const routes = readFileSync(join(here, 'routes.tsx'), 'utf8');

  it('the scope is the one layout route under the shell, and every page route is inside it', () => {
    const open = routes.indexOf('<Route element={<AtmDisplayScope />}>');
    expect(open).toBeGreaterThan(routes.indexOf('<Route element={<AppShell />}>'));
    // Every page — the index and every path — comes after the scope opens.
    const firstPage = Math.min(routes.indexOf('<Route index'), routes.indexOf('<Route\n'));
    expect(firstPage).toBeGreaterThan(open);
    // And the scope closes after the last of them: two closings follow the catch-all.
    const tail = routes.slice(routes.indexOf('path="*"'));
    expect(tail.match(/<\/Route>/g)?.length).toBe(2);
  });
});

describe('styles.css holds a rule for each attribute', () => {
  const css = readFileSync(join(here, '..', '..', 'styles.css'), 'utf8');

  it('scales the type scale, weighs the text, shades the lines — in both themes', () => {
    for (const size of ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']) {
      expect(css).toMatch(
        new RegExp(
          `\\[data-atm-text\\] \\.${size} \\{ font-size: calc\\([^)]*var\\(--atm-text-scale`,
        ),
      );
    }
    expect(css).toContain(
      '[data-atm-weight] { font-weight: calc(400 + 200 * var(--atm-bold, 0)); }',
    );
    for (const lines of ATM_TABLE_LINES) {
      expect(css).toContain(`[data-atm-lines='${lines}'] { --atm-table-line:`);
      expect(css).toContain(`.dark [data-atm-lines='${lines}'] { --atm-table-line:`);
    }
    expect(css).toContain('[data-atm-lines] table :is(thead, tbody, tr, th, td)');
  });
});

describe('the card on /atm/settings', () => {
  const cardWith = (display: AtmDisplaySetting): string => render(<DisplaySettingsCard />, display);

  it('offers every size, every line shade and bold, holding the stored value', () => {
    const html = cardWith(CHOSEN);
    expect(html).toContain(t('atm.settings.display.title'));
    for (const size of ATM_TEXT_SIZES) expect(html).toContain(`<option value="${String(size)}"`);
    expect(html).toContain(`<option value="125" selected="">`);
    for (const lines of ATM_TABLE_LINES) {
      expect(html).toContain(t(`atm.settings.display.lines.${lines}`));
    }
    expect(html).toContain(`<option value="stronger" selected="">`);
    expect(html).toMatch(/data-display-field="bold"[\s\S]*?type="checkbox"[^>]*checked=""/);
  });

  it('previews the choice with all three attributes, before anything is saved', () => {
    const html = cardWith(CHOSEN);
    expect(html).toMatch(
      /data-display-preview="true" data-atm-display="true" data-atm-text="scaled" data-atm-weight="bold" data-atm-lines="stronger" style="--atm-text-scale:1\.25;--atm-bold:1"/,
    );
    expect(html).toContain('<table');
  });

  it('saves only a change — the button waits while the choice is the stored one', () => {
    expect(sameDisplay(CHOSEN, { ...CHOSEN })).toBe(true);
    expect(sameDisplay(CHOSEN, { ...CHOSEN, bold: false })).toBe(false);
    // Each button, from its tag to its end; the one that says «حفظ».
    const buttons = (html: string): string[] =>
      html
        .split('<button')
        .slice(1)
        .map((part) => part.slice(0, part.indexOf('</button>')));
    const saveOf = (html: string): string =>
      buttons(html).find((button) => button.includes(t('common.save'))) ?? '';
    expect(saveOf(cardWith(CHOSEN))).toContain('disabled=""');
    // «الرجوع لشكل الصفحات الأصلي» is offered while the stored look is not the pages' own.
    const resetOf = (html: string): string =>
      buttons(html).find((button) => button.includes(t('atm.settings.display.reset'))) ?? '';
    expect(resetOf(cardWith(CHOSEN))).not.toBe('');
    expect(resetOf(cardWith(CHOSEN))).not.toContain('disabled=""');
    expect(resetOf(cardWith(ATM_DEFAULT_DISPLAY))).toContain('disabled=""');
  });
});

describe('the scope copies tables as rows a chat can read', () => {
  it('listens for a copy on every ATM page, for tables inside the scope only', () => {
    const scope = readFileSync(join(here, 'components', 'AtmDisplayScope.tsx'), 'utf8');
    expect(scope).toContain("document.addEventListener('copy', onCopy)");
    expect(scope).toContain("element.closest('[data-atm-display]') !== null");
  });
});
