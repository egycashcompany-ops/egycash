// The register page (spec §8.3) as a reader meets it: rendered from a pre-filled query cache, the
// way the fleet dashboard is pinned (fleet-dashboard.spec.tsx). What a reader may SEE is the
// server's decision; what this pins is that the page shows that decision faithfully — the hidden
// key columns stay hidden, the combination is never drawn whatever arrives, a handed-back row is
// dark green in every cell, and each row offers exactly the actions its state and the reader's keys
// allow.
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
  type AtmRegisterCassettesDto,
  type AtmRegisterEntryDto,
  type AtmRegisterMetaDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { RegisterPage } from './pages/RegisterPage';
import { HandoverDialog, handoverBody } from './components/register/HandoverDialog';
import { registerRowActions } from './components/register/RegisterRowActions';
import {
  entryEditRules,
  entryFormValues,
  receiveBody,
  updateBody,
} from './components/register/EntryFormSections';
import { EditEntryDialog } from './components/register/EditEntryDialog';
import { ReceiveEntryDialog, defaultReceiptBranch } from './components/register/ReceiveEntryDialog';
import { REGISTER_ENDED_ROW } from './lib/register-grid';
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

const ROWS = [OPEN, ENDED, PENDING, UNLINKED, BRANCHLESS, VISIBLE];

const META: AtmRegisterMetaDto = {
  banks: [
    {
      code: 'NBE',
      name: { ar: 'البنك الأهلي المصري', en: 'NBE' },
      opsLabel: 'NBE',
      color: '#385723',
    },
  ],
  branches: [
    {
      code: 'EGYCASH-4',
      name: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchId: ALEX,
      branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchActive: true,
      canView: true,
      canCreate: true,
    },
  ],
};

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

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
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
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The page's own first question: page 1, 25 rows, no filter, no sort (the sheet's order).
  qc.setQueryData(listKey('atm', 'registerEntries', { page: 1, pageSize: 25 }), page(rows));
  qc.setQueryData(listKey('atm', 'registerMeta'), meta);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/register']}>
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
      ['area', 87],
      ['bankCode', 208],
      ['machineCode', 280],
      ['name', 377],
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
      branches: META.branches.map((b) => ({ ...b, branchId: null, branchName: null })),
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
    expect(markup).toContain(t('common.list.count', { count: '٦' }));
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
    const two: AtmRegisterMetaDto = {
      ...META,
      branches: [
        ...META.branches,
        {
          ...(META.branches[0] as AtmRegisterMetaDto['branches'][number]),
          code: 'EGYCASH-2',
          branchId: '650000000000000000000102',
        },
      ],
    };
    expect(defaultReceiptBranch(two, null), 'a choice to make').toBe('');
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
