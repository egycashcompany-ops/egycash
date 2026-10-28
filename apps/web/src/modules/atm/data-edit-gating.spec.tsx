// The data-edit split (spec §8.4, owner decision D2) as each reader meets /atm/data-edit: rendered
// from a pre-filled query cache, the way the register page is pinned (register-page.spec.tsx).
// The server enforces the split (atm-data-edit-permissions.spec.ts); this pins that the page offers
// each reader exactly the controls their keys allow:
//   · Operations: bank spellings and areas can be added, renamed and archived, and a machine can be
//     moved to another area. No machine add, no bulk add or delete-by-codes, no archive, no delete.
//   · `atmMachine.manage`: everything, exactly as before the split — the add stays its own.
//   · the bank CATALOG tab (DEC-35): add under `atmBank.create`, edit under `atmBank.edit`, and
//     neither Operations' keys nor `manage` reach it — it belongs to Efficiency and the admins.
//
// Every code, name and label below is synthetic.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import {
  ATM_BANK_SEED,
  UpdateAtmMachineAreaSchema,
  type AtmBankDto,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { ATM_DATA_TABS, DataEditPage, type AtmDataTab } from './pages/DataEditPage';
import { atmBanksKey, atmRefLabelOptionsKey } from './api/atm-queries';
import {
  MachineAreaDialog,
  MachineDialog,
  RefLabelDialog,
  machineAreaBody,
  refLabelErrorText,
} from './components/DataEditDialogs';
import { ApiError } from '../../shared/lib/api-client';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const ALEX = '650000000000000000000104';
const STAMP = '2026-01-12T08:00:00.000Z';

const machine = (n: number, over: Partial<AtmMachineDto> = {}): AtmMachineDto => ({
  id: `650000000000000000000b0${String(n)}`,
  branchId: ALEX,
  bankName: 'SYN BANK',
  machineCode: `9999000${String(n)}`,
  name: `Synthetic ATM 0${String(n)}`,
  zone: '',
  area: 'SYN AREA NORTH',
  isActive: true,
  version: 4,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

const label = (
  n: number,
  name: string,
  isActive = true,
  over: Partial<AtmRefLabelDto> = {},
): AtmRefLabelDto => ({
  id: `650000000000000000000c0${String(n)}`,
  branchId: ALEX,
  kind: 'bank',
  name,
  nameAr: null,
  nameEn: null,
  formerNames: [],
  bankCode: null,
  origin: 'manual',
  isActive,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

const MACHINES = [machine(1), machine(2, { isActive: false })];
/** The «أسماء البنوك في التشغيل» tab: spellings of catalog banks. */
const BANKS = [
  label(1, 'SYN BANK', true, { bankCode: 'NBE' }),
  label(2, 'SYN BANK B', true, { bankCode: 'BM' }),
  label(3, 'SYN BANK OLD', false),
];
const AREAS = [
  label(4, 'SYN AREA NORTH', true, { kind: 'area' }),
  label(5, 'SYN AREA SOUTH', true, { kind: 'area' }),
  label(6, 'SYN AREA OLD', false, { kind: 'area' }),
];
const ACTIVE_AREAS = AREAS.filter((a) => a.isActive);

/** `GET /atm/banks`: the six seeds, as the catalog holds them. */
const CATALOG: AtmBankDto[] = ATM_BANK_SEED.map((seed) => ({
  id: `650000000000000000000d${String(seed.sortOrder)}`,
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
  createdAt: STAMP,
  updatedAt: STAMP,
}));

/** `GET /atm/ref-labels/options?branchId=ALEX` — what the machine dialogs offer. */
const OPTIONS: AtmRefLabelOptionsDto = {
  branchId: ALEX,
  registerMapped: true,
  banks: [
    { value: 'NBE', bankCode: 'NBE', kind: 'bank' },
    { value: 'MISR', bankCode: 'BM', kind: 'bank' },
    { value: 'SYN BANK', bankCode: 'NBE', kind: 'spelling' },
    { value: 'SYN BANK B', bankCode: 'BM', kind: 'spelling' },
  ],
  areas: ACTIVE_AREAS.map((a) => ({ name: a.name, nameAr: null, nameEn: null })),
  unmappedBankNames: [],
};

/** The Operations bundle of §12.3: reads the machines, keeps the lists, moves a machine. */
const OPERATIONS = [
  'atmMachine.view',
  'atmRefLabel.create',
  'atmRefLabel.edit',
  'atmMachine.moveArea',
];
const MANAGE = ['atmMachine.view', 'atmMachine.manage'];
const VIEW_ONLY = 'atmMachine.view';

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

const page = <T,>(rows: T[]): Paginated<T> => ({
  items: rows,
  meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
});

const wrap = (
  permissions: readonly string[],
  qc: QueryClient,
  node: ReactNode,
  url = '/',
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The page on one tab, every list it asks for already answered. */
const renderPage = (permissions: readonly string[], tab: AtmDataTab = 'machines'): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = { page: 1, pageSize: 25, sortDir: 'asc' };
  qc.setQueryData(listKey('atm', 'machines', { ...first, sortBy: 'machineCode' }), page(MACHINES));
  for (const [kind, rows] of [
    ['bank', BANKS],
    ['area', AREAS],
  ] as const) {
    qc.setQueryData(listKey('atm', 'refLabels', { kind, ...first, sortBy: 'name' }), page(rows));
  }
  qc.setQueryData(atmBanksKey(), CATALOG);
  qc.setQueryData(atmRefLabelOptionsKey(null), { ...OPTIONS, branchId: ALEX });
  const url = tab === 'machines' ? '/atm/data-edit' : `/atm/data-edit?tab=${tab}`;
  return wrap(permissions, qc, <DataEditPage />, url);
};

/** A dialog, the catalog and the machine's branch's options already answered. */
const renderDialog = (permissions: readonly string[], node: ReactNode): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBanksKey(), CATALOG);
  qc.setQueryData(atmRefLabelOptionsKey(ALEX), OPTIONS);
  return wrap(permissions, qc, node);
};

/** Every gated control on the screen, by kind, in document order. */
const actions = (markup: string): string[] =>
  [...markup.matchAll(/data-edit-action="([^"]+)"/g)].map((m) => m[1] as string);
const count = (markup: string, action: string): number =>
  actions(markup).filter((a) => a === action).length;

/** The one opening tag of the element carrying `attr="value"`. */
const tagWith = (markup: string, element: string, attr: string, value: string): string =>
  new RegExp(`<${element}[^>]*${attr}="${value}"[^>]*>`).exec(markup)?.[0] ?? '';

describe('Operations: the machines tab is read-only except for the area move', () => {
  it('offers one area move per row and no add, bulk, edit or delete', () => {
    const markup = renderPage(OPERATIONS);
    // The rows are there, so a missing button means a gate and not an empty table.
    for (const m of MACHINES) expect(markup).toContain(m.machineCode);
    expect(count(markup, 'move-area')).toBe(MACHINES.length);
    for (const absent of ['add-machine', 'bulk', 'edit-machine', 'delete-machine']) {
      expect(actions(markup), absent).not.toContain(absent);
    }
    expect(markup).not.toContain(t('atm.dataEdit.bulkTitle'));
    expect(markup).not.toContain(t('atm.dataEdit.addMachine'));
    expect(markup).not.toContain(t('atm.dataEdit.deleteMachine'));
    expect(tagWith(markup, 'button', 'data-edit-action', 'move-area')).toContain(
      `aria-label="${t('atm.dataEdit.moveArea')}"`,
    );
  });

  it.each(['bankLabel', 'area'] as const)(
    'may add, rename and archive on the %s tab, and delete nothing',
    (tab) => {
      const markup = renderPage(OPERATIONS, tab);
      const rows = tab === 'bankLabel' ? BANKS : AREAS;
      for (const r of rows) expect(markup).toContain(r.name);
      expect(count(markup, 'add-label')).toBe(1);
      expect(markup).toContain(
        t(tab === 'bankLabel' ? 'atm.dataEdit.addSpelling' : 'atm.dataEdit.addArea'),
      );
      expect(count(markup, 'edit-label')).toBe(rows.length);
      expect(actions(markup).filter((a) => a !== 'add-label' && a !== 'edit-label')).toEqual([]);
    },
  );

  it('the bank catalog is not theirs: rows to read, nothing to add or edit', () => {
    const markup = renderPage(OPERATIONS, 'bank');
    for (const bank of CATALOG) expect(markup).toContain(bank.name.ar);
    expect(actions(markup)).toEqual([]);
  });
});

describe('the four tabs (DEC-35, DEC-38)', () => {
  it('machines, the bank catalog, the Operations bank names and the areas, in that order', () => {
    const markup = renderPage(OPERATIONS);
    const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map(
      (m) => m[1],
    );
    expect(ATM_DATA_TABS).toEqual(['machines', 'bank', 'bankLabel', 'area']);
    expect(tabs).toEqual(ATM_DATA_TABS.map((key) => t(`atm.dataEdit.tab.${key}`)));
    expect(tabs[2]).toBe('أسماء البنوك في التشغيل');
  });

  it('a spelling shows its bank, or «غير مربوط ببنك» when it is linked to none', () => {
    const markup = renderPage(OPERATIONS, 'bankLabel');
    expect(markup).toContain('البنك الأهلي المصري');
    expect(markup).toContain('بنك مصر');
    expect(markup).toContain(t('atm.dataEdit.notLinked'));
  });
});

describe('each Operations key opens only its own control', () => {
  const VIEW = 'atmMachine.view';

  it('atmRefLabel.create alone: add a bank name or an area, nothing else', () => {
    const keys = [VIEW, 'atmRefLabel.create'];
    expect(actions(renderPage(keys, 'bankLabel'))).toEqual(['add-label']);
    expect(actions(renderPage(keys, 'area'))).toEqual(['add-label']);
    expect(actions(renderPage(keys, 'bank'))).toEqual([]);
    expect(actions(renderPage(keys))).toEqual([]);
  });

  it('atmRefLabel.edit alone: rename and archive the labels, add none', () => {
    const keys = [VIEW, 'atmRefLabel.edit'];
    expect(actions(renderPage(keys, 'area'))).toEqual(AREAS.map(() => 'edit-label'));
    expect(actions(renderPage(keys))).toEqual([]);
  });

  it('atmMachine.moveArea alone: the area move, and the lists stay read-only', () => {
    const keys = [VIEW, 'atmMachine.moveArea'];
    expect(actions(renderPage(keys))).toEqual(MACHINES.map(() => 'move-area'));
    expect(actions(renderPage(keys, 'bankLabel'))).toEqual([]);
    expect(actions(renderPage(keys, 'bank'))).toEqual([]);
  });

  it('a reader with no write key gets no actions column at all', () => {
    for (const tab of ATM_DATA_TABS) {
      const markup = renderPage([VIEW], tab);
      expect(actions(markup), tab).toEqual([]);
      expect(markup, tab).not.toContain(t('atm.dataEdit.actions'));
    }
  });
});

describe('the bank catalog tab: its own two keys (DEC-39)', () => {
  it('atmBank.create alone: «إضافة بنك», and no edit', () => {
    const markup = renderPage([VIEW_ONLY, 'atmBank.create'], 'bank');
    expect(actions(markup)).toEqual(['add-bank']);
    expect(markup).toContain(t('atm.bankCatalog.add'));
  });

  it('atmBank.edit alone: the edit on every bank, and no add', () => {
    expect(actions(renderPage([VIEW_ONLY, 'atmBank.edit'], 'bank'))).toEqual(
      CATALOG.map(() => 'edit-bank'),
    );
  });

  it('the table names each bank in both languages, with its Operations label and colour', () => {
    const markup = renderPage([VIEW_ONLY], 'bank');
    for (const bank of CATALOG) {
      expect(markup).toContain(bank.name.ar);
      expect(markup).toContain(bank.name.en);
      expect(markup).toContain(`background-color:${bank.color}`);
    }
    expect(markup).toContain('MISR');
  });

  it('`manage` does not reach the catalog: the machines tab is still where its add lives', () => {
    expect(actions(renderPage(MANAGE, 'bank'))).toEqual([]);
    expect(count(renderPage(MANAGE), 'add-machine')).toBe(1);
  });
});

describe('the area move dialog', () => {
  const M = machine(1);

  it('shows the code and name read-only and offers only the active areas: no bank, no archive', () => {
    const markup = renderDialog(
      OPERATIONS,
      <MachineAreaDialog open onClose={() => undefined} machine={M} />,
    );
    expect(markup).toContain(t('atm.dataEdit.moveAreaTitle', { code: M.machineCode }));
    expect(markup).toContain(t('atm.dataEdit.moveAreaHint'));
    expect(tagWith(markup, 'input', 'value', M.machineCode)).toContain('disabled=""');
    expect(tagWith(markup, 'input', 'value', M.name)).toContain('disabled=""');
    const options = [...markup.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
    expect(options).toEqual(['', ...ACTIVE_AREAS.map((a) => a.name)]);
    expect(tagWith(markup, 'option', 'value', M.area)).toContain('selected=""');
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain(t('atm.dataEdit.isActive'));
    expect(markup).not.toContain(t('atm.dataEdit.pickBank'));
    // Nothing to save until another area is picked.
    expect(tagWith(markup, 'button', 'type', 'submit')).toContain('disabled=""');
  });

  it('opens on an archived area as it is, without letting it be picked again', () => {
    const archived = machine(1, { area: 'SYN AREA OLD' });
    const markup = renderDialog(
      OPERATIONS,
      <MachineAreaDialog open onClose={() => undefined} machine={archived} />,
    );
    const current = tagWith(markup, 'option', 'value', 'SYN AREA OLD');
    expect(current).toContain('selected=""');
    expect(current).toContain('disabled=""');
  });

  it('sends the new area and the row version, nothing else', () => {
    const body = machineAreaBody(M, 'SYN AREA SOUTH');
    expect(body).toEqual({ area: 'SYN AREA SOUTH', version: M.version });
    expect(UpdateAtmMachineAreaSchema.safeParse(body).success).toBe(true);
  });
});

describe('atmMachine.manage keeps everything it had (regression)', () => {
  it('the machines tab: bulk, add, the full edit and the delete on every row', () => {
    const markup = renderPage(MANAGE);
    expect(count(markup, 'bulk')).toBe(1);
    expect(count(markup, 'add-machine')).toBe(1);
    expect(count(markup, 'edit-machine')).toBe(MACHINES.length);
    expect(count(markup, 'delete-machine')).toBe(MACHINES.length);
    expect(count(markup, 'move-area')).toBe(0);
    expect(markup).toContain(t('atm.dataEdit.bulkTitle'));
    expect(markup).toContain(t('atm.dataEdit.addMachine'));
  });

  it('holding moveArea too changes nothing: the area is part of the full edit', () => {
    const markup = renderPage([...MANAGE, 'atmMachine.moveArea']);
    expect(count(markup, 'edit-machine')).toBe(MACHINES.length);
    expect(count(markup, 'move-area')).toBe(0);
  });

  it.each(['bankLabel', 'area'] as const)('the %s tab: add and edit', (tab) => {
    const markup = renderPage(MANAGE, tab);
    expect(count(markup, 'add-label')).toBe(1);
    expect(count(markup, 'edit-label')).toBe((tab === 'bankLabel' ? BANKS : AREAS).length);
  });

  it('the full machine edit still carries the bank and the archive switch', () => {
    const markup = renderDialog(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={machine(1)} />,
    );
    expect(markup).toContain(t('atm.dataEdit.pickBank'));
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain(t('atm.dataEdit.isActive'));
  });
});

describe('the label edit Operations now reach', () => {
  it('renames and toggles the archive, with no delete in it', () => {
    const markup = renderDialog(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="area" label={AREAS[0] ?? null} />,
    );
    expect(markup).toContain(t('atm.dataEdit.editArea'));
    expect(markup).toContain(t('atm.dataEdit.labelName'));
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain(t('atm.dataEdit.labelActiveHint'));
    expect(markup).not.toContain(t('atm.common.delete'));
  });
});

// Review finding F1: every refused label save used to read "already exists".
describe('a refused label save says why', () => {
  const tr = (key: string): string => translate('ar', key);
  it('"already exists" only for the duplicate; a refusal of reach says it is not allowed', () => {
    expect(refLabelErrorText(new ApiError('CONFLICT', 'duplicate', 409), tr, 'ar')).toBe(
      tr('atm.dataEdit.labelExists'),
    );
    const forbidden = refLabelErrorText(new ApiError('FORBIDDEN', 'Forbidden', 403), tr, 'ar');
    expect(forbidden).not.toBe(tr('atm.dataEdit.labelExists'));
    expect(forbidden).toBe('ليس لديك صلاحية للقيام بذلك.');
  });
});
