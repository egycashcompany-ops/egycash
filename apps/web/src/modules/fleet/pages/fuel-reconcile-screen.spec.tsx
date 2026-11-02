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
import { FuelReconcilePage, NO_SHEET_STATE, ReconcileResult } from './FuelReconcilePage';
import { ReconcileUploadCard } from '../components/fuel-reconcile/ReconcileUploadCard';
import {
  ChooseTable,
  ConflictTable,
  NumbersTable,
} from '../components/fuel-reconcile/reconcile-folds-parts';

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
/** A sheet row's batch-3 facts, neutral: no plate, chassis or code; the number kind not told. */
const ROW_FACTS = { plate: null, chassis: null, code: null, numberKind: 'other' as const };
const line = (
  id: string,
  system: number,
  sheet: number,
  over: Partial<FleetFuelReconcileLineDto> = {},
): FleetFuelReconcileLineDto => ({
  card: card(id, system),
  sheet: {
    row: 180,
    number: '548**********7868',
    name: `EGYCASH-${id}`,
    balance: sheet,
    builtName: `EGYCASH-${id}`,
    ...ROW_FACTS,
  },
  difference: (piastres(sheet) - piastres(system)) / 100,
  numberMatches: true,
  // Batch 3's line facts, neutral: matched by name, no crossed number, no charge to cancel.
  matchedBy: 'name',
  nameMatches: true,
  numberHolder: null,
  placeMatches: null,
  charges: [],
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
      sheet: {
        row: 28,
        number: '548**********0935',
        name: `EGYCASH-${C}`,
        balance: 8724.73,
        builtName: `EGYCASH-${C}`,
        ...ROW_FACTS,
      },
    }),
  ],
  equal: [line('e1', 6750, 6750)],
  sheetOnly: [
    {
      row: 222,
      number: '548**********1111',
      name: 'EGYCASH-1-2',
      balance: 10,
      builtName: 'EGYCASH-1-2',
      ...ROW_FACTS,
    },
  ],
  systemOnly: [card('s1', 40)],
  duplicates: [
    {
      row: 5,
      number: '548**********2222',
      name: 'EGYCASH-2-3',
      balance: 5,
      times: 2,
      builtName: 'EGYCASH-2-3',
      ...ROW_FACTS,
    },
  ],
  conflicts: [],
  // Batch 3's reading facts, neutral.
  layout: [],
  nameRebuilt: false,
  cardRows: 223,
  skipped: [],
  totalCheck: null,
  example: null,
  sheetDate: null,
  carColumn: false,
  links: [],
  newCards: [],
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
  // Batch 3: the links' car picker reads the vehicles, so the answer is drawn under a client.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={storeOf([...ALL, 'fleetFuelCard.edit', 'fleetFuelCard.create'])}>
      <QueryClientProvider client={qc}>
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
          onSwitch={() => undefined}
          onUpdateNumber={() => undefined}
          sheet={NO_SHEET_STATE}
          onDecideLinks={() => undefined}
          onAdd={() => undefined}
        />
      </QueryClientProvider>
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
              cancelledAmount: 0,
              approvedRequest: null,
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
    // Rewritten on purpose (batch 3, sample F1/06): the company's statements print the BARE
    // prefix («EGYCASHTCS»), so the stop names it without batch 2's trailing «-».
    expect(html).toContain('«EGYCASHTCS»');
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
            candidateIds: [],
            rows: [{ row: 147, number: '548**********4811', balance: -2214.66 }],
          },
          {
            reason: 'sheetRowsDiffer',
            name: 'EGYCASH-3671-309819',
            cardId: null,
            candidateIds: [],
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
    // Batch 3 moved the conflicts table into the folds' parts file — both are read.
    const FOLDS = ['ReconcileFolds.tsx', 'reconcile-folds-parts.tsx']
      .map((name) => readFileSync(join(HERE, '../components/fuel-reconcile', name), 'utf8'))
      .join('\n');
    expect(FOLDS).toContain('t(`fleet.fuelCards.reconcile.conflict.${conflict.reason}`)');
    expect(FOLDS).toContain("t('fleet.fuelCards.reconcile.unreadable')");
    for (const reason of ['sheetRowsDiffer', 'systemNameTwice', 'badBalance', 'noName']) {
      expect(ar(`${R}conflict.${reason}`)).not.toBe(`${R}conflict.${reason}`);
    }
  });
});

// ── Batch 3 — 6c: reading the sheet ─────────────────────────────────────────────────────────────

/** The 4-10 statement's reading (sample F1/02): masked numbers, the bare «EGYCASH» rebuilt from
 *  the plate and the chassis, the car code, «قيمه الشحن» and the PIN recognised and never read. */
const READ: FleetFuelReconcileDto = {
  ...RESULT,
  fileName: 'رصيد وطنيه 4-10-2026.xlsx',
  rows: 219,
  cardRows: 216,
  layout: [
    { role: 'number', column: 'A', header: 'Card Number', assumed: false },
    { role: 'name', column: 'B', header: 'Card Name', assumed: false },
    { role: 'plate', column: 'C', header: 'لوحه', assumed: false },
    { role: 'chassis', column: 'D', header: 'شاسيه', assumed: false },
    { role: 'balance', column: 'E', header: 'Card Balance', assumed: false },
    { role: 'code', column: 'F', header: 'كود', assumed: false },
    { role: 'ignored', column: 'G', header: 'قيمه الشحن', assumed: false },
    { role: 'secret', column: 'H', header: 'pass', assumed: false },
  ],
  nameRebuilt: true,
  example: { row: 2, builtName: 'EGYCASH-3674-B257539' },
  skipped: [
    { row: 218, text: 'رصيد الكروت', figure: 963194.66 },
    { row: 219, text: 'قيمه الشحن', figure: 1030000 },
    { row: 220, text: 'الرصيد المتوقع', figure: 700000 },
  ],
  totalCheck: { row: 218, text: 'رصيد الكروت', figure: 963194.66, sum: 963194.66, agrees: true },
  sheetDate: '2026-10-04',
  carColumn: true,
};
const matchedAll = (html: string): void => {
  expect(html).toContain('data-recon-matched-chip="true"');
};

describe('6c: how the sheet was read', () => {
  it('names each column’s role — the name rebuilt from the company, the plate and the chassis', () => {
    const html = renderResult({ result: READ });
    const line = html.slice(
      html.indexOf('data-recon-layout="true"'),
      html.indexOf('</section>', html.indexOf('data-recon-layout="true"')),
    );
    expect(line).toContain(ar(`${R}layout.title`));
    expect(line).toContain('data-recon-layout-role="number"');
    expect(line).toContain(ar(`${R}layout.role.number`));
    // The number's kind is told from the first card row: here it is not told.
    expect(line).not.toContain(ar(`${R}layout.masked`));
    expect(line).toContain(ar(`${R}layout.companyWord`));
    expect(line).toContain(ar(`${R}layout.role.plate`));
    expect(line).toContain(ar(`${R}layout.role.chassis`));
    expect(line).toContain('data-recon-layout-role="code"');
    // Recognised and never read: «قيمه الشحن» and the PIN column, named by their header only.
    expect(line).toContain('data-recon-layout-not-read="true"');
    expect(line).toContain('قيمه الشحن');
    expect(line).toContain(ar(`${R}layout.neverPin`));
    expect(line).toContain('EGYCASH-3674-B257539');
    expect(line).toContain(ar(`${R}layout.example`, { row: 2 }));
  });

  it('untitled columns read by their content are flagged; an old session draws no layout line', () => {
    const assumed = renderResult({
      result: {
        ...READ,
        layout: READ.layout.map((c) =>
          c.role === 'plate' || c.role === 'chassis' ? { ...c, header: null, assumed: true } : c,
        ),
      },
    });
    expect(assumed).toContain('data-recon-layout-assumed="true"');
    const masked = renderResult({
      result: {
        ...READ,
        differs: READ.differs.map((one) => ({
          ...one,
          sheet: { ...one.sheet, numberKind: 'masked' as const },
        })),
      },
    });
    expect(masked).toContain(`· ${ar(`${R}layout.masked`)}`);
    expect(assumed).toContain(ar(`${R}layout.untitled`));
    const old = renderResult();
    expect(old).not.toContain('data-recon-layout=');
    expect(old).not.toContain('data-recon-matched-chip');
  });

  it('the strip counts the CARD rows and shows the sheet’s date; the chips check the totals row', () => {
    const html = renderResult({ result: READ });
    expect(html).toContain('216 صفًّا');
    expect(html).toContain('data-recon-sheet-date="true"');
    expect(html).toContain('2026/10/04');
    matchedAll(html);
    expect(html).toContain('data-recon-total-chip="agrees"');
    expect(html).toContain('963,194.66');
    expect(html).toContain('data-recon-skipped-chip="true"');
    expect(html).toContain(ar(`${R}secSkippedChip`, { rows: '3 صفوف' }));
    const off = renderResult({
      result: { ...READ, totalCheck: { ...READ.totalCheck!, sum: 963000, agrees: false } },
    });
    expect(off).toContain('data-recon-total-chip="differs"');
    // The rows that are not cards have a fold of their own.
    expect(html).toContain('data-recon-fold="skipped" data-open="false"');
    expect(html).toContain(ar(`${R}secSkipped`));
  });

  it('raises the guard banner when fewer than half the card rows found a card', () => {
    // Four cards found (three differ, one equal): of 8 card rows that is half — no banner.
    expect(renderResult({ result: { ...READ, cardRows: 8 } })).not.toContain('data-recon-guard');
    const mass = renderResult({ result: { ...READ, cardRows: 9 } });
    expect(mass).toContain('data-recon-guard="true"');
    expect(mass).toContain(ar(`${R}guard`, { matched: 4, rows: '9 صفوف' }));
  });

  it('a sheet of the other company STOPS the comparison, with a one-click switch', () => {
    const html = renderResult({ result: { ...READ, sheetCompany: 'chillout' } });
    expect(html).toContain('data-recon-page="wrong-company"');
    expect(html).toContain('data-recon-switch="chillout"');
    expect(html).toContain(ar(`${R}wrongCompanySwitch`, { sheet: 'شل أوت' }));
    // Nothing is compared under it.
    expect(html).not.toContain('data-recon-table');
    expect(html).not.toContain('data-recon-counts');
    expect(html).not.toContain('data-recon-folds');
    // How the sheet was read stays, so the reader sees why.
    expect(html).toContain('data-recon-layout="true"');
  });
});

describe('6c: the rows that are never decided — one table row per sheet row', () => {
  const T = (rows: number): FleetFuelReconcileDto['conflicts'][number] => ({
    reason: 'sheetRowsDiffer',
    name: 'EGYCASH',
    cardId: null,
    candidateIds: [],
    rows: Array.from({ length: rows }, (_, i) => ({
      row: i + 2,
      number: '548**********0021',
      balance: 100 + i,
    })),
  });
  const conflictsOf = (conflicts: FleetFuelReconcileDto['conflicts']): string =>
    renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        <ConflictTable conflicts={conflicts} />
      </Provider>,
    );

  it('the name and the reason on the conflict’s first row, every row top-aligned', () => {
    const html = conflictsOf([T(3)]);
    expect(html.match(/data-recon-conflict="sheetRowsDiffer"/gu)).toHaveLength(3);
    expect(html.match(/class="align-top/gu)).toHaveLength(3);
    expect(html.match(/EGYCASH</gu)).toHaveLength(1);
    expect(html.match(new RegExp(ar(`${R}conflict.sheetRowsDiffer`), 'gu'))).toHaveLength(1);
    expect(html).toContain('548 •••• 0021');
  });

  it('a conflict longer than ten rows shows ten and «و N أخرى»', () => {
    const html = conflictsOf([T(216)]);
    expect(html.match(/data-recon-conflict-row=/gu)).toHaveLength(10);
    expect(html).toContain('data-recon-conflict-more="206"');
    expect(html).toContain(ar(`${R}moreRows`, { rows: '206 صفوف' }));
  });

  it('a negative balance is said as one', () => {
    const html = conflictsOf([
      {
        reason: 'badBalance',
        name: 'EGYCASHTCS-4811-48358',
        cardId: null,
        candidateIds: [],
        rows: [{ row: 188, number: '548**********6617', balance: -2214.66 }],
      },
    ]);
    expect(html).toContain(ar(`${R}negativeBalance`));
    expect(html).toContain('−2,214.66');
  });

  it('«تحتاج اختيارًا»: a number with no name, the cards its last four fit — nothing decided', () => {
    const withChoice = renderResult({
      result: {
        ...RESULT,
        conflicts: [
          {
            reason: 'ambiguousNumber',
            name: '',
            cardId: null,
            candidateIds: [A, 's1'],
            rows: [{ row: 9, number: '548**********7868', balance: 50 }],
          },
        ],
      },
    });
    expect(withChoice).toContain('data-recon-fold="choose" data-open="false"');
    expect(withChoice).toContain(ar(`${R}secChoose`));
    // Not among the rows that never match.
    expect(withChoice).not.toContain('data-recon-fold="conflicts"');
    const table = renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        <ChooseTable
          conflicts={[
            {
              reason: 'ambiguousNumber',
              name: '',
              cardId: null,
              candidateIds: [A, 'gone'],
              rows: [{ row: 9, number: '548**********7868', balance: 50 }],
            },
          ]}
          cardOf={(id) => (id === A ? card(A, 795) : undefined)}
        />
      </Provider>,
    );
    expect(table).toContain(`data-recon-candidate="${A}"`);
    expect(table).toContain(`EGYCASH-${A}`);
    expect(table).toContain(ar(`${R}conflict.ambiguousNumber`));
    expect(table).not.toContain('data-recon-apply');
  });
});

describe('6c: «أرقام مختلفة» — who holds the sheet’s number', () => {
  const numbersOf = (lines: FleetFuelReconcileLineDto[], mayEdit = true): string =>
    renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        <NumbersTable
          lines={lines}
          cardNow={(c) => c}
          onUpdateNumber={mayEdit ? () => undefined : null}
        />
      </Provider>,
    );

  it('names the card the sheet’s number is on, with its car', () => {
    const html = numbersOf([
      line(A, 1469.52, 129.52, {
        numberMatches: false,
        numberHolder: { id: 'h1', name: 'EGYCASH-4822-48085', place: '800' },
      }),
    ]);
    expect(html).toContain(ar(`${R}numberHolder`));
    expect(html).toContain('data-recon-holder="h1"');
    expect(html).toContain('EGYCASH-4822-48085');
    expect(html).toContain('>800<');
    expect(html).toContain('548 •••• 7868');
    expect(html).not.toContain('data-recon-update-number');
  });

  it('no card holds it: «تحديث رقم الكارت», for those who may edit cards', () => {
    const lone = [line(A, 6785.22, 385.22, { numberMatches: false })];
    expect(numbersOf(lone)).toContain(`data-recon-update-number="${A}"`);
    expect(numbersOf(lone)).toContain(ar(`${R}numberHolderNone`));
    expect(numbersOf(lone, false)).not.toContain('data-recon-update-number');
  });

  it('the sheet’s code beside the car when it names another place — a hint only', () => {
    const html = numbersOf([
      line(A, 10, 20, {
        numberMatches: false,
        placeMatches: false,
        sheet: { ...line(A, 10, 20).sheet, code: '209' },
      }),
    ]);
    expect(html).toContain(`data-recon-place-in-sheet="${A}"`);
    expect(html).toContain(ar(`${R}placeInSheet`, { code: '209' }));
  });

  it('the table row offers «تحديث رقم الكارت» too, when no card holds the number', () => {
    const html = renderResult({
      result: { ...RESULT, differs: [line(C, 6785.22, 385.22, { numberMatches: false })] },
    });
    expect(rowOf(html, C)).toContain(`data-recon-update-number="${C}"`);
    expect(rowOf(renderResult(), A)).not.toContain('data-recon-update-number');
  });
});

describe('6c / M23: the upload card', () => {
  const uploadOf = (fileName: string | null, sheetDate: string): string =>
    renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        <QueryClientProvider client={new QueryClient()}>
          <ReconcileUploadCard
            company="wataniya"
            file={fileName === null ? null : ({ name: fileName, size: 24576 } as File)}
            reading={false}
            onCompany={() => undefined}
            onFile={() => undefined}
            onCompare={() => undefined}
            sheetDate={sheetDate}
            onSheetDate={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );

  it('names the layouts it reads — and what it never reads', () => {
    const html = uploadOf(null, '');
    expect(html).toContain('data-recon-layouts="true"');
    expect(html).toContain(ar(`${R}dropNoteLayouts`));
    expect(html).toContain(ar(`${R}layouts.name`));
    expect(html).toContain(ar(`${R}layouts.never`));
    expect(html).toContain('data-recon-sheet-date-field="true"');
    expect(html).toContain(ar(`${R}sheetDateOptional`));
  });

  it('the sheet’s date from the file name, said so; none when the name holds none', () => {
    const named = uploadOf('رصيد وطنيه 4-10-2026.xlsx', '2026-10-04');
    expect(named).toContain('value="2026-10-04"');
    expect(named).toContain('data-recon-sheet-date-from="4-10-2026"');
    const changed = uploadOf('رصيد وطنيه 4-10-2026.xlsx', '2026-10-05');
    expect(changed).not.toContain('data-recon-sheet-date-from');
    const plain = uploadOf('بيانات شركه وطنيه.xlsx', '');
    expect(plain).toContain('value=""');
    expect(plain).not.toContain('data-recon-sheet-date-from');
    // The file's name in order: the Arabic head right to left, its date and extension isolated.
    expect(named).toContain('<span dir="ltr">4-10-2026.xlsx</span>');
  });

  it('the page fills the date from the file it is given (`sheetDateOfName`)', () => {
    const PAGE = readFileSync(join(HERE, 'FuelReconcilePage.tsx'), 'utf8');
    expect(PAGE).toContain(
      "setSheetDate(picked === null ? '' : (sheetDateOfName(picked.name)?.day ?? ''))",
    );
    expect(PAGE).toContain('{ company: picked, file, sheetDate }');
  });
});

// ── Batch 3 — 6a: a top-up the sheet does not show, a request the difference equals ────────────

const CH = '650000000000000000000d04';
const RQ = '650000000000000000000e05';
const charge = (id: string, amount: number, afterSheetDate = false) => ({
  id,
  amount,
  at: '2026-11-01T08:05:00.000Z',
  byName: 'مدير الحركة',
  afterSheetDate,
});
const SIXA: FleetFuelReconcileDto = {
  ...RESULT,
  fileName: 'وطنية 1-11-2026.xlsx',
  sheetDate: '2026-10-04',
  differs: [
    {
      ...line(RQ, 77.48, 1577.48),
      card: card(RQ, 77.48, { requestedAmount: 1500, requestedAt: '2026-10-31T09:00:00.000Z' }),
    },
    line(CH, 11203.43, 10203.43, {
      charges: [charge('m1', 1000), charge('m2', 250, true)],
    }),
  ],
};

describe('6a: what a ✓ will ask about', () => {
  it('chips under the card: the charge the sheet does not show, and the request it equals', () => {
    const html = renderResult({ result: SIXA });
    const lower = rowOf(html, CH);
    expect(lower).toContain('data-recon-unseen-chip="m1"');
    expect(lower).toContain('data-recon-unseen-chip="m2"');
    expect(lower).toContain('1,000.00');
    expect(lower).toContain(ar(`${R}afterSheetDate`));
    expect(lower).toContain(`title="${ar(`${R}asksFirst`)}"`);
    const higher = rowOf(html, RQ);
    expect(higher).toContain(`data-recon-request-chip="${RQ}"`);
    expect(higher).toContain('1,500.00');
    expect(higher).toContain(`title="${ar(`${R}asksFirstRequest`)}"`);
    // A plain row keeps batch 2's one-click words.
    expect(rowOf(renderResult(), A)).toContain(
      `title="${ar(`${R}apply`, { balance: '16,745.12' })}"`,
    );
  });

  it('the confirm: the sheet’s date, the checklist pre-ticked, the later charge apart, the warning', () => {
    const html = renderResult({
      result: SIXA,
      actions: [{ type: 'toggle', id: CH, on: true }],
      confirming: 'apply',
    });
    expect(html).toContain('data-recon-confirm-sheet-date="2026-10-04"');
    expect(html).toContain('2026/10/04');
    expect(html).toContain('data-recon-confirm-block="unseen"');
    expect(html).toContain('data-recon-confirm-charge="m1" data-recon-confirm-charge-on="yes"');
    expect(html).toContain('data-recon-confirm-pre-ticked="m1"');
    // After the sheet's date: listed apart, never pre-ticked.
    expect(html).toContain('data-recon-confirm-later="true"');
    expect(html).toContain('data-recon-confirm-charge="m2" data-recon-confirm-charge-on="no"');
    expect(html).not.toContain('data-recon-confirm-pre-ticked="m2"');
    expect(html).toContain('data-recon-confirm-moved-after="true"');
    expect(html).toContain(ar(`${R}movedAfterSheetDate`));
    expect(html).toContain('data-recon-confirm-marked="1000"');
    expect(html).not.toContain('data-recon-confirm-block="request"');
  });

  it('the confirm: «اعتماد طلب الرصيد» suggested and chosen, «تسوية فقط» beside it', () => {
    const html = renderResult({
      result: SIXA,
      actions: [{ type: 'toggle', id: RQ, on: true }],
      confirming: 'apply',
    });
    expect(html).toContain('data-recon-confirm-block="request"');
    expect(html).toContain(
      'data-recon-confirm-request="approve" data-recon-confirm-request-on="yes"',
    );
    expect(html).toContain(
      'data-recon-confirm-request="adjust" data-recon-confirm-request-on="no"',
    );
    expect(html).toContain(ar(`${R}approveRequest`));
    expect(html).not.toContain('data-recon-confirm-block="unseen"');
  });

  it('a ✗ asks nothing; a sheet without a date says so', () => {
    const reject = renderResult({
      result: SIXA,
      actions: [{ type: 'toggle', id: CH, on: true }],
      confirming: 'reject',
    });
    expect(reject).not.toContain('data-recon-confirm-block');
    expect(reject).not.toContain('data-recon-confirm-sheet-date');
    const undated = renderResult({
      result: { ...SIXA, sheetDate: null },
      actions: [{ type: 'toggle', id: CH, on: true }],
      confirming: 'apply',
    });
    expect(undated).toContain('data-recon-confirm-sheet-date="none"');
    expect(undated).toContain(ar(`${R}sheetDateNone`));
    expect(undated).not.toContain('data-recon-confirm-moved-after');
  });

  it('a row that asks first opens the confirm for itself; the body carries only what is chosen', () => {
    const PAGE = readFileSync(join(HERE, 'FuelReconcilePage.tsx'), 'utf8');
    expect(PAGE).toContain("if (decision === 'apply' && line !== undefined && asksFirst(line)) {");
    expect(PAGE).toContain("confirming === 'apply' ? decideExtrasOf(asked, choiceOf) : undefined");
    expect(PAGE).toContain('body: { decision: chosen, cardIds: [...ids], ...extras }');
  });
});
