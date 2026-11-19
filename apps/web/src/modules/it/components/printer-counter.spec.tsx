// «عداد الطابعة» (owner, 2026-11-19) — «يعني إجبارى أدخل عدد الورق المطبوع عند تركيب الحبارة», and
// «كمان عايزك تكتب اخر قراءة لما أجى أصرف حبارة جديدة .. وأكيد مش هيدخل عدد ورق أقل أو مساوي للى
// موجود». The screens, as they render, against the query cache:
//   · «صرف» — a toner is one cartridge on a printer that is now required, with the printer's reading
//     typed under it and the printer's LAST reading always shown there; a reading at or below it is
//     refused on the line, with the figure, unless «تم تصفير عداد الطابعة» is ticked;
//   · the printer's card on its asset page, a toner's cartridges and their average in its
//     movements, the ledger's «قراءة العداد» column, and the type's flag on the catalogs screen.
// The web suite has no DOM to click in (`vitest.config.ts`), so — as `issue-holder.spec.tsx` does —
// «صرف» is opened on the state the user's clicks lead to (the person-and-device reducer's own
// `issueHolderStart`, mocked to replay them), and the few lines that WIRE the rules — the reducer
// that clears a moved line's reading, the body, the server's refusal — are pinned in the source.
// The rules themselves are `lib/consumable-counter.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItConsumableCartridgesDto,
  type ItConsumableDto,
  type ItConsumableMovementDto,
  type ItPrinterCounterDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { formatDateTime } from '../../../shared/lib/format';
import { translate } from '../../../platform/localization/i18n';
import type * as HolderRules from '../lib/consumable-issue-holder';
import {
  type IssueDeviceLine,
  type IssueHolderEvent,
  type IssueHolderState,
} from '../lib/consumable-issue-holder';
import { ItCatalogsPage } from '../pages/ItCatalogsPage';
import { CatalogItemDialog } from './CatalogItemDialog';
import { ConsumableMovementsDialog, IssueConsumablesDialog } from './ConsumableDialogs';
import { AssetConsumablesCard } from './ConsumableMovements';
import { PrinterCounterCard } from './PrinterCounterCard';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

/** Where «صرف» opens: empty by default; a test sets the events a user's clicks would have sent. */
const opening = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('../lib/consumable-issue-holder', async (actual) => {
  const real = await actual<typeof HolderRules>();
  return {
    ...real,
    issueHolderStart: <L extends IssueDeviceLine>(lines: L[]): IssueHolderState<L> =>
      (opening.events as IssueHolderEvent<L>[]).reduce(
        real.issueHolderReducer<L>,
        real.issueHolderStart(lines),
      ),
  };
});

/** «now», for the memo's date: after the printer's last reading, unless a test moves it. */
const NOW = new Date('2026-11-19T10:30:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  opening.events = [];
  vi.useRealTimers();
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

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

const STORE = [
  'itConsumable.view',
  'itConsumable.create',
  'itConsumable.edit',
  'itConsumable.assign',
];
/** …and the register of devices: «مركّب على» — and so a toner's printer — needs it. */
const KEEPER = [...STORE, 'itAsset.view'];

const WALEED = '64b000000000000000000001';
const WALEED_LABEL = 'وليد صفوت جلال (0100052)';

const type = (id: string, code: string, ar: string, counts: boolean): ItCatalogItemDto => ({
  id,
  kind: 'consumableType',
  code,
  name: { ar, en: code },
  description: null,
  sortOrder: 1,
  isActive: true,
  requiresCounterReading: counts,
  version: 0,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
});
const INK = type('ty-ink', 'ink', 'حبارات', true);
const MICE = type('ty-mice', 'mice', 'ماوس', false);

const consumable = (over: Partial<ItConsumableDto>): ItConsumableDto => ({
  id: 'c-85a',
  code: 'CON-00011',
  name: 'حبر HP 85A',
  typeId: INK.id,
  unit: 'قطعة',
  branchId: 'b-hq',
  minQty: 2,
  notes: null,
  active: true,
  onHandQty: 6,
  issuedQty: 3,
  scrappedQty: 0,
  belowMin: false,
  version: 0,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  ...over,
});
const TONER = consumable({});
const CYAN = consumable({ id: 'c-cyan', code: 'CON-00012', name: 'حبر HP 207A أزرق' });
const MOUSE = consumable({ id: 'c-mouse', code: 'CON-00004', name: 'Mouse', typeId: MICE.id });

const PRINTER = {
  id: '64b0000000000000000000a5',
  assetCode: 'AST-00031',
  name: 'HP LaserJet Pro M404',
  status: 'assigned',
  serialNumber: 'PHBQ7K21',
  branchId: 'b-hq',
  holder: {
    employeeId: WALEED,
    employeeCode: '0100052',
    employeeName: 'وليد صفوت جلال',
    assignedAt: '2026-09-01T08:00:00.000Z',
  },
  hasActiveMaintenance: false,
} as unknown as ItAssetDto;

const LAST_AT = '2026-11-10T09:00:00.000Z';
const counter = (latest: boolean): ItPrinterCounterDto => {
  const reading = {
    movementId: 'm-prev',
    at: LAST_AT,
    reading: 12_400,
    reset: false,
    consumableId: TONER.id,
    consumableCode: TONER.code,
    consumableName: TONER.name,
  };
  return {
    assetId: PRINTER.id,
    latest: latest ? reading : null,
    readings: latest
      ? [
          {
            ...reading,
            replaced: {
              movementId: 'm-first',
              at: '2026-09-02T09:00:00.000Z',
              reading: 9_900,
              pages: 2_500,
            },
          },
          {
            movementId: 'm-first',
            at: '2026-09-02T09:00:00.000Z',
            reading: 9_900,
            reset: false,
            consumableId: TONER.id,
            consumableCode: TONER.code,
            consumableName: TONER.name,
            replaced: null,
          },
        ]
      : [],
  };
};
const counterKey = (assetId: string): readonly unknown[] =>
  listKey('it', 'consumables', { counter: 'printer', assetId });

const client = ({
  catalog = true,
  printer = true as boolean | null,
}: { catalog?: boolean; printer?: boolean | null } = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
  if (catalog) {
    qc.setQueryData(listKey('it', 'catalogs', { kind: 'consumableType', select: true }), {
      items: [INK, MICE],
      meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
    });
  }
  // The picked printer, as its chip reads it; and its counter, unless a test asks before it is read.
  qc.setQueryData(detailKey('it', 'assets', PRINTER.id), PRINTER);
  if (printer !== null) qc.setQueryData(counterKey(PRINTER.id), counter(printer));
  return qc;
};

const render = (
  qc: QueryClient,
  element: JSX.Element,
  permissions = KEEPER,
  path = '/it/consumables',
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const pathname = path.split('?')[0] ?? path;
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pathname} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const issue = (qc: QueryClient, item: ItConsumableDto = TONER, permissions = KEEPER): string =>
  render(qc, <IssueConsumablesDialog open onClose={() => {}} item={item} />, permissions);

// The clicks, as the dialog's reducer receives them. Its first line is key 0.
const choose = (): IssueHolderEvent<IssueDeviceLine> => ({
  type: 'person',
  employeeId: WALEED,
  label: WALEED_LABEL,
});
const pick = (key: number): IssueHolderEvent<IssueDeviceLine> => ({
  type: 'device',
  key,
  assetId: PRINTER.id,
  asset: PRINTER,
});
const type_ = (key: number, counterReading: string, counterReset = false) =>
  ({ type: 'patch', key, update: { counterReading, counterReset } }) as never;
const addToner = (key: number, item: ItConsumableDto): IssueHolderEvent<IssueDeviceLine>[] => [
  {
    type: 'add',
    line: {
      key,
      consumable: null,
      qty: '1',
      reason: 'new',
      assetId: '',
      asset: null,
      counterReading: '',
      counterReset: false,
    } as never,
  },
  { type: 'patch', key, update: { consumable: item } as never },
];

const dataAttr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'gu'))].map((m) => m[1] ?? '');

/** The opening tag of the element carrying `marker`. */
const tagOf = (html: string, marker: string, tag = 'input'): string => {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf(`<${tag}`, at), html.indexOf('>', at));
};

/** «صرف وطباعة المذكرة» — the memo's one button. */
const submit = (html: string): string => {
  const label = ar('it.consumables.issue.submit');
  const at = html.indexOf(label);
  expect(at, 'the memo has its button').toBeGreaterThan(-1);
  return html.slice(
    html.lastIndexOf('<button', at),
    html.indexOf('>', html.lastIndexOf('<button', at)),
  );
};

/** A line of the memo, `<li>` to `</li>`. */
const lineOf = (html: string, index: number): string => {
  const at = html.indexOf(`data-issue-line="${String(index)}"`);
  expect(at, `line ${String(index)}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at));
};

const LAST_READING = ar('it.consumables.counter.lastReading', {
  reading: '١٢٬٤٠٠',
  date: formatDateTime(LAST_AT, 'ar'),
});

// ── «صرف» ─────────────────────────────────────────────────────────────────────────────────────────

describe('«صرف» — a toner goes onto its printer, with the printer’s counter', () => {
  it('one cartridge a line; «مركّب على» required; no reading box until the printer is picked', () => {
    opening.events = [choose()];
    const html = issue(client());
    const line = lineOf(html, 0);
    expect(line).toContain(ar('it.consumables.counter.oneCartridge'));
    expect(tagOf(line, 'min="1"')).toContain('disabled=""');
    expect(line).toContain(ar('it.consumables.counter.printerRequired'));
    expect(line).not.toContain(ar('it.consumables.issue.installedOnHint'));
    expect(line).not.toContain('data-issue-counter=');
    // Nothing to send yet: the printer is missing.
    expect(submit(html)).toContain('disabled=""');
  });

  it('without the register of devices it cannot name its printer — said, and the memo waits', () => {
    opening.events = [choose()];
    const html = issue(client(), TONER, STORE);
    expect(dataAttr(html, 'data-issue-counter-blocked')).toEqual(['0']);
    expect(html).toContain(ar('it.consumables.counter.needsAssets'));
    expect(html).not.toContain(ar('it.consumables.issue.installedOn'));
    expect(submit(html)).toContain('disabled=""');
  });

  it('the printer picked: the reading box, and the printer’s LAST reading under it with its toner', () => {
    opening.events = [choose(), pick(0)];
    const html = issue(client());
    expect(dataAttr(html, 'data-issue-counter')).toEqual(['0']);
    expect(html).toContain(ar('it.consumables.counter.reading'));
    expect(html).toContain(ar('it.consumables.counter.reset'));
    expect(dataAttr(html, 'data-counter-latest')).toEqual(['12400']);
    expect(html).toContain(LAST_READING);
    expect(html).toContain(
      ar('it.consumables.counter.lastReadingToner', { toner: 'حبر HP 85A (CON-00011)' }),
    );
    // The reading is still to be typed.
    expect(submit(html)).toContain('disabled=""');
  });

  it('a printer with no reading yet says so', () => {
    opening.events = [choose(), pick(0)];
    const html = issue(client({ printer: false }));
    expect(dataAttr(html, 'data-counter-latest')).toEqual(['none']);
    expect(html).toContain(ar('it.consumables.counter.noReading'));
  });

  it('asks the printer’s counter only once a counted line has its printer', () => {
    const asked = (qc: QueryClient): boolean =>
      qc.getQueryCache().find({ queryKey: counterKey(PRINTER.id), exact: true }) !== undefined;
    opening.events = [choose(), pick(0)];
    const qc = client({ printer: null });
    const html = issue(qc);
    expect(asked(qc)).toBe(true);
    expect(dataAttr(html, 'data-counter-latest')).toEqual(['loading']);
    opening.events = [choose(), pick(0)];
    const mouse = client({ printer: null });
    issue(mouse, MOUSE);
    expect(asked(mouse)).toBe(false);
  });

  it('an EQUAL reading is refused on the line, with the figure it was held against', () => {
    opening.events = [choose(), pick(0), type_(0, '12400')];
    const html = issue(client());
    const line = lineOf(html, 0);
    expect(line).toContain(
      ar('it.consumables.counter.belowPrevious', {
        reading: '١٢٬٤٠٠',
        date: formatDateTime(LAST_AT, 'ar'),
      }),
    );
    expect(tagOf(line, 'data-issue-counter-reading')).toContain('value="12400"');
    expect(submit(html)).toContain('disabled=""');
  });

  it('a lower one too; a HIGHER one may go', () => {
    opening.events = [choose(), pick(0), type_(0, '9000')];
    expect(submit(issue(client()))).toContain('disabled=""');
    opening.events = [choose(), pick(0), type_(0, '12401')];
    const html = issue(client());
    expect(html).not.toContain(
      ar('it.consumables.counter.belowPrevious', {
        reading: '١٢٬٤٠٠',
        date: formatDateTime(LAST_AT, 'ar'),
      }),
    );
    expect(submit(html)).not.toContain('disabled=""');
  });

  it('«تم تصفير عداد الطابعة» lets a reading at or below the last one go', () => {
    opening.events = [choose(), pick(0), type_(0, '0', true)];
    const html = issue(client());
    expect(tagOf(html, 'data-issue-counter-reset')).toContain('checked=""');
    expect(submit(html)).not.toContain('disabled=""');
  });

  it('a memo dated before the last reading is backdated: said, and left to the server', () => {
    vi.setSystemTime(new Date('2026-11-01T10:30:00.000Z'));
    opening.events = [choose(), pick(0), type_(0, '11000')];
    const html = issue(client());
    expect(html).toContain(ar('it.consumables.counter.backdated'));
    expect(submit(html)).not.toContain('disabled=""');
  });

  it('two toners on one printer carry one reading: another one is refused on the second line', () => {
    opening.events = [
      choose(),
      pick(0),
      type_(0, '12500'),
      ...addToner(1, CYAN),
      pick(1),
      type_(1, '12600'),
    ];
    const html = issue(client());
    expect(lineOf(html, 0)).not.toContain(ar('it.consumables.counter.sameReading', { n: '١' }));
    expect(lineOf(html, 1)).toContain(ar('it.consumables.counter.sameReading', { n: '١' }));
    expect(submit(html)).toContain('disabled=""');
    // The same reading on both — one display, one moment — goes.
    opening.events = [
      choose(),
      pick(0),
      type_(0, '12500'),
      ...addToner(1, CYAN),
      pick(1),
      type_(1, '12500'),
    ];
    expect(submit(issue(client()))).not.toContain('disabled=""');
  });

  it('an item whose type takes no counter is issued as before — on a printer too', () => {
    opening.events = [choose(), pick(0)];
    const html = issue(client(), MOUSE);
    expect(html).not.toContain('data-issue-counter');
    expect(html).toContain(ar('it.consumables.issue.installedOnHint'));
    expect(tagOf(html, 'min="1"')).not.toContain('disabled=""');
    expect(submit(html)).not.toContain('disabled=""');
  });

  it('a catalog that could not be read adds nothing: the server, which reads the type, judges', () => {
    opening.events = [choose(), pick(0)];
    const html = issue(client({ catalog: false }));
    expect(html).not.toContain('data-issue-counter');
    expect(submit(html)).not.toContain('disabled=""');
  });
});

// ── The printer's card, the toner's cartridges, the ledger's column ───────────────────────────────

describe('«عداد الطابعة» on the printer’s page', () => {
  it('every reading, newest first: its toner, the cartridge it replaced and the pages that one printed', () => {
    const html = render(client(), <PrinterCounterCard assetId={PRINTER.id} />);
    expect(html).toContain(ar('it.consumables.counter.cardTitle'));
    expect(dataAttr(html, 'data-counter-reading')).toEqual(['12400', '9900']);
    expect(html).toContain('حبر HP 85A');
    expect(dataAttr(html, 'data-counter-replaced')).toEqual(['m-first']);
    expect(dataAttr(html, 'data-counter-pages')).toEqual(['2500']);
    // The first of its item on the printer replaced none.
    expect(html).toContain(ar('it.consumables.counter.firstOfItem'));
  });

  it('a reset between two cartridges leaves the pages unknown, and the reset is marked', () => {
    const qc = client();
    const base = counter(true);
    const [first, second] = base.readings;
    qc.setQueryData(counterKey(PRINTER.id), {
      ...base,
      readings: [
        { ...first!, reset: true, reading: 300, replaced: { ...first!.replaced!, pages: null } },
        second!,
      ],
    });
    const html = render(qc, <PrinterCounterCard assetId={PRINTER.id} />);
    expect(html).toContain(ar('it.consumables.counter.unknown'));
    expect(html).toContain(ar('it.consumables.counter.resetBadge'));
    expect(dataAttr(html, 'data-counter-pages')).toEqual([]);
  });

  it('no card on an asset with no reading — a screen or a laptop', () => {
    expect(render(client({ printer: false }), <PrinterCounterCard assetId={PRINTER.id} />)).toBe(
      '',
    );
  });

  it('the asset’s page draws it, under the page’s own `itAsset.view`', () => {
    const page = readFileSync(join(HERE, '../pages/AssetDetailPage.tsx'), 'utf8');
    expect(flatText(page)).toContain('<PrinterCounterCard assetId={asset.id} />');
  });
});

describe('a toner’s movements — its cartridges and their average', () => {
  const life: ItConsumableCartridgesDto = {
    consumableId: TONER.id,
    averagePages: 2_350,
    counted: 2,
    cartridges: [
      {
        movementId: 'm-prev',
        at: LAST_AT,
        assetId: PRINTER.id,
        assetCode: PRINTER.assetCode,
        assetName: PRINTER.name,
        installReading: 12_400,
        removedAt: null,
        removedReading: null,
        pages: null,
      },
      {
        movementId: 'm-first',
        at: '2026-09-02T09:00:00.000Z',
        assetId: PRINTER.id,
        assetCode: PRINTER.assetCode,
        assetName: PRINTER.name,
        installReading: 9_900,
        removedAt: LAST_AT,
        removedReading: 12_400,
        pages: 2_500,
      },
    ],
  };
  const movements = (qc: QueryClient, item: ItConsumableDto, rows: ItConsumableMovementDto[]) => {
    qc.setQueryData(
      listKey('it', 'consumables', {
        movements: true,
        consumableId: item.id,
        page: 1,
        pageSize: 20,
      }),
      { items: rows, meta: { page: 1, pageSize: 20, totalItems: rows.length, totalPages: 1 } },
    );
    qc.setQueryData(listKey('it', 'consumables', { counter: 'item', consumableId: item.id }), life);
  };

  it('the average over the cartridges replaced, and each cartridge’s life', () => {
    const qc = client();
    movements(qc, TONER, []);
    const html = render(qc, <ConsumableMovementsDialog open onClose={() => {}} item={TONER} />);
    expect(dataAttr(html, 'data-consumable-cartridges')).toEqual([TONER.id]);
    expect(html).toContain(ar('it.consumables.counter.average', { pages: '٢٬٣٥٠', n: '٢' }));
    expect(html).toContain(ar('it.consumables.counter.latestOfItem'));
    expect(dataAttr(html, 'data-counter-pages')).toEqual(['2500']);
    // The ledger's own column, on a toner.
    expect(html).toContain(ar('it.consumables.movements.columns.counter'));
  });

  it('not on an item whose type takes no counter — no section, no column of dashes', () => {
    const qc = client();
    movements(qc, MOUSE, []);
    const html = render(qc, <ConsumableMovementsDialog open onClose={() => {}} item={MOUSE} />);
    expect(html).not.toContain('data-consumable-cartridges');
    expect(html).not.toContain(ar('it.consumables.movements.columns.counter'));
  });
});

describe('the ledger’s «قراءة العداد»', () => {
  const row = (over: Partial<ItConsumableMovementDto>): ItConsumableMovementDto => ({
    id: 'm-prev',
    consumableId: TONER.id,
    kind: 'issued',
    qty: 1,
    at: LAST_AT,
    branchId: 'b-hq',
    consumableCode: TONER.code,
    consumableName: TONER.name,
    typeId: INK.id,
    employeeId: WALEED,
    employeeCode: '0100052',
    employeeName: 'وليد صفوت جلال',
    assetId: PRINTER.id,
    assetCode: PRINTER.assetCode,
    assetName: PRINTER.name,
    counterReading: 12_400,
    counterReset: false,
    reason: 'new',
    memoId: 'memo-9',
    memoNumber: 9,
    memoSigned: false,
    transferId: null,
    counterpartBranchId: null,
    counterpartConsumableId: null,
    counterpartConsumableCode: null,
    byUserId: null,
    notes: null,
    version: 0,
    createdAt: LAST_AT,
    ...over,
  });

  it('the reading a toner went in at, «تصفير» beside a reset, and a dash on every other row', () => {
    const qc = client();
    qc.setQueryData(
      listKey('it', 'consumables', { movements: true, assetId: PRINTER.id, page: 1, pageSize: 10 }),
      {
        items: [
          row({}),
          row({ id: 'm-reset', counterReading: 0, counterReset: true }),
          row({ id: 'm-mouse', counterReading: null, typeId: MICE.id }),
        ],
        meta: { page: 1, pageSize: 10, totalItems: 3, totalPages: 1 },
      },
    );
    const html = render(qc, <AssetConsumablesCard assetId={PRINTER.id} />, STORE);
    expect(html).toContain(ar('it.consumables.movements.columns.counter'));
    expect(dataAttr(html, 'data-counter-reading')).toEqual(['12400', '0']);
    expect(html).toContain('١٢٬٤٠٠');
    expect(html.split(`>${ar('it.consumables.counter.resetBadge')}<`).length - 1).toBe(1);
  });
});

describe('the type’s flag — «يتطلب عداد الطباعة»', () => {
  it('offered on a consumable type, on create and on edit — and on no other kind', () => {
    const create = render(
      client(),
      <CatalogItemDialog open onClose={() => {}} kind="consumableType" item={null} />,
    );
    expect(create).toContain(ar('it.catalogs.fields.requiresCounterReading'));
    expect(tagOf(create, 'data-catalog-counter')).not.toContain('checked=""');
    const edit = render(
      client(),
      <CatalogItemDialog open onClose={() => {}} kind="consumableType" item={INK} />,
    );
    expect(tagOf(edit, 'data-catalog-counter')).toContain('checked=""');
    const category = render(
      client(),
      <CatalogItemDialog open onClose={() => {}} kind="assetCategory" item={null} />,
    );
    expect(category).not.toContain('data-catalog-counter');
  });

  it('a column of its own on the types’ tab, and on no other tab', () => {
    const qc = client();
    const list = (kind: string, items: ItCatalogItemDto[]) =>
      qc.setQueryData(
        listKey('it', 'catalogs', {
          kind,
          page: 1,
          pageSize: 25,
          sortBy: 'sortOrder',
          sortDir: 'asc',
        }),
        { items, meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 } },
      );
    list('consumableType', [INK, MICE]);
    list('assetCategory', []);
    const types = render(
      qc,
      <ItCatalogsPage />,
      ['itCatalog.manage'],
      '/it/catalogs?kind=consumableType',
    );
    expect(types).toContain(ar('it.catalogs.fields.requiresCounterReading'));
    // The badge on «حبارات» only — «ماوس» reads a dash.
    expect(types.split(`>${ar('it.catalogs.counterBadge')}<`).length - 1).toBe(1);
    const categories = render(qc, <ItCatalogsPage />, ['itCatalog.manage'], '/it/catalogs');
    expect(categories).not.toContain(ar('it.catalogs.fields.requiresCounterReading'));
  });

  it('sends it on create (false on any other kind) and only a change of it on an update', () => {
    const source = flatText(readFileSync(join(HERE, 'CatalogItemDialog.tsx'), 'utf8'));
    expect(source).toContain(
      'requiresCounterReading: counterKind ? form.requiresCounterReading : false,',
    );
    expect(source).toContain(
      '...(counterKind && form.requiresCounterReading !== item.requiresCounterReading ? { requiresCounterReading: form.requiresCounterReading } : {}),',
    );
  });
});

// ── The wiring, pinned ───────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped and whitespace collapsed: prose satisfies no rule here. */
const flatText = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\s+/gu, ' ');

describe('the wiring a static render cannot click', () => {
  const source = flatText(readFileSync(join(HERE, 'ConsumableDialogs.tsx'), 'utf8'));

  it('a line whose device changes — however it changes — loses its reading', () => {
    expect(source).toContain('const next = issueHolderReducer(state, event);');
    expect(source).toContain('const lines = clearMovedReadings(state.lines, next.lines);');
    expect(source).toContain('useReducer(issueReducer, [blankLine(0, item)], issueHolderStart)');
  });

  it('a toner picked is one cartridge', () => {
    expect(source).toContain(
      "...(consumable !== null && countsLine({ consumable }, counting) ? { qty: '1' } : {}),",
    );
  });

  it('the body carries each counted line’s reading, and the memo waits for every line’s check', () => {
    expect(source).toContain('...counterBody(line, line.counts),');
    expect(source).toContain('counterCheck(line).ok;');
    expect(source).toContain('counted.every(lineOk)');
  });

  it('the server’s refusal is pinned to the line it named, and said on its field', () => {
    // Pinned to the lines AND the memo's date box as they were when the save was clicked.
    expect(source).toContain('const sent = lines; const sentIssuedAt = issuedAt;');
    expect(source).toContain(
      'const refusals = sentCounterFailures(counterFailures(err), sent, sentIssuedAt);',
    );
    expect(source).toContain('setCounterRefusals(refusals);');
    // The printer's toast says the first refusal's figure in the reader's words, not the server's.
    expect(source).toContain(
      'if (first !== undefined) throw new Error(counterProblemWords(t, first.problem, locale));',
    );
    // Said on its field while the line — and, for a refused reading, the memo's date — is as sent.
    expect(source).toContain(
      "check.reading ?? standingFailure(counterRefusals, line, 'counterReading', issuedAt);",
    );
    expect(source).toContain("standingFailure(counterRefusals, line, 'assetId', issuedAt);");
    expect(source).toContain(
      "check.qty ?? standingFailure(counterRefusals, line, 'qty', issuedAt);",
    );
  });

  it('the alert above says the refusal with its figure, as the field and the toast do', () => {
    expect(source).toContain(
      "setError(refusalAlertWords(t, refusals, err, locale) ?? message(err, t('common.error')));",
    );
    // Not the bare words of the code, which say no figure.
    expect(source).not.toContain('refusals.length > 0 ? errorMessage(err, locale)');
  });

  it('the reading box and its reset reach the line', () => {
    expect(source).toContain('onChange={(update) => patchLine(line.key, update)}');
    expect(source).toContain(
      'onChange={(e) => onChange({ counterReading: e.target.value, counterReset: line.counterReset }) }',
    );
    expect(source).toContain(
      'onChange={(e) => onChange({ counterReading: line.counterReading, counterReset: e.target.checked }) }',
    );
  });
});
