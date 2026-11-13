// «ربط الكروت بالسيارات» and «كروت في الشيت وليست في النظام» (6b), proven against what they draw:
// the groups with his real rows (sample F1/07), the chassis ✓ / ⚠, the 0849 pair with its ✓ off
// and the repair note, the unknown code's picker and «تذكّر هذا الكود», the grants, the decided
// verdicts, a refused card's tag; the new cards with «إضافة» and the dialog it opens, filled from
// the sheet (sample F1/08) — the number typed against the sheet's last four, the opening balance.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetFuelCardDto,
  type FleetFuelLinkPlaceDto,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLinkDto,
  type FleetFuelReconcileNewCardDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { FuelCardDialog } from '../components/FuelCardDialog';
import { ReconcileLinks } from '../components/fuel-reconcile/ReconcileLinks';
import { ReconcileNewCards } from '../components/fuel-reconcile/ReconcileNewCards';
import { fromSheetOf } from '../lib/fuel-reconcile-links';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const L = 'fleet.fuelCards.reconcile.links.';
const N = 'fleet.fuelCards.reconcile.newCards.';

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
const storeOf = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
const ALL = [
  'fleetFuelCard.view',
  'fleetFuelCard.edit',
  'fleetFuelCard.create',
  'fleetFuelCharge.view',
  'fleetFuelCharge.approve',
];

const card = (
  id: string,
  name: string,
  over: Partial<FleetFuelCardDto> = {},
): FleetFuelCardDto => ({
  id,
  vehicleId: null,
  vehicleCode: null,
  label: null,
  company: 'wataniya',
  name,
  number: '5485640068870849',
  expiresAt: '2029-05-31T00:00:00.000Z',
  hasPassword: true,
  balance: 260.96,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const on = (code: string): Partial<FleetFuelCardDto> => ({
  vehicleId: `v-${code}`,
  vehicleCode: code,
});
const car = (code: string): FleetFuelLinkPlaceDto => ({
  vehicleId: `v-${code}`,
  vehicleCode: code,
  label: null,
});
const label = (text: string): FleetFuelLinkPlaceDto => ({
  vehicleId: null,
  vehicleCode: null,
  label: text,
});
const link = (
  over: Partial<FleetFuelReconcileLinkDto> & Pick<FleetFuelReconcileLinkDto, 'card' | 'kind'>,
): FleetFuelReconcileLinkDto => ({
  sheetRow: 2,
  sheetCode: null,
  to: null,
  resolvedBy: 'code',
  chassisCar: null,
  slotHeldBy: null,
  pairWith: null,
  inRepair: false,
  decision: null,
  ...over,
});

const LINKS: FleetFuelReconcileLinkDto[] = [
  link({
    card: card('p1', 'EGYCASH-1137-401485', on('283')),
    kind: 'move',
    sheetRow: 20,
    sheetCode: '530',
    to: car('530'),
    chassisCar: '530',
    pairWith: 'p2',
    inRepair: true,
  }),
  link({
    card: card('p2', 'EGYCASH-8616-783211', on('530')),
    kind: 'move',
    sheetRow: 21,
    sheetCode: '283',
    to: car('283'),
    chassisCar: '283',
    pairWith: 'p1',
    inRepair: true,
  }),
  link({
    card: card('m1', 'EGYCASH-4489-MB060216', on('MG 2')),
    kind: 'move',
    sheetRow: 30,
    sheetCode: '172',
    to: car('172'),
    chassisCar: 'MG 2',
    pairWith: 'm2',
  }),
  link({
    card: card('m2', 'EGYCASH-3675-B253813', on('172')),
    kind: 'move',
    sheetRow: 31,
    sheetCode: 'm g 2',
    to: car('MG 2'),
    resolvedBy: 'alias',
    chassisCar: '172',
    pairWith: 'm1',
  }),
  link({
    card: card('d', 'EGYCASH-7576-312521', on('231')),
    kind: 'detach',
    sheetRow: 40,
    sheetCode: 'اسبير',
    to: label('اسبير'),
    resolvedBy: 'label',
    chassisCar: '231',
  }),
  link({
    card: card('u', 'EGYCASH-4857-501205', { label: 'كولراى' }),
    kind: 'unknownCode',
    sheetRow: 50,
    sheetCode: 'جيلى',
    resolvedBy: null,
    chassisCar: 'كولراى',
  }),
];
const RESULT = {
  id: '650000000000000000000999',
  company: 'wataniya',
  fileName: 'رصيد وطنيه 4-10-2026.xlsx',
  layout: [
    { role: 'number', column: 'A', header: 'Card Number', assumed: false },
    { role: 'code', column: 'F', header: 'كود', assumed: false },
  ],
  carColumn: true,
  links: LINKS,
  newCards: [],
} as unknown as FleetFuelReconcileDto;

const linksOf = ({
  result = RESULT,
  permissions = ALL,
  results = {},
  refused = new Set<string>(),
}: {
  result?: FleetFuelReconcileDto;
  permissions?: string[];
  results?: Record<string, FleetFuelLinkResultDto>;
  refused?: ReadonlySet<string>;
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={storeOf(permissions)}>
      <QueryClientProvider client={new QueryClient()}>
        <ReconcileLinks
          result={result}
          results={results}
          refused={refused}
          mayDecide={permissions.includes('fleetFuelCard.edit')}
          busy={false}
          onDecide={() => undefined}
          onHistory={() => undefined}
        />
      </QueryClientProvider>
    </Provider>,
  );
/** One card's row in the desktop table. */
const rowOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-recon-link-card="${id}"`, html.indexOf('data-recon-links-list'));
  expect(start, id).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</tr>', start));
};

describe('«ربط الكروت بالسيارات»', () => {
  it('the groups in order, each with its question and count; the column the sheet names cars in', () => {
    const html = linksOf();
    expect(html).toContain('data-recon-links="true"');
    expect(html).toContain(ar(`${L}title`));
    expect(html).toContain(ar(`${L}note`, { column: 'كود (F)' }));
    const groups = ['move', 'detach', 'unknownCode'].map((kind) =>
      html.indexOf(`data-recon-link-group="${kind}"`),
    );
    expect(groups.every((at) => at > -1)).toBe(true);
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
    expect(html).not.toContain('data-recon-link-group="attach"');
    expect(html).toContain(ar(`${L}ask.move`));
    expect(html).toContain(ar(`${L}group.unknownCode`));
    expect(html).toContain(ar(`${L}chip`, { cards: '6 كروت' }));
  });

  it('a swap is drawn as one pair, decided together — «نقل الكارتين»', () => {
    const html = linksOf();
    expect(html).toContain('data-recon-link-pair="m1"');
    expect(html).toContain(ar(`${L}swap`));
    expect(html).toContain(`✓ ${ar(`${L}moveBoth`)}`);
    // One decision cell per pair: the pair's second card has none of its own.
    expect(html).toContain('data-recon-link-apply="m1"');
    expect(html).not.toContain('data-recon-link-apply="m2"');
  });

  it('the chassis: ✓ as in the sheet, ⚠ as in the system; a saved code says so', () => {
    const html = linksOf();
    expect(rowOf(html, 'p1')).toContain('data-recon-evidence="agrees"');
    expect(rowOf(html, 'p1')).toContain(ar(`${L}chassisAgreesNote`));
    expect(rowOf(html, 'm1')).toContain('data-recon-evidence="differs"');
    expect(rowOf(html, 'm1')).toContain(ar(`${L}chassisDiffersNote`));
    expect(rowOf(html, 'm2')).toContain(ar(`${L}resolvedAlias`));
    expect(rowOf(html, 'm2')).toContain(ar(`${L}sheetSays`, { code: 'm g 2' }));
    expect(rowOf(html, 'u')).toContain('data-recon-evidence="info"');
  });

  it('the 0849 pair: ✓ off with «ضمن تصحيح الأرقام» and its note; ✗ «إبقاء» stays', () => {
    const html = linksOf();
    expect(html).toMatch(/data-recon-link-apply="p1"[^>]*disabled=""/u);
    expect(html).not.toMatch(/data-recon-link-keep="p1"[^>]*disabled=""/u);
    expect(html).toContain('data-recon-link-in-repair="p1"');
    expect(html).toContain(ar(`${L}inRepairNote`));
    expect(html).not.toMatch(/data-recon-link-apply="m1"[^>]*disabled=""/u);
  });

  it('an unknown code: the car picker and «تذكّر هذا الكود» (on), ✓ off until a car is picked', () => {
    const html = linksOf();
    expect(html).toContain('data-recon-link-pick="u"');
    expect(html).toContain(ar(`${L}remember`));
    expect(html).toMatch(/data-recon-link-remember="u"[^>]*checked=""/u);
    expect(html).toMatch(/data-recon-link-apply="u"[^>]*disabled=""/u);
  });

  it('without the grant to edit cards, nothing is decided here', () => {
    const html = linksOf({ permissions: ['fleetFuelCard.view', 'fleetFuelCharge.view'] });
    expect(html).toMatch(/data-recon-link-apply="m1"[^>]*disabled=""/u);
    expect(html).toMatch(/data-recon-link-keep="m1"[^>]*disabled=""/u);
  });

  it('a decided unit shows its verdict and «سجل الكارت»; a card refused as changed loses its ✓', () => {
    const answer = (cardId: string): FleetFuelLinkResultDto => ({
      cardId,
      decision: 'apply',
      from: car('231'),
      to: label('اسبير'),
      at: '2026-11-01T10:24:00.000Z',
      byName: 'مدير الحركة',
    });
    const html = linksOf({ results: { d: answer('d') }, refused: new Set(['m1']) });
    expect(html).toContain('data-recon-link-verdict="apply"');
    expect(html).toContain('data-recon-history="d"');
    expect(html).not.toContain('data-recon-link-apply="d"');
    expect(html).toMatch(/data-recon-link-apply="m1"[^>]*disabled=""/u);
    expect(html).toContain(ar('fleet.fuelCards.reconcile.movedTag'));
  });

  it('a sheet with no car column says so in one line; an old session says nothing', () => {
    const none = linksOf({ result: { ...RESULT, carColumn: false, links: [] } });
    expect(none).toContain('data-recon-links="none"');
    expect(none).toContain(ar(`${L}noCarColumn`));
    expect(linksOf({ result: { ...RESULT, carColumn: false, layout: [], links: [] } })).toBe('');
  });
});

const NEW: FleetFuelReconcileNewCardDto[] = [
  {
    sheetRow: 60,
    name: 'EGYCASHTCS-1781-312986',
    number: '548**********7791',
    numberIsFull: false,
    balance: 4305.09,
    sheetCode: '209',
    to: car('209'),
    resolvedBy: 'code',
    chassisCar: '209',
    slotHeldBy: null,
    cardId: null,
  },
  {
    sheetRow: 142,
    name: 'EGYCASHTCS-6482-818014',
    number: '548**********2819',
    numberIsFull: false,
    balance: 0,
    sheetCode: '305',
    to: null,
    resolvedBy: null,
    chassisCar: null,
    slotHeldBy: null,
    cardId: null,
  },
];

describe('«كروت في الشيت وليست في النظام»', () => {
  const newOf = (added: Record<number, string> = {}, mayAdd = true): string =>
    renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        {/* The car chip watches the registry for its car card. */}
        <QueryClientProvider client={new QueryClient()}>
          <ReconcileNewCards
            rows={NEW}
            company="chillout"
            added={added}
            mayAdd={mayAdd}
            onAdd={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );

  it('each row: the name, the number as printed, the balance, the car the code names, «إضافة»', () => {
    const html = newOf();
    expect(html).toContain(ar(`${N}title`));
    expect(html).toContain('EGYCASHTCS-1781-312986');
    expect(html).toContain('548 •••• 7791');
    expect(html).toContain('4,305.09');
    expect(html).toContain(ar(`${N}slotFree`, { company: 'شل أوت' }));
    expect(html).toContain(ar(`${N}codeUnknown`, { code: '305' }));
    expect(html).toContain('data-recon-add="60"');
    expect(html).toContain('data-recon-add="142"');
  });

  it('an added row says so; without the grant to add, no «إضافة»', () => {
    expect(newOf({ 60: 'new-id' })).toContain('data-recon-added="60"');
    expect(newOf({ 60: 'new-id' })).not.toContain('data-recon-add="60"');
    expect(newOf({}, false)).not.toContain('data-recon-add=');
  });

  it('a row the server would refuse is not offered «إضافة»: the other company’s name, a name too long', () => {
    const blocked = (rows: FleetFuelReconcileNewCardDto[]): string =>
      renderToStaticMarkup(
        <Provider store={storeOf(ALL)}>
          <QueryClientProvider client={new QueryClient()}>
            <ReconcileNewCards
              rows={rows}
              company="wataniya"
              added={{}}
              mayAdd
              onAdd={() => undefined}
            />
          </QueryClientProvider>
        </Provider>,
      );
    // A Wataniya sheet of mixed prefixes (no wrong-company stop): the stray Chill Out row.
    const stray = blocked([{ ...NEW[0]!, sheetRow: 7, name: 'EGYCASHTCS-STRAY' }]);
    expect(stray).not.toContain('data-recon-add="7"');
    expect(stray).toContain('data-recon-add-blocked="7"');
    expect(stray).toContain(ar(`${N}blockedOtherCompany`));
    const long = blocked([{ ...NEW[0]!, sheetRow: 8, name: `EGYCASH-${'9'.repeat(120)}` }]);
    expect(long).not.toContain('data-recon-add="8"');
    expect(long).toContain(ar(`${N}blockedTooLong`, { max: 120 }));
    // Its own company's name: offered as usual.
    const own = blocked([{ ...NEW[0]!, sheetRow: 9, name: 'EGYCASH-1781-312986' }]);
    expect(own).toContain('data-recon-add="9"');
    expect(own).not.toContain('data-recon-add-blocked=');
  });

  it('the page offers «إضافة» only with both grants — the card opens at the sheet’s balance', () => {
    // As the server asks: `fleetFuelCard.create` for the card, `fleetFuelCharge.approve` for the
    // money it opens with.
    const PAGE = readFileSync(join(HERE, 'FuelReconcilePage.tsx'), 'utf8');
    expect(PAGE).toContain(
      "mayAdd={can('fleetFuelCard.create') && can('fleetFuelCharge.approve')}",
    );
  });

  it('«إضافة» opens «إضافة كارت» filled from the sheet: car, name, the opening balance', () => {
    const from = fromSheetOf(NEW[0]!, {
      id: 's-1',
      fileName: 'رصيد شل اوت 1-11-2026.xlsx',
      company: 'chillout',
    });
    const html = renderToStaticMarkup(
      <Provider store={storeOf(ALL)}>
        <QueryClientProvider client={new QueryClient()}>
          <FuelCardDialog open onClose={() => undefined} card={null} fromSheet={from} />
        </QueryClientProvider>
      </Provider>,
    );
    expect(html).toContain('data-fuel-card-form="sheet"');
    expect(html).toContain(ar(`${N}addTitle`));
    expect(html).toContain(ar(`${N}addSubtitle`, { row: 60, company: 'شل أوت' }));
    expect(html).toContain(ar(`${N}fromSheet`));
    // The masked number is typed against the sheet's last four.
    expect(html).toContain(ar(`${N}numberHint`, { masked: '⁦548 •••• 7791⁩', last4: '7791' }));
    expect(html).toContain('placeholder="548• •••• •••• 7791"');
    expect(html).toContain('data-fuel-opening-balance="true"');
    expect(html).toContain('4,305.09');
    expect(html).toContain(ar(`${N}save`));
    // The PIN and the expiry are typed; the name box takes no typing.
    expect(html).toContain(ar('fleet.fuelCards.fields.password'));
    expect(html).toContain('readonly=""');
    // Opening fills the car, the company and the name from the row (an effect — read the source).
    const DIALOG = readFileSync(join(HERE, '../components/FuelCardDialog.tsx'), 'utf8');
    expect(DIALOG).toContain(
      "setCompany(fromSheet?.company ?? card?.company ?? initialCompany ?? 'wataniya');",
    );
    expect(DIALOG).toContain("setName(fromSheet?.name ?? card?.name ?? '');");
    expect(DIALOG).toContain('fromSheet.vehicleId');
  });
});
