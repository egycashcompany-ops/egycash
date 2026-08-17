// Scope B1 — the boundary rules, tested where they are written.
//
// These are not shape tests for their own sake. Each one is a rule the API will rely on rather than
// re-check: that a filter can only name a declared dimension, that its values fit the field they
// filter, that `currency` cannot be selected away, and that a definition cannot be saved incoherent.
// If the schema stops enforcing any of them, something downstream starts trusting a value nobody
// validated.
import { describe, expect, it } from 'vitest';
import {
  CreatePayrollReportDefinitionSchema,
  PAYROLL_REPORT_DIMENSIONS,
  PAYROLL_REPORT_FILTER_FIELDS,
  PAYROLL_REPORT_FILTER_OPS,
  PAYROLL_REPORT_MAX_DIMENSIONS,
  PAYROLL_REPORT_MAX_FILTERS,
  PAYROLL_REPORT_MEASURES,
  PAYROLL_REPORT_NULL_VALUE,
  PAYROLL_REPORT_SOURCES,
  PayrollReportFilterSchema,
  PreviewPayrollReportSchema,
} from './hr-payroll-reports.js';

const OID = '507f1f77bcf86cd799439011';

const definition = (over: Record<string, unknown> = {}): unknown => ({
  name: { ar: 'تقرير', en: 'Report' },
  sourceId: 'payrollRunLines',
  measures: ['amountMinor'],
  ...over,
});

const parse = (over: Record<string, unknown> = {}) =>
  CreatePayrollReportDefinitionSchema.safeParse(definition(over));

// ── The closed vocabularies ─────────────────────────────────────────────────

describe('the vocabularies are exactly this large', () => {
  it('offers one source, and only one', () => {
    expect([...PAYROLL_REPORT_SOURCES]).toEqual(['payrollRunLines']);
    expect(parse({ sourceId: 'employees' }).success).toBe(false);
  });

  it('offers five dimensions', () => {
    expect([...PAYROLL_REPORT_DIMENSIONS]).toEqual([
      'kind',
      'origin',
      'payItem',
      'branch',
      'costCenter',
    ]);
  });

  it('does NOT offer currency as a dimension — it is in every key and cannot be chosen away', () => {
    expect([...PAYROLL_REPORT_DIMENSIONS]).not.toContain('currency');
    expect(parse({ dimensions: ['currency'] }).success).toBe(false);
    // …but it can still be FILTERED on, which is a different thing.
    expect([...PAYROLL_REPORT_FILTER_FIELDS]).toContain('currency');
  });

  it('offers two measures and four operators (D-B1-2, D-B1-3)', () => {
    expect([...PAYROLL_REPORT_MEASURES]).toEqual(['lineCount', 'amountMinor']);
    expect([...PAYROLL_REPORT_FILTER_OPS]).toEqual(['eq', 'ne', 'in', 'nin']);
  });

  it('refuses an operator this phase did not grant', () => {
    for (const op of ['gt', 'lt', 'contains', 'regex', 'exists']) {
      expect(
        PayrollReportFilterSchema.safeParse({ field: 'kind', op, values: ['earning'] }).success,
        op,
      ).toBe(false);
    }
  });
});

// ── Filters: names, never paths ─────────────────────────────────────────────

describe('a filter can only name a declared field', () => {
  it('accepts every declared field', () => {
    for (const field of PAYROLL_REPORT_FILTER_FIELDS) {
      const values =
        field === 'currency'
          ? ['EGP']
          : field === 'kind'
            ? ['earning']
            : field === 'origin'
              ? ['payItem']
              : [OID];
      expect(
        PayrollReportFilterSchema.safeParse({ field, op: 'eq', values }).success,
        field,
      ).toBe(true);
    }
  });

  it('refuses anything that looks like a path or a field of its own choosing', () => {
    for (const field of ['$branchId', 'branchId', 'employeeId', 'employee.salary', '__proto__', '$where']) {
      expect(
        PayrollReportFilterSchema.safeParse({ field, op: 'eq', values: [OID] }).success,
        field,
      ).toBe(false);
    }
  });
});

describe('a filter’s values must fit the field they filter', () => {
  it('refuses a non-id where an id belongs', () => {
    for (const field of ['payItem', 'branch', 'costCenter']) {
      expect(
        PayrollReportFilterSchema.safeParse({ field, op: 'eq', values: ['earning'] }).success,
        field,
      ).toBe(false);
    }
  });

  it('refuses a value outside a closed vocabulary', () => {
    expect(
      PayrollReportFilterSchema.safeParse({ field: 'kind', op: 'eq', values: ['bonus'] }).success,
    ).toBe(false);
    expect(
      PayrollReportFilterSchema.safeParse({ field: 'origin', op: 'eq', values: ['nope'] }).success,
    ).toBe(false);
  });

  it('refuses a currency that is not three characters', () => {
    expect(
      PayrollReportFilterSchema.safeParse({ field: 'currency', op: 'eq', values: ['EGYPT'] }).success,
    ).toBe(false);
  });

  it('accepts the null token on a dimension, and refuses it on currency', () => {
    expect(
      PayrollReportFilterSchema.safeParse({
        field: 'costCenter',
        op: 'eq',
        values: [PAYROLL_REPORT_NULL_VALUE],
      }).success,
    ).toBe(true);
    expect(
      PayrollReportFilterSchema.safeParse({
        field: 'currency',
        op: 'eq',
        values: [PAYROLL_REPORT_NULL_VALUE],
      }).success,
    ).toBe(false);
  });
});

describe('one shape for four operators', () => {
  it('requires exactly one value for eq and ne', () => {
    for (const op of ['eq', 'ne']) {
      expect(
        PayrollReportFilterSchema.safeParse({ field: 'kind', op, values: ['earning', 'deduction'] })
          .success,
        op,
      ).toBe(false);
    }
  });

  it('accepts several values for in and nin', () => {
    for (const op of ['in', 'nin']) {
      expect(
        PayrollReportFilterSchema.safeParse({ field: 'kind', op, values: ['earning', 'deduction'] })
          .success,
        op,
      ).toBe(true);
    }
  });

  it('never accepts an empty value list', () => {
    expect(PayrollReportFilterSchema.safeParse({ field: 'kind', op: 'in', values: [] }).success).toBe(
      false,
    );
  });
});

// ── The definition holds together ───────────────────────────────────────────

describe('a definition cannot be saved incoherent', () => {
  it('accepts the smallest legal report — one measure and nothing else', () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions).toEqual([]);
      expect(result.data.filters).toEqual([]);
      expect(result.data.columns).toEqual([]);
      expect(result.data.status).toBe('active');
      expect(result.data.sort).toBeNull();
    }
  });

  it('requires at least one measure — a report of nothing is not a report', () => {
    expect(parse({ measures: [] }).success).toBe(false);
  });

  it('refuses a dimension, a measure or a column selected twice', () => {
    expect(parse({ dimensions: ['branch', 'branch'] }).success).toBe(false);
    expect(parse({ measures: ['amountMinor', 'amountMinor'] }).success).toBe(false);
    expect(
      parse({
        columns: [
          { key: 'a', expression: { kind: 'field', path: 'amountMinor' } },
          { key: 'a', expression: { kind: 'literal', value: 1 } },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses a sort key the report does not select', () => {
    expect(parse({ sort: { key: 'branch', direction: 'asc' } }).success).toBe(false);
    expect(
      parse({ dimensions: ['branch'], sort: { key: 'branch', direction: 'asc' } }).success,
    ).toBe(true);
    expect(parse({ sort: { key: 'amountMinor', direction: 'desc' } }).success).toBe(true);
    // A calculated column is sortable too, once it exists.
    expect(
      parse({
        columns: [{ key: 'perLine', expression: { kind: 'field', path: 'amountMinor' } }],
        sort: { key: 'perLine', direction: 'asc' },
      }).success,
    ).toBe(true);
  });

  it('accepts every dimension at once', () => {
    expect(parse({ dimensions: [...PAYROLL_REPORT_DIMENSIONS] }).success).toBe(true);
  });

  it(
    'documents that the dimension cap equals the vocabulary — so only a duplicate can exceed it ' +
      'today, and adding a sixth dimension is what makes the cap start refusing anything',
    () => {
      expect(PAYROLL_REPORT_MAX_DIMENSIONS).toBe(PAYROLL_REPORT_DIMENSIONS.length);
      // The only way past it right now is a repeat, and the coherence rule catches that first.
      expect(parse({ dimensions: [...PAYROLL_REPORT_DIMENSIONS, 'branch'] }).success).toBe(false);
    },
  );

  it('refuses more filters than it allows', () => {
    const filters = Array.from({ length: PAYROLL_REPORT_MAX_FILTERS + 1 }, () => ({
      field: 'kind',
      op: 'eq',
      values: ['earning'],
    }));
    expect(parse({ filters }).success).toBe(false);
    expect(parse({ filters: filters.slice(0, PAYROLL_REPORT_MAX_FILTERS) }).success).toBe(true);
  });

  it('refuses a stray key rather than ignoring it', () => {
    expect(parse({ ownerId: OID }).success).toBe(false);
    expect(parse({ sharedWith: [] }).success).toBe(false);
  });
});

// ── Calculated columns are P-HR-24's, unchanged ─────────────────────────────

describe('calculated columns reuse the expression engine and add nothing', () => {
  it('accepts a P-HR-24 AST', () => {
    expect(
      parse({
        columns: [
          {
            key: 'perLine',
            expression: {
              kind: 'binary',
              op: 'divide',
              left: { kind: 'field', path: 'amountMinor' },
              right: { kind: 'field', path: 'lineCount' },
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses anything that is not one — no text, no operation the engine lacks', () => {
    expect(parse({ columns: [{ key: 'x', expression: 'amountMinor / lineCount' }] }).success).toBe(
      false,
    );
    expect(
      parse({
        columns: [
          {
            key: 'x',
            expression: {
              kind: 'binary',
              op: 'modulo',
              left: { kind: 'literal', value: 1 },
              right: { kind: 'literal', value: 2 },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

// ── Preview ─────────────────────────────────────────────────────────────────

describe('preview runs an unsaved definition (D-B1-6)', () => {
  it('takes a run and a whole definition', () => {
    expect(
      PreviewPayrollReportSchema.safeParse({ runId: OID, definition: definition() }).success,
    ).toBe(true);
  });

  it('refuses a definition it would not have accepted saved', () => {
    expect(
      PreviewPayrollReportSchema.safeParse({
        runId: OID,
        definition: definition({ measures: [] }),
      }).success,
    ).toBe(false);
  });

  it('refuses a run id that is not one', () => {
    expect(
      PreviewPayrollReportSchema.safeParse({ runId: 'latest', definition: definition() }).success,
    ).toBe(false);
  });
});
