// The data-edit split (spec §8.4, owner decision D2) as each reader meets /atm/data-edit: rendered
// from a pre-filled query cache, the way the register page is pinned (register-page.spec.tsx).
// The server enforces the split (atm-data-edit-permissions.spec.ts); this pins that the page offers
// each reader exactly the controls their keys allow:
//   · Operations: banks and areas can be added, renamed and archived, and a machine can be moved to
//     another area. No machine add, no bulk add or delete-by-codes, no archive, no delete.
//   · `atmMachine.manage`: everything, exactly as before the split.
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
  MAX_PAGE_SIZE,
  UpdateAtmMachineAreaSchema,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { DataEditPage, type AtmDataTab } from './pages/DataEditPage';
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

const label = (n: number, name: string, isActive = true): AtmRefLabelDto => ({
  id: `650000000000000000000c0${String(n)}`,
  branchId: ALEX,
  name,
  isActive,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const MACHINES = [machine(1), machine(2, { isActive: false })];
const BANKS = [label(1, 'SYN BANK'), label(2, 'SYN BANK B'), label(3, 'SYN BANK OLD', false)];
const AREAS = [
  label(4, 'SYN AREA NORTH'),
  label(5, 'SYN AREA SOUTH'),
  label(6, 'SYN AREA OLD', false),
];
const ACTIVE_AREAS = AREAS.filter((a) => a.isActive);

/** The Operations bundle of §12.3: reads the machines, keeps the lists, moves a machine. */
const OPERATIONS = [
  'atmMachine.view',
  'atmRefLabel.create',
  'atmRefLabel.edit',
  'atmMachine.moveArea',
];
const MANAGE = ['atmMachine.view', 'atmMachine.manage'];

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
    // The dialogs' pick lists: the full ACTIVE list of each kind.
    qc.setQueryData(
      listKey('atm', 'refLabels', {
        kind,
        pageSize: MAX_PAGE_SIZE,
        sortBy: 'name',
        sortDir: 'asc',
        isActive: true,
      }),
      page(rows.filter((r) => r.isActive)),
    );
  }
  const url = tab === 'machines' ? '/atm/data-edit' : `/atm/data-edit?tab=${tab}`;
  return wrap(permissions, qc, <DataEditPage />, url);
};

const renderDialog = (permissions: readonly string[], node: ReactNode): string =>
  wrap(permissions, new QueryClient(), node);

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

  it.each(['bank', 'area'] as const)(
    'may add, rename and archive on the %s tab, and delete nothing',
    (tab) => {
      const markup = renderPage(OPERATIONS, tab);
      const rows = tab === 'bank' ? BANKS : AREAS;
      for (const r of rows) expect(markup).toContain(r.name);
      expect(count(markup, 'add-label')).toBe(1);
      expect(markup).toContain(t(tab === 'bank' ? 'atm.dataEdit.addBank' : 'atm.dataEdit.addArea'));
      expect(count(markup, 'edit-label')).toBe(rows.length);
      expect(actions(markup).filter((a) => a !== 'add-label' && a !== 'edit-label')).toEqual([]);
    },
  );
});

describe('each Operations key opens only its own control', () => {
  const VIEW = 'atmMachine.view';

  it('atmRefLabel.create alone: add a bank or an area, nothing else', () => {
    const keys = [VIEW, 'atmRefLabel.create'];
    expect(actions(renderPage(keys, 'bank'))).toEqual(['add-label']);
    expect(actions(renderPage(keys, 'area'))).toEqual(['add-label']);
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
    expect(actions(renderPage(keys, 'bank'))).toEqual([]);
  });

  it('a reader with no write key gets no actions column at all', () => {
    for (const tab of ['machines', 'bank', 'area'] as const) {
      const markup = renderPage([VIEW], tab);
      expect(actions(markup), tab).toEqual([]);
      expect(markup, tab).not.toContain(t('atm.dataEdit.actions'));
    }
  });
});

describe('the area move dialog', () => {
  const M = machine(1);

  it('shows the code and name read-only and offers only the active areas: no bank, no archive', () => {
    const markup = renderDialog(
      OPERATIONS,
      <MachineAreaDialog open onClose={() => undefined} machine={M} areas={ACTIVE_AREAS} />,
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
      <MachineAreaDialog open onClose={() => undefined} machine={archived} areas={ACTIVE_AREAS} />,
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

  it.each(['bank', 'area'] as const)('the %s tab: add and edit', (tab) => {
    const markup = renderPage(MANAGE, tab);
    expect(count(markup, 'add-label')).toBe(1);
    expect(count(markup, 'edit-label')).toBe((tab === 'bank' ? BANKS : AREAS).length);
  });

  it('the full machine edit still carries the bank and the archive switch', () => {
    const markup = renderDialog(
      MANAGE,
      <MachineDialog
        open
        onClose={() => undefined}
        machine={machine(1)}
        banks={BANKS.filter((b) => b.isActive)}
        areas={ACTIVE_AREAS}
      />,
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
