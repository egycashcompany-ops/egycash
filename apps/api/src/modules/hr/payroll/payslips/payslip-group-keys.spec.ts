// The equivalence test scope B1 was made conditional on (D-B1-4).
//
// P-HR-25 shipped four grouping keys written out as literals. B1 needs dimensions that COMPOSE — a
// report groups by branch and cost centre at once — so those literals were replaced by a
// composition of atomic fragments. Decomposing a working query is exactly the kind of change that
// looks equivalent and is not: a dropped `currency` would silently total two currencies together,
// and a dropped `code` would merge two pay items into one row of money.
//
// So the literals P-HR-25 shipped are frozen HERE, copied from the commit that introduced them, and
// the composition must reproduce them field for field. This file is the reference; if it ever
// disagrees with `payslip.repository.ts`, the repository is wrong.
import { describe, expect, it } from 'vitest';
import { PAYROLL_REPORT_GROUP_BY, type PayrollReportGroupBy } from '@ecms/contracts';
import { composeGroupKey } from '../report-builder/report-dimensions';
import { AXIS_DIMENSIONS } from './payslip.repository';

/** Verbatim from P-HR-25, before the decomposition. Do not "tidy" — that is the point of it. */
const SHIPPED_KEYS: Record<PayrollReportGroupBy, Record<string, string>> = {
  origin: { currency: '$currency', kind: '$lines.kind', origin: '$lines.origin' },
  payItem: {
    currency: '$currency',
    kind: '$lines.kind',
    origin: '$lines.origin',
    payItemId: '$lines.payItemId',
    code: '$lines.code',
  },
  branch: { currency: '$currency', kind: '$lines.kind', branchId: '$branchId' },
  costCenter: { currency: '$currency', kind: '$lines.kind', costCenterId: '$costCenterId' },
};

describe('the composed keys are the keys P-HR-25 shipped', () => {
  it('reproduces every axis, field for field', () => {
    for (const axis of PAYROLL_REPORT_GROUP_BY) {
      expect(composeGroupKey(AXIS_DIMENSIONS[axis]), axis).toEqual(SHIPPED_KEYS[axis]);
    }
  });

  it('and covers all four axes — not three of them quietly', () => {
    expect(Object.keys(SHIPPED_KEYS).sort()).toEqual([...PAYROLL_REPORT_GROUP_BY].sort());
    expect(Object.keys(AXIS_DIMENSIONS).sort()).toEqual([...PAYROLL_REPORT_GROUP_BY].sort());
  });

  it('would notice a dropped field', () => {
    // Guarding the guard: if `composeGroupKey` started returning less, this test must fail rather
    // than pass on a subset. `toEqual` is exact, and this proves it for the case that matters.
    expect(composeGroupKey(['kind'])).not.toEqual(SHIPPED_KEYS.origin);
    expect(composeGroupKey(['kind', 'origin', 'payItem'])).not.toEqual(SHIPPED_KEYS.origin);
  });
});

describe('currency is in every key, and cannot be composed away', () => {
  it('leads every composition, including the empty one', () => {
    expect(composeGroupKey([])).toEqual({ currency: '$currency' });
    for (const axis of PAYROLL_REPORT_GROUP_BY) {
      expect(composeGroupKey(AXIS_DIMENSIONS[axis])['currency'], axis).toBe('$currency');
    }
  });

  it('survives every subset a report could ask for', () => {
    const all = ['kind', 'origin', 'payItem', 'branch', 'costCenter'] as const;
    for (let mask = 0; mask < 2 ** all.length; mask += 1) {
      const chosen = all.filter((_, index) => (mask & (1 << index)) !== 0);
      const key = composeGroupKey(chosen);
      expect(key['currency'], chosen.join('+')).toBe('$currency');
      // …and every chosen dimension contributed at least one field.
      expect(Object.keys(key).length, chosen.join('+')).toBeGreaterThanOrEqual(chosen.length + 1);
    }
  });
});

describe('composition is order-independent and repeatable', () => {
  it('gives the same key whatever order the caller listed the dimensions in', () => {
    expect(composeGroupKey(['costCenter', 'branch', 'kind'])).toEqual(
      composeGroupKey(['kind', 'branch', 'costCenter']),
    );
  });

  it('and the same key twice', () => {
    expect(composeGroupKey(['branch', 'origin'])).toEqual(composeGroupKey(['branch', 'origin']));
  });
});

describe('a dimension contributes only its own fields', () => {
  it('payItem carries both its id and the code the line stored', () => {
    expect(composeGroupKey(['payItem'])).toEqual({
      currency: '$currency',
      payItemId: '$lines.payItemId',
      code: '$lines.code',
    });
  });

  it('costCenter reads the payslip’s stamp, not an assignment', () => {
    expect(composeGroupKey(['costCenter'])).toEqual({
      currency: '$currency',
      costCenterId: '$costCenterId',
    });
  });
});
