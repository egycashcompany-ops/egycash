// The security core, tested as values (scope B1).
//
// Everything here is pure, so these are not stand-ins for integration tests — they are the actual
// proofs for the claims that matter: a filter names a field it is allowed to name and nothing else,
// a value becomes what the database stores rather than what the caller typed, and a user filter is
// an ADDITIONAL condition that can only narrow.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { PAYROLL_REPORT_NULL_VALUE, type PayrollReportFilter } from '@ecms/contracts';
import { composeGroupKey, planFilters, sortRows, type SortableRow } from './report-dimensions';

const filter = (
  field: PayrollReportFilter['field'],
  op: PayrollReportFilter['op'],
  values: string[],
): PayrollReportFilter => ({ field, op, values });

const OID = '507f1f77bcf86cd799439011';

describe('every path comes from the map, never from the caller', () => {
  it('translates a field NAME into the one path it stands for', () => {
    expect(planFilters([filter('branch', 'eq', [OID])]).pre[0]).toEqual({
      branchId: new Types.ObjectId(OID),
    });
    expect(planFilters([filter('kind', 'eq', ['earning'])]).post[0]).toEqual({
      'lines.kind': 'earning',
    });
  });

  it('splits payslip-level filters from line-level ones', () => {
    const plan = planFilters([
      filter('branch', 'eq', [OID]),
      filter('costCenter', 'eq', [OID]),
      filter('currency', 'eq', ['EGP']),
      filter('kind', 'eq', ['earning']),
      filter('origin', 'eq', ['payItem']),
      filter('payItem', 'eq', [OID]),
    ]);
    // Before the unwind: three payslip fields. After it: three line fields — matching a line field
    // early would compare against an array instead of a value.
    expect(plan.pre).toHaveLength(3);
    expect(plan.post).toHaveLength(3);
    expect(Object.keys(plan.post[0] ?? {})[0]).toContain('lines.');
    expect(Object.keys(plan.pre[0] ?? {})[0]).not.toContain('lines.');
  });

  it('produces no `$where`, `$expr`, `$function` or regular expression, whatever it is given', () => {
    const plan = planFilters([
      filter('kind', 'in', ['earning', 'deduction']),
      filter('branch', 'nin', [OID]),
      filter('currency', 'ne', ['EGP']),
    ]);
    const serialized = JSON.stringify([...plan.pre, ...plan.post]);
    for (const forbidden of ['$where', '$expr', '$function', '$regex', '$accumulator']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe('values become what the database stores', () => {
  it('turns an id into an ObjectId', () => {
    const condition = planFilters([filter('costCenter', 'eq', [OID])]).pre[0] as Record<string, unknown>;
    expect(condition['costCenterId']).toBeInstanceOf(Types.ObjectId);
  });

  it('turns the null token into a real null — the group of the unassigned', () => {
    expect(planFilters([filter('costCenter', 'eq', [PAYROLL_REPORT_NULL_VALUE])]).pre[0]).toEqual({
      costCenterId: null,
    });
  });

  it('leaves a vocabulary member as the string it already was', () => {
    expect(planFilters([filter('origin', 'eq', ['adjustment'])]).post[0]).toEqual({
      'lines.origin': 'adjustment',
    });
  });
});

describe('the four operators, and only those', () => {
  it('builds each one from the closed enum', () => {
    expect(planFilters([filter('kind', 'eq', ['earning'])]).post[0]).toEqual({ 'lines.kind': 'earning' });
    expect(planFilters([filter('kind', 'ne', ['earning'])]).post[0]).toEqual({
      'lines.kind': { $ne: 'earning' },
    });
    expect(planFilters([filter('kind', 'in', ['earning', 'deduction'])]).post[0]).toEqual({
      'lines.kind': { $in: ['earning', 'deduction'] },
    });
    expect(planFilters([filter('kind', 'nin', ['earning'])]).post[0]).toEqual({
      'lines.kind': { $nin: ['earning'] },
    });
  });
});

describe('a filter cannot widen the scope', () => {
  it('produces conditions only — never a `$or`, and never a stage', () => {
    // The pipeline puts these in their own `$match` AFTER the scoped one, so the only shape that
    // could widen anything is a disjunction that reintroduces excluded documents. There is none:
    // every condition is a single field constrained by a single operator.
    for (const f of [
      filter('branch', 'in', [OID, '507f1f77bcf86cd799439012']),
      filter('kind', 'nin', ['earning']),
      filter('currency', 'eq', ['EGP']),
    ]) {
      const plan = planFilters([f]);
      for (const condition of [...plan.pre, ...plan.post]) {
        expect(Object.keys(condition)).toHaveLength(1);
        expect(Object.keys(condition)[0]).not.toMatch(/^\$/);
      }
    }
  });

  it('and an empty filter list adds no condition at all', () => {
    expect(planFilters([])).toEqual({ pre: [], post: [] });
  });
});

describe('currency leads every composed key', () => {
  it('is present with no dimensions, one dimension, or all of them', () => {
    expect(composeGroupKey([])['currency']).toBe('$currency');
    expect(composeGroupKey(['branch'])['currency']).toBe('$currency');
    expect(composeGroupKey(['kind', 'origin', 'payItem', 'branch', 'costCenter'])['currency']).toBe(
      '$currency',
    );
  });
});

describe('sorting is deterministic', () => {
  const row = (currency: string, amount: number, id: string): SortableRow => ({
    currency,
    measures: { amountMinor: amount, lineCount: 1 },
    calculated: {},
    cells: [{ dimension: 'branch', id, code: null }],
  });

  it('orders by a measure in both directions', () => {
    const rows = [row('EGP', 300, 'c'), row('EGP', 100, 'a'), row('EGP', 200, 'b')];
    expect(sortRows(rows, { key: 'amountMinor', direction: 'asc' }).map((r) => r.measures['amountMinor'])).toEqual([100, 200, 300]);
    expect(sortRows(rows, { key: 'amountMinor', direction: 'desc' }).map((r) => r.measures['amountMinor'])).toEqual([300, 200, 100]);
  });

  it('puts an uncomputable value last in BOTH directions — unknown is not a small number', () => {
    const rows: SortableRow[] = [
      { currency: 'EGP', measures: {}, calculated: { ratio: 5 }, cells: [] },
      { currency: 'EGP', measures: {}, calculated: { ratio: null }, cells: [] },
      { currency: 'EGP', measures: {}, calculated: { ratio: 1 }, cells: [] },
    ];
    expect(sortRows(rows, { key: 'ratio', direction: 'asc' }).map((r) => r.calculated['ratio'])).toEqual([1, 5, null]);
    expect(sortRows(rows, { key: 'ratio', direction: 'desc' }).map((r) => r.calculated['ratio'])).toEqual([5, 1, null]);
  });

  it('breaks ties the same way every time, so two runs of one report agree', () => {
    const tied = [row('EGP', 100, 'c'), row('EGP', 100, 'a'), row('EGP', 100, 'b')];
    const once = sortRows(tied, { key: 'amountMinor', direction: 'asc' }).map((r) => r.cells[0]?.id);
    for (let i = 0; i < 20; i += 1) {
      expect(sortRows([...tied].reverse(), { key: 'amountMinor', direction: 'asc' }).map((r) => r.cells[0]?.id)).toEqual(once);
    }
    expect(once).toEqual(['a', 'b', 'c']);
  });

  it('orders by currency first when nothing was asked for', () => {
    const rows = [row('USD', 1, 'a'), row('EGP', 1, 'a')];
    expect(sortRows(rows, null).map((r) => r.currency)).toEqual(['EGP', 'USD']);
  });

  it('never mutates the rows it was given', () => {
    const rows = [row('EGP', 300, 'c'), row('EGP', 100, 'a')];
    const before = rows.map((r) => r.measures['amountMinor']);
    sortRows(rows, { key: 'amountMinor', direction: 'asc' });
    expect(rows.map((r) => r.measures['amountMinor'])).toEqual(before);
  });
});
