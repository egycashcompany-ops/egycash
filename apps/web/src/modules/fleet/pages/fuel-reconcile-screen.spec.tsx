// «مطابقة أرصدة الكروت», proven against what it draws: the two steps and the compare button's hint,
// the four counts and their units, the differing cards in the server's order with «رقم مختلف», the
// ticks and ✓ / ✗ behind their grant, the bulk bar in the screen's own words, the confirmation the
// bulk buttons open (never the write itself), the red banner and the «تغيّر بعد القراءة» tag after a
// refused ✓, and the folds — closed at first, «صفوف لا تُطابَق» only when the sheet has such rows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelCardTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import {
  NO_SELECTION,
  piastres,
  reconcileSelection,
  type ReconcileSelection,
  type ReconcileSelectionAction,
} from '../lib/fuel-reconcile';
import { FuelReconcilePage, ReconcileResult } from './FuelReconcilePage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const R = 'fleet.fuelCards.reconcile.';

const me = (permissions: string[]): MeDto =>
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const card = (
  id: string,
  balance: number,
  over: Partial<FleetFuelCardDto> = {},
): FleetFuelCardDto => ({
  id,
  vehicleId: `v-${id}`,
  vehicleCode: '254',
  label: null,
  company: 'wataniya',
  name: `EGYCASH-${id}`,
  number: '7045 1120 0098 7868',
  expiresAt: '2099-03-31T00:00:00.000Z',
  hasPassword: true,
  balance,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const line = (
  id: string,
  system: number,
  sheet: number,
  over: Partial<FleetFuelReconcileLineDto> = {},
): FleetFuelReconcileLineDto => ({
  card: card(id, system),
  sheet: { row: 180, number: '548**********7868', name: `EGYCASH-${id}`, balance: sheet },
  difference: (piastres(sheet) - piastres(system)) / 100,
  numberMatches: true,
  ...over,
});

const A = '650000000000000000000a01';
const B = '650000000000000000000b02';
const C = '650000000000000000000c03';
const RESULT: FleetFuelReconcileDto = {
  id: '650000000000000000000999',
  company: 'wataniya',
  fileName: 'wataniya-balances-2026-10-20.xlsx',
  fileSha256: 'f'.repeat(64),
  rows: 223,
  readAt: '2026-10-20T08:40:00.000Z',
  sheetCompany: 'wataniya',
  // The server's order: the largest |difference| first.
  differs: [
    line(A, 795, 16745.12),
    line(B, 14516.85, 596.85),
    line(C, 3049.73, 8724.73, {
      numberMatches: false,
      sheet: { row: 28, number: '548**********0935', name: `EGYCASH-${C}`, balance: 8724.73 },
    }),
  ],
  equal: [line('e1', 6750, 6750)],
  sheetOnly: [{ row: 222, number: '548**********1111', name: 'EGYCASH-1-2', balance: 10 }],
  systemOnly: [card('s1', 40)],
  duplicates: [{ row: 5, number: '548**********2222', name: 'EGYCASH-2-3', balance: 5, times: 2 }],
  conflicts: [],
};

const ALL = ['fleetFuelCard.view', 'fleetFuelCharge.view', 'fleetFuelCharge.approve'];

const storeOf = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const totals = (over: Partial<FleetFuelCardTotalsDto>): FleetFuelCardTotalsDto => ({
  wataniyaBalance: 0,
  chilloutBalance: 0,
  requestedCount: 0,
  requestedAmount: 0,
  chargedTodayAmount: 0,
  cardCount: 0,
  ...over,
});

/** The page as it opens: the two steps. */
const renderPage = (permissions = ALL): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('fleet', 'fuelCards', { summary: true, company: 'wataniya' }),
    totals({ wataniyaBalance: 1234567.5, cardCount: 218 }),
  );
  qc.setQueryData(
    listKey('fleet', 'fuelCards', { summary: true, company: 'chillout' }),
    totals({ chilloutBalance: 900, cardCount: 2 }),
  );
  return renderToStaticMarkup(
    <Provider store={storeOf(permissions)}>
      <QueryClientProvider client={qc}>
        <FuelReconcilePage />
      </QueryClientProvider>
    </Provider>,
  );
};

/** The answer, drawn with a given selection. */
const renderResult = ({
  result = RESULT,
  actions = [],
  mayDecide = true,
  confirming = null,
}: {
  result?: FleetFuelReconcileDto;
  actions?: ReconcileSelectionAction[];
  mayDecide?: boolean;
  confirming?: FleetFuelReconcileDecision | null;
} = {}): string => {
  const selection: ReconcileSelection = actions.reduce(reconcileSelection, NO_SELECTION);
  return renderToStaticMarkup(
    <Provider store={storeOf(ALL)}>
      <ReconcileResult
        result={result}
        selection={selection}
        dispatch={() => undefined}
        mayDecide={mayDecide}
        deciding={false}
        confirming={confirming}
        onConfirming={() => undefined}
        onDecide={() => undefined}
        onAnother={() => undefined}
        onHistory={() => undefined}
      />
    </Provider>,
  );
};

/** The markup of one row of the table. */
const rowOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-recon-row="${id}"`);
  expect(start, `row ${id}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</tr>', start));
};

describe('before the sheet is read', () => {
  it('asks for the company, then the file — the compare button waits for both', () => {
    const html = renderPage();
    expect(html).toContain('data-recon-page="upload"');
    expect(html).toContain(ar(`${R}title`));
    expect(html).toContain(ar(`${R}stepCompany`));
    expect(html).toContain(ar(`${R}stepSheet`));
    expect(html).toMatch(/data-recon-compare="true"[^>]*disabled=""/u);
    expect(html).toContain(ar(`${R}compareNeedsCompany`));
    // The sheet's three columns, as the company writes them.
    for (const column of ['Card Number', 'Card Name', 'Card Balance'])
      expect(html).toContain(column);
  });

  it('each company offers itself with its cards and balance, from «شحن الكروت»’s own summary', () => {
    const html = renderPage();
    expect(html).toContain('data-recon-company="wataniya"');
    expect(html).toContain('data-recon-company="chillout"');
    expect(html).toContain('218 كارتًا');
    expect(html).toContain('1,234,567.50');
    expect(html).toContain('كارتان');
    expect(html).toContain('EGYCASH-…');
    expect(html).toContain('EGYCASHTCS-…');
  });

  it('the hint names what is missing next', () => {
    const SOURCE = readFileSync(
      join(HERE, '../components/fuel-reconcile/ReconcileUploadCard.tsx'),
      'utf8',
    );
    expect(SOURCE).toContain('disabled={company === null || file === null || reading}');
    expect(SOURCE).toContain("t('fleet.fuelCards.reconcile.compareNeedsFile')");
  });
});

describe('the answer', () => {
  it('counts the cards that differ, are equal, are only in the sheet or only in the system', () => {
    const html = renderResult();
    expect(html).toContain('data-recon-page="result"');
    expect(html).toContain('wataniya-balances-2026-10-20.xlsx');
    expect(html).toContain('223 صفًّا');
    const kpi = (mark: string): string => {
      const start = html.indexOf(`data-fuel-kpi="${mark}"`);
      return html.slice(start, html.indexOf('data-fuel-kpi=', start + 10));
    };
    expect(kpi('recon-differs')).toContain('>3<');
    expect(kpi('recon-differs')).toContain('>كروت<');
    expect(kpi('recon-differs')).toContain(ar(`${R}differsNote`));
    expect(kpi('recon-equal')).toContain('>1<');
    expect(kpi('recon-equal')).toContain('>كارت<');
    expect(kpi('recon-sheet-only')).toContain(ar(`${R}sheetOnlyNote`, { company: 'وطنية' }));
  });

  it('lists the differing cards in the server’s order, flagging four digits that differ', () => {
    const html = renderResult();
    const order = [A, B, C].map((id) => html.indexOf(`data-recon-row="${id}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(rowOf(html, C)).toContain(`data-recon-number-changed="${C}"`);
    expect(rowOf(html, C)).toContain(ar(`${R}numberDiffers`));
    expect(rowOf(html, A)).not.toContain('data-recon-number-changed');
    expect(rowOf(html, A)).toContain('+15,950.12');
    expect(rowOf(html, B)).toContain('−13,920.00');
    // The note chips: the changed number, the repeated row.
    expect(html).toContain(ar(`${R}numberChanged`, { count: 'كارت واحد' }));
    expect(html).toContain(ar(`${R}duplicates`, { rows: 'صف واحد مكرر' }));
  });

  it('without the grant to decide: no ticks, and ✓ / ✗ are disabled', () => {
    const html = renderResult({ mayDecide: false });
    expect(html).not.toContain('data-recon-tick');
    expect(html).toMatch(new RegExp(`data-recon-apply="${A}"[^>]*disabled=""`, 'u'));
    expect(html).toMatch(new RegExp(`data-recon-reject="${A}"[^>]*disabled=""`, 'u'));
  });

  it('with it: ticks, and an enabled ✓ / ✗ on every open row', () => {
    const html = renderResult();
    expect(html).toContain('data-recon-tick-all="true"');
    expect(rowOf(html, A)).toContain(`data-recon-tick="${A}"`);
    expect(rowOf(html, A)).not.toMatch(/data-recon-apply="[^"]+"[^>]*disabled=""/u);
  });

  it('the bulk bar names what is ticked in the screen’s words, with its net difference', () => {
    const none = renderResult();
    expect(none).not.toContain('data-recon-bulk');
    const two = renderResult({
      actions: [
        { type: 'toggle', id: A, on: true },
        { type: 'toggle', id: C, on: true },
      ],
    });
    expect(two).toContain('data-recon-bulk="true"');
    expect(two).toContain(ar(`${R}selected`, { count: 'كارتين' }));
    expect(two).toContain('تم اختيار كارتين');
    expect(two).toContain('+21,625.12');
    expect(two).toContain('data-recon-apply-selected="true"');
    expect(two).toContain('data-recon-reject-selected="true"');
    expect(rowOf(two, A)).toContain('data-recon-state="ticked"');
  });

  it('decided rows show the verdict, the balance it left and who decided', () => {
    const html = renderResult({
      actions: [
        {
          type: 'decided',
          results: [
            {
              cardId: A,
              decision: 'apply',
              balance: 16745.12,
              at: '2026-10-20T09:00:00.000Z',
              byName: 'أحمد علي',
            },
          ],
        },
      ],
    });
    const row = rowOf(html, A);
    expect(row).toContain('data-recon-verdict="apply"');
    expect(row).toContain(ar(`${R}applied`));
    expect(row).toContain('أحمد علي');
    expect(row).not.toContain(`data-recon-tick="${A}"`);
    expect(html).toContain('data-recon-progress="true"');
    expect(html).toContain(ar(`${R}reviewed`, { done: 1, all: 3 }));
  });

  it('warns in red when the sheet’s names belong to the other company', () => {
    expect(renderResult()).not.toContain('data-recon-wrong-company');
    const html = renderResult({ result: { ...RESULT, sheetCompany: 'chillout' } });
    expect(html).toContain('data-recon-wrong-company="true"');
    expect(html).toContain('EGYCASHTCS-');
  });
});

describe('the bulk buttons ask first', () => {
  it('they only open the confirmation; the write is the dialog’s own button', () => {
    const TABLE = readFileSync(
      join(HERE, '../components/fuel-reconcile/ReconcileTable.tsx'),
      'utf8',
    );
    expect(TABLE).toContain("onClick={() => onBulk('apply')}");
    expect(TABLE).toContain("onClick={() => onBulk('reject')}");
    const PAGE = readFileSync(join(HERE, 'FuelReconcilePage.tsx'), 'utf8');
    expect(PAGE).toContain('onBulk={onConfirming}');
    // A single row stays one click.
    expect(PAGE).toContain('onDecide([id], decision);');
  });

  it('✓: the count, the totals now + net = after, the list, and its two buttons', () => {
    const html = renderResult({
      actions: [
        { type: 'toggle', id: A, on: true },
        { type: 'toggle', id: C, on: true },
      ],
      confirming: 'apply',
    });
    expect(html).toContain('data-recon-confirm="apply"');
    expect(html).toContain(ar(`${R}confirm.applyTitle`));
    expect(html).toContain(ar(`${R}confirm.applyBody`, { cards: 'كارتين' }));
    const cell = (mark: string): string => {
      const start = html.indexOf(`data-recon-confirm-cell="${mark}"`);
      return html.slice(start, html.indexOf('</div>', start));
    };
    expect(cell('now')).toContain('3,844.73');
    expect(cell('net')).toContain('+21,625.12');
    expect(cell('after')).toContain('25,469.85');
    expect(html).toContain(`data-recon-confirm-row="${A}"`);
    expect(html).toContain(`data-recon-confirm-row="${C}"`);
    expect(html).not.toContain(`data-recon-confirm-row="${B}"`);
    expect(html).toContain('data-recon-confirm-go="apply"');
    expect(html).toContain(ar(`${R}confirm.apply`));
    expect(html).toContain(ar('fleet.fuelCards.history.back'));
  });

  it('✗: the net that will not be applied, and the balance that stays', () => {
    const html = renderResult({
      actions: [{ type: 'toggle', id: B, on: true }],
      confirming: 'reject',
    });
    expect(html).toContain('data-recon-confirm="reject"');
    expect(html).toContain(ar(`${R}confirm.rejectBody`, { cards: 'كارت واحد' }));
    expect(html).toContain('data-recon-confirm-cell="stays"');
    expect(html).not.toContain('data-recon-confirm-cell="after"');
    expect(html).toContain(ar(`${R}confirm.reject`));
  });
});

describe('a ✓ refused because a balance moved after the read', () => {
  const refused = new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'Changed', 409, [
    { field: 'cardIds', code: 'CARD_CHANGED', message: C },
  ]);

  it('names the card in a red banner with «رفع شيت آخر»; its row is tagged, unticked, ✓ off, ✗ on', () => {
    const html = renderResult({
      actions: [
        { type: 'tickAll', lines: RESULT.differs, on: true },
        { type: 'refused', error: refused },
      ],
    });
    expect(html).toContain('data-recon-moved="true"');
    expect(html).toContain(ar(`${R}moved`, { cards: 'كارت واحد' }));
    expect(html).toContain('data-recon-moved-again="true"');
    const banner = html.slice(
      html.indexOf('data-recon-moved-names'),
      html.indexOf('data-recon-moved-again'),
    );
    expect(banner).toContain(`EGYCASH-${C}`);
    const row = rowOf(html, C);
    expect(row).toContain('data-recon-state="moved"');
    expect(row).toContain(`data-recon-moved-tag="${C}"`);
    expect(row).toContain(ar(`${R}movedTag`));
    expect(row).not.toContain(`data-recon-tick="${C}"`);
    expect(row).toMatch(new RegExp(`data-recon-apply="${C}"[^>]*disabled=""`, 'u'));
    expect(row).not.toMatch(new RegExp(`data-recon-reject="${C}"[^>]*disabled=""`, 'u'));
    expect(row).toContain(ar(`${R}movedApply`));
    // The other two stay ticked.
    expect(rowOf(html, A)).toContain('data-recon-state="ticked"');
    expect(html).toContain('تم اختيار كارتين');
  });

  it('no banner while nothing was refused', () => {
    expect(renderResult()).not.toContain('data-recon-moved=');
  });
});

describe('the folds', () => {
  it('are closed at first; «صفوف لا تُطابَق» is absent while the sheet has none', () => {
    const html = renderResult();
    for (const mark of ['sheet-only', 'system-only', 'numbers', 'duplicates', 'equal']) {
      expect(html).toContain(`data-recon-fold="${mark}" data-open="false"`);
    }
    expect(html).not.toContain('data-recon-fold="conflicts"');
    expect(html).not.toContain('data-recon-conflicts-chip');
  });

  it('rows that never match: their fold and chip, counted as rows', () => {
    const html = renderResult({
      result: {
        ...RESULT,
        conflicts: [
          {
            reason: 'badBalance',
            name: 'EGYCASHTCS-4811-48358',
            cardId: null,
            rows: [{ row: 147, number: '548**********4811', balance: -2214.66 }],
          },
          {
            reason: 'sheetRowsDiffer',
            name: 'EGYCASH-3671-309819',
            cardId: null,
            rows: [
              { row: 3, number: '548**********0056', balance: 8403.24 },
              { row: 225, number: '548**********0056', balance: 8103.24 },
            ],
          },
        ],
      },
    });
    expect(html).toContain('data-recon-fold="conflicts" data-open="false"');
    expect(html).toContain(ar(`${R}secConflicts`));
    expect(html).toContain('data-recon-conflicts-chip="true"');
    expect(html).toContain(ar(`${R}conflictsChip`, { rows: '3 صفوف' }));
    // Drawn above the sheet-only fold.
    expect(html.indexOf('data-recon-fold="conflicts"')).toBeLessThan(
      html.indexOf('data-recon-fold="sheet-only"'),
    );
  });

  it('the conflicts table says each reason in words, and a balance it cannot read', () => {
    const FOLDS = readFileSync(
      join(HERE, '../components/fuel-reconcile/ReconcileFolds.tsx'),
      'utf8',
    );
    expect(FOLDS).toContain('t(`fleet.fuelCards.reconcile.conflict.${conflict.reason}`)');
    expect(FOLDS).toContain("t('fleet.fuelCards.reconcile.unreadable')");
    for (const reason of ['sheetRowsDiffer', 'systemNameTwice', 'badBalance', 'noName']) {
      expect(ar(`${R}conflict.${reason}`)).not.toBe(`${R}conflict.${reason}`);
    }
  });
});
