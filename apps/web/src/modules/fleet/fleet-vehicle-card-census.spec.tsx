// The CAR CARD CENSUS — «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق
// نفس الموضوع كدا», scope «زى ما انت اقترحت»: every Fleet register table and board chip that shows
// a car's code carries the car card, as every board that shows a driver's name carries the
// driver's — and never a picker, a filter or a form dialog.
//
// Three claims a typecheck cannot see:
//   • every screen that draws a car's code is ACCOUNTED FOR — wired (`WIRED`, with the pin that
//     proves its code cell is the card's trigger) or deliberately left without one (`SKIPPED`,
//     with the reason). A new table that draws a code is caught by the sweep below and fails
//     until it is put in one list or the other;
//   • a row linked to the registry names its car by id (a code is only looked up where the chip
//     carries nothing else), and a code inside something that already takes clicks or drags
//     hovers without a Tab stop of its own;
//   • the shared chips the boards draw codes with — the dashboard's `CarChip`, custody's and the
//     fuel reconcile's `CodeChip`, the fuel boards' car block — carry the card, and the places
//     that must not (a pick list, a confirm dialog) turn it off.
//
// The suite runs in node with no DOM: the wiring is read from the sources, and the shared chips
// are rendered to static markup over a seeded registry.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetVehicleDto, type Locale, type MeDto, type Paginated } from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { CarChip } from './components/fleet-dashboard/dash-kit';
import { CodeChip } from './components/custody-memo-parts';
import { FuelCarGroup } from './components/FuelCarGroup';
import { ALL_KEYS, renderDashboard } from './fleet-dashboard-fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

/** The card's doors: the code component, the hook, and the chips built on them. */
const DOORS = /<VehicleHoverCode\b|useVehicleHoverCard\(|<FuelCarGroup\b/u;

// ── The wired screens ──────────────────────────────────────────────────────────────────────────

interface Wired {
  file: string;
  /** The screen, as a reader knows it. */
  screen: string;
  /** What in the source proves the code cell is the card's trigger. */
  pins: readonly RegExp[];
}

/** Hover only: no Tab stop of its own — the chip sits in something that takes clicks or drags. */
const HOVER_ONLY = /focusable(?:=\{false\}|: false)/u;

const WIRED: readonly Wired[] = [
  {
    file: 'pages/AccidentsPage.tsx',
    screen: '«الحوادث» — the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{r\.vehicleId\}/u],
  },
  {
    file: 'pages/MaintenancePage.tsx',
    screen: '«الصيانة» — the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{visit\.vehicleId\}/u],
  },
  {
    file: 'pages/MaintenanceAlarmsPage.tsx',
    screen: '«تنبيهات الصيانة» — the code column',
    pins: [
      /useVehicleHoverCard\(\{\s*vehicleId: alarm\.vehicleId,\s*code: alarm\.code,?\s*\}\)/u,
      /render: \(alarm\) => <AlarmCode alarm=\{alarm\} \/>/u,
    ],
  },
  {
    file: 'pages/OdometerPage.tsx',
    screen: '«قراءات العداد» — the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{log\.vehicleId\}\s+code=\{log\.vehicleCode\}/u],
  },
  {
    file: 'pages/ReceiptsPage.tsx',
    screen: '«الإيصالات» — the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.vehicleCode\}/u],
  },
  {
    file: 'pages/DealershipPage.tsx',
    screen: '«التوكيل» — the code column',
    pins: [/<VehicleHoverCode vehicleId=\{row\.vehicleId\} code=\{row\.vehicleCode\} \/>/u],
  },
  {
    file: 'pages/RosterPage.tsx',
    screen: '«تعيين السيارات» — the code column, hover only',
    pins: [
      /<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.code\}\s+focusable=\{false\}/u,
    ],
  },
  {
    file: 'pages/FixedRosterPage.tsx',
    screen: '«الطاقم الثابت» — the coloured code, hover only',
    pins: [
      /useVehicleHoverCard\(\s*\{ vehicleId: row\.vehicleId, code: row\.code \},\s*\{ focusable: false \},?\s*\)/u,
      /render: \(row\) => <CrewCarCode row=\{row\} \/>/u,
    ],
  },
  {
    file: 'pages/CustodyPage.tsx',
    screen:
      '«مصروفات العهدة» — every movement’s code, and each car’s chip beside «السجل» (hover only)',
    pins: [
      /<MovementCode vehicleId=\{row\.vehicleId\} code=\{row\.vehicleCode\} \/>/u,
      /useVehicleHoverCard\(\{ vehicleId, code \}\)/u,
      /<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.vehicleCode\}\s+focusable=\{false\}/u,
    ],
  },
  {
    file: 'components/CustodyDashboardCharts.tsx',
    screen: 'the custody dashboard’s top cars — hover only, the tile is the Tab stop',
    pins: [
      /<VehicleHoverCode\s+vehicleId=\{car\.vehicleId\}\s+code=\{car\.vehicleCode\}\s+focusable=\{false\}/u,
    ],
  },
  {
    file: 'pages/NoticesPage.tsx',
    screen: '«الإخطارات» — the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.vehicleCode\}/u],
  },
  {
    file: 'pages/LicenseExpensesPage.tsx',
    screen: '«مصروفات الترخيص» — each code chip of a memo',
    pins: [
      /<MemoCarChip key=\{`\$\{index\}:\$\{code\}`\} code=\{code\} vehicleId=\{ids\[index\] \?\? null\} \/>/u,
      /useVehicleHoverCard\(\{ vehicleId, code \}\)/u,
    ],
  },
  {
    file: 'pages/LicensingPage.tsx',
    screen: '«الترخيص» — the code column',
    pins: [/<VehicleHoverCode vehicleId=\{row\.vehicleId\} code=\{row\.code\} \/>/u],
  },
  {
    file: 'pages/VehiclesListPage.tsx',
    screen: '«السيارات» — the registry’s code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{v\.id\}\s+code=\{v\.code\}/u],
  },
  {
    file: 'pages/FuelCardsPage.tsx',
    screen: '«كروت البنزين» — each car’s block, hover only',
    pins: [/<FuelCarGroup\b/u],
  },
  {
    file: 'pages/FuelChargingPage.tsx',
    screen: '«شحن الكروت» — each car’s block, hover only; a label on no car has none',
    pins: [/<FuelCarGroup\b/u, /noCar=\{tile\.noCar\}/u],
  },
  {
    file: 'components/FuelCarGroup.tsx',
    screen: 'the fuel boards’ car block',
    pins: [/useVehicleHoverCard\(/u, HOVER_ONLY],
  },
  {
    file: 'components/DriverViolationsPanel.tsx',
    screen: '«المخالفات» — the drivers’ half, the code column',
    pins: [/<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.vehicleCode\}/u],
  },
  {
    file: 'components/CompanyViolationsPanel.tsx',
    screen: '«المخالفات» — the company’s half, each car’s group',
    pins: [/<VehicleHoverCode vehicleId=\{row\.vehicleId\} code=\{row\.code\} \/>/u],
  },
  {
    file: 'components/fleet-dashboard/dash-kit.tsx',
    screen: '«لوحة تحكم الحركة» — `CarChip`, every tab’s car chip (by code)',
    pins: [
      /<VehicleHoverCode code=\{code\} focusable=\{focusable\}/u,
      /focusable = link === null/u,
    ],
  },
  {
    file: 'components/fleet-dashboard/tab-licences.tsx',
    screen: 'the dashboard’s licences tab — each licence row’s code box (by id)',
    pins: [
      /<VehicleHoverCode\s+vehicleId=\{vehicleId\}\s+code=\{code\}\s+focusable=\{link === null\}/u,
      /<CodeBox\s+vehicleId=\{row\.vehicleId\}/u,
      // A chip inside the visit line's own link hovers; Tab reaches the link.
      /<CarChip code=\{row\.code\} focusable=\{false\} \/>/u,
    ],
  },
  ...(
    [
      ['tab-accidents.tsx', 'accidents'],
      ['tab-alerts.tsx', 'alerts'],
      ['tab-maintenance.tsx', 'maintenance'],
      ['tab-now.tsx', 'now'],
      ['tab-ranking.tsx', 'ranking'],
    ] as const
  ).map(([file, tab]) => ({
    file: `components/fleet-dashboard/${file}`,
    screen: `the dashboard’s ${tab} tab — through \`CarChip\``,
    pins: [/<CarChip\b/u],
  })),
  {
    file: 'components/custody-memo-parts.tsx',
    screen: '`CodeChip` — the custody and fuel-reconcile code chip (by id where the row has one)',
    pins: [/card = true/u, /<VehicleHoverCode\b/u],
  },
  {
    file: 'components/fuel-reconcile/reconcile-cells.tsx',
    screen: '«مطابقة الكروت» — a card’s place and a link’s place',
    pins: [
      /<CodeChip code=\{card\.vehicleCode\} vehicleId=\{card\.vehicleId\} \/>/u,
      /<CodeChip code=\{place\.vehicleCode\} vehicleId=\{place\.vehicleId\} \/>/u,
    ],
  },
  {
    file: 'components/fuel-reconcile/ReconcileNewCards.tsx',
    screen: '«مطابقة الكروت» — the car a new card’s code names',
    pins: [/<CodeChip code=\{row\.to\.vehicleCode\} vehicleId=\{row\.to\.vehicleId\} \/>/u],
  },
];

// ── The places that show a code and deliberately have no card ──────────────────────────────────

const SKIPPED: readonly { file: string; why: string }[] = [
  // Never inside a form dialog, a picker or a filter.
  { file: 'components/AccidentFormDialog.tsx', why: 'a form dialog (and its car picker)' },
  { file: 'components/MaintenanceDialogs.tsx', why: 'form dialogs' },
  { file: 'components/DealershipInvoiceDialog.tsx', why: 'a form dialog' },
  { file: 'components/ReceiptDialog.tsx', why: 'a form dialog' },
  { file: 'components/FuelCardDialog.tsx', why: 'a form dialog' },
  { file: 'components/FuelTransferDialog.tsx', why: 'a form dialog' },
  { file: 'components/ViolationDialogs.tsx', why: 'form dialogs' },
  {
    file: 'components/fuel-reconcile/ReconcileConfirmDialog.tsx',
    why: 'a confirm dialog — its `CodeChip`s are `card={false}`',
  },
  {
    file: 'components/fuel-reconcile/reconcile-confirm-parts.tsx',
    why: 'the confirm dialog’s parts — `card={false}`',
  },
  {
    file: 'pages/CustodyMemoEditorPage.tsx',
    why: 'a memo’s editor: the codes are a pick list of receipts to tick — `card={false}`',
  },
  {
    file: 'components/number-repair/RepairConfirmDialog.tsx',
    why: 'the fuel-number repair’s confirm dialog',
  },
  {
    file: 'components/number-repair/RepairCycleSection.tsx',
    why: 'the fuel-number repair wizard — codes inside its sentences',
  },
  {
    file: 'components/number-repair/RepairPairSection.tsx',
    why: 'the fuel-number repair wizard — codes inside its sentences',
  },
  {
    file: 'components/number-repair/RepairThumb.tsx',
    why: 'the fuel-number repair wizard — a code inside a photo’s sentence',
  },
  {
    file: 'components/number-repair/repair-parts.tsx',
    why: 'the fuel-number repair wizard’s parts (`CarCode`, `CarBox`)',
  },
  // Photos and logs opened over a board: the board's own row carries the card.
  { file: 'components/FuelCardHistoryDialog.tsx', why: 'a card’s log dialog — its title' },
  { file: 'components/ReceiptImageCell.tsx', why: 'a receipt photo’s dialog — its title' },
  { file: 'components/DealershipImageCell.tsx', why: 'an invoice photo’s dialog — its title' },
  {
    file: 'components/NoticeImageCell.tsx',
    why: 'a notice photo’s dialog and its print — the facts above the scan',
  },
  {
    file: 'components/CustodyCarLog.tsx',
    why: '«السجل» — the drawer is ABOUT the car its title names',
  },
  // Codes inside sentences, not cells or chips.
  {
    file: 'components/CustodyDashboard.tsx',
    why: 'an alert sentence on the custody dashboard — the code is a word in it',
  },
  {
    file: 'components/CustodyDashboardFund.tsx',
    why: 'a settle candidate’s list of codes («150 · 151 و19 سيارة أخرى»), as its dialog names them',
  },
  {
    file: 'pages/DriverProfilePage.tsx',
    why: 'a driver’s file — the codes are words inside its notes and readings',
  },
  // A page about one car.
  { file: 'pages/VehicleDetailPage.tsx', why: 'the car’s own file — the page is the card' },
  // Drawn by no screen.
  {
    file: 'components/FuelCardTiles.tsx',
    why: '`VehicleCardTile` — no screen draws it (the boards use `VehicleFuelGroup`)',
  },
];

// ── The sweep: every place that draws a car's code ─────────────────────────────────────────────

/** A car column's heading, a code drawn from a row, or one of the code chips. */
const DRAWS_A_CODE = new RegExp(
  [
    String.raw`t\('fleet\.odometer\.columns\.vehicle'\)`,
    String.raw`t\('fleet\.vehicles\.columns\.code'\)`,
    String.raw`t\('fleet\.notices\.columns\.code'\)`,
    String.raw`t\('fleet\.licensing\.columns\.vehicle'\)`,
    String.raw`\{\s*[\w.?!]+\.vehicleCode\b`,
    String.raw`<(?:CarChip|CodeChip|CarCode|CarBox|CodeBox)\b`,
  ].join('|'),
  'u',
);

const sourcesUnder = (rel: string): string[] =>
  readdirSync(join(HERE, rel)).flatMap((name) => {
    const path = join(HERE, rel, name);
    if (statSync(path).isDirectory()) return sourcesUnder(relative(HERE, path));
    return /\.tsx$/u.test(name) && !/\.spec\.tsx$/u.test(name) ? [relative(HERE, path)] : [];
  });

describe('every screen that draws a car’s code is accounted for', () => {
  const drawing = [...sourcesUnder('pages'), ...sourcesUnder('components')].filter((file) =>
    DRAWS_A_CODE.test(read(file)),
  );
  const known = new Set([...WIRED.map((w) => w.file), ...SKIPPED.map((s) => s.file)]);

  it('the sweep finds the boards it should — it is not reading an empty tree', () => {
    for (const file of [
      'pages/ReceiptsPage.tsx',
      'pages/OdometerPage.tsx',
      'pages/CustodyPage.tsx',
    ]) {
      expect(drawing, file).toContain(file);
    }
  });

  it('wired, or skipped with a reason — a new table cannot forget the card', () => {
    expect(drawing.filter((file) => !known.has(file))).toEqual([]);
  });

  it('no file is in both lists, and every listed file exists', () => {
    const wired = new Set(WIRED.map((w) => w.file));
    expect(SKIPPED.filter((s) => wired.has(s.file)).map((s) => s.file)).toEqual([]);
    for (const file of known) expect(() => read(file), file).not.toThrow();
  });
});

describe('the wired screens: the code cell is the card’s trigger', () => {
  it.each(WIRED.map((w) => ({ ...w })))('$screen', ({ file, pins }) => {
    const source = read(file);
    for (const pin of pins) expect(source, `${file}: ${String(pin)}`).toMatch(pin);
  });

  it('a row linked to the registry names its car by id — a code is looked up only on a bare chip', () => {
    // Every `VehicleHoverCode` in a page passes the row's id; the code-only ones are the chips.
    const codeOnly = WIRED.map((w) => w.file).filter((file) =>
      /<VehicleHoverCode\s+code=/u.test(read(file)),
    );
    expect(codeOnly).toEqual(['components/fleet-dashboard/dash-kit.tsx']);
  });

  it('hover only where the code sits in something that takes clicks or drags', () => {
    for (const file of [
      'pages/RosterPage.tsx',
      'pages/FixedRosterPage.tsx',
      'pages/CustodyPage.tsx',
      'components/FuelCarGroup.tsx',
      'components/CustodyDashboardCharts.tsx',
    ]) {
      expect(read(file), file).toMatch(HOVER_ONLY);
    }
  });
});

describe('the skipped places draw no card', () => {
  it.each(SKIPPED.map((s) => ({ ...s })))('$file — $why', ({ file }) => {
    const source = read(file);
    expect(source).not.toMatch(DOORS);
    // A shared code chip in a dialog or a pick list is turned off, each one.
    const chips = source.match(/<CodeChip\b[^>]*>/gu) ?? [];
    for (const chip of chips) expect(chip).toContain('card={false}');
  });
});

// ── The shared chips, rendered ─────────────────────────────────────────────────────────────────

const V120 = '64b1f0cccccccccccccccc20';

const REGISTRY_KEY = ['fleet', 'vehicles', 'list', { whole: true, anyStatus: true }];
const registry = (): Paginated<FleetVehicleDto> =>
  ({
    items: [{ id: V120, code: '120', status: 'active' } as FleetVehicleDto],
    meta: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
  }) as Paginated<FleetVehicleDto>;

const render = (node: ReactNode, permissions: string[] = ['fleetVehicle.view']): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(REGISTRY_KEY, registry());
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const MARK = 'data-vehicle-hover="true"';
/** The opening tag of the element whose text is `text`. */
const tagOf = (markup: string, text: string): string => {
  const at = markup.indexOf(`>${text}<`);
  expect(at, `${text} is drawn`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<', at), at + 1);
};

describe('the shared chips carry the card', () => {
  it('`CarChip`: the code is the trigger; a Tab stop only when the chip is no link', () => {
    const bare = render(<CarChip code="120" />);
    expect(tagOf(bare, '120')).toContain(MARK);
    expect(tagOf(bare, '120')).toContain('tabindex="0"');
    const linked = render(<CarChip code="120" link={{ to: '/fleet/vehicles/x', metric: 'm' }} />);
    expect(tagOf(linked, '120')).toContain(MARK);
    expect(tagOf(linked, '120'), 'the link is the Tab stop').not.toContain('tabindex');
    // A code the registry does not carry: the chip as it always was.
    expect(render(<CarChip code="404" />)).not.toContain(MARK);
  });

  it('`CodeChip`: by id where the row has one, else by code; `card={false}` is the chip alone', () => {
    expect(tagOf(render(<CodeChip code="120" />), '120')).toContain(MARK);
    expect(tagOf(render(<CodeChip code="120" vehicleId={V120} />), '120')).toContain(MARK);
    // A row from the old books: its id decides — none, no card, whatever its code says.
    expect(render(<CodeChip code="120" vehicleId={null} />)).not.toContain(MARK);
    const off = render(<CodeChip code="120" card={false} />);
    expect(off).not.toContain(MARK);
    expect(off).toMatch(/^<span dir="ltr" class="[^"]+">120<\/span>$/u);
  });

  it('`FuelCarGroup`: the big code hovers, with no Tab stop; a label on no car has no card', () => {
    const car = render(
      <FuelCarGroup vehicleId={V120} code="120" held={1}>
        {null}
      </FuelCarGroup>,
    );
    expect(tagOf(car, '120')).toContain(MARK);
    expect(tagOf(car, '120')).toContain('data-fuel-code="120"');
    expect(tagOf(car, '120')).not.toContain('tabindex');
    const label = render(
      <FuelCarGroup vehicleId="label:سفر 1" code="سفر 1" noCar held={1}>
        {null}
      </FuelCarGroup>,
    );
    expect(label).not.toContain(MARK);
  });

  it('nothing for a reader who may not see the registry', () => {
    for (const node of [<CarChip code="120" />, <CodeChip code="120" vehicleId={V120} />]) {
      expect(render(node, ['fleetFuelCard.view'])).not.toContain(MARK);
    }
  });
});

describe('the dashboard draws its cars’ codes with the card', () => {
  it.each(['alerts', 'now', 'licences'])('the %s tab', (tab) => {
    expect(renderDashboard({ url: `/fleet?tab=${tab}` })).toContain(MARK);
  });

  it('every licence row’s code box', () => {
    const html = renderDashboard({ url: '/fleet?tab=licences' });
    const rows = html.split('data-licence-row="').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.slice(0, row.indexOf('</li>'))).toContain(MARK);
  });

  it('none for a reader who may not see the registry', () => {
    const permissions = ALL_KEYS.filter((key) => key !== 'fleetVehicle.view');
    for (const tab of ['alerts', 'now', 'licences']) {
      expect(renderDashboard({ url: `/fleet?tab=${tab}`, permissions }), tab).not.toContain(MARK);
    }
  });
});
