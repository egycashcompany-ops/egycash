// The warehouse form's state against the contracts (design §2.3.5, OD-10 A): a create names its
// branch and its kind — none is assumed — and a code in the org units' pattern; an edit never names
// a branch, sends only what moved, and clears an optional value with `null`; the departments offered
// are the branch's own copies, and the one a store already names stays — named from the read with
// the retired units, and marked, once it has been retired.
import { describe, expect, it } from 'vitest';
import {
  CreateAdministrationWarehouseSchema,
  UpdateAdministrationWarehouseSchema,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { warehouse } from '../screen-fixtures';
import {
  branchDepartments,
  storedDepartmentRetired,
  warehouseChanges,
  warehouseCodeOk,
  warehouseCreateBody,
  warehouseFormFrom,
  warehouseRequired,
  type WarehouseForm,
} from './warehouse-form';

const EMPTY = warehouseFormFrom(null);
const filled = (over: Partial<WarehouseForm> = {}): WarehouseForm => ({
  ...EMPTY,
  code: 'CAI-01',
  nameAr: 'مخزن القاهرة الرئيسي',
  nameEn: 'Cairo main store',
  branchId: '650000000000000000000010',
  type: 'main',
  ...over,
});

describe('a new warehouse', () => {
  it('needs its code, both names, its branch and its kind — no kind is assumed', () => {
    expect(EMPTY.type).toBe('');
    expect(warehouseRequired(EMPTY)).toEqual({
      code: false,
      nameAr: false,
      nameEn: false,
      branchId: false,
      type: false,
    });
    expect(Object.values(warehouseRequired(filled())).every(Boolean)).toBe(true);
    expect(() => warehouseCreateBody(filled({ type: '' }))).toThrow();
  });

  it('takes a code in the contract’s pattern only', () => {
    expect(warehouseCodeOk('MAIN')).toBe(true);
    expect(warehouseCodeOk('CAI-01')).toBe(true);
    expect(warehouseCodeOk('cai-01')).toBe(false);
    expect(warehouseCodeOk('-CAI')).toBe(false);
    expect(warehouseCodeOk('A'.repeat(21))).toBe(false);
  });

  it('sends what the contract takes — the keeper and department only when named', () => {
    const plain = warehouseCreateBody(filled());
    expect(plain).toEqual({
      code: 'CAI-01',
      name: { ar: 'مخزن القاهرة الرئيسي', en: 'Cairo main store' },
      branchId: '650000000000000000000010',
      type: 'main',
    });
    expect(CreateAdministrationWarehouseSchema.safeParse(plain).success).toBe(true);
    const named = warehouseCreateBody(
      filled({
        keeperId: '650000000000000000000020',
        departmentId: '650000000000000000000030',
        location: ' الدور الأرضي ',
      }),
    );
    expect(named).toMatchObject({
      responsibleEmployeeId: '650000000000000000000020',
      departmentId: '650000000000000000000030',
      location: 'الدور الأرضي',
    });
    expect(CreateAdministrationWarehouseSchema.safeParse(named).success).toBe(true);
  });
});

describe('an edit', () => {
  const KEPT = warehouse();

  it('sends nothing when nothing moved, and never the branch', () => {
    expect(warehouseChanges(warehouseFormFrom(KEPT), KEPT)).toEqual({});
    const moved = warehouseChanges({ ...warehouseFormFrom(KEPT), branchId: 'b-other' }, KEPT);
    expect(moved).not.toHaveProperty('branchId');
  });

  it('clears the keeper with `null`, and retires through `isActive`', () => {
    const changes = warehouseChanges(
      { ...warehouseFormFrom(KEPT), keeperId: '', isActive: false, type: 'sub' },
      KEPT,
    );
    expect(changes).toEqual({ responsibleEmployeeId: null, isActive: false, type: 'sub' });
    expect(UpdateAdministrationWarehouseSchema.safeParse({ ...changes, version: 0 }).success).toBe(
      true,
    );
  });

  it('keeps a keeper HR no longer knows until another is named', () => {
    const unknown = warehouse({ keeper: null, responsibleEmployeeId: 'e-9' });
    expect(warehouseFormFrom(unknown).keeperId).toBe('e-9');
    expect(warehouseChanges(warehouseFormFrom(unknown), unknown)).toEqual({});
  });
});

describe('the departments a store may name', () => {
  const option = (id: string, parentId: string): OrgUnitOptionDto => ({
    id,
    code: id,
    name: { ar: id, en: id },
    parentId,
    catalogId: null,
  });
  const ALL = [option('d-cai', 'b-cai'), option('d-alx', 'b-alx')];
  const RETIRED = option('d-cai-old', 'b-cai');
  const ids = (choices: ReturnType<typeof branchDepartments>): string[] =>
    choices.map((choice) => choice.department.id);

  it('are the branch’s own copies, none before a branch is chosen', () => {
    expect(ids(branchDepartments(ALL, [], 'b-cai', ''))).toEqual(['d-cai']);
    expect(branchDepartments(ALL, [], '', '')).toEqual([]);
  });

  it('keep the one a store already names, whatever has become of it', () => {
    expect(ids(branchDepartments(ALL, [], 'b-cai', 'd-alx'))).toEqual(['d-cai', 'd-alx']);
  });

  it('keep a retired one the store names, named from the read with the retired units and marked', () => {
    // The active options no longer hold it, so the read with the retired units is asked.
    expect(storedDepartmentRetired(ALL, 'd-cai-old')).toBe(true);
    expect(storedDepartmentRetired(ALL, 'd-cai')).toBe(false);
    expect(storedDepartmentRetired(ALL, '')).toBe(false);
    expect(storedDepartmentRetired(undefined, 'd-cai-old'), 'not before the options answer').toBe(
      false,
    );
    const choices = branchDepartments(ALL, [...ALL, RETIRED], 'b-cai', 'd-cai-old');
    expect(choices).toEqual([
      { department: ALL[0], retired: false },
      { department: RETIRED, retired: true },
    ]);
    // Never offered to a store that does not already name it.
    expect(ids(branchDepartments(ALL, [...ALL, RETIRED], 'b-cai', 'd-cai'))).toEqual(['d-cai']);
  });
});
