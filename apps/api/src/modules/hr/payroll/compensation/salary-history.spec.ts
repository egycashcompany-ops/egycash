// The basic salary as it WAS (PY-8). No database.
//
// The bug this closes is quiet and expensive: a raise recorded in June changed what March was
// worth, because March's calculation read the salary field as it stands today. Every case below
// states the figure it expects, so a change in the walk fails with a number a reader can argue
// with.
import { describe, expect, it } from 'vitest';
import { readableChanges, salaryAsOf, type SalaryChange } from './salary-history';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const egp = (amount: number) => ({ amount, currency: 'EGP' });

const change = (on: string, from: number | null, to: number | null): SalaryChange => ({
  effectiveDate: d(on),
  from: from === null ? null : egp(from),
  to: to === null ? null : egp(to),
});

describe('walking the salary back', () => {
  // A salary nobody ever changed has always been what it is — no fallback, just the truth.
  it('answers today’s value for every date when nothing was ever changed', () => {
    expect(salaryAsOf(egp(10_000), [], d('2020-01-01'))).toEqual(egp(10_000));
    expect(salaryAsOf(egp(10_000), [], d('2030-01-01'))).toEqual(egp(10_000));
  });

  it('undoes a raise that took effect after the date asked about', () => {
    const changes = [change('2026-06-01', 10_000, 30_000)];
    expect(salaryAsOf(egp(30_000), changes, d('2026-03-31'))).toEqual(egp(10_000));
  });

  // A change effective ON the date has already happened.
  it('keeps a change effective on the boundary itself', () => {
    const changes = [change('2026-03-31', 10_000, 30_000)];
    expect(salaryAsOf(egp(30_000), changes, d('2026-03-31'))).toEqual(egp(30_000));
    expect(salaryAsOf(egp(30_000), changes, d('2026-03-30'))).toEqual(egp(10_000));
  });

  it('walks back through several raises to the right one', () => {
    const changes = [
      change('2024-01-01', 5000, 8000),
      change('2025-01-01', 8000, 10_000),
      change('2026-06-01', 10_000, 30_000),
    ];
    expect(salaryAsOf(egp(30_000), changes, d('2026-03-31'))).toEqual(egp(10_000));
    expect(salaryAsOf(egp(30_000), changes, d('2024-06-30'))).toEqual(egp(8000));
    expect(salaryAsOf(egp(30_000), changes, d('2023-12-31'))).toEqual(egp(5000));
  });

  // The order the rows arrive in is not the order they are walked in.
  it('is independent of the order the log hands them over', () => {
    const rows = [
      change('2026-06-01', 10_000, 30_000),
      change('2024-01-01', 5000, 8000),
      change('2025-01-01', 8000, 10_000),
    ];
    expect(salaryAsOf(egp(30_000), rows, d('2024-06-30'))).toEqual(egp(8000));
  });

  it('reports no salary for a date before the first one was ever recorded', () => {
    const changes = [change('2024-01-01', null, 8000)];
    expect(salaryAsOf(egp(8000), changes, d('2023-12-31'))).toBeNull();
  });

  it('carries a currency change back with the amount', () => {
    const changes: SalaryChange[] = [
      {
        effectiveDate: d('2026-06-01'),
        from: { amount: 1000, currency: 'USD' },
        to: { amount: 30_000, currency: 'EGP' },
      },
    ];
    expect(salaryAsOf(egp(30_000), changes, d('2026-03-31'))).toEqual({
      amount: 1000,
      currency: 'USD',
    });
  });

  it('answers null when there is no salary today and nothing was ever recorded', () => {
    expect(salaryAsOf(null, [], d('2026-03-31'))).toBeNull();
  });
});

describe('which log rows the walk may use', () => {
  it('takes a well-formed money value', () => {
    expect(readableChanges([{ effectiveDate: d('2026-01-01'), from: egp(5000), to: egp(6000) }])).toEqual(
      [{ effectiveDate: d('2026-01-01'), from: egp(5000), to: egp(6000) }],
    );
  });

  it('takes an explicit null — "there was no salary before this" is a fact', () => {
    expect(readableChanges([{ effectiveDate: d('2026-01-01'), from: null, to: egp(6000) }])).toEqual([
      { effectiveDate: d('2026-01-01'), from: null, to: egp(6000) },
    ]);
  });

  // A row nobody wrote on purpose is not a fact about a salary, and stepping through it would
  // replace a real figure with a guess. Dropping it leaves the walk on the last value it can
  // vouch for.
  it('drops a row whose previous value is not a money shape', () => {
    for (const from of [undefined, 5000, 'EGP 5000', {}, { amount: 5000 }, []]) {
      expect(
        readableChanges([{ effectiveDate: d('2026-01-01'), from, to: egp(6000) }]),
        JSON.stringify(from),
      ).toEqual([]);
    }
  });

  it('keeps a usable row even when the value it installed is unreadable', () => {
    const rows = readableChanges([{ effectiveDate: d('2026-01-01'), from: egp(5000), to: 'nonsense' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from).toEqual(egp(5000));
    expect(rows[0]?.to).toBeNull();
  });
});
