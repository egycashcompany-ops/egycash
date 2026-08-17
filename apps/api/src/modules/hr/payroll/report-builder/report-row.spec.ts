// Calculated columns in a built report (scope B1) — the P-HR-24 engine, consumed and not extended.
import { describe, expect, it } from 'vitest';
import { type ExpressionNode, type PayrollReportColumn } from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
import { REPORT_ROW_CATALOG, assertColumnsValid, computeColumns, flattenRow } from './report-row';

const field = (path: string): ExpressionNode => ({ kind: 'field', path });
const divide = (left: ExpressionNode, right: ExpressionNode): ExpressionNode => ({
  kind: 'binary',
  op: 'divide',
  left,
  right,
});
const column = (key: string, expression: ExpressionNode): PayrollReportColumn => ({ key, expression });

describe('the catalog names this row’s measures, and nothing else', () => {
  it('offers the two measures and the derived major figure', () => {
    expect(REPORT_ROW_CATALOG.fields.map((f) => f.path).sort()).toEqual([
      'amount',
      'amountMinor',
      'lineCount',
    ]);
  });

  it('uses the measure names the contract uses — a column saying `lineCount` must find it', () => {
    expect(REPORT_ROW_CATALOG.fields.map((f) => f.path)).toContain('lineCount');
  });

  it('offers nothing from another row — no run total, so no share-of-total (D-REPORT-13)', () => {
    for (const absent of ['runTotalMinor', 'grandTotal', 'total', 'currency']) {
      expect(REPORT_ROW_CATALOG.fields.map((f) => f.path), absent).not.toContain(absent);
    }
  });
});

describe('flattening', () => {
  it('keys by the catalog’s paths and converts the major figure once', () => {
    expect(flattenRow({ lineCount: 4, amountMinor: 12_345 })).toEqual({
      lineCount: 4,
      amountMinor: 12_345,
      amount: 123.45,
    });
  });
});

describe('columns are refused before they run', () => {
  it('accepts a column over the declared measures', () => {
    expect(() =>
      assertColumnsValid([column('perLine', divide(field('amountMinor'), field('lineCount')))]),
    ).not.toThrow();
  });

  it('refuses a column naming anything else', () => {
    expect(() => assertColumnsValid([column('bad', field('salary'))])).toThrow(ValidationError);
    expect(() => assertColumnsValid([column('bad', field('lines'))])).toThrow(ValidationError);
  });

  it('names every offending column, together', () => {
    try {
      assertColumnsValid([column('a', field('nope')), column('b', field('alsoNope'))]);
      expect.unreachable('should have thrown');
    } catch (error) {
      const fields = ((error as ValidationError).details ?? []).map((d) => d.field);
      expect(fields.some((f) => f?.includes('columns.a'))).toBe(true);
      expect(fields.some((f) => f?.includes('columns.b'))).toBe(true);
    }
  });
});

describe('evaluation', () => {
  it('computes each column under its own key', () => {
    expect(
      computeColumns([column('perLine', divide(field('amountMinor'), field('lineCount')))], {
        lineCount: 4,
        amountMinor: 10_000,
      }),
    ).toEqual({ perLine: 2500 });
  });

  it('answers null for a division by zero, and the row survives (D-REPORT-7)', () => {
    expect(
      computeColumns([column('perLine', divide(field('amountMinor'), field('lineCount')))], {
        lineCount: 0,
        amountMinor: 500,
      }),
    ).toEqual({ perLine: null });
  });

  it('rounds nothing (D-REPORT-8)', () => {
    const value = computeColumns(
      [column('third', divide(field('amountMinor'), { kind: 'literal', value: 3 }))],
      { lineCount: 1, amountMinor: 100 },
    ).third;
    expect(value).toBeCloseTo(33.3333, 4);
  });

  it('returns nothing when nothing was asked for', () => {
    expect(computeColumns([], { lineCount: 1, amountMinor: 1 })).toEqual({});
  });
});
