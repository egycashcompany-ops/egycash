// «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم» — the violations board's year, as a list.
//
// The company ledger is read as a history: «٢٠٢٥ جنب ٢٠٢٦» is the commonest question asked of it,
// and one year at a time made the comparison something the reader held in their head between two
// loads. What makes several years correct is not obvious, which is why it is pinned here.
import { describe, expect, it } from 'vitest';
import { violationYearBranches } from './violation.repository';

/** One `$or` branch, as this test reads it — the shape is what is under assertion. */
interface Branch {
  kind: string;
  year?: number;
  date?: { $gte: Date; $lt: Date };
}

describe('the years a rollup is narrowed to', () => {
  it('asks BOTH shapes about each year — a stored year and an event date', () => {
    // A single date range would miss every statement row; a single `year` equality would miss
    // every driver row. The collection holds both, so the filter has to ask both.
    const branches = violationYearBranches([2026]) as Branch[];
    expect(branches).toHaveLength(2);
    expect(branches[0]).toEqual({ kind: 'vehicle', year: 2026 });
    expect(branches[1]?.kind).toBe('driver');
    expect(branches[1]?.date?.$gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(branches[1]?.date?.$lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('keeps the years APART rather than spanning them', () => {
    // «٢٠٢٤ و٢٠٢٦» must not quietly become «٢٠٢٤ إلى ٢٠٢٦»: the year in between was not ticked
    // and its fines are not part of the answer.
    const branches = violationYearBranches([2024, 2026]) as Branch[];
    expect(branches).toHaveLength(4);
    expect(branches.filter((b) => b.kind === 'vehicle').map((b) => b.year)).toEqual([2024, 2026]);
    const spans = branches
      .filter((b) => b.kind === 'driver')
      .map((b) => [b.date?.$gte.getUTCFullYear(), b.date?.$lt.getUTCFullYear()]);
    expect(spans, 'each driver branch covers exactly its own year').toEqual([
      [2024, 2025],
      [2026, 2027],
    ]);
    for (const span of spans) expect(span[0]).not.toBe(2025);
  });

  it('answers with nothing for no years — the caller then narrows nothing at all', () => {
    // An empty `$or` matches NO document in Mongo, so «every year» must never reach this as an
    // empty list and be turned into one: `yearSums` drops the clause instead, and this is the
    // shape that makes that check meaningful.
    expect(violationYearBranches([])).toEqual([]);
  });
});
