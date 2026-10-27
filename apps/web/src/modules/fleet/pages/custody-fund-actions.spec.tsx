// «المفروض هيكون فى زرار تسوية العهدة و استعاضة العهدة و شحن العهدة كل واحد هيعمل اكشن معين حط
// الزراير وانا هبقى اقولك هنعمل فى كل واحد ايه»: the fund's three actions — «تسوية العهدة»,
// «استعاضة العهدة», «طلب عهدة» (was «شحن العهدة»), in that order, one framed group. «خلاص افصلهم»:
// they stand in the head of SCREEN 1 «العهدة» (`CustodyFundHeader`), at the far left of the fund's
// own bar, over each of its three tabs — never on the board «مصروفات العهدة» any more.
//
// Each opens its own dialog: a press writes `?fund=<op>` into the address (`useFundParam`), and the
// head's `CustodyFundDialogs` draws the dialog the address names. A reader who may not write custody
// money («إيصالات العهدة» — `fleetReceipt.create`) sees no group and no dialog at all. Nothing says
// «سيُفعَّل هذا الإجراء قريبًا.» any more: the toast and its words are gone.
//
// The suite has no DOM, so nothing here clicks: the page is rendered to markup, and each button's
// own `onClick` — caught as the element is created — is pressed by hand, against a toast store
// that only records.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import type * as RouterDom from 'react-router-dom';

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
/** Every address a fund action asked for, as `setSearchParams` was handed it. */
const asked = vi.hoisted(() => [] as string[]);
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof RouterDom>();
  return {
    ...actual,
    useSearchParams: (...args: Parameters<typeof actual.useSearchParams>) => {
      const [sp] = actual.useSearchParams(...args);
      const record: ReturnType<typeof actual.useSearchParams>[1] = (next) => {
        asked.push(
          String(typeof next === 'function' ? next(sp) : new URLSearchParams(next as never)),
        );
      };
      return [sp, record] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { CustodyPage } = await import('./CustodyPage');
const { CustodyLedgerPage } = await import('./CustodyLedgerPage');
const { CustodyMemosPage } = await import('./CustodyMemosPage');
const { CustodyFundDashboardPage } = await import('./CustodyFundDashboardPage');
const {
  CUSTODY_FUND_ORDER,
  CUSTODY_OPS,
  CustodyFundActions,
  isCustodyFundOp,
  useFundParam,
  withFundParam,
} = await import('../components/CustodyFundActions');
const { PILL_FRAME } = await import('../components/custody-board-looks');

const ar = (key: string): string => translate('ar', key);
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'CustodyPage.tsx'), 'utf8');
const HEAD = readFileSync(join(HERE, '../components/CustodyFundHeader.tsx'), 'utf8');

const me = (permissions: readonly string[] = ['fleetCustody.view']): MeDto =>
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const storeFor = (permissions?: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/** The group alone, at `path`, for a reader holding `permissions`. */
const group = (
  permissions: readonly string[] = ['fleetCustody.view', 'fleetReceipt.create'],
  path = '/fleet/custody/log?from=2026-09-01&page=3',
): string =>
  renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <MemoryRouter initialEntries={[path]}>
        <CustodyFundActions />
      </MemoryRouter>
    </Provider>,
  );

/** May open the fund's dialogs: the custody grant and the receipts' create. */
const WRITER = ['fleetCustody.view', 'fleetReceipt.create'] as const;

/** The custody screens at `path` — «سجل العهدة» by default — for a reader holding `permissions`. */
const board = (permissions: readonly string[] = WRITER, path = '/fleet/custody/log'): string => {
  const store = storeFor(permissions);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/log" element={<CustodyLedgerPage />} />
            <Route path="/fleet/custody/memos" element={<CustodyMemosPage />} />
            <Route path="/fleet/custody/dashboard" element={<CustodyFundDashboardPage />} />
            <Route path="/fleet/custody-expenses" element={<CustodyPage />} />
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
const LABELS = ['تسوية العهدة', 'استعاضة العهدة', 'طلب عهدة'];
const SHORT = ['تسوية', 'استعاضة', 'طلب'];

/** Each fund action's button, as it is drawn: its opening tag and what is inside it. */
const actionButtons = (html: string): { key: string; tag: string; inside: string }[] =>
  [...html.matchAll(/<button [^>]*data-custody-fund-action="(\w+)"[^>]*>/gu)].map((m) => ({
    key: m[1] ?? '',
    tag: m[0],
    inside: html.slice(m.index + m[0].length, html.indexOf('</button>', m.index)),
  }));

describe('«تسوية العهدة» «استعاضة العهدة» «طلب عهدة» — the fund’s three actions', () => {
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
    expect(ORDER.map((key) => ar(CUSTODY_OPS[key].label))).toEqual(LABELS);
    // «شحن العهدة» is «طلب عهدة» now — new keys; the old ones stay in the file, unused.
    expect(CUSTODY_OPS.charge.label).toBe('fleet.custody.actions.request');
    expect(CUSTODY_OPS.charge.short).toBe('fleet.custody.actions.requestShort');
    expect(ar('fleet.custody.actions.charge')).toBe('شحن العهدة');
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
    expect(ORDER.map((key) => ar(CUSTODY_OPS[key].short))).toEqual(SHORT);
    for (const b of buttons) {
      // Nothing of the label outside its two spans: no word left to show at every width.
      const bare = b.inside
        .replace(/<span class="(?:sm:hidden|hidden sm:inline)">.*?<\/span>/gu, '')
        .replace(/<svg[\s\S]*?<\/svg>/gu, '');
      expect(text(bare), b.key).toBe('');
    }
    // English too, one word each.
    expect(ORDER.map((key) => translate('en', CUSTODY_OPS[key].short))).toEqual([
      'Settle',
      'Replenish',
      'Request',
    ]);
  });

  it('sits at the far left of the fund’s bar, after the fund now — one framed group', () => {
    const html = board();
    const bar = html.indexOf('data-custody-fund-bar="true"');
    const now = html.indexOf('data-custody-fund-now="head"', bar);
    const group = html.indexOf('data-custody-fund-actions="true"');
    const tabs = html.indexOf('data-custody-tabs="true"');
    expect(bar).toBeGreaterThan(-1);
    // Right to left: the fund now, then the three — the bar's last child — then the tabs under it.
    expect(group, 'the three after the fund now').toBeGreaterThan(now);
    expect(tabs, 'the tabs under the bar').toBeGreaterThan(group);
    const groupEnd = html.indexOf('</div>', group);
    expect(html.slice(groupEnd + '</div>'.length), 'nothing after it in the bar').toMatch(
      /^<\/section>/u,
    );
    // All three inside the group, framed as the export pairs are.
    const inside = html.slice(html.lastIndexOf('<div', group), groupEnd);
    expect([...inside.matchAll(/data-custody-fund-action="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...ORDER,
    ]);
    expect(classesOf(html, 'data-custody-fund-actions="true"')).toBe(PILL_FRAME);
    // Not in the log's own toolbar any more: once on the screen, in its head.
    expect(html.match(/data-custody-fund-actions="true"/gu)).toHaveLength(1);
    const toolbar = html.slice(html.indexOf('data-ledger-toolbar="true"'));
    expect(toolbar).not.toContain('data-custody-fund-action');
  });

  it.each(['/fleet/custody/log', '/fleet/custody/memos', '/fleet/custody/dashboard'])(
    'stands in the head of %s — and never on «مصروفات العهدة»',
    (path) => {
      const html = board(WRITER, path);
      expect(html.match(/data-custody-fund-actions="true"/gu), path).toHaveLength(1);
      expect(actionButtons(html).map((b) => b.key), path).toEqual([...ORDER]);
      const board2 = board(WRITER, '/fleet/custody-expenses');
      expect(board2).not.toContain('data-custody-fund-actions');
      expect(board2).not.toContain('data-custody-fund-action=');
    },
  );

  it('opens its dialog on a press — `?fund=<op>` on the page’s own address, no toast', () => {
    pressed.clear();
    raised.length = 0;
    asked.length = 0;
    board(WRITER, '/fleet/custody/log?from=2026-09-01&op=charge&page=2');
    expect([...pressed.keys()]).toEqual([...ORDER]);
    for (const key of ORDER) pressed.get(key)?.();
    // The log's filters and page stay as they were; only `fund` joins them.
    expect(asked).toEqual([
      'from=2026-09-01&op=charge&page=2&fund=settle',
      'from=2026-09-01&op=charge&page=2&fund=replenish',
      'from=2026-09-01&op=charge&page=2&fund=charge',
    ]);
    expect(raised).toEqual([]);
    // «سيُفعَّل هذا الإجراء قريبًا.» is gone — from the screens and from both dictionaries.
    expect(PAGE).not.toContain('actions.soon');
    expect(PAGE).not.toContain('FUND_ACTIONS');
    expect(PAGE).not.toContain('CustodyFundActions');
    expect(HEAD.match(/<CustodyFundActions \/>/gu)).toHaveLength(1);
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, 'fleet.custody.actions.soon'), locale).toBe(
        'fleet.custody.actions.soon',
      );
    }
  });

  it.each([
    ['settle', 'data-memo-settle="true"'],
    ['replenish', 'data-memo-replenish="true"'],
    ['charge', 'data-memo-charge="true"'],
  ])('draws the «%s» dialog where the address says `?fund=` — and only that one', (op, panel) => {
    const html = board(WRITER, `/fleet/custody/log?fund=${op}`);
    expect(html).toContain(panel);
    expect(html.match(/data-memo-(?:settle|replenish|charge)="true"/gu)).toHaveLength(1);
    // In the head, outside its bar: after the tabs, before the log's own toolbar.
    const bar = html.indexOf('data-custody-fund-bar="true"');
    const tabs = html.indexOf('data-custody-tabs="true"');
    const toolbar = html.indexOf('data-ledger-toolbar="true"');
    expect(tabs).toBeGreaterThan(bar);
    expect(html.indexOf(panel)).toBeGreaterThan(tabs);
    expect(html.indexOf(panel)).toBeLessThan(toolbar);
  });

  it('opens no dialog on «مصروفات العهدة» — the fund’s dialogs are SCREEN 1’s', () => {
    const html = board(WRITER, '/fleet/custody-expenses?fund=charge');
    expect(html).toContain('data-custody-toolbar="true"');
    expect(html).not.toMatch(/data-memo-(?:settle|replenish|charge)="true"/u);
    expect(PAGE).not.toContain('CustodyFundDialogs');
    expect(PAGE).not.toContain('useFundParam');
  });

  it('opens no dialog without `?fund=`, nor for a `fund` it does not know', () => {
    for (const path of ['/fleet/custody/log', '/fleet/custody/log?fund=refund']) {
      expect(board(WRITER, path), path).not.toMatch(
        /data-memo-(?:settle|replenish|charge)="true"/u,
      );
    }
  });

  it('is not drawn for a reader who may not write custody money — nor is any dialog', () => {
    for (const permissions of [
      ['fleetCustody.view'],
      ['fleetCustody.view', 'fleetReceipt.edit', 'fleetReceipt.delete'],
    ]) {
      const html = board(permissions, '/fleet/custody/log?fund=charge');
      expect(html, permissions.join()).not.toContain('data-custody-fund-actions');
      expect(html, permissions.join()).not.toContain('data-custody-fund-action=');
      expect(html, permissions.join()).not.toMatch(/data-memo-(?:settle|replenish|charge)="true"/u);
      // The rest of the head and the log's toolbar are all there.
      expect(html).toContain('data-custody-fund-bar="true"');
      expect(html).toContain('data-custody-tabs="true"');
      expect(html).toContain('data-export="custody-ledger"');
    }
  });
});

describe('`CustodyFundActions` — the three, each opening its own dialog', () => {
  it('draws the same three, in the owner’s order, with their words and the export pair’s frame', () => {
    const html = group();
    const buttons = actionButtons(html);
    expect(buttons.map((b) => b.key)).toEqual([...ORDER]);
    expect([...CUSTODY_FUND_ORDER]).toEqual([...ORDER]);
    expect(buttons.map((b) => /title="([^"]*)"/u.exec(b.tag)?.[1])).toEqual(LABELS);
    expect(
      buttons.map((b) =>
        text(/<span class="hidden sm:inline">(.*?)<\/span>/u.exec(b.inside)?.[1] ?? ''),
      ),
    ).toEqual(LABELS);
    expect(
      buttons.map((b) => text(/<span class="sm:hidden">(.*?)<\/span>/u.exec(b.inside)?.[1] ?? '')),
    ).toEqual(SHORT);
    for (const b of buttons) expect(b.tag, b.key).toContain('type="button"');
    expect(classesOf(html, 'data-custody-fund-actions="true"')).toBe(PILL_FRAME);
    // The board's own export pair wears the very same frame.
    const page = board(WRITER, '/fleet/custody-expenses');
    const pair = page.lastIndexOf('<div', page.indexOf('data-export="custody"'));
    expect(/class="([^"]*)"/u.exec(page.slice(pair))?.[1]).toBe(PILL_FRAME);
    // Each its own colour, as before.
    for (const key of ORDER) {
      expect(html, key).toContain(CUSTODY_OPS[key].tone);
    }
  });

  it('opens a dialog through the address — `?fund=<op>`, the board’s filters and page kept', () => {
    pressed.clear();
    raised.length = 0;
    asked.length = 0;
    group();
    expect([...pressed.keys()]).toEqual([...ORDER]);
    for (const key of ORDER) pressed.get(key)?.();
    expect(asked).toEqual([
      'from=2026-09-01&page=3&fund=settle',
      'from=2026-09-01&page=3&fund=replenish',
      'from=2026-09-01&page=3&fund=charge',
    ]);
    // No «سيُفعَّل…» any more: a press says nothing, it opens.
    expect(raised).toEqual([]);
  });

  it('is not drawn for a reader who may not write custody money', () => {
    for (const permissions of [
      ['fleetCustody.view'],
      ['fleetCustody.view', 'fleetReceipt.edit', 'fleetReceipt.delete'],
    ]) {
      const html = group(permissions);
      expect(html, permissions.join()).toBe('');
    }
  });

  it('reads the open dialog from the address — anything else is none', () => {
    const read = (path: string): unknown => {
      let open: unknown = 'unread';
      const Probe = (): null => {
        [open] = useFundParam();
        return null;
      };
      renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <Probe />
        </MemoryRouter>,
      );
      return open;
    };
    expect(read('/fleet/custody/memos?fund=replenish')).toBe('replenish');
    expect(read('/fleet/custody/log?fund=settle&op=charge')).toBe('settle');
    expect(read('/fleet/custody/dashboard?fund=charge')).toBe('charge');
    expect(read('/fleet/custody/log?fund=delete')).toBeNull();
    expect(read('/fleet/custody/log')).toBeNull();
    expect(isCustodyFundOp('settle')).toBe(true);
    expect(isCustodyFundOp('spend')).toBe(false);
    expect(isCustodyFundOp(null)).toBe(false);
  });

  it('closes by taking `fund` away and nothing else', () => {
    const search = new URLSearchParams('from=2026-09-01&fund=charge&page=2&sort=date%3Adesc');
    expect(String(withFundParam(search, null))).toBe('from=2026-09-01&page=2&sort=date%3Adesc');
    expect(String(withFundParam(search, 'settle'))).toBe(
      'from=2026-09-01&fund=settle&page=2&sort=date%3Adesc',
    );
    // The address it was handed is never changed in place.
    expect(String(search)).toBe('from=2026-09-01&fund=charge&page=2&sort=date%3Adesc');
  });
});
