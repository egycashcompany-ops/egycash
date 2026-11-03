// 6d on «مطابقة أرصدة الكروت»: a line of the 0849 pair read while «تصحيح أرقام الكروت» is pending
// (`inRepair`) takes no ✓ — its name sits on the other card's record, so the sheet's figure would
// land on the wrong card. The ✓ cell shows «ضمن تصحيح الأرقام», «تحديد الكل» passes it by, a bulk ✓
// leaves it out, its ✗ stays; a ✓ the server refuses for it (409 `FLEET_FUEL_RECONCILE_IN_REPAIR`)
// is worded as the link ✓'s own refusal.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLineDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import {
  NO_SELECTION,
  applicableLines,
  reconcileSelection,
  tickAll,
  toggle,
  waitsForRepair,
  type ReconcileSelectionAction,
} from '../lib/fuel-reconcile';
import { decideRefusalOf, isDecideRefusal } from '../lib/fuel-reconcile-words';
import { NO_SHEET_STATE, ReconcileResult } from './FuelReconcilePage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);
const R = 'fleet.fuelCards.reconcile.';

const card = (id: string, balance: number): FleetFuelCardDto => ({
  id,
  vehicleId: `v-${id}`,
  vehicleCode: id === P1 ? '530' : '254',
  label: null,
  company: 'wataniya',
  name: `EGYCASH-${id}`,
  number: '5485 6400 0621 0849',
  expiresAt: '2029-01-31T00:00:00.000Z',
  hasPassword: true,
  balance,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const line = (id: string, inRepair: boolean): FleetFuelReconcileLineDto => ({
  card: card(id, 1258),
  sheet: {
    row: 12,
    number: '548**********0849',
    name: `EGYCASH-${id}`,
    balance: 11430.62,
    builtName: `EGYCASH-${id}`,
    plate: null,
    chassis: null,
    code: null,
    numberKind: 'other',
  },
  difference: 10172.62,
  numberMatches: true,
  matchedBy: 'name',
  nameMatches: true,
  numberHolder: null,
  placeMatches: null,
  charges: [],
  inRepair,
});

const P1 = '650000000000000000000a30';
const OTHER = '650000000000000000000b54';
const LINES = [line(P1, true), line(OTHER, false)];
const RESULT: FleetFuelReconcileDto = {
  id: '650000000000000000000999',
  company: 'wataniya',
  fileName: 'وطنية 1-11-2026.xlsx',
  fileSha256: 'f'.repeat(64),
  rows: 2,
  readAt: '2026-11-01T08:40:00.000Z',
  sheetCompany: 'wataniya',
  differs: LINES,
  equal: [],
  sheetOnly: [],
  systemOnly: [],
  duplicates: [],
  conflicts: [],
  layout: [],
  nameRebuilt: false,
  cardRows: 2,
  skipped: [],
  totalCheck: null,
  example: null,
  sheetDate: null,
  carColumn: false,
  links: [],
  newCards: [],
};

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

const render = (actions: ReconcileSelectionAction[] = []): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: me(['fleetFuelCard.view', 'fleetFuelCharge.view', 'fleetFuelCharge.approve']),
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <ReconcileResult
          result={RESULT}
          selection={actions.reduce(reconcileSelection, NO_SELECTION)}
          dispatch={() => undefined}
          mayDecide
          deciding={false}
          confirming={null}
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
const rowOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-recon-row="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</tr>', start));
};

describe('the selection', () => {
  it('«تحديد الكل» passes a line waiting for the number repair by', () => {
    const all = tickAll(NO_SELECTION, LINES, true);
    expect([...all.picked]).toEqual([OTHER]);
  });
  it('the line may still be ticked by hand — for a bulk ✗', () => {
    expect([...toggle(NO_SELECTION, P1, true).picked]).toEqual([P1]);
  });
  it('a ✓ names only the lines it may', () => {
    expect(waitsForRepair(LINES[0] as FleetFuelReconcileLineDto)).toBe(true);
    expect(applicableLines(LINES).map((one) => one.card.id)).toEqual([OTHER]);
  });
});

describe('the table', () => {
  it('shows «ضمن تصحيح الأرقام» where the ✓ would be; the ✗ stays', () => {
    const row = rowOf(render(), P1);
    expect(row).toContain(`data-recon-in-repair="${P1}"`);
    expect(row).toContain(ar(`${R}links.inRepair`));
    expect(row).toContain(ar(`${R}inRepairLine`));
    expect(row).not.toContain(`data-recon-apply="${P1}"`);
    expect(row).toMatch(new RegExp(`data-recon-reject="${P1}"(?![^>]*disabled="")`, 'u'));
    // Any other line keeps its ✓.
    expect(rowOf(render(), OTHER)).toContain(`data-recon-apply="${OTHER}"`);
  });
  it('says why under the table', () => {
    expect(render()).toContain(ar(`${R}inRepairLineNote`));
  });
  it('the bulk ✓ is off when only such a line is ticked; ✗ stays', () => {
    const html = render([{ type: 'toggle', id: P1, on: true }]);
    expect(html).toMatch(/data-recon-apply-selected="true"[^>]*disabled=""/u);
    expect(html).not.toMatch(/data-recon-reject-selected="true"[^>]*disabled=""/u);
    const both = render([
      { type: 'toggle', id: P1, on: true },
      { type: 'toggle', id: OTHER, on: true },
    ]);
    expect(both).not.toMatch(/data-recon-apply-selected="true"[^>]*disabled=""/u);
  });
});

describe('the server’s refusal', () => {
  it('409 FLEET_FUEL_RECONCILE_IN_REPAIR is worded by the screen, naming the card', () => {
    const error = new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_IN_REPAIR, 'in repair', 409, [
      { field: 'cardIds', code: 'IN_REPAIR', message: P1 },
    ]);
    expect(decideRefusalOf(error)).toEqual({ kind: 'inRepair', cardIds: [P1] });
    expect(isDecideRefusal(error)).toBe(true);
    expect(ar(`${R}refusal.inRepair`)).toBe('هذا الكارت ضمن تصحيح الأرقام — لم يُسجَّل شيء.');
  });
});
