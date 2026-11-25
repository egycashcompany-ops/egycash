// The warehouse register «المخازن» and its form, proven against what they render (design §13.6
// A, D, E): the board frame; the keeper as HR answers today — named, marked when they have left,
// flagged when HR no longer knows them; an edit offered only where the server says it would be
// taken (`canEdit`); the branch filter offering only the branches the reader may read, and a
// stray remembered branch never asked for; and the form — the branch chosen once, from the
// branches a store may be opened in, and the keeper through the module's own picker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  departmentOptionsKey,
  warehouseBranchOptionsKey,
  warehouseListKey,
} from '../api/administration-keys';
import {
  ar,
  branchOption,
  headings,
  pageOf,
  renderScreen,
  rowOf,
  text,
  warehouse,
} from '../screen-fixtures';
import { WarehouseFormDialog, storedKeeperLabel } from '../components/WarehouseFormDialog';
import { refusalFieldKeys } from '../lib/refusals';
import { WarehousesPage, strayBranch, viewableBranches } from './WarehousesPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'WarehousesPage.tsx'), 'utf8');
const FORM = readFileSync(join(HERE, '../components/WarehouseFormDialog.tsx'), 'utf8');

const FIRST_PAGE = { page: 1, pageSize: 25, isActive: true };
const KEPT = warehouse();
const LEFT = warehouse({
  id: 'w-2',
  code: 'CAI-02',
  name: { ar: 'مخزن الأدوات', en: 'Tools store' },
  type: 'sub',
  responsibleEmployeeId: 'e-2',
  keeper: { employeeId: 'e-2', code: '0100077', fullNameAr: 'هالة فوزي رشدي', status: 'exited' },
  canEdit: false,
});
const UNKNOWN = warehouse({
  id: 'w-3',
  code: 'ALX-01',
  name: { ar: 'مخزن الإسكندرية', en: 'Alexandria store' },
  branchId: 'b-alx',
  branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
  type: 'branch',
  responsibleEmployeeId: 'e-9',
  keeper: null,
});
const NONE = warehouse({
  id: 'w-4',
  code: 'ALX-02',
  name: { ar: 'مخزن الأرشيف', en: 'Archive store' },
  responsibleEmployeeId: null,
  keeper: null,
});
const OPTIONS = [
  branchOption(),
  branchOption({
    branchId: 'b-alx',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
    canCreate: false,
  }),
  // A branch outside the reader's view: never offered by the filter.
  branchOption({
    branchId: 'b-tnt',
    name: { ar: 'طنطا', en: 'Tanta' },
    canView: false,
    canCreate: false,
  }),
];

const render = (
  keys: string[] = ['administrationWarehouse.view'],
  path = '/administration/warehouses',
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [warehouseListKey(FIRST_PAGE), pageOf([KEPT, LEFT, UNKNOWN, NONE])],
  ],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <WarehousesPage />,
    route: '/administration/warehouses',
    path,
    keys,
    seed: [[warehouseBranchOptionsKey(), OPTIONS], ...seed],
    failing,
  });

describe('the warehouse register', () => {
  it('wears the board frame, its table filling the rest', () => {
    expect(SOURCE).toContain('<PageContainer fullHeight>');
    expect(SOURCE).toContain('<div className={BOARD_FRAME}>');
    expect(SOURCE).toContain('<div className={BOARD_TABLE_FILL}>');
    expect(SOURCE).not.toContain('BOARD_TABLE_FILL_LOW');
  });

  it('lists the columns in order, under its sidebar row’s title', () => {
    const html = render();
    expect(text(html)).toContain(ar('administration.nav.warehouses'));
    expect(headings(html)).toEqual([
      ar('administration.warehouses.columns.code'),
      ar('administration.warehouses.columns.name'),
      ar('administration.warehouses.columns.branch'),
      ar('administration.warehouses.columns.type'),
      ar('administration.warehouses.columns.keeper'),
      ar('administration.warehouses.columns.status'),
      ar('administration.warehouses.columns.actions'),
    ]);
    const cells = rowOf(html, 'CAI-01');
    expect(text(cells[2] ?? '')).toBe('القاهرة');
    expect(text(cells[3] ?? '')).toBe(ar('administration.warehouses.type.main'));
  });

  it('names the keeper as HR answers today — marked when they left, flagged when HR does not know them', () => {
    const html = render();
    const kept = rowOf(html, 'CAI-01')[4] ?? '';
    expect(kept).toContain('سامح عادل منير');
    expect(kept).toContain('0100052');
    expect(kept).not.toContain(ar('administration.people.exited'));
    const left = rowOf(html, 'CAI-02')[4] ?? '';
    expect(left).toContain('هالة فوزي رشدي');
    expect(left).toContain(ar('administration.people.exited'));
    const unknown = rowOf(html, 'ALX-01')[4] ?? '';
    expect(unknown).toContain('data-keeper-unknown');
    expect(text(unknown)).toBe(ar('administration.warehouses.keeperUnknown'));
    expect(text(rowOf(html, 'ALX-02')[4] ?? '')).toBe('—');
  });

  it('offers a row’s edit where the server says the edit would be taken, whatever the keys say', () => {
    const html = render(['administrationWarehouse.view', 'administrationWarehouse.edit']);
    const label = (name: string): string =>
      `aria-label="${ar('administration.warehouses.edit')} — ${name}"`;
    expect(rowOf(html, 'CAI-01')[6]).toContain(label('مخزن القاهرة الرئيسي'));
    expect(rowOf(html, 'CAI-02')[6]).not.toContain(label('مخزن الأدوات'));
    expect(SOURCE).toContain('row.canEdit ?');
  });

  it('offers «add» only to a holder of the create key', () => {
    expect(render()).not.toContain(ar('administration.warehouses.create'));
    expect(render(['administrationWarehouse.view', 'administrationWarehouse.create'])).toContain(
      ar('administration.warehouses.create'),
    );
  });

  it('offers only the branches the reader may read, named as the top bar names them', () => {
    const html = render();
    expect(html).toContain('<option value="b-cai">القاهرة</option>');
    expect(html).toContain('<option value="b-alx">الإسكندرية</option>');
    expect(html).not.toContain('<option value="b-tnt">');
    expect(viewableBranches(OPTIONS).map((o) => o.branchId)).toEqual(['b-cai', 'b-alx']);
  });

  it('never asks for a remembered branch the server no longer offers — it waits, then drops it', () => {
    expect(strayBranch(undefined, 'b-tnt'), 'nothing is known before the options answer').toBe(
      false,
    );
    expect(strayBranch(OPTIONS, 'b-tnt')).toBe(true);
    expect(strayBranch(OPTIONS, 'b-cai')).toBe(false);
    expect(strayBranch(OPTIONS, '')).toBe(false);
    // The list keyed by the stray branch is never read: the table waits instead.
    const html = render(undefined, '/administration/warehouses?branch=b-tnt', [
      [warehouseListKey({ ...FIRST_PAGE, branchId: 'b-tnt' }), pageOf([KEPT])],
    ]);
    expect(html).not.toContain('CAI-01');
    expect(SOURCE).toContain('setSp(next, { replace: true })');
  });

  it('asks for the linked branch when the options cannot be read, rather than loading for ever', () => {
    const html = renderScreen({
      element: <WarehousesPage />,
      route: '/administration/warehouses',
      path: '/administration/warehouses?branch=b-cai',
      keys: ['administrationWarehouse.view'],
      seed: [[warehouseListKey({ ...FIRST_PAGE, branchId: 'b-cai' }), pageOf([KEPT])]],
      failing: [warehouseBranchOptionsKey()],
    });
    expect(html).toContain('CAI-01');
  });

  it('says so when nothing matches, and offers a retry when the list failed', () => {
    expect(render(undefined, undefined, [[warehouseListKey(FIRST_PAGE), pageOf([])]])).toContain(
      ar('administration.warehouses.empty'),
    );
    const failed = render(undefined, undefined, [], [warehouseListKey(FIRST_PAGE)]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });
});

describe('the warehouse form', () => {
  const DEPARTMENTS = [
    {
      id: 'd-cai-admin',
      code: 'ADM',
      name: { ar: 'الشئون الإدارية', en: 'Admin' },
      parentId: 'b-cai',
      catalogId: null,
    },
    {
      id: 'd-alx-admin',
      code: 'ADM',
      name: { ar: 'الشئون الإدارية / الإسكندرية', en: 'Admin ALX' },
      parentId: 'b-alx',
      catalogId: null,
    },
  ];
  const dialog = (
    keys: string[],
    subject: Parameters<typeof WarehouseFormDialog>[0]['warehouse'],
  ): string =>
    renderScreen({
      element: <WarehouseFormDialog open onClose={() => undefined} warehouse={subject} />,
      route: '/',
      path: '/',
      keys,
      seed: [
        [warehouseBranchOptionsKey(), OPTIONS],
        [departmentOptionsKey(), DEPARTMENTS],
      ],
    });

  it('opens a store only in a branch the server says it may be opened in', () => {
    const html = dialog(['administrationWarehouse.create'], null);
    expect(html).toContain('<option value="b-cai">القاهرة</option>');
    expect(html).not.toContain('<option value="b-alx">');
    expect(html).not.toContain('<option value="b-tnt">');
    // No branch chosen yet, so no department either: a department is its branch's own.
    expect(html).toMatch(
      /<select[^>]*disabled=""><option value="" selected="">بلا إدارة<\/option><\/select>/u,
    );
  });

  it('keeps the branch of a store for good: an edit shows it and cannot change it', () => {
    const html = dialog(['administrationWarehouse.edit'], KEPT);
    expect(html).toContain(ar('administration.warehouses.fields.branchFixed'));
    expect(html).toMatch(
      /<select[^>]*disabled=""><option value="b-cai" selected="">القاهرة<\/option><\/select>/u,
    );
    // The branch's own departments, and Active on an edit.
    expect(html).toContain('<option value="d-cai-admin">الشئون الإدارية</option>');
    expect(html).not.toContain('d-alx-admin');
    expect(html).toContain(ar('administration.warehouses.fields.isActive'));
  });

  it('shows the stored keeper on its chip — as one who left, or flagged when HR does not know them', () => {
    const t = (key: string): string => ar(key);
    expect(storedKeeperLabel(KEPT, t)).toBe('سامح عادل منير (0100052)');
    expect(storedKeeperLabel(LEFT, t)).toBe(
      `هالة فوزي رشدي (0100077) — ${ar('administration.people.exited')}`,
    );
    expect(storedKeeperLabel(UNKNOWN, t)).toBe(ar('administration.warehouses.keeperUnknown'));
    expect(storedKeeperLabel(NONE, t)).toBe('');
    expect(dialog(['administrationWarehouse.edit'], KEPT)).toContain('سامح عادل منير (0100052)');
  });

  it('asks for the code in the contract’s pattern, the kind from the contract’s list, and no other field', () => {
    const html = dialog(['administrationWarehouse.create'], null);
    expect(html).toContain(ar('administration.warehouses.fields.codeHint'));
    for (const type of ['main', 'branch', 'sub']) {
      expect(html).toContain(
        `<option value="${type}">${ar(`administration.warehouses.type.${type}`)}</option>`,
      );
    }
    expect(html.match(/<span class="text-red-500"> \*<\/span>/gu)).toHaveLength(5);
    expect(html).not.toContain(ar('administration.warehouses.fields.isActive'));
  });

  it('names a keeper only for a holder of the keys the picker’s endpoint admits', () => {
    expect(dialog(['administrationWarehouse.create'], null)).not.toContain(
      ar('administration.people.noAccess'),
    );
    // A reader who holds neither write key never opens the form; the picker still says why.
    expect(dialog(['administrationWarehouse.view'], null)).toContain(
      ar('administration.people.noAccess'),
    );
  });

  it('words each refusal a store can meet beside the box it names', () => {
    const refusals = [
      new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, '', 409, [
        { field: 'name', code: 'duplicate', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, '', 409, [
        { field: 'code', code: 'duplicate', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED, '', 422, [
        { field: 'responsibleEmployeeId', code: 'exited', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED, '', 422, [
        { field: 'isActive', code: 'holdsStock', message: '' },
      ]),
      // A branch outside the top bar's choice (ADR-028).
      new ApiError(ErrorCodes.VALIDATION_FAILED, '', 400, [
        { field: 'body.branchId', code: 'OUT_OF_REACH', message: '' },
      ]),
    ];
    const named = refusals.flatMap((refusal) => Object.keys(refusalFieldKeys(refusal)));
    expect(named).toEqual(['nameAr', 'code', 'responsibleEmployeeId', 'isActive', 'branchId']);
    for (const field of named) expect(FORM, field).toContain(`refusedWord('${field}')`);
    expect(FORM).toContain('error={failure === null ? null : errorMessage(failure, locale)}');
  });
});
