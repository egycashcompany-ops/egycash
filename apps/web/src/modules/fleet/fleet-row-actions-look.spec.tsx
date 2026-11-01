// «اعملى الالوان دى» — the owner's picture of a row's actions, held on every Fleet table.
//
// One box of icons per row, each icon in its own calm colour, in the picture's order (the eye,
// the pen, the printer, the bin — right to left); an empty image cell is a dashed box with the
// cloud upload; a filled one is a box of its own with the eye, the replace arrow, the printer
// where the cell prints and the bin. Proven on what the screens render, and guarded at the source
// so no screen grows its own grey copy of the actions again.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetReceiptDto,
  type FleetReceiptTotalsDto,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { listKey } from '../../shared/lib/query-keys';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { DARK_TABLE } from './pages/VehiclesListPage';
import { VehicleLicenseImageCell } from './components/VehicleLicenseImage';
import {
  ACTION_GROUP,
  IMAGE_EMPTY_BOX,
  IMAGE_GROUP,
  PARTLY_PRESSED,
  PRESSED,
  actionColour,
  actionTone,
  type RowActionKind,
} from './components/row-actions-look';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));

// ── the harness ─────────────────────────────────────────────────────────────

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

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const mount = (qc: QueryClient, permissions: string[], path: string, page: JSX.Element): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const PHOTO = { fileId: 'f-1', fileName: 'a.jpg', mime: 'image/jpeg', size: 1, uploadedAt: '' };

const receipt = (over: Partial<FleetReceiptDto> = {}): FleetReceiptDto => ({
  id: 'r-1',
  date: '2026-10-01T00:00:00.000Z',
  vehicleId: 'v-204',
  vehicleCode: '204',
  driverEmployeeId: null,
  driverName: 'أيمن حسن مصطفى',
  kind: 'fuel',
  source: 'card',
  cardId: 'c-1',
  cardCompany: 'wataniya',
  cardNumber: '7045 1120 0098 2231',
  cardVehicleId: 'v-204',
  cardVehicleCode: '204',
  cardLabel: null,
  fuelType: 'petrol92',
  pricePerLitre: 17.25,
  litres: 37.1,
  amount: 640,
  odometer: null,
  company: null,
  image: null,
  // In no custody memo unless a test says otherwise.
  memo: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const TOTALS: FleetReceiptTotalsDto = {
  count: 2,
  custodyTotal: 0,
  cardTotal: 1280,
  fuelTotal: 1280,
  fuelLitres: 74.2,
  tyresTotal: 0,
  washTotal: 0,
  maintenanceTotal: 0,
};

const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  kind: undefined,
  source: undefined,
  driver: undefined,
};

const RECEIPT_GRANTS = [
  'fleetReceipt.view',
  'fleetReceipt.create',
  'fleetReceipt.edit',
  'fleetReceipt.delete',
];

const receiptsBoard = (grants: string[] = RECEIPT_GRANTS): string => {
  const qc = client();
  const rows = [receipt(), receipt({ id: 'r-2', image: PHOTO })];
  qc.setQueryData(
    listKey('fleet', 'receipts', {
      ...FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  qc.setQueryData(listKey('fleet', 'receipts', { summary: true, ...FILTERS }), TOTALS);
  return mount(qc, grants, '/fleet/receipts', <ReceiptsPage />);
};

const vehicle = (over: Partial<FleetVehicleDto> = {}): FleetVehicleDto =>
  ({
    id: 'v-1',
    code: '150',
    status: 'active',
    licenseImage: null,
    ...over,
  }) as FleetVehicleDto;

const licenceCell = (car: FleetVehicleDto): string =>
  mount(
    client(),
    ['fleetVehicle.view', 'fleetVehicle.edit'],
    '/fleet/vehicles',
    <VehicleLicenseImageCell vehicle={car} onPreview={() => undefined} onPrint={() => undefined} />,
  );

// ── reading the markup ──────────────────────────────────────────────────────

/** The element that opens at `marker` (an attribute), up to its own closing tag. */
const element = (markup: string, marker: string, tag = 'span'): string => {
  const at = markup.indexOf(marker);
  expect(at, `${marker} is on screen`).toBeGreaterThan(-1);
  const open = markup.lastIndexOf(`<${tag}`, at);
  let depth = 0;
  const pattern = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'gu');
  pattern.lastIndex = open;
  for (let m = pattern.exec(markup); m !== null; m = pattern.exec(markup)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return markup.slice(open, m.index + m[0].length);
  }
  throw new Error(`${marker} never closes`);
};

/** The opening tag an attribute sits on. */
const tagOf = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  expect(at, `${marker} is on screen`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
};

/** Every button's class, in the order the row draws them. */
const buttonClasses = (markup: string): string[] =>
  [...markup.matchAll(/<(?:button|a|label)\b[^>]*class="([^"]*)"/gu)].map((m) => m[1] ?? '');

const html = (classes: string): string => classes.replace(/&amp;/gu, '&');

/** The tone a button wears — the first kind whose colour its class carries. */
const KINDS: RowActionKind[] = ['view', 'edit', 'print', 'delete', 'status', 'reopen', 'history'];
const kindOf = (classes: string): RowActionKind | 'other' =>
  KINDS.find((kind) => html(classes).includes(actionColour(kind))) ?? 'other';

/** The bin with the two lines inside it, the cloud, the arrow off its line, the pen on a square. */
const TRASH_2 = '<line x1="10" y1="11" x2="10" y2="17">';
const CLOUD = 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2';
const ARROW_OFF_LINE = 'M5 21h14';
const SQUARE_PEN = 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7';

// ── the look itself ─────────────────────────────────────────────────────────

describe('the owner’s colours for each action', () => {
  it('gives each of the four its own colour, in light and in dark', () => {
    // The second picture's own colours in the dark theme; the nearest shade in the light one.
    expect(actionTone('view')).toContain('text-emerald-600');
    expect(actionTone('view')).toContain('dark:text-[#68c098]');
    expect(actionTone('edit')).toContain('text-blue-600');
    expect(actionTone('edit')).toContain('dark:text-[#58a8e8]');
    expect(actionTone('print')).toContain('text-slate-500');
    expect(actionTone('print')).toContain('dark:text-[#a8b0b8]');
    expect(actionTone('delete')).toContain('text-red-500');
    expect(actionTone('delete')).toContain('dark:text-[#e86870]');
    expect(actionTone('upload'), 'an upload is the pen’s blue').toContain('text-blue-600');
    expect(actionTone('upload')).toContain('dark:text-[#58a8e8]');
  });

  it('washes the icon’s own colour behind it on hover, faintly', () => {
    for (const [kind, hue] of [
      ['view', 'emerald'],
      ['edit', 'blue'],
      ['print', 'slate'],
      ['delete', 'red'],
      ['status', 'violet'],
      ['reopen', 'indigo'],
      ['transfer', 'indigo'],
    ] as const) {
      expect(actionTone(kind), kind).toContain(`hover:bg-${hue}-500/10`);
    }
  });

  it('gives the other actions calm colours that are none of the four', () => {
    expect(actionTone('status'), 'a status or a check-out').toContain('text-violet-600');
    expect(actionTone('reopen')).toContain('text-indigo-600');
    expect(actionTone('transfer')).toContain('text-indigo-600');
    expect(actionTone('history')).toContain('text-slate-600');
    for (const kind of ['status', 'reopen', 'transfer', 'history', 'move'] as const) {
      for (const hue of ['emerald', 'blue-', 'red-', '#68c098', '#58a8e8', '#e86870']) {
        expect(actionTone(kind)).not.toContain(hue);
      }
    }
  });

  it('puts no yellow, orange or amber on an action', () => {
    const look = readFileSync(join(HERE, 'components/row-actions-look.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(look).not.toMatch(/\b(?:yellow|orange|amber)-/u);
    expect(PRESSED + PARTLY_PRESSED).toContain('violet');
  });

  it('draws the box as the picture does — a soft square, a light fill, a faint border', () => {
    for (const piece of ['inline-flex', 'rounded-lg', 'border', 'bg-slate-50']) {
      expect(ACTION_GROUP, piece).toContain(piece);
    }
    expect(ACTION_GROUP).not.toContain('rounded-xl');
    expect(ACTION_GROUP).toContain('border-slate-200');
    expect(ACTION_GROUP).toContain('dark:border-white/[0.08]');
    expect(ACTION_GROUP).toContain('dark:bg-white/[0.03]');
    // 16px icons in 24px squares, `gap-2` and `px-2`: icons 16px apart, 12px from the sides.
    expect(ACTION_GROUP).toContain('gap-2');
    expect(ACTION_GROUP).toContain('px-2');
    expect(actionTone('view')).toContain('h-6 w-6');
  });

  it('draws an image’s box as the actions’ one, and an empty image as a dashed square in blue', () => {
    expect(IMAGE_GROUP).toBe(ACTION_GROUP.replace(' empty:hidden', ''));
    for (const piece of [
      'border-dashed',
      'rounded-lg',
      'border-slate-300',
      'dark:border-white/[0.14]',
      'text-blue-600',
      'dark:text-[#58a8e8]',
    ]) {
      expect(IMAGE_EMPTY_BOX, piece).toContain(piece);
    }
  });

  it('holds its size inside the boards’ table, which squeezes every button in a cell', () => {
    // `DARK_TABLE` is the other boards’ too and is left exactly as it was…
    expect(DARK_TABLE).toContain('[&_td_button]:!h-7 [&_td_button]:!w-7');
    expect(DARK_TABLE).toContain('max-[1749px]:[&_td_button]:!h-6');
    // …and `.x.x` (two classes) outweighs its `.x td button` (one class, two elements).
    expect(actionTone('edit')).toContain('[&&]:!h-6 [&&]:!w-6');
    expect(IMAGE_EMPTY_BOX).toContain('[&&]:!h-8 [&&]:!w-8');
  });
});

// ── on a screen ─────────────────────────────────────────────────────────────

describe('the receipts table — the actions and the image, as the picture draws them', () => {
  const markup = receiptsBoard();

  it('puts a row’s actions in one box: the pen in blue, then the bin in red', () => {
    const box = element(markup, 'data-row-actions="receipt"');
    expect(tagOf(box, 'data-row-actions'), 'the box').toContain(`class="${ACTION_GROUP}"`);
    expect(buttonClasses(box).map(kindOf)).toEqual(['edit', 'delete']);
    expect(box, 'the pen on a square').toContain(SQUARE_PEN);
    expect(box, 'the bin with its two lines').toContain(TRASH_2);
  });

  it('a reader allowed none of the row’s actions sees no box — not an empty bordered blob', () => {
    // Edit and delete are each behind their own grant; the column is not. The box is drawn with
    // nothing in it, and `empty:hidden` takes it off the row.
    const viewOnly = receiptsBoard(['fleetReceipt.view']);
    const box = element(viewOnly, 'data-row-actions="receipt"');
    expect(box, 'nothing inside').toMatch(/^<span [^>]*><\/span>$/u);
    expect(ACTION_GROUP).toContain('empty:hidden');
  });

  it('draws a row with no photo as the dashed box with the cloud upload', () => {
    const upload = tagOf(markup, 'data-receipt-image-upload="r-1"');
    expect(html(upload)).toContain(IMAGE_EMPTY_BOX);
    expect(element(markup, 'data-receipt-image-upload="r-1"', 'button')).toContain(CLOUD);
  });

  it('draws a row with a photo as its own box: the eye, replace, print, the bin — in that order', () => {
    const box = element(markup, 'data-image-actions="receipt"');
    expect(tagOf(box, 'data-image-actions'), 'the image box').toContain(`class="${IMAGE_GROUP}"`);
    expect(buttonClasses(box).map(kindOf)).toEqual(['view', 'edit', 'print', 'delete']);
    expect(box, 'replace is the arrow off its line').toContain(ARROW_OFF_LINE);
    expect(box).toContain('data-receipt-image-replace="r-2"');
    expect(box).toContain(TRASH_2);
    expect(markup, 'no row is left without one or the other').not.toContain(
      'data-receipt-image-upload="r-2"',
    );
  });
});

describe('a receipt a custody memo holds — the bin stays in the box, faded', () => {
  it('keeps the pen in blue and the bin in red, the bin disabled inside a titled span', () => {
    const qc = client();
    const rows = [
      receipt({
        source: 'custody',
        cardId: null,
        cardCompany: null,
        cardNumber: null,
        memo: { id: 'm-7', no: 7, replenishedAt: null, held: false },
      }),
    ];
    qc.setQueryData(
      listKey('fleet', 'receipts', {
        ...FILTERS,
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDir: 'desc',
        sort: 'date:desc',
      }),
      { items: rows, meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
    );
    qc.setQueryData(listKey('fleet', 'receipts', { summary: true, ...FILTERS }), TOTALS);
    const box = element(
      mount(qc, RECEIPT_GRANTS, '/fleet/receipts', <ReceiptsPage />),
      'data-row-actions="receipt"',
    );
    // The same two icons in the same order and colours — the bin is the one that no longer works.
    expect(buttonClasses(box).map(kindOf)).toEqual(['edit', 'delete']);
    expect(box).toContain(TRASH_2);
    expect(box).toMatch(
      /<span title="[^"]+" data-locked-action="receipt-delete"[^>]*><button type="button" disabled=""/u,
    );
  });
});

describe('the vehicles licence cell', () => {
  it('a car with no scan: the dashed box with the cloud upload', () => {
    const cell = licenceCell(vehicle());
    const upload = tagOf(cell, 'data-vehicle-license-upload="v-1"');
    expect(html(upload)).toContain(IMAGE_EMPTY_BOX);
    expect(cell).toContain(CLOUD);
    expect(cell).not.toContain('data-image-actions');
  });

  it('a car with a scan: the eye, replace, print and the bin, in the image box', () => {
    const cell = licenceCell(vehicle({ licenseImage: PHOTO }));
    const box = element(cell, 'data-image-actions="vehicle-license"');
    expect(tagOf(box, 'data-image-actions')).toContain(`class="${IMAGE_GROUP}"`);
    expect(buttonClasses(box).map(kindOf)).toEqual(['view', 'edit', 'print', 'delete']);
    expect(box).toContain('data-vehicle-license-replace="v-1"');
    expect(box).toContain(ARROW_OFF_LINE);
  });

  it('a disposed car keeps its eye, print and bin, and is offered no new scan', () => {
    const cell = licenceCell(vehicle({ licenseImage: PHOTO, status: 'disposed' }));
    const box = element(cell, 'data-image-actions="vehicle-license"');
    expect(buttonClasses(box).map(kindOf)).toEqual(['view', 'print', 'delete']);
    expect(box).not.toContain('data-vehicle-license-replace');
  });
});

// ── every screen, at the source ─────────────────────────────────────────────

const SOURCES = ((): { path: string; code: string }[] => {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(name) && !/\.spec\.tsx?$/u.test(name)) {
        // Comments are history, not code.
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//gu, '')
          .replace(/^\s*\/\/.*$/gmu, '');
        out.push({ path: relative(HERE, full), code });
      }
    }
  };
  walk(HERE);
  return out;
})();

describe('no Fleet screen keeps its own grey actions', () => {
  it('found the sources it guards', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it('defines no local `actionButton` — nor any renamed copy of the old grey icon button', () => {
    const offenders = SOURCES.filter(({ code }) =>
      /\bconst\s+(?:actionButton|iconButton|[A-Z_]*ACTION_BUTTON)\s*=/u.test(code),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
    // The old string itself, under whatever name: a grey square that greys further on hover.
    const copies = SOURCES.filter(({ code }) =>
      /const\s+\w+\s*=\s*\n?\s*'rounded(?:-md)? p-[\d.]+ text-slate-[45]00 hover:bg-slate-100/u.test(
        code,
      ),
    ).map(({ path }) => path);
    expect(copies).toEqual([]);
  });

  it('draws every actions column in the owner’s box', () => {
    const columns = SOURCES.filter(({ code }) => code.includes("key: 'actions'"));
    expect(columns.length, 'the screens with an actions column').toBeGreaterThanOrEqual(15);
    for (const { path, code } of columns) {
      expect(code, path).toContain('ACTION_GROUP');
      expect(code, path).toContain('row-actions-look');
    }
  });

  it('draws every image cell from the same look', () => {
    for (const cell of [
      'components/VehicleLicenseImage.tsx',
      'components/DriverLicenseImage.tsx',
      'components/ReceiptImageCell.tsx',
      'components/DealershipImageCell.tsx',
      'components/NoticeImageCell.tsx',
      'components/FuelCardImage.tsx',
    ]) {
      const code = SOURCES.find(({ path }) => path === cell)?.code ?? '';
      expect(code, cell).toContain('IMAGE_EMPTY_BOX');
      expect(code, cell).toContain('IMAGE_GROUP');
      expect(code, cell).toContain('<CloudUploadIcon');
    }
  });

  it('puts no yellow, orange or amber on any screen’s action or image box — one named exception', () => {
    // Every `className={…}` that draws from the look, read whole: a screen adding its own yellow
    // over an action (`cn(actionTone('…'), '!text-amber-…')`) is caught, not only the look file.
    const LOOK =
      /\b(?:actionTone|actionColour)\(|\b(?:ACTION_GROUP|IMAGE_GROUP|IMAGE_EMPTY_BOX)\b/gu;
    const expressionAt = (code: string, at: number): string => {
      const open = code.lastIndexOf('className={', at);
      if (open === -1 || at - open > 400) return '';
      let depth = 0;
      for (let i = open + 'className='.length; i < code.length; i += 1) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') {
          depth -= 1;
          if (depth === 0) return code.slice(open, i + 1);
        }
      }
      return '';
    };
    const yellow = new Set<string>();
    let boxes = 0;
    for (const { path, code } of SOURCES) {
      if (path === 'components/row-actions-look.ts') continue;
      for (const match of code.matchAll(LOOK)) {
        const expression = expressionAt(code, match.index ?? 0);
        if (expression === '') continue;
        boxes += 1;
        if (/\b(?:yellow|orange|amber)-/u.test(expression)) yellow.add(path);
      }
    }
    expect(boxes, 'the guard read the screens’ boxes').toBeGreaterThan(50);
    // «لو السجل فى عمليه واحده على الاقل يخليه باللون الاصفر» — the owner's own earlier word for the
    // accidents log of a car that has paid from or to another car. Kept, and written down in
    // row-actions-look.ts, until he says the picture replaces it. Nothing else may be yellow.
    expect([...yellow]).toEqual(['pages/AccidentsPage.tsx']);
  });

  it('no container paints every button or label in it one colour over the icons’ own', () => {
    // The vehicles card's footer did: `[&_button]:!text-slate-600` greyed every icon of the row's
    // box and of the licence cell on a tablet or a phone. A size (`!text-xs`) is not a colour.
    const COLOUR = /\[&_(?:button|label)\]:!?text-(?:white|black|inherit|current|[a-z]+-\d)/u;
    const offenders = SOURCES.filter(({ code }) => COLOUR.test(code)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('deletes with the bin that has two lines inside it, on every action and image box', () => {
    const boxes = SOURCES.filter(
      ({ code }) => code.includes('ACTION_GROUP') || code.includes('IMAGE_GROUP'),
    );
    for (const { path, code } of boxes) {
      for (const at of [...code.matchAll(/actionTone\('delete'\)/gu)].map((m) => m.index ?? 0)) {
        expect(code.slice(at, at + 400), `${path} — its delete`).toContain('<Trash2Icon');
      }
    }
  });
});
