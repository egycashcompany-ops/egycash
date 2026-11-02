// «سجل الكارت» after batch 3's company-sheet decisions, proven against what it draws: a charge the
// sheet cancelled stays struck, with the violet chip «أُلغي بشيت الشركة · file · date» and no ✎ 🗑;
// the adjustment that cancelled it says «وأُلغي شحن …»; a card moved car by the sheet has its own
// line «نُقل من … إلى … — شيت الشركة»; every file name is set in order; and every line kind has a
// tone. (The batch-2 lines are pinned in `fuel-cards-screen.spec.tsx`.)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FLEET_FUEL_MOVEMENT_KINDS,
  type FleetFuelCardDto,
  type FleetFuelCardMovementDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { FuelCardHistoryDialog } from '../components/FuelCardHistoryDialog';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const H = 'fleet.fuelCards.history.';

const ALL = [
  'fleetFuelCard.view',
  'fleetFuelCharge.view',
  'fleetFuelCharge.approve',
  'fleetFuelCharge.transfer',
];
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

const CARD: FleetFuelCardDto = {
  id: 'c-1',
  vehicleId: 'v-150',
  vehicleCode: '150',
  label: null,
  company: 'wataniya',
  name: 'EGYCASH-2374-B250541',
  number: '5485640006436766',
  expiresAt: '2029-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 10203.43,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const FILE = 'وطنية 1-11-2026.xlsx';
const line = (over: Partial<FleetFuelCardMovementDto>): FleetFuelCardMovementDto => ({
  id: 'm-1',
  cardId: 'c-1',
  kind: 'charge',
  amount: 1000,
  balanceAfter: 11203.43,
  counterpartCardId: null,
  counterpartNumber: null,
  receiptVehicleId: null,
  receiptVehicleCode: null,
  at: '2026-11-01T08:05:00.000Z',
  createdAt: '2026-11-01T08:05:00.000Z',
  byName: 'مدير الحركة',
  sheet: null,
  cancelledBySheet: null,
  link: null,
  repair: null,
  ...over,
});
// Sample F2/07: the top-up the 1-11 sheet cancelled, under the adjustment that cancelled it.
const CANCELLED = line({
  id: 'charge-1',
  cancelledBySheet: {
    reconciliationId: 'r-1',
    fileName: FILE,
    at: '2026-11-01T09:02:00.000Z',
    byName: 'مدير الحركة',
  },
});
const ADJUST = line({
  id: 'adjust-1',
  kind: 'sheetAdjust',
  amount: -1000,
  balanceAfter: 10203.43,
  at: '2026-11-01T09:02:00.000Z',
  sheet: {
    reconciliationId: 'r-1',
    fileName: FILE,
    sheetBalance: 10203.43,
    systemBalance: 11203.43,
    cancelledCharges: [{ id: 'charge-1', amount: 1000 }],
  },
});
// Sample F1/09: the card moved from «سفر 1» onto car 285 by the 4-10 sheet.
const MOVED = line({
  id: 'link-1',
  kind: 'sheetLink',
  amount: 0,
  balanceAfter: 260.96,
  link: {
    from: { vehicleId: null, vehicleCode: null, label: 'سفر 1' },
    to: { vehicleId: 'v-285', vehicleCode: '285', label: null },
    sheetCode: '285',
    reconciliationId: 'r-2',
    fileName: 'رصيد وطنيه 4-10-2026.xlsx',
  },
});
const LIVE = line({ id: 'charge-2', at: '2026-10-06T09:15:00.000Z' });

const logOf = (lines: FleetFuelCardMovementDto[]): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(ALL), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'fuelCards', { movements: CARD.id }), {
    items: lines,
    meta: { page: 1, pageSize: 100, totalItems: lines.length, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <FuelCardHistoryDialog card={CARD} cards={[CARD]} onClose={() => undefined} />
      </QueryClientProvider>
    </Provider>,
  );
};
const lineOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-fuel-history-line="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const next = html.indexOf('data-fuel-history-line=', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};

describe('a charge the company’s sheet cancelled', () => {
  it('stays in the log, struck, with «أُلغي بشيت الشركة · file · date» — and is changed nowhere', () => {
    const html = logOf([ADJUST, CANCELLED, LIVE]);
    const struck = lineOf(html, 'charge-1');
    expect(struck).toContain('data-fuel-history-cancelled="sheet"');
    expect(struck).toContain('line-through');
    expect(struck).toContain('data-fuel-history-cancelled-chip="charge-1"');
    expect(struck).toContain(ar(`${H}cancelledBySheet`));
    expect(struck).toContain('<span dir="ltr">1-11-2026.xlsx</span>');
    expect(struck).toContain(ar(`${H}cancelledNote`));
    expect(struck).not.toContain('data-fuel-history-edit');
    expect(struck).not.toContain('data-fuel-history-remove');
    // A live charge keeps its pen and bin.
    const live = lineOf(html, 'charge-2');
    expect(live).toContain('data-fuel-history-edit="charge-2"');
    expect(live).not.toContain('data-fuel-history-cancelled');
  });

  it('the adjustment that cancelled it adds «وأُلغي شحن …», its file in order', () => {
    const adjust = lineOf(logOf([ADJUST, CANCELLED]), 'adjust-1');
    expect(adjust).toContain(
      ar(`${H}sheetFromTo`, { from: '11,203.43', to: '10,203.43' }) +
        ' ' +
        ar(`${H}sheetCancelled`, { amount: '1,000.00' }),
    );
    expect(adjust).toContain('<span dir="ltr">1-11-2026.xlsx</span>');
    expect(adjust).not.toContain('data-fuel-history-edit');
    // An adjustment that cancelled nothing reads as batch 2's.
    const plain = lineOf(
      logOf([{ ...ADJUST, sheet: { ...ADJUST.sheet!, cancelledCharges: [] } }]),
      'adjust-1',
    );
    expect(plain).not.toContain(ar(`${H}sheetCancelled`, { amount: '1,000.00' }));
  });
});

describe('a card the sheet moved car', () => {
  it('«نقل من شيت الشركة»: from where to where, the file, no amount, changed nowhere', () => {
    const moved = lineOf(logOf([MOVED]), 'link-1');
    expect(moved).toContain(ar(`${H}kind.sheetLink`));
    expect(moved).toContain(
      ar(`${H}sheetLink`, {
        from: ar('fleet.fuelCards.reconcile.links.placeLabel', { label: 'سفر 1' }),
        to: ar('fleet.fuelCards.reconcile.links.placeCar', { code: '285' }),
      }),
    );
    expect(ar(`${H}sheetLink`, { from: '«سفر 1»', to: 'سيارة 285' })).toBe(
      'نُقل من «سفر 1» إلى سيارة 285 — شيت الشركة',
    );
    expect(moved).toContain('<span dir="ltr">4-10-2026.xlsx</span>');
    expect(moved).toContain('cyan');
    expect(moved).not.toContain('data-fuel-history-edit');
    expect(moved).not.toContain('+0.00');
  });
});

describe('every line kind', () => {
  it('has its own tone and its own words', () => {
    const SOURCE = readFileSync(join(HERE, '../components/FuelCardHistoryDialog.tsx'), 'utf8');
    const tones = SOURCE.slice(
      SOURCE.indexOf('const KIND_TONE'),
      SOURCE.indexOf('};', SOURCE.indexOf('const KIND_TONE')),
    );
    for (const kind of FLEET_FUEL_MOVEMENT_KINDS) {
      expect(tones, kind).toMatch(new RegExp(`\\b${kind}:`, 'u'));
      expect(ar(`${H}kind.${kind}`), kind).not.toBe(`${H}kind.${kind}`);
    }
    // F0's stand-in is gone: `sheetLink` no longer borrows `sheetReject`'s rose.
    expect(SOURCE).not.toContain('B3-F0 stub');
  });
});

// ── 6d «تصحيح أرقام الكروت»: the repair's line, and the lines before it ─────────────────────────

const REPAIRED_AT = '2026-11-02T10:31:00.000Z';
/** Sample 07: car 239's record took the number •••• 0935 — PIN, photo and expiry with it. */
const FIX_NUMBER = line({
  id: 'fix-1',
  kind: 'dataFix',
  amount: 0,
  balanceAfter: 10203.43,
  at: REPAIRED_AT,
  repair: {
    key: '6d:2026-10-04',
    unit: 'C4',
    kind: 'number',
    numberBeforeLast4: '2813',
    numberAfterLast4: '0935',
    pinMoved: true,
    photoMoved: true,
    expiryBefore: '2027-03-31',
    expiryAfter: '2027-03-31',
    nameBefore: null,
    nameAfter: null,
    openingBefore: null,
    openingAfter: null,
  },
});
/** Car 284's record: the number it takes has no PIN stored — left empty; the expiry moves. */
const FIX_NO_PIN = line({
  ...FIX_NUMBER,
  id: 'fix-2',
  repair: {
    ...FIX_NUMBER.repair!,
    unit: 'C5',
    numberBeforeLast4: '8713',
    numberAfterLast4: '9096',
    pinMoved: false,
    expiryBefore: '2027-11-30',
    expiryAfter: '2029-01-31',
  },
});
/** The 0849 pair, car 530: the name and the go-live opening swap; the balance moves by Δ. */
const FIX_PAIR = line({
  id: 'fix-3',
  kind: 'dataFix',
  amount: -11872.62,
  balanceAfter: 11258,
  at: REPAIRED_AT,
  repair: {
    key: '6d:2026-10-04',
    unit: 'pair',
    kind: 'nameSwap',
    numberBeforeLast4: null,
    numberAfterLast4: null,
    pinMoved: null,
    photoMoved: null,
    expiryBefore: null,
    expiryAfter: null,
    nameBefore: 'EGYCASH-8616-783211',
    nameAfter: 'EGYCASH-1137-401485',
    openingBefore: 13130.62,
    openingAfter: 1258,
  },
});
const BEFORE_FIX = line({ id: 'charge-3', at: '2026-10-23T08:40:00.000Z' });
const AFTER_FIX = line({ id: 'charge-4', at: '2026-11-03T08:40:00.000Z' });

describe('6d — the repair’s line «تصحيح بيانات»', () => {
  it('a moved number: «صُحّح رقم الكارت: كان •••• 2813 وأصبح •••• 0935 — تصحيح بيانات التشغيل», amount «—»', () => {
    const fix = lineOf(logOf([FIX_NUMBER, BEFORE_FIX]), 'fix-1');
    expect(fix).toContain(ar(`${H}kind.dataFix`));
    expect(fix).toContain('indigo');
    expect(fix).toContain('data-fuel-history-repair="fix-1"');
    const sentence = fix.slice(fix.indexOf('data-fuel-history-repair="fix-1"'));
    expect(sentence.replace(/<[^>]+>/gu, '')).toContain(
      ar(`${H}dataFix.number`, { before: '•••• 2813', after: '•••• 0935' }),
    );
    expect(ar(`${H}dataFix.number`, { before: '•••• 2813', after: '•••• 0935' })).toBe(
      'صُحّح رقم الكارت: كان •••• 2813 وأصبح •••• 0935 — تصحيح بيانات التشغيل',
    );
    // What moved with it: its PIN (one is stored), the photo, the expiry — the same date.
    expect(fix).toContain(ar(`${H}dataFix.movedAll`, { expiry: ar(`${H}dataFix.sameDate`) }));
    expect(fix).toContain(ar(`${H}dataFix.kept`));
    expect(fix).not.toContain(ar(`${H}dataFix.noPin`));
    // Nothing moved in money: «—», never «+0.00».
    expect(fix).toContain('—');
    expect(fix).not.toContain('+0.00');
    // Changed nowhere.
    expect(fix).not.toContain('data-fuel-history-edit');
    expect(fix).not.toContain('data-fuel-history-remove');
  });

  it('a number with no PIN stored: «تُرك فارغًا», and the new expiry date', () => {
    const fix = lineOf(logOf([FIX_NO_PIN]), 'fix-2');
    expect(fix).toContain(ar(`${H}dataFix.movedNoPin`, { expiry: '2029/01/31' }));
    expect(fix).toContain(ar(`${H}dataFix.noPin`));
    expect(fix).not.toContain(ar(`${H}dataFix.movedAll`, { expiry: '2029/01/31' }));
  });

  it('the 0849 pair: the name and the opening before and after, the difference signed', () => {
    const fix = lineOf(logOf([FIX_PAIR]), 'fix-3');
    expect(fix.replace(/<[^>]+>/gu, '')).toContain(
      ar(`${H}dataFix.nameSwap`, {
        before: 'EGYCASH-8616-783211',
        after: 'EGYCASH-1137-401485',
        from: '13,130.62',
        to: '1,258.00',
      }),
    );
    expect(fix).toContain(ar(`${H}dataFix.nameSwapKept`));
    expect(fix).toContain('−11,872.62');
    expect(fix).not.toContain('data-fuel-history-edit');
  });

  it('marks every older line «سُجِّلت قبل التصحيح» — and only on a card that has the line', () => {
    const html = logOf([AFTER_FIX, FIX_NUMBER, BEFORE_FIX]);
    const tag = ar(`${H}beforeRepair`);
    expect(lineOf(html, 'charge-3')).toContain(tag);
    expect(lineOf(html, 'charge-3')).toContain('data-fuel-history-before-repair="true"');
    // The older top-up keeps its pen and bin: it is kept exactly as it was.
    expect(lineOf(html, 'charge-3')).toContain('data-fuel-history-edit="charge-3"');
    expect(lineOf(html, 'charge-4')).not.toContain(tag);
    expect(lineOf(html, 'fix-1')).not.toContain(tag);
    expect(logOf([BEFORE_FIX])).not.toContain(tag);
    // As the approved sample draws it: «بواسطة» follows the tag (and the repair's words) on those
    // lines; a line after the repair keeps it at the far end, as every log line did before.
    expect(lineOf(html, 'charge-3')).not.toContain('class="ms-auto"');
    expect(lineOf(html, 'fix-1')).not.toContain('class="ms-auto"');
    expect(lineOf(html, 'charge-4')).toContain('class="ms-auto"');
  });

  it('shows last fours only — never a full number, never a PIN', () => {
    const html = logOf([FIX_NUMBER, FIX_NO_PIN, FIX_PAIR]);
    const body = html.slice(html.indexOf('data-fuel-history-lines'));
    expect(body).not.toMatch(/\d{9,}/u);
    expect(html).not.toMatch(/password/iu);
  });
});
