// The pure half of P-HR-25: what a calculated column may name, and what it answers.
//
// No database, no run, no request — a column is arithmetic over one grouped row, so the whole of
// this file is values in and values out.
import { describe, expect, it } from 'vitest';
import { type ExpressionNode, type PayrollReportColumn } from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
import {
  COST_REPORT_CATALOG,
  assertColumnsValid,
  computeColumns,
  flattenRow,
} from './cost-report.row';

const field = (path: string): ExpressionNode => ({ kind: 'field', path });
const lit = (value: number): ExpressionNode => ({ kind: 'literal', value });
const divide = (left: ExpressionNode, right: ExpressionNode): ExpressionNode => ({
  kind: 'binary',
  op: 'divide',
  left,
  right,
});
const column = (key: string, expression: ExpressionNode): PayrollReportColumn => ({ key, expression });

describe('the catalog is derived, and it is this row only', () => {
  it('offers exactly the row’s own numbers (D-REPORT-13)', () => {
    expect(COST_REPORT_CATALOG.fields.map((f) => f.path).sort()).toEqual([
      'amount',
      'amountMinor',
      'lines',
    ]);
    expect(COST_REPORT_CATALOG.sourceId).toBe('payrollRunCostRow');
  });

  it('offers nothing from any other row — a share of the run’s total is not expressible', () => {
    for (const absent of ['runTotalMinor', 'totalAmountMinor', 'grandTotal', 'currency', 'kind']) {
      expect(COST_REPORT_CATALOG.fields.map((f) => f.path), absent).not.toContain(absent);
    }
  });
});

describe('flattening', () => {
  it('keys the row by the catalog’s own paths, and converts the major figure once', () => {
    expect(flattenRow({ lines: 4, amountMinor: 12_345 })).toEqual({
      lines: 4,
      amountMinor: 12_345,
      amount: 123.45,
    });
  });
});

describe('columns are checked before anything runs', () => {
  it('accepts a column over declared fields', () => {
    expect(() =>
      assertColumnsValid([column('perLine', divide(field('amountMinor'), field('lines')))]),
    ).not.toThrow();
  });

  it('refuses a column naming a field the row does not have', () => {
    expect(() => assertColumnsValid([column('bad', field('salary'))])).toThrow(ValidationError);
  });

  it('names the offending column, so the caller knows which one to fix', () => {
    try {
      assertColumnsValid([column('mine', field('nope'))]);
      expect.unreachable('should have thrown');
    } catch (error) {
      const details = (error as ValidationError).details ?? [];
      expect(details[0]?.field).toContain('columns.mine');
      expect(details[0]?.code).toBe('UNKNOWNFIELD');
    }
  });

  it('reports every faulty column in one pass rather than the first', () => {
    try {
      assertColumnsValid([column('a', field('nope')), column('b', field('alsoNope'))]);
      expect.unreachable('should have thrown');
    } catch (error) {
      const fields = ((error as ValidationError).details ?? []).map((d) => d.field);
      expect(fields.some((f) => f?.includes('columns.a'))).toBe(true);
      expect(fields.some((f) => f?.includes('columns.b'))).toBe(true);
    }
  });

  it('refuses two columns with the same key — one would silently replace the other', () => {
    expect(() =>
      assertColumnsValid([column('same', lit(1)), column('same', lit(2))]),
    ).toThrow(ValidationError);
  });

  it('accepts no columns at all — a plain grouping is a report', () => {
    expect(() => assertColumnsValid([])).not.toThrow();
  });
});

describe('evaluation over a row', () => {
  const row = { lines: 4, amountMinor: 10_000 };

  it('computes each column under its own key', () => {
    expect(
      computeColumns(
        [
          column('perLine', divide(field('amountMinor'), field('lines'))),
          column('doubled', { kind: 'binary', op: 'multiply', left: field('amount'), right: lit(2) }),
        ],
        row,
      ),
    ).toEqual({ perLine: 2500, doubled: 200 });
  });

  it('answers null for a division by zero, and the row is still returned (D-REPORT-7)', () => {
    const computed = computeColumns(
      [column('perLine', divide(field('amountMinor'), field('lines')))],
      { lines: 0, amountMinor: 500 },
    );
    expect(computed).toEqual({ perLine: null });
  });

  it('rounds nothing — presentation formats, the engine does not (D-REPORT-8)', () => {
    expect(
      computeColumns([column('third', divide(field('amountMinor'), lit(3)))], {
        lines: 1,
        amountMinor: 100,
      }).third,
    ).toBeCloseTo(33.3333, 4);
  });

  it('returns an empty map when nothing was asked for', () => {
    expect(computeColumns([], row)).toEqual({});
  });
});
