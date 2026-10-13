// «المفروض هيكون فى زرار تسوية العهدة و استعاضة العهدة و شحن العهدة كل واحد هيعمل اكشن معين حط
// الزراير وانا هبقى اقولك هنعمل فى كل واحد ايه»: the fund's three actions on the custody board's
// toolbar — «تسوية العهدة», «استعاضة العهدة», «شحن العهدة», in that order, one framed group right
// before the Excel/PDF pair. What each one does is the owner's to say, so for now a press only
// says «سيُفعَّل هذا الإجراء قريبًا.».
//
// The suite has no DOM, so nothing here clicks: the page is rendered to markup, and each button's
// own `onClick` — caught as the element is created — is pressed by hand, against a toast store
// that only records.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import type * as JsxRuntime from 'react/jsx-runtime';
import type * as JsxDevRuntime from 'react/jsx-dev-runtime';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';

/** Each fund action's `onClick`, by its `data-custody-fund-action`, as the page created it. */
const pressed = vi.hoisted(() => new Map<string, () => void>());
/** Every toast raised, in order. */
const raised = vi.hoisted(() => [] as { variant: string; title: string }[]);
/** Keeps a fund action's `onClick` from the props an element is created with. */
const catchAction = vi.hoisted(() => (props: unknown): void => {
  const { 'data-custody-fund-action': action, onClick } = (props ?? {}) as Record<string, unknown>;
  if (typeof action === 'string' && typeof onClick === 'function') {
    pressed.set(action, onClick as () => void);
  }
});

// Whichever JSX runtime the transform emits — the development one under the test runner.
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxDevRuntime>();
  const jsxDEV: typeof actual.jsxDEV = (type, props, ...rest) => {
    catchAction(props);
    return actual.jsxDEV(type, props, ...rest);
  };
  return { ...actual, jsxDEV };
});
vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxRuntime>();
  const keep =
    (create: typeof actual.jsx): typeof actual.jsx =>
    (type, props, key) => {
      catchAction(props);
      return create(type, props, key);
    };
  return { ...actual, jsx: keep(actual.jsx), jsxs: keep(actual.jsxs) };
});
vi.mock('../../../shared/ui/toast/toast-store', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastStore>();
  const record =
    (variant: string) =>
    (title: string): string => {
      raised.push({ variant, title });
      return `toast-${raised.length}`;
    };
  return {
    ...actual,
    toast: {
      info: record('info'),
      success: record('success'),
      warning: record('warning'),
      error: record('error'),
    },
  };
});
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { CustodyPage } = await import('./CustodyPage');

const ar = (key: string): string => translate('ar', key);

const me = (): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: { 'fleetCustody.view': 'organization' },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const board = (): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/custody']}>
          <Routes>
            <Route path="/fleet/custody" element={<CustodyPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** A piece's words as a reader sees them: every tag a gap. */
const text = (part: string): string =>
  part
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
/** The class list of the tag that carries `attr`. */
const classesOf = (html: string, attr: string): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at));
  return /class="([^"]*)"/u.exec(tag)?.[1] ?? '';
};

const ORDER = ['settle', 'replenish', 'charge'] as const;
const LABELS = ['تسوية العهدة', 'استعاضة العهدة', 'شحن العهدة'];
const SHORT = ['تسوية', 'استعاضة', 'شحن'];

/** Each fund action's button, as it is drawn: its opening tag and what is inside it. */
const actionButtons = (html: string): { key: string; tag: string; inside: string }[] =>
  [...html.matchAll(/<button [^>]*data-custody-fund-action="(\w+)"[^>]*>/gu)].map((m) => ({
    key: m[1] ?? '',
    tag: m[0],
    inside: html.slice(m.index + m[0].length, html.indexOf('</button>', m.index)),
  }));

describe('«تسوية العهدة» «استعاضة العهدة» «شحن العهدة» — the fund’s three actions', () => {
  it('draws the three with their Arabic words, in the owner’s order', () => {
    const buttons = actionButtons(board());
    expect(buttons.map((b) => b.key)).toEqual([...ORDER]);
    // From a tablet up, the whole name; its words are each button's title at every width.
    expect(
      buttons.map((b) =>
        text(/<span class="hidden sm:inline">(.*?)<\/span>/u.exec(b.inside)?.[1] ?? ''),
      ),
    ).toEqual(LABELS);
    expect(buttons.map((b) => /title="([^"]*)"/u.exec(b.tag)?.[1])).toEqual(LABELS);
    expect(ORDER.map((key) => ar(`fleet.custody.actions.${key}`))).toEqual(LABELS);
    for (const b of buttons) expect(b.tag, b.key).toContain('type="button"');
  });

  it('says one word each on a phone — the three whole names do not fit its toolbar', () => {
    // Measured in Chromium: the three whole names make the group about 330px wide in Arabic and
    // 400px in English, wider than a 320–390px phone's toolbar, and what overflows it there is cut
    // off at its start with no scroll to reach it. Below `sm` each button says its one word, as the
    // export pair says «Excel» and «PDF», and the whole name is hidden — never both at once.
    const buttons = actionButtons(board());
    expect(
      buttons.map((b) => text(/<span class="sm:hidden">(.*?)<\/span>/u.exec(b.inside)?.[1] ?? '')),
    ).toEqual(SHORT);
    expect(ORDER.map((key) => ar(`fleet.custody.actions.${key}Short`))).toEqual(SHORT);
    for (const b of buttons) {
      // Nothing of the label outside its two spans: no word left to show at every width.
      const bare = b.inside
        .replace(/<span class="(?:sm:hidden|hidden sm:inline)">.*?<\/span>/gu, '')
        .replace(/<svg[\s\S]*?<\/svg>/gu, '');
      expect(text(bare), b.key).toBe('');
    }
    // English too, one word each.
    expect(ORDER.map((key) => translate('en', `fleet.custody.actions.${key}Short`))).toEqual([
      'Settle',
      'Replenish',
      'Top up',
    ]);
  });

  it('sits in the toolbar as one framed group, right before the Excel/PDF pair', () => {
    const html = board();
    const stats = html.indexOf('data-custody-stats-toggle="true"');
    const dashboard = html.indexOf('data-custody-dashboard-open="true"');
    const group = html.indexOf('data-custody-fund-actions="true"');
    const excel = html.indexOf('data-export="custody"');
    const pdf = html.indexOf('data-print="custody"');
    expect(stats).toBeGreaterThan(-1);
    expect(dashboard).toBeGreaterThan(stats);
    expect(group, 'after «لوحة تحكم»').toBeGreaterThan(dashboard);
    expect(excel, 'and before the files').toBeGreaterThan(group);
    expect(pdf).toBeGreaterThan(excel);
    // All three inside the group…
    const start = html.lastIndexOf('<div', group);
    const end = html.indexOf('</div>', group);
    const inside = html.slice(start, end);
    expect([...inside.matchAll(/data-custody-fund-action="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...ORDER,
    ]);
    // …and the group the export pair's own sibling, nothing between them: the next tag after it
    // opens the Excel/PDF frame, whose first button is «Excel».
    const next = html.slice(end + '</div>'.length, excel);
    expect(next).toMatch(/^<div class="[^"]*"><button type="button" $/u);
    // Framed as the export pair is.
    expect(classesOf(html, 'data-custody-fund-actions="true"')).toBe(
      /class="([^"]*)"/u.exec(next)?.[1],
    );
  });

  it('says «سيُفعَّل هذا الإجراء قريبًا.» on a press — an info toast, whichever of the three', () => {
    pressed.clear();
    raised.length = 0;
    board();
    expect([...pressed.keys()]).toEqual([...ORDER]);
    expect(ar('fleet.custody.actions.soon')).toBe('سيُفعَّل هذا الإجراء قريبًا.');
    for (const key of ORDER) {
      pressed.get(key)?.();
      expect(raised.at(-1), key).toEqual({
        variant: 'info',
        title: 'سيُفعَّل هذا الإجراء قريبًا.',
      });
    }
    expect(raised).toHaveLength(3);
  });
});
