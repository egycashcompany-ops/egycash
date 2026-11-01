// The register page (spec §8.3) as a reader meets it: rendered from a pre-filled query cache, the
// way the fleet dashboard is pinned (fleet-dashboard.spec.tsx). What a reader may SEE is the
// server's decision; what this pins is that the page shows that decision faithfully — the hidden
// key columns stay hidden, the combination is never drawn whatever arrives, a handed-back row is
// dark green in every cell, and each row offers exactly the actions its state and the reader's keys
// allow.
//
// And the catalog (DEC-35 … DEC-37): the bank select offers the catalog's active banks (a seventh
// included) with «+» behind `atmBank.create`, the Operations name is a spelling of the chosen bank,
// an area can be added from the form, «البنوك» opens the catalog, and a row Operations recorded from
// /atm/data-edit carries «بيانات ناقصة» — which the filter finds and the export takes along.
//
// And the branches as the top bar names them (2026-10-28): the grid, the filter, the receipt's
// picker and the edit form read the ECMS name the server sends, never an EGYCASH code, and a top
// bar on a linked source (أكتوبر, working as المهندسين) stands for the branch it works as.
//
// Every code, name and value below is synthetic. No real ATM ID, key code or combination appears.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ATM_BANK_SEED,
  type AtmBankDto,
  type AtmRegisterBranchOptionsDto,
  type AtmRegisterCassettesDto,
  type AtmRegisterEntryDto,
  type AtmRegisterMetaBranchOptionDto,
  type AtmRegisterMetaDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { RegisterPage, readRegisterFilters, registerFilterParams } from './pages/RegisterPage';
import { HandoverDialog, handoverBody } from './components/register/HandoverDialog';
import { registerRowActions } from './components/register/RegisterRowActions';
import {
  areaSuggestions,
  entryEditRules,
  entryFormValues,
  isNewArea,
  opsLabelChoices,
  receiveBody,
  registerBankChoices,
  updateBody,
} from './components/register/EntryFormSections';
import { EditEntryDialog } from './components/register/EditEntryDialog';
import { DeleteEntryDialog } from './components/register/DeleteEntryDialog';
import { ReceiveEntryDialog, defaultReceiptBranch } from './components/register/ReceiveEntryDialog';
import { BankCatalogDialog } from './components/catalog/BankCatalogDialog';
import { REGISTER_ENDED_ROW } from './lib/register-grid';
import { makeBankLookup } from './lib/bank-catalog';
import {
  registerBankFilterOptions,
  registerBranchChoices,
  registerBranchFilterValue,
  searchParamOf,
  strayRegisterBranch,
  viewableBranches,
} from './components/register/RegisterFilters';
import { atmBanksKey } from './api/atm-queries';
import { listKey } from '../../shared/lib/query-keys';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const ALEX = '650000000000000000000104';
/** Alexandria as ECMS names it — what the top bar, and so the register, shows. */
const ALEX_NAME = { ar: 'الإسكندرية', en: 'Alexandria' };
/** A value no row may ever print — it rides on a row as if a server had leaked it. */
const LEAKED_COMBINATION = 'SENTINEL-AO-VALUE';
const SYNTHETIC_KEY = 'SYN-KEY-0001';

const NO_CASSETTES: AtmRegisterCassettesDto = {
  withdrawalType: null,
  withdrawalCount: null,
  withdrawal1: null,
  withdrawal2: null,
  withdrawal3: null,
  withdrawal4: null,
  withdrawal5: null,
  depositType: null,
  depositCount: null,
  collectionCount: null,
  recycle200: null,
  recycle100: null,
  recycle50: null,
  spareCount: null,
  spare1: null,
  spare2: null,
  spare3: null,
  spare4: null,
  spare5: null,
};

const entry = (id: string, over: Partial<AtmRegisterEntryDto> = {}): AtmRegisterEntryDto => ({
  id,
  branchId: ALEX,
  branchCode: 'EGYCASH-4',
  branchName: ALEX_NAME,
  area: 'SYNTH AREA',
  bankCode: 'NBE',
  opsBankLabel: null,
  effectiveOpsBankLabel: 'NBE',
  machineCode: `9999${id.slice(-4)}`,
  machineId: '650000000000000000000b01',
  masterState: 'active',
  name: `Synthetic ATM ${id.slice(-2)}`,
  operationType: null,
  vendor: null,
  model: null,
  serial: null,
  secretsVisible: false,
  keys: null,
  cassettes: NO_CASSETTES,
  openTime: null,
  closeTime: null,
  accessHoursNotes: null,
  receiptNotes: null,
  safeCombinationSet: true,
  locationPlusCode: null,
  locationUrl: null,
  hub: null,
  startDate: '2026-01-12',
  endDate: null,
  receivedByName: null,
  handoverName: null,
  handoverNotes: null,
  status: 'open',
  source: 'manual',
  dataIncomplete: false,
  importRow: null,
  importIssues: [],
  version: 3,
  createdAt: '2026-01-12T08:00:00.000Z',
  updatedAt: '2026-01-12T08:00:00.000Z',
  ...over,
});

const OPEN = entry('650000000000000000000a01');
const ENDED = entry('650000000000000000000a02', { status: 'ended', endDate: '2026-03-01' });
const PENDING = entry('650000000000000000000a03', {
  status: 'pending',
  startDate: null,
  machineId: null,
  masterState: null,
});
const UNLINKED = entry('650000000000000000000a04', {
  machineId: null,
  masterState: 'unlinked',
  name: null,
  source: 'import',
  importRow: 7,
  importIssues: [{ code: 'noName', column: 'E', detail: null }],
});
const BRANCHLESS = entry('650000000000000000000a05', {
  status: 'pending',
  startDate: null,
  branchId: null,
  branchCode: null,
  branchName: null,
  machineId: null,
  masterState: null,
});
/** A row whose secrets the reader may see. */
const VISIBLE = entry('650000000000000000000a06', {
  secretsVisible: true,
  keys: {
    supervisorCode: SYNTHETIC_KEY,
    supervisorCount: '2',
    safeDoorCount: '1',
    alanki: null,
    combinationKeyCode: null,
    combinationKeyCount: null,
    cashUnitCode: null,
    cashUnitCount: null,
  },
});

/** A machine Operations added on /atm/data-edit: an open, linked receipt, flagged (DEC-36/37). */
const INTAKE = entry('650000000000000000000a08', {
  source: 'operations',
  dataIncomplete: true,
  bankCode: 'BM',
  effectiveOpsBankLabel: 'MISR',
  safeCombinationSet: false,
});

const ROWS = [OPEN, ENDED, PENDING, UNLINKED, BRANCHLESS, VISIBLE, INTAKE];

/** The six seeds as the meta carries them, a seventh active bank, and an archived eighth. */
const META_BANKS: AtmRegisterMetaDto['banks'] = [
  ...ATM_BANK_SEED.map((seed) => ({
    code: seed.code,
    name: seed.name,
    opsLabel: seed.opsLabel,
    color: seed.color,
    isActive: true,
    sortOrder: seed.sortOrder,
    isSeed: true,
  })),
  {
    code: 'QNB',
    name: { ar: 'بنك تجريبي', en: 'Synthetic Bank' },
    opsLabel: 'QNB',
    color: '#7030A0',
    isActive: true,
    sortOrder: 70,
    isSeed: false,
  },
  {
    code: 'OLDB',
    name: { ar: 'بنك مؤرشف تجريبي', en: 'Archived Synthetic Bank' },
    opsLabel: 'OLDB',
    color: '#00B0F0',
    isActive: false,
    sortOrder: 80,
    isSeed: false,
  },
];

const META: AtmRegisterMetaDto = {
  banks: META_BANKS,
  branches: [
    {
      code: 'EGYCASH-4',
      name: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchId: ALEX,
      branchName: ALEX_NAME,
      branchActive: true,
      canView: true,
      canCreate: true,
      resolvedBranchId: ALEX,
      resolvedBranchName: ALEX_NAME,
    },
  ],
  branchOptions: [
    {
      branchId: ALEX,
      name: ALEX_NAME,
      codes: ['EGYCASH-4'],
      sourceBranchIds: [],
      active: true,
      canView: true,
      canCreate: true,
    },
  ],
};

/** META with one more branch the reader may receive in — a choice to make. */
const TANTA = '650000000000000000000102';
const withTanta = (meta: AtmRegisterMetaDto = META): AtmRegisterMetaDto => ({
  ...meta,
  branches: [
    ...meta.branches,
    {
      ...(meta.branches[0] as AtmRegisterMetaDto['branches'][number]),
      code: 'EGYCASH-2',
      branchId: TANTA,
      resolvedBranchId: TANTA,
    },
  ],
  branchOptions: [
    ...(meta.branchOptions ?? []),
    {
      branchId: TANTA,
      name: { ar: 'طنطا', en: 'Tanta' },
      codes: ['EGYCASH-2'],
      sourceBranchIds: [],
      active: true,
      canView: true,
      canCreate: true,
    },
  ],
});

const ALL_KEYS = [
  'atmRegister.view',
  'atmRegister.create',
  'atmRegister.edit',
  'atmRegister.delete',
  'atmRegister.export',
  'atmRegister.handover',
  'atmRegister.viewSecrets',
  'atmRegister.import',
  'atmRegisterReport.view',
];

const store = (permissions: readonly string[], locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const page = (rows: AtmRegisterEntryDto[]): Paginated<AtmRegisterEntryDto> => ({
  items: rows,
  meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
});

const render = (
  permissions: readonly string[] = ALL_KEYS,
  rows: AtmRegisterEntryDto[] = ROWS,
  meta: AtmRegisterMetaDto = META,
  {
    url = '/atm/register',
    filters = {},
    locale = 'ar',
  }: { url?: string; filters?: Record<string, unknown>; locale?: Locale } = {},
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The page's own first question: page 1, 25 rows, no filter (unless the URL holds one), no sort
  // (the sheet's order).
  qc.setQueryData(
    listKey('atm', 'registerEntries', { ...filters, page: 1, pageSize: 25 }),
    page(rows),
  );
  qc.setQueryData(listKey('atm', 'registerMeta'), meta);
  return renderToStaticMarkup(
    <Provider store={store(permissions, locale)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <RegisterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** One body row, from its marker to the end of the row. */
const row = (markup: string, id: string): string => {
  const at = markup.indexOf(`data-register-row="${id}"`);
  return at === -1 ? '' : markup.slice(at, markup.indexOf('</tr>', at));
};
/** One cell of a row. */
const cell = (rowMarkup: string, field: string): string => {
  const at = rowMarkup.indexOf(`data-register-cell="${field}"`);
  return at === -1 ? '' : rowMarkup.slice(at, rowMarkup.indexOf('</td>', at));
};
const actionsOf = (rowMarkup: string): string[] =>
  [...rowMarkup.matchAll(/data-register-action="([^"]+)"/g)].map((m) => m[1] as string);

describe('the grid', () => {
  it('opens under a title alone, with the two-row grouped head', () => {
    const markup = render();
    expect(markup).toContain(t('atm.register.title'));
    expect(markup).toContain('data-register-groups="true"');
    const groups = [...markup.matchAll(/data-register-group="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual([
      'identity',
      'keys',
      'cassettes',
      'hours',
      'secret',
      'location',
      'lifecycle',
      'hub',
    ]);
    expect(markup).toContain(t('atm.register.group.cassettes'));
    expect(markup, 'every column header, AV beside AP').toMatch(
      /data-register-column="AP"[\s\S]*data-register-column="AV"[\s\S]*data-register-column="AQ"/,
    );
  });

  it('freezes Branch, Area, Bank, ATM ID and Name at their inline-start offsets', () => {
    const open = row(render(), OPEN.id);
    for (const [field, offset] of [
      ['branchCode', 0],
      ['area', 96],
      ['bankCode', 217],
      ['machineCode', 289],
      ['name', 386],
    ] as const) {
      const at = cell(open, field);
      expect(at, field).toContain('lg:sticky');
      // React writes a zero without its unit.
      expect(at, field).toContain(
        `inset-inline-start:${offset === 0 ? '0' : `${String(offset)}px`}"`,
      );
    }
    expect(cell(open, 'model'), 'a scrolled column stays put').not.toContain('lg:sticky');
  });

  it('paints a handed-back row dark green in every cell, frozen ones included', () => {
    const ended = row(render(), ENDED.id);
    expect(ended).toContain(REGISTER_ENDED_ROW);
    const cells = [...ended.matchAll(/<td [^>]*class="([^"]*)"/g)].map((m) => m[1] as string);
    expect(cells.length).toBeGreaterThan(49);
    expect(cells.every((c) => c.includes(REGISTER_ENDED_ROW))).toBe(true);
    expect(row(render(), OPEN.id)).not.toContain(REGISTER_ENDED_ROW);
  });

  it('draws a lock in every key cell the reader may not see, and the values where they may', () => {
    const markup = render();
    const hiddenOpen = [...row(markup, OPEN.id).matchAll(/data-secret-hidden="true"/g)];
    // J..Q (8), Notes received (AN), Notes delivered (AU).
    expect(hiddenOpen).toHaveLength(10);
    expect(cell(row(markup, OPEN.id), 'keys.supervisorCode')).toContain(
      t('atm.register.secretHidden'),
    );
    const visible = row(markup, VISIBLE.id);
    expect(visible).not.toContain('data-secret-hidden');
    expect(cell(visible, 'keys.supervisorCode')).toContain(SYNTHETIC_KEY);
  });

  it('never prints the combination, whatever a row carries — only whether one is recorded', () => {
    const leaky = {
      ...OPEN,
      safeCombination: LEAKED_COMBINATION,
    } as unknown as AtmRegisterEntryDto;
    const markup = render(ALL_KEYS, [leaky, { ...ENDED, safeCombinationSet: false }]);
    expect(markup).not.toContain(LEAKED_COMBINATION);
    expect(cell(row(markup, OPEN.id), 'safeCombination')).toContain(
      t('atm.register.combinationSet'),
    );
    expect(cell(row(markup, ENDED.id), 'safeCombination')).toContain(
      t('atm.register.combinationUnset'),
    );
  });

  it('marks an open row the Operations list does not hold, and only such a row', () => {
    const markup = render();
    const unlinked = cell(row(markup, UNLINKED.id), 'machineCode');
    expect(unlinked).toContain('data-master-state="unlinked"');
    expect(unlinked).toContain(t('atm.register.master.unlinked'));
    expect(cell(row(markup, OPEN.id), 'machineCode')).not.toContain('data-master-state');
    expect(cell(row(markup, PENDING.id), 'machineCode')).not.toContain('data-master-state');
  });

  it('writes a dash for a blank imported name, with the row’s import notes beside it', () => {
    const name = cell(row(render(), UNLINKED.id), 'name');
    expect(name).toContain('—');
    expect(name).toContain('data-register-issues="1"');
    expect(name).toContain(t('atm.register.issue.noName'));
  });

  it('puts the pending pill where the start date would be', () => {
    expect(cell(row(render(), PENDING.id), 'startDate')).toContain(
      t('atm.register.status.pending'),
    );
    expect(cell(row(render(), OPEN.id), 'startDate')).toContain('12/01/2026');
  });
});

describe('the row actions', () => {
  it('offer each row what its state and the reader’s keys allow', () => {
    const markup = render();
    expect(actionsOf(row(markup, OPEN.id))).toEqual(['edit', 'handover', 'delete']);
    expect(actionsOf(row(markup, ENDED.id))).toEqual(['edit', 'delete']);
    expect(actionsOf(row(markup, PENDING.id))).toEqual(['edit', 'receivePending', 'delete']);
    // Link only for an open row the Operations list does not hold (DEC-30).
    expect(actionsOf(row(markup, UNLINKED.id))).toEqual(['edit', 'handover', 'link', 'delete']);
    // A branch-less pending row cannot be received — its branch can never be set (DEC-12).
    expect(actionsOf(row(markup, BRANCHLESS.id))).toEqual(['edit', 'delete']);
    // Reveal only where the server said this reader may see this row's secrets.
    expect(actionsOf(row(markup, VISIBLE.id))).toEqual(['edit', 'handover', 'reveal', 'delete']);
  });

  it('offer nothing to a reader who may only look', () => {
    const markup = render(['atmRegister.view']);
    for (const r of ROWS) expect(actionsOf(row(markup, r.id)), r.id).toEqual([]);
    expect(markup).not.toContain(t('atm.register.actions'));
    expect(markup).not.toContain(t('atm.register.receive'));
    expect(markup).not.toContain(t('atm.register.export'));
  });

  it('follow each key on its own', () => {
    const none = { edit: false, create: false, handover: false, viewSecrets: false, delete: false };
    expect(registerRowActions(UNLINKED, { ...none, handover: true })).toEqual(['handover']);
    expect(registerRowActions(UNLINKED, { ...none, edit: true })).toEqual(['edit', 'link']);
    expect(registerRowActions(PENDING, { ...none, create: true })).toEqual(['receivePending']);
    expect(registerRowActions(OPEN, { ...none, create: true }), 'an open row is received').toEqual(
      [],
    );
    expect(registerRowActions(VISIBLE, none), 'reveal follows the row, not a key').toEqual([
      'reveal',
    ]);
  });

  it('put the header actions behind their own keys', () => {
    const markup = render();
    expect(markup).toContain(t('atm.register.receive'));
    expect(markup).toContain(t('atm.register.export'));
    expect(markup).toContain('href="/atm/register/import"');
    expect(markup).toContain('href="/atm/register/report"');
    const viewer = render(['atmRegister.view']);
    expect(viewer).not.toContain('href="/atm/register/import"');
    expect(viewer).not.toContain('href="/atm/register/report"');
  });
});

describe('the page around the grid', () => {
  it('says so when no branch code is mapped yet', () => {
    const unmapped: AtmRegisterMetaDto = {
      ...META,
      branches: META.branches.map((b) => ({
        ...b,
        branchId: null,
        branchName: null,
        resolvedBranchId: null,
        resolvedBranchName: null,
      })),
      branchOptions: [],
    };
    expect(render(ALL_KEYS, ROWS, unmapped)).toContain(t('atm.register.noMapping'));
    expect(render()).not.toContain('data-register-no-mapping');
  });

  it('answers an empty register with its own words', () => {
    expect(render(ALL_KEYS, [])).toContain(t('atm.register.empty'));
  });

  it('pages through the whole register on the server, 25 / 50 / 100 a page', () => {
    const markup = render();
    expect(markup).toContain('data-page-size');
    expect(markup).toMatch(/<option value="100">/);
    expect(markup).toContain(t('common.list.count', { count: '٧' }));
  });
});

// Review finding WEB-2. `SearchInput` re-emits while its text differs from the value it is handed
// back; the page hands back `sp.get('q') ?? ''`. Whatever is typed must therefore come back as
// itself — a box of spaces written as "no q" came back as '' and was pushed onto the history
// every 300 ms, for ever.
describe('the search box', () => {
  it('writes what was typed, so the value handed back equals the text and nothing re-emits', () => {
    for (const text of ['', ' ', '   ', 'ab', ' ab ', 'x ']) {
      expect(searchParamOf(text) ?? '', JSON.stringify(text)).toBe(text);
    }
    expect(searchParamOf('')).toBeNull();
  });
});

describe('the handover dialog', () => {
  const dialog = (target: AtmRegisterEntryDto): string => {
    const qc = new QueryClient();
    return renderToStaticMarkup(
      <Provider store={store(ALL_KEYS)}>
        <QueryClientProvider client={qc}>
          <HandoverDialog entry={target} onClose={() => undefined} />
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('pre-fills the delivered name the entry already carries', () => {
    const markup = dialog({ ...OPEN, handoverName: 'Synthetic Courier' });
    expect(markup).toContain(t('atm.register.form.handoverHint'));
    expect(markup).toMatch(
      /data-handover-name="true"[^>]*value="Synthetic Courier"|value="Synthetic Courier"[^>]*data-handover-name="true"/,
    );
    expect(markup, 'no notes box for a reader who may not see the notes').not.toContain(
      t('atm.register.col.handoverNotes'),
    );
  });

  it('pre-fills the notes too, for a reader who may see them', () => {
    const markup = dialog({ ...VISIBLE, handoverNotes: 'Synthetic note' });
    expect(markup).toContain(t('atm.register.col.handoverNotes'));
    expect(markup).toContain('Synthetic note');
  });

  it('keeps a delivered name the sheet holds on two lines in a text area (DATA-1)', () => {
    const markup = dialog({ ...OPEN, handoverName: 'Courier one\nCourier two' });
    expect(markup).toMatch(
      /<textarea[^>]*data-handover-name="true"[^>]*>Courier one\nCourier two</,
    );
    expect(dialog({ ...OPEN, handoverName: 'Courier' })).toMatch(/<input[^>]*data-handover-name/);
  });

  it('sends only what the reader changed, so an untouched field keeps its stored value', () => {
    const carried = {
      ...VISIBLE,
      handoverName: 'Synthetic Courier',
      handoverNotes: 'Synthetic note',
    };
    expect(handoverBody(carried, '2026-03-01', 'Synthetic Courier', 'Synthetic note')).toEqual({
      endDate: '2026-03-01',
      version: 3,
    });
    expect(handoverBody(carried, '2026-03-01', '', 'Synthetic note')).toEqual({
      endDate: '2026-03-01',
      version: 3,
      handoverName: null,
    });
    // Without the right to see the notes, they are never sent — not even as a blank.
    expect(handoverBody({ ...OPEN, handoverNotes: null }, '2026-03-01', '', '')).toEqual({
      endDate: '2026-03-01',
      version: 3,
    });
  });
});

describe('the reveal', () => {
  const source = readFileSync(join(HERE, 'components/register/RevealCombinationDialog.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('shows the value thirty seconds, then resets the mutation that held it', () => {
    expect(source).toContain('export const REVEAL_SECONDS = 30;');
    const timer = source.slice(
      source.indexOf('window.setInterval('),
      source.indexOf('return () => window.clearInterval(timer);'),
    );
    expect(timer, 'counts down from REVEAL_SECONDS').toContain('REVEAL_SECONDS - ');
    expect(timer.slice(timer.indexOf('if (left <= 0)')), 'and resets at zero').toMatch(
      /^if \(left <= 0\) \{\s*window\.clearInterval\(timer\);\s*resetRef\.current\(\);/,
    );
  });

  it('resets on close and when the screen goes away, and never keeps the value anywhere else', () => {
    const close = source.slice(source.indexOf('const close = ()'), source.indexOf('const copy'));
    expect(close).toContain('reveal.reset()');
    expect(source).toContain('useEffect(() => () => resetRef.current(), [])');
    expect(source, 'never logged').not.toMatch(/console\./);
    expect(source, 'never copied into state').not.toMatch(/useState\([^)]*safeCombination/);
    expect(source, 'never put in the query cache').not.toMatch(/setQueryData/);
  });
});

describe('the entry form', () => {
  const withDialog = (node: JSX.Element, permissions: readonly string[] = ALL_KEYS): string =>
    renderToStaticMarkup(
      <Provider store={store(permissions)}>
        <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
      </Provider>,
    );
  const sections = (markup: string): string[] =>
    [...markup.matchAll(/data-register-section="([^"]+)"/g)].map((m) => m[1] as string);

  it('asks for the keys, the K notes and the combination only of a reader allowed them', () => {
    const full = withDialog(<ReceiveEntryDialog meta={META} onClose={() => undefined} />);
    expect(sections(full)).toEqual([
      'identity',
      'keys',
      'cassettes',
      'hours',
      'secret',
      'location',
      'lifecycle',
      'hub',
    ]);
    expect(full).toContain(t('atm.register.col.receiptNotes'));
    const plain = withDialog(
      <ReceiveEntryDialog meta={META} onClose={() => undefined} />,
      ALL_KEYS.filter((k) => k !== 'atmRegister.viewSecrets'),
    );
    expect(sections(plain)).toEqual([
      'identity',
      'cassettes',
      'hours',
      'location',
      'lifecycle',
      'hub',
    ]);
    expect(plain).not.toContain(t('atm.register.col.receiptNotes'));
    // The nineteen cassette columns, the five numbered ones of each set on one line.
    expect([...full.matchAll(/data-cassette-set="([^"]+)"/g)]).toHaveLength(3);
  });

  it('starts a receipt on the top bar’s branch when the reader may receive there', () => {
    expect(defaultReceiptBranch(META, ALEX)).toBe(ALEX);
    expect(defaultReceiptBranch(META, null), 'the only branch on offer').toBe(ALEX);
    const two = withTanta();
    expect(defaultReceiptBranch(two, null), 'a choice to make').toBe('');
    expect(defaultReceiptBranch(two, TANTA)).toBe(TANTA);
    expect(defaultReceiptBranch(two, '650000000000000000000999'), 'out of reach').toBe('');
  });

  it('sends a receipt without empty boxes, and without any K or S value from a reader not allowed them', () => {
    const values = {
      ...entryFormValues(null, ALEX),
      name: '  Synthetic ATM  ',
      machineCode: '99990009',
      bankCode: 'NBE',
      area: 'SYNTH AREA',
      startDate: '2026-02-01',
      'keys.supervisorCode': SYNTHETIC_KEY,
      safeCombination: 'synthetic-combination',
      'cassettes.withdrawal1': '4',
    };
    const plain = receiveBody(values, false);
    expect(plain).toEqual({
      branchId: ALEX,
      name: 'Synthetic ATM',
      machineCode: '99990009',
      bankCode: 'NBE',
      area: 'SYNTH AREA',
      startDate: '2026-02-01',
      cassettes: { withdrawal1: '4' },
    });
    const allowed = receiveBody(values, true);
    expect(allowed.keys).toEqual({ supervisorCode: SYNTHETIC_KEY });
    expect(allowed.safeCombination).toBe('synthetic-combination');
  });

  it('sends an edit of only what changed — never a K field the reader cannot see', () => {
    const initial = entryFormValues(OPEN);
    expect(initial.safeCombination, 'the combination box starts empty').toBe('');
    expect(updateBody(OPEN, initial, initial, false), 'nothing changed').toEqual({ version: 3 });
    const edited = { ...initial, area: 'OTHER AREA', 'keys.supervisorCode': SYNTHETIC_KEY };
    expect(updateBody(OPEN, initial, edited, true)).toEqual({ version: 3, area: 'OTHER AREA' });
    // A reader who may see the secrets: empty keeps, "clear" clears, typed replaces.
    const seen = entryFormValues(VISIBLE);
    expect(updateBody(VISIBLE, seen, seen, false)).toEqual({ version: 3 });
    expect(updateBody(VISIBLE, seen, seen, true)).toEqual({ version: 3, safeCombination: null });
    expect(
      updateBody(
        VISIBLE,
        seen,
        { ...seen, safeCombination: 'typed', 'keys.supervisorCount': '' },
        false,
      ),
    ).toEqual({ version: 3, safeCombination: 'typed', keys: { supervisorCount: null } });
  });

  it('follows the status: the ATM ID while unlinked, the handover fields once handed back', () => {
    expect(entryEditRules(OPEN)).toMatchObject({ codeEditable: false, areaRequired: true });
    expect(entryEditRules(UNLINKED)).toMatchObject({ codeEditable: true, areaLinks: true });
    expect(entryEditRules(PENDING)).toMatchObject({ codeEditable: true, startDateEditable: false });
    expect(entryEditRules(ENDED)).toMatchObject({ handoverEditable: true, codeEditable: false });
    const initial = entryFormValues(OPEN);
    expect(
      updateBody(
        OPEN,
        initial,
        { ...initial, machineCode: '99990077', endDate: '2026-04-01' },
        false,
      ),
      'a linked ATM ID and an open entry’s end date are not the edit’s to change',
    ).toEqual({ version: 3 });
  });

  // Review finding DATA-1: 1,531 imported cells hold several lines. A single-line <input> strips
  // the breaks as soon as it is touched, so an edit saved '2\n3' as '23'. Such a value is edited in
  // a text area, which keeps them; a one-line value keeps its input.
  it('edits a value the sheet holds on several lines in a text area, line breaks intact', () => {
    const lines = entry('650000000000000000000a07', {
      ...VISIBLE,
      id: '650000000000000000000a07',
      model: 'Model A\nModel B',
      receivedByName: 'Receiver one\nReceiver two',
      cassettes: { ...NO_CASSETTES, withdrawalType: 'Type 1\nType 2' },
      keys: {
        ...(VISIBLE.keys as NonNullable<AtmRegisterEntryDto['keys']>),
        alanki: 'LINE-ONE\nLINE-TWO',
      },
    });
    const markup = withDialog(
      <EditEntryDialog entry={lines} meta={META} onClose={() => undefined} />,
    );
    const box = (field: string): string =>
      new RegExp(`<(textarea|input)[^>]*id="[^"]*-${field.replace('.', '-')}"`).exec(markup)?.[1] ??
      'missing';
    expect(box('keys.alanki')).toBe('textarea');
    expect(box('model')).toBe('textarea');
    expect(box('receivedByName')).toBe('textarea');
    expect(box('cassettes.withdrawalType')).toBe('textarea');
    expect(markup).toContain('LINE-ONE\nLINE-TWO');
    // One-line values keep their single-line box.
    expect(box('keys.supervisorCode')).toBe('input');
    expect(box('serial')).toBe('input');
    // An untouched multi-line value is not sent; a changed one is sent with its lines.
    const initial = entryFormValues(lines);
    expect(updateBody(lines, initial, initial, false)).toEqual({ version: 3 });
    expect(
      updateBody(lines, initial, { ...initial, 'keys.alanki': 'LINE-ONE\nLINE-3' }, false),
    ).toEqual({ version: 3, keys: { alanki: 'LINE-ONE\nLINE-3' } });
  });

  it('draws the edit with the branch fixed, the ID locked once linked, and the link hint when not', () => {
    const linked = withDialog(
      <EditEntryDialog entry={OPEN} meta={META} onClose={() => undefined} />,
    );
    expect(linked).toContain(t('atm.register.form.editTitle', { code: OPEN.machineCode ?? '' }));
    expect(linked).toContain(t('atm.register.form.codeLocked'));
    expect(linked).not.toContain(t('atm.register.form.linkOnAreaHint'));
    expect(linked, 'no key box for a reader who may not see the keys').not.toContain(
      'data-register-section="keys"',
    );
    const unlinked = withDialog(
      <EditEntryDialog entry={UNLINKED} meta={META} onClose={() => undefined} />,
    );
    expect(unlinked).toContain(t('atm.register.form.linkOnAreaHint'));
    expect(unlinked).not.toContain(t('atm.register.form.codeLocked'));
    const visible = withDialog(
      <EditEntryDialog entry={VISIBLE} meta={META} onClose={() => undefined} />,
    );
    expect(visible).toContain('data-register-section="secret"');
    expect(visible).toContain(t('atm.register.form.combinationKeep'));
    expect(visible).toContain(t('atm.register.form.combinationClear'));
  });
});

// ── The catalog in the register (DEC-35 … DEC-37) ─────────────────────────────────────────────────

/** The branch's options as `/branch-options` answers them: two spellings, a labelled area. */
const OPTIONS: AtmRegisterBranchOptionsDto = {
  branchId: ALEX,
  areaLabels: ['SYNTH AREA'],
  bankLabels: ['NBE FOREX', 'MISR SPELLING'],
  areaOptions: [{ name: 'SYNTH AREA', nameAr: 'منطقة تجريبية', nameEn: null }],
  bankVariants: [
    { name: 'NBE FOREX', bankCode: 'NBE' },
    { name: 'MISR SPELLING', bankCode: 'BM' },
  ],
  areas: ['SYNTH AREA', 'Typed Area'],
  operationTypes: [],
  vendors: [],
  models: [],
  hubs: [],
};

const withForm = (node: JSX.Element, permissions: readonly string[] = ALL_KEYS): string => {
  const qc = new QueryClient();
  qc.setQueryData(listKey('atm', 'registerBranchOptions', { branchId: ALEX }), OPTIONS);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

/** The `<option>`s of one select, by the select's id suffix. */
const optionsOf = (markup: string, field: string): string[] => {
  const at = new RegExp(`<select[^>]*id="[^"]*-${field}"[^>]*>`).exec(markup);
  if (at === null) return [];
  const body = markup.slice(at.index, markup.indexOf('</select>', at.index));
  return [...body.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1] as string);
};

describe('«بيانات ناقصة» in the grid', () => {
  it('marks a flagged row with the amber pill beside its Name, and only such a row', () => {
    const markup = render();
    const name = cell(row(markup, INTAKE.id), 'name');
    expect(name).toContain('data-register-incomplete="true"');
    expect(name).toContain(t('atm.register.incomplete'));
    for (const other of [OPEN, ENDED, PENDING, UNLINKED, VISIBLE]) {
      expect(cell(row(markup, other.id), 'name'), other.id).not.toContain(
        'data-register-incomplete',
      );
    }
  });

  it('lists what is still empty in its tooltip, and says Operations recorded the row', () => {
    const name = cell(row(render(), INTAKE.id), 'name');
    const tooltip = /data-register-incomplete="true" title="([^"]*)"/.exec(name)?.[1] ?? '';
    expect(tooltip).toContain(t('atm.register.col.model'));
    expect(tooltip).toContain(t('atm.register.group.cassettes'));
    // The reader cannot see this row's keys: whether they are empty is not theirs to know.
    expect(tooltip).not.toContain(t('atm.register.group.keys'));
    expect(tooltip).not.toContain(t('atm.register.col.area'));
    expect(tooltip).toContain(t('atm.register.source.operations'));
    expect(row(render(), INTAKE.id)).toContain('data-register-source="operations"');
    // The Name's own tooltip says where the row came from too.
    expect(name).toContain(`title="${INTAKE.name ?? ''}\n${t('atm.register.source.operations')}"`);
  });

  it('names the bank of a row by the catalog, a seventh bank included', () => {
    const qnb = entry('650000000000000000000a09', { bankCode: 'QNB' });
    expect(cell(row(render(ALL_KEYS, [qnb]), qnb.id), 'bankCode')).toContain('title="بنك تجريبي"');
  });
});

describe('the «بيانات ناقصة فقط» filter', () => {
  it('reads incomplete=1 from the URL and asks the list — and the export — for incomplete=true', () => {
    const filters = readRegisterFilters(new URLSearchParams('incomplete=1'));
    expect(filters.incomplete).toBe(true);
    // The list and the export send exactly these.
    expect(registerFilterParams(filters)).toEqual({ incomplete: true });
    expect(registerFilterParams(readRegisterFilters(new URLSearchParams('')))).toEqual({});
    const markup = render(ALL_KEYS, [INTAKE], META, {
      url: '/atm/register?incomplete=1',
      filters: { incomplete: true },
    });
    // The page asked the list with incomplete=true (only that cache entry was filled).
    expect(markup).toContain(`data-register-row="${INTAKE.id}"`);
    expect(markup).toMatch(
      /<input(?=[^>]*checked="")(?=[^>]*data-register-filter="incomplete")[^>]*>/,
    );
  });

  it('is remembered with the other filters, and cleared with them', () => {
    const src = readFileSync(join(HERE, 'pages/RegisterPage.tsx'), 'utf8');
    expect(/const REMEMBERED_FILTERS = \[[^\]]*'incomplete'[^\]]*\] as const;/.test(src)).toBe(
      true,
    );
    expect(src).toMatch(/onClear=\{\(\) =>\s*patch\(\{[^}]*incomplete: null/);
  });

  it('takes any well-shaped bank code from the URL — a seventh bank is a real filter', () => {
    expect(readRegisterFilters(new URLSearchParams('bank=NBE,QNB,qnb,X')).banks).toEqual([
      'NBE',
      'QNB',
    ]);
  });

  it('offers every catalog bank, archived ones marked, and a code the catalog lacks', () => {
    const lookup = makeBankLookup(META_BANKS);
    const options = registerBankFilterOptions(lookup, ['ZZZ'], 'ar', t);
    expect(options.map((o) => o.value)).toEqual([
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
      'QNB',
      'OLDB',
      'ZZZ',
    ]);
    expect(options.find((o) => o.value === 'OLDB')?.label).toBe(
      t('atm.bankCatalog.archivedOption', { name: 'OLDB · بنك مؤرشف تجريبي' }),
    );
    expect(options.find((o) => o.value === 'QNB')?.label).toBe('QNB · بنك تجريبي');
  });
});

describe('banks and areas in the entry form', () => {
  it('offers the catalog’s active banks, a seventh included, and never an archived one for a receipt', () => {
    const markup = withForm(<ReceiveEntryDialog meta={META} onClose={() => undefined} />);
    expect(optionsOf(markup, 'bankCode')).toEqual([
      '',
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
      'QNB',
    ]);
  });

  it('keeps an entry’s own archived bank on offer, marked, so an edit can still save it', () => {
    const old = entry('650000000000000000000a0a', { bankCode: 'OLDB' });
    const markup = withForm(<EditEntryDialog entry={old} meta={META} onClose={() => undefined} />);
    expect(optionsOf(markup, 'bankCode')).toContain('OLDB');
    expect(markup).toContain(
      t('atm.bankCatalog.archivedOption', { name: 'OLDB · بنك مؤرشف تجريبي' }),
    );
    const lookup = makeBankLookup(META_BANKS);
    expect(registerBankChoices(lookup, ['QNB2']).map((c) => c.code)).toContain('QNB2');
  });

  it('offers «+» for a bank only to `atmBank.create`', () => {
    const dialog = <ReceiveEntryDialog meta={META} onClose={() => undefined} />;
    expect(withForm(dialog, [...ALL_KEYS, 'atmBank.create'])).toContain('data-register-add="bank"');
    expect(withForm(dialog)).not.toContain('data-register-add="bank"');
  });

  it('offers «+ منطقة» to the register keys and the Operations label keys, and nobody else', () => {
    const edit = <EditEntryDialog entry={OPEN} meta={META} onClose={() => undefined} />;
    expect(withForm(edit, ['atmRegister.edit'])).toContain('data-register-add="area"');
    expect(withForm(edit, ['atmRegister.create'])).toContain('data-register-add="area"');
    expect(withForm(edit, ['atmRefLabel.create'])).toContain('data-register-add="area"');
    expect(withForm(edit, ['atmMachine.manage'])).toContain('data-register-add="area"');
    expect(withForm(edit, ['atmRegister.view'])).not.toContain('data-register-add="area"');
    // A receipt whose branch is not chosen yet has nowhere to file an area.
    const receipt = withForm(<ReceiveEntryDialog meta={withTanta()} onClose={() => undefined} />);
    expect(receipt).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*data-register-add="area")[^>]*>/);
  });

  it('offers the Operations names of the CHOSEN bank only (DEC-25)', () => {
    const markup = withForm(<EditEntryDialog entry={OPEN} meta={META} onClose={() => undefined} />);
    expect(optionsOf(markup, 'opsBankLabel')).toEqual(['', 'NBE FOREX']);
    expect(opsLabelChoices(OPTIONS, 'BM', '')).toEqual(['MISR SPELLING']);
    expect(opsLabelChoices(OPTIONS, 'QNB', '')).toEqual([]);
    expect(opsLabelChoices(OPTIONS, 'NBE', 'OLD LABEL')).toEqual(['NBE FOREX', 'OLD LABEL']);
  });

  it('suggests a labelled area by its stored name, with its name in the reader’s language', () => {
    const markup = withForm(<EditEntryDialog entry={OPEN} meta={META} onClose={() => undefined} />);
    expect(markup).toContain('<option value="SYNTH AREA" label="منطقة تجريبية">');
    expect(markup).toContain('<option value="Typed Area">');
    const suggestions = areaSuggestions(OPTIONS, 'en');
    expect(suggestions).toHaveLength(2);
    // No English name: the Arabic one stands in.
    expect(suggestions).toContainEqual({ value: 'SYNTH AREA', label: 'منطقة تجريبية' });
    expect(suggestions).toContainEqual({ value: 'Typed Area' });
  });

  it('says before the save when a typed area is new to the branch', () => {
    expect(isNewArea(OPTIONS, 'Brand New', null)).toBe(true);
    expect(isNewArea(OPTIONS, ' SYNTH AREA ', null)).toBe(false);
    expect(isNewArea(OPTIONS, 'Typed Area', null)).toBe(false);
    // The entry's own stored value is not new, and nothing is said before the lists answer.
    expect(isNewArea(OPTIONS, 'Legacy', 'Legacy')).toBe(false);
    expect(isNewArea(undefined, 'Brand New', null)).toBe(false);
    expect(t('atm.register.form.newAreaHint')).not.toBe('atm.register.form.newAreaHint');
  });
});

describe('the «بيانات ناقصة» tick of an edit', () => {
  it('opens on the entry’s flag, and sends only a change of it', () => {
    const initial = entryFormValues(INTAKE);
    expect(initial.dataIncomplete).toBe('1');
    expect(updateBody(INTAKE, initial, initial, false)).toEqual({ version: 3 });
    expect(updateBody(INTAKE, initial, { ...initial, dataIncomplete: '' }, false)).toEqual({
      version: 3,
      dataIncomplete: false,
    });
    const plain = entryFormValues(OPEN);
    expect(updateBody(OPEN, plain, { ...plain, dataIncomplete: '1' }, false)).toEqual({
      version: 3,
      dataIncomplete: true,
    });
    // A receipt never sends it: the mark is the server's (intake) or Efficiency's (edit).
    expect(
      receiveBody({ ...entryFormValues(null, ALEX), dataIncomplete: '1' }, false),
    ).not.toHaveProperty('dataIncomplete');
  });

  it('is drawn on an edit — ticked for a flagged row, with the Operations note — never on a receipt', () => {
    const flagged = withForm(
      <EditEntryDialog entry={INTAKE} meta={META} onClose={() => undefined} />,
    );
    expect(flagged).toContain('data-register-incomplete-field="true"');
    expect(flagged).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(flagged).toContain('data-register-operations-note="true"');
    const plain = withForm(<EditEntryDialog entry={OPEN} meta={META} onClose={() => undefined} />);
    expect(plain).toContain('data-register-incomplete-field="true"');
    expect(plain).not.toContain('data-register-operations-note');
    const receipt = withForm(<ReceiveEntryDialog meta={META} onClose={() => undefined} />);
    expect(receipt).not.toContain('data-register-incomplete-field');
  });
});

describe('the delete of an Operations receipt', () => {
  it('says the entry is Operations’ own record of the machine', () => {
    const intake = withForm(<DeleteEntryDialog entry={INTAKE} onClose={() => undefined} />);
    expect(intake).toContain(t('atm.register.form.deleteBodyOperations'));
    const manual = withForm(<DeleteEntryDialog entry={OPEN} onClose={() => undefined} />);
    expect(manual).toContain(t('atm.register.form.deleteBody'));
    expect(manual).not.toContain(t('atm.register.form.deleteBodyOperations'));
  });
});

describe('«البنوك» in the register', () => {
  const bank = (seed: (typeof ATM_BANK_SEED)[number]): AtmBankDto => ({
    id: `65000000000000000000c0${String(seed.sortOrder)}`,
    code: seed.code,
    name: seed.name,
    opsLabel: seed.opsLabel,
    formerOpsLabels: [],
    color: seed.color,
    sortOrder: seed.sortOrder,
    isActive: true,
    isSeed: true,
    hasIdFormat: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const CATALOG = ATM_BANK_SEED.map(bank);

  const catalogDialog = (permissions: readonly string[]): string => {
    const qc = new QueryClient();
    qc.setQueryData(atmBanksKey(), CATALOG);
    return renderToStaticMarkup(
      <Provider store={store(permissions)}>
        <QueryClientProvider client={qc}>
          <BankCatalogDialog open onClose={() => undefined} />
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('opens from the header for whoever keeps the catalog, and for nobody else', () => {
    expect(render([...ALL_KEYS, 'atmBank.edit'])).toContain('data-register-banks="true"');
    expect(render([...ALL_KEYS, 'atmBank.create'])).toContain('data-register-banks="true"');
    expect(render()).not.toContain('data-register-banks');
  });

  it('lists the whole catalog, with add and edit behind their own keys', () => {
    const keeper = catalogDialog(['atmBank.create', 'atmBank.edit']);
    expect(keeper).toContain('data-bank-catalog="true"');
    expect(keeper).toContain(t('atm.bankCatalog.intro'));
    expect(keeper).toContain('البنك التجارى الدولى');
    expect(keeper).toContain('data-bank-catalog-action="add"');
    expect([...keeper.matchAll(/data-edit-action="edit-bank"/g)]).toHaveLength(6);
    const editor = catalogDialog(['atmBank.edit']);
    expect(editor).not.toContain('data-bank-catalog-action="add"');
    expect([...editor.matchAll(/data-edit-action="edit-bank"/g)]).toHaveLength(6);
    const adder = catalogDialog(['atmBank.create']);
    expect(adder).toContain('data-bank-catalog-action="add"');
    expect(adder).not.toContain('data-edit-action="edit-bank"');
  });
});

// ── The branches, as the top bar names them (2026-10-28) ─────────────────────────────────────────
//
// The owner: «أنا عايزك تعتمد التسمية اللى بالعربي والإنجليزي», «الفروع فوق خالص فى البار بتاع
// السيستم غير اللى فى الفلاتر». Below, أكتوبر works as المهندسين (`atm.branchLinks`) and the
// workbook's EGYCASH-1 and EGYCASH-5 both resolve there: the meta lists المهندسين once, with أكتوبر
// among its sources. The names are ECMS's, the ids synthetic.

const MOH = '650000000000000000000101';
const OCT = '650000000000000000000105';
const PORT_SAID = '650000000000000000000106';

const branchOption = (
  over: Partial<AtmRegisterMetaBranchOptionDto> &
    Pick<AtmRegisterMetaBranchOptionDto, 'branchId' | 'name'>,
): AtmRegisterMetaBranchOptionDto => ({
  codes: [],
  sourceBranchIds: [],
  active: true,
  canView: true,
  canCreate: true,
  ...over,
});

const LINKED: AtmRegisterMetaDto = {
  ...META,
  // The server's order is the top bar's (by ECMS code); the page keeps it as it comes.
  branchOptions: [
    branchOption({ branchId: ALEX, name: ALEX_NAME, codes: ['EGYCASH-4'] }),
    branchOption({
      branchId: MOH,
      name: { ar: 'المهندسين', en: 'Mohandessin' },
      codes: ['EGYCASH-1', 'EGYCASH-5'],
      sourceBranchIds: [OCT],
    }),
    // Outside what the top bar's choice lets this reader see or receive in.
    branchOption({
      branchId: TANTA,
      name: { ar: 'طنطا', en: 'Tanta' },
      codes: ['EGYCASH-2'],
      canView: false,
      canCreate: false,
    }),
    // No longer active in ECMS: its rows stay findable, nothing new is received there.
    branchOption({
      branchId: PORT_SAID,
      name: { ar: 'بورسعيد', en: 'Port Said' },
      codes: ['EGYCASH-6'],
      active: false,
    }),
  ],
};

/** One select's options as [value, text], the select found by its opening tag. */
const selectOptions = (markup: string, opening: RegExp): [string, string][] => {
  const at = opening.exec(markup);
  if (at === null) return [];
  const body = markup.slice(at.index, markup.indexOf('</select>', at.index));
  return [...body.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [
    m[1] as string,
    m[2] as string,
  ]);
};
const BRANCH_FILTER = /<select[^>]*aria-label="الفرع"[^>]*>/;
const RECEIPT_BRANCH = /<select[^>]*id="[^"]*-branchId"[^>]*>/;

describe('the branches, as the top bar names them', () => {
  it('names a row’s branch in its cell and tooltip by its ECMS name — never its code', () => {
    const named = entry('650000000000000000000a0b', {
      branchId: MOH,
      branchCode: 'EGYCASH-1',
      branchName: { ar: 'فرع تجريبي', en: 'Synthetic branch' },
    });
    const ar = cell(row(render(ALL_KEYS, [named, BRANCHLESS]), named.id), 'branchCode');
    expect(ar).toContain('title="فرع تجريبي"');
    expect(ar).toContain('<span dir="auto">فرع تجريبي</span>');
    // Not the workbook's name for the code, and not the code.
    expect(ar).not.toContain('المهندسين');
    expect(ar).not.toContain('EGYCASH');
    const en = cell(row(render(ALL_KEYS, [named], META, { locale: 'en' }), named.id), 'branchCode');
    expect(en).toContain('title="Synthetic branch"');
    // A branch-less imported row (a blank column A) reads as a dash.
    const blank = cell(row(render(ALL_KEYS, [named, BRANCHLESS]), BRANCHLESS.id), 'branchCode');
    expect(blank).toContain('title="—"');
  });

  it('writes no EGYCASH code anywhere on the page', () => {
    expect(render(ALL_KEYS, ROWS, LINKED)).not.toContain('EGYCASH');
    expect(render(ALL_KEYS, ROWS, LINKED, { locale: 'en' })).not.toContain('EGYCASH');
  });

  it('filters by the branches the server offers: ECMS names alone, in its order, viewable only', () => {
    expect(selectOptions(render(ALL_KEYS, ROWS, LINKED), BRANCH_FILTER)).toEqual([
      ['', t('atm.register.filter.allBranches')],
      [ALEX, 'الإسكندرية'],
      [MOH, 'المهندسين'],
      [PORT_SAID, 'بورسعيد'],
    ]);
    expect(viewableBranches(LINKED).map((b) => b.branchId)).toEqual([ALEX, MOH, PORT_SAID]);
  });

  it('reads a filter remembered on a linked source as the branch it works as', () => {
    const choices = viewableBranches(LINKED);
    expect(registerBranchFilterValue(choices, OCT)).toBe(MOH);
    expect(registerBranchFilterValue(choices, MOH)).toBe(MOH);
    expect(registerBranchFilterValue(choices, '')).toBe('');
    const markup = render(ALL_KEYS, ROWS, LINKED, {
      url: `/atm/register?branch=${OCT}`,
      filters: { branchId: OCT },
    });
    expect(markup).toContain(`<option value="${MOH}" selected="">المهندسين</option>`);
  });

  // The options follow the top bar, so a filter chosen under another top-bar choice (or a link
  // from another reader's view) can name a branch no option stands for: the select read «كل
  // الفروع» while the list stayed narrowed to it and answered empty (review finding). The page
  // drops such a filter once the meta has answered.
  it('drops a branch filter the server no longer offers — once the meta has answered', () => {
    expect(
      strayRegisterBranch(LINKED, TANTA),
      'outside what the top bar lets this reader see',
    ).toBe(true);
    expect(strayRegisterBranch(LINKED, '650000000000000000000199'), 'a branch never offered').toBe(
      true,
    );
    expect(strayRegisterBranch(LINKED, OCT), 'a linked source reads as its target').toBe(false);
    expect(strayRegisterBranch(LINKED, MOH)).toBe(false);
    expect(strayRegisterBranch(LINKED, PORT_SAID), 'inactive, still findable').toBe(false);
    expect(strayRegisterBranch(LINKED, '')).toBe(false);
    expect(strayRegisterBranch(undefined, TANTA), 'nothing known before the meta').toBe(false);
  });

  it('receives in the active branches the reader may create in, each named once', () => {
    const markup = withForm(<ReceiveEntryDialog meta={LINKED} onClose={() => undefined} />);
    expect(selectOptions(markup, RECEIPT_BRANCH)).toEqual([
      ['', t('common.select')],
      [ALEX, 'الإسكندرية'],
      [MOH, 'المهندسين'],
    ]);
  });

  it('starts a receipt on a top bar set to a linked source on the branch it works as', () => {
    expect(defaultReceiptBranch(LINKED, OCT)).toBe(MOH);
    expect(defaultReceiptBranch(LINKED, MOH)).toBe(MOH);
    expect(defaultReceiptBranch(LINKED, null), 'two to choose from').toBe('');
    expect(defaultReceiptBranch(LINKED, TANTA), 'not one this reader receives in').toBe('');
  });

  it('shows an edited entry’s branch by the ECMS name of where it is filed, read-only', () => {
    const filed = entry('650000000000000000000a0c', {
      branchId: OCT,
      branchCode: 'EGYCASH-1',
      branchName: { ar: 'أكتوبر', en: 'October' },
    });
    const markup = withForm(
      <EditEntryDialog entry={filed} meta={LINKED} onClose={() => undefined} />,
    );
    const box = /<input[^>]*id="[^"]*-branchId"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(box).toContain('value="أكتوبر"');
    expect(box).toContain('disabled=""');
    expect(markup).not.toContain('EGYCASH');
    const blank = withForm(
      <EditEntryDialog entry={BRANCHLESS} meta={LINKED} onClose={() => undefined} />,
    );
    expect(/<input[^>]*id="[^"]*-branchId"[^>]*>/.exec(blank)?.[0]).toContain('value="—"');
  });

  it('lets the per-code rows stand in for an older server that sends no branch list', () => {
    const older: AtmRegisterMetaDto = {
      ...META,
      branches: [
        ...META.branches,
        {
          code: 'EGYCASH-3',
          name: { ar: 'أسيوط', en: 'Asyut' },
          branchId: null,
          branchName: null,
          branchActive: false,
          canView: false,
          canCreate: false,
        },
      ],
    };
    delete older.branchOptions;
    expect(registerBranchChoices(older)).toEqual([
      {
        branchId: ALEX,
        name: ALEX_NAME,
        codes: ['EGYCASH-4'],
        sourceBranchIds: [],
        active: true,
        canView: true,
        canCreate: true,
      },
    ]);
    expect(defaultReceiptBranch(older, ALEX)).toBe(ALEX);
    expect(registerBranchChoices(undefined)).toEqual([]);
  });
});
