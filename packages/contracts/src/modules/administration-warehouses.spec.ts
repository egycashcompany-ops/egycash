// The Administrative Affairs warehouse contracts, pinned (design §2.3.5, §19.4, §19.7): every write
// schema is strict, so an unknown key — a client-sent `nameKey`, a stock figure, a branch on an
// update — is refused instead of dropped; the types are OD-10's closed list; the code is typed in
// the org units' pattern; the branch is set once, at the create, and never sent again; the list's
// branch only narrows. And the refusal vocabulary the screens word is exactly §5.15's.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../errors/index.js';
import {
  ADMINISTRATION_DEACTIVATION_PROBLEMS,
  ADMINISTRATION_WAREHOUSE_TYPES,
  CreateAdministrationWarehouseSchema,
  ListAdministrationWarehousesQuerySchema,
  UpdateAdministrationWarehouseSchema,
} from './administration-warehouses.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const tools = { ar: 'مخزن الأدوات', en: 'Tools store' };
const warehouse = { code: 'CAI-01', name: tools, branchId: oid(1), type: 'main' };

describe('the warehouse types (OD-10 A)', () => {
  it('are main, branch and sub — quarantine waits for OD-34 B', () => {
    expect(ADMINISTRATION_WAREHOUSE_TYPES).toEqual(['main', 'branch', 'sub']);
  });

  it.each(['quarantine', 'MAIN', ''])('refuses the type %j', (type) => {
    expect(CreateAdministrationWarehouseSchema.safeParse({ ...warehouse, type }).success).toBe(
      false,
    );
  });
});

describe('creating a warehouse', () => {
  it('needs a code, a name, a branch and a type — nothing else', () => {
    expect(CreateAdministrationWarehouseSchema.parse(warehouse)).toEqual(warehouse);
  });

  it('takes a department, a keeper, a location and notes, trimmed; null names none', () => {
    const parsed = CreateAdministrationWarehouseSchema.parse({
      ...warehouse,
      code: ' MAIN ',
      departmentId: oid(2),
      responsibleEmployeeId: oid(3),
      location: ' الدور الأرضي ',
      notes: ' مفاتيح عند الأمن ',
    });
    expect(parsed).toMatchObject({
      code: 'MAIN',
      departmentId: oid(2),
      responsibleEmployeeId: oid(3),
      location: 'الدور الأرضي',
      notes: 'مفاتيح عند الأمن',
    });
    expect(
      CreateAdministrationWarehouseSchema.parse({
        ...warehouse,
        departmentId: null,
        responsibleEmployeeId: null,
      }),
    ).toMatchObject({ departmentId: null, responsibleEmployeeId: null });
  });

  it.each([
    ['no code', { name: tools, branchId: oid(1), type: 'main' }],
    ['no branch', { code: 'A1', name: tools, type: 'main' }],
    ['no type', { code: 'A1', name: tools, branchId: oid(1) }],
    ['a lower-case code', { ...warehouse, code: 'cai-01' }],
    ['a code that starts with a dash', { ...warehouse, code: '-CAI' }],
    ['a code past 20 characters', { ...warehouse, code: 'A'.repeat(21) }],
    ['a code with a space inside', { ...warehouse, code: 'CAI 01' }],
    ['a branch that is not an id', { ...warehouse, branchId: 'cairo' }],
    ['a keeper that is not an id', { ...warehouse, responsibleEmployeeId: 'ahmed' }],
    ['a location past 200 characters', { ...warehouse, location: 'x'.repeat(201) }],
    ['an Arabic name of tatweel alone', { ...warehouse, name: { ar: 'ـ', en: 'x' } }],
  ])('refuses %s', (_label, body) => {
    expect(CreateAdministrationWarehouseSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['nameKey', { nameKey: 'مخزنالادوات' }],
    ['isActive', { isActive: false }],
    ['an on-hand figure (ADR-024)', { onHandQty: 5 }],
    ['a keeper’s name — it is read from HR, never stored', { keeperName: 'أحمد' }],
    ['canEdit — the server answers it', { canEdit: true }],
  ])('refuses %s on a create', (_label, extra) => {
    expect(CreateAdministrationWarehouseSchema.safeParse({ ...warehouse, ...extra }).success).toBe(
      false,
    );
  });
});

describe('editing a warehouse', () => {
  it('needs its version', () => {
    expect(UpdateAdministrationWarehouseSchema.safeParse({ name: tools }).success).toBe(false);
    expect(UpdateAdministrationWarehouseSchema.parse({ version: 0 })).toEqual({ version: 0 });
  });

  it('never moves the branch: a body that sends one is refused, not dropped', () => {
    expect(
      UpdateAdministrationWarehouseSchema.safeParse({ branchId: oid(1), version: 0 }).success,
    ).toBe(false);
  });

  it('clears the department, the keeper, the location and the notes with null, and retires', () => {
    expect(
      UpdateAdministrationWarehouseSchema.parse({
        departmentId: null,
        responsibleEmployeeId: null,
        location: null,
        notes: null,
        isActive: false,
        version: 3,
      }),
    ).toEqual({
      departmentId: null,
      responsibleEmployeeId: null,
      location: null,
      notes: null,
      isActive: false,
      version: 3,
    });
  });

  it.each([
    ['a null code — a warehouse always has one', { code: null }],
    ['a null name', { name: null }],
    ['a null type', { type: null }],
    ['nameKey', { nameKey: 'x' }],
    ['an on-hand figure', { onHandQty: 1 }],
  ])('refuses %s', (_label, extra) => {
    expect(UpdateAdministrationWarehouseSchema.safeParse({ version: 0, ...extra }).success).toBe(
      false,
    );
  });
});

describe('the register', () => {
  it('lists by search, branch, type and status, its page capped at 100', () => {
    expect(
      ListAdministrationWarehousesQuerySchema.parse({
        search: ' CAI ',
        branchId: oid(1),
        type: 'sub',
        isActive: 'false',
      }),
    ).toMatchObject({
      search: 'CAI',
      branchId: oid(1),
      type: 'sub',
      isActive: false,
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
    });
    expect(ListAdministrationWarehousesQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(ListAdministrationWarehousesQuerySchema.safeParse({ branchId: 'x' }).success).toBe(
      false,
    );
    expect(
      ListAdministrationWarehousesQuerySchema.safeParse({ departmentId: oid(2) }).success,
      'the department is no filter: it is reference-only (OD-10 department (i))',
    ).toBe(false);
  });
});

describe('the refusals the screens word (§5.15)', () => {
  it('names the two holds that keep a warehouse from retiring (OD-70 B)', () => {
    expect(ADMINISTRATION_DEACTIVATION_PROBLEMS).toEqual(['holdsStock', 'openDocument']);
  });

  it('carries the warehouse codes in the catalog, module-prefixed', () => {
    for (const code of [
      'ADMINISTRATION_EMPLOYEE_EXITED',
      'ADMINISTRATION_DEACTIVATION_BLOCKED',
      'ADMINISTRATION_DUPLICATE',
    ] as const) {
      expect(ErrorCodes[code]).toBe(code);
    }
  });
});
