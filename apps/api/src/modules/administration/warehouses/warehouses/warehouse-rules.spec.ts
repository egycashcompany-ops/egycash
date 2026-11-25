// A warehouse's rules (design §2.3.5, §5.3, §5.15, §19.7): the type list and the fixed branch, as
// the contract holds them; the keeper refused only on HR's positive «left»; and the retirement rule
// of OD-70 B with its checker registry — which nothing registers with in Phase 1, so a warehouse
// retires freely, and which refuses with one detail per hold the moment something does.
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_WAREHOUSE_TYPES,
  CreateAdministrationWarehouseSchema,
  ErrorCodes,
  UpdateAdministrationWarehouseSchema,
} from '@ecms/contracts';
import { type AppError } from '../../../../shared/errors';
import { registerWarehouseHoldChecker, warehouseHolds } from './warehouse-holds';
import { deactivationProblem, isRetirement, keeperRefusal } from './warehouse-rules';

describe('the type list (OD-10 A)', () => {
  it('is a closed list of three — a quarantine store waits for OD-34 B', () => {
    expect(ADMINISTRATION_WAREHOUSE_TYPES).toEqual(['main', 'branch', 'sub']);
  });
});

describe('the branch is fixed (§2.3.5)', () => {
  it('is required at the create and absent from the edit, so no write can move a store', () => {
    expect(Object.keys(CreateAdministrationWarehouseSchema.shape)).toContain('branchId');
    expect(Object.keys(UpdateAdministrationWarehouseSchema.shape)).not.toContain('branchId');
  });
});

describe('keeperRefusal (§7.8; OD-44, IT’s rule)', () => {
  it.each(['probation', 'active', 'onLeave', 'suspended'] as const)(
    'lets a %s employee keep a store',
    (status) => {
      expect(keeperRefusal({ status })).toBeNull();
    },
  );

  it('passes an id the directory cannot read — no HR source, or a person it does not know', () => {
    expect(keeperRefusal(null)).toBeNull();
  });

  it('refuses a leaver: 422 ADMINISTRATION_EMPLOYEE_EXITED on the keeper field', () => {
    const refusal = keeperRefusal({ status: 'exited' });
    expect(refusal).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED,
      httpStatus: 422,
    });
    expect(refusal?.details).toEqual([
      expect.objectContaining({ field: 'responsibleEmployeeId', code: 'exited' }),
    ]);
  });
});

describe('isRetirement', () => {
  it('is an active warehouse sent `isActive: false`, and nothing else', () => {
    expect(isRetirement({ isActive: true }, false)).toBe(true);
    expect(isRetirement({ isActive: true }, undefined)).toBe(false);
    expect(isRetirement({ isActive: true }, true)).toBe(false);
    expect(isRetirement({ isActive: false }, false), 'already retired').toBe(false);
    expect(isRetirement({ isActive: false }, true), 'a reactivation').toBe(false);
  });
});

describe('deactivationProblem (OD-70 B)', () => {
  it('answers none when nothing holds the warehouse — every warehouse, in Phase 1', () => {
    expect(deactivationProblem([])).toBeNull();
  });

  it('refuses a warehouse that holds stock: 422 ADMINISTRATION_DEACTIVATION_BLOCKED', () => {
    const refusal = deactivationProblem(['holdsStock']);
    expect(refusal).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED,
      httpStatus: 422,
    });
    expect(refusal?.details).toEqual([
      expect.objectContaining({ field: 'isActive', code: 'holdsStock' }),
    ]);
  });

  it('names each hold once, in the vocabulary’s order, whatever order they came in', () => {
    const codes = (refusal: AppError | null) => refusal?.details?.map((detail) => detail.code);
    expect(codes(deactivationProblem(['openDocument', 'holdsStock', 'openDocument']))).toEqual([
      'holdsStock',
      'openDocument',
    ]);
    expect(codes(deactivationProblem(['openDocument']))).toEqual(['openDocument']);
  });
});

describe('the checker registry (§3.6)', () => {
  // In this order: the registry is the module's, and the case below registers for good.
  it('ships with no registrant, so nothing holds a warehouse and it retires freely', async () => {
    const holds = await warehouseHolds('64a0000000000000000000f1');
    expect(holds).toEqual([]);
    expect(deactivationProblem(holds)).toBeNull();
  });

  it('asks every registrant, and the rule refuses on what they report', async () => {
    const asked: string[] = [];
    registerWarehouseHoldChecker(async (id) => {
      asked.push(id);
      return null;
    });
    registerWarehouseHoldChecker(async (id) => (id === 'held' ? 'openDocument' : null));
    registerWarehouseHoldChecker(async (id) => (id === 'held' ? 'holdsStock' : null));

    expect(await warehouseHolds('free')).toEqual([]);
    const holds = await warehouseHolds('held');
    expect(holds).toEqual(['holdsStock', 'openDocument']);
    expect(asked).toEqual(['free', 'held']);
    expect(deactivationProblem(holds)?.code).toBe(ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED);
  });
});
