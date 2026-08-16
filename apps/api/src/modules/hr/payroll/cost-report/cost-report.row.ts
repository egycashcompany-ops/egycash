// What a calculated column is allowed to name (P-HR-25 / D-REPORT-6, D-REPORT-13).
//
// A column is an expression, and P-HR-24 refuses an expression that references anything a DECLARED
// catalog does not list. This file is that declaration for the one data source this phase has: a
// grouped row of payslip lines. The catalog is DERIVED from the schema below rather than written
// out, so a field renamed here cannot leave a stale name behind in the catalog.
//
// NUMBERS ONLY, AND ONLY THIS ROW'S OWN NUMBERS. The engine offers arithmetic, so a currency code
// or an axis label has nothing it could do with them and is not offered. And the row is the whole
// horizon: `amountMinor / lines` is expressible, "share of the run's total" is not, because the
// total lives in other rows and aggregation is deliberately absent from the language. D-REPORT-13
// settles that as a decision rather than leaving it as an omission — exposing run totals here would
// make ratios possible without touching the engine, and that stays a separate decision nobody has
// taken.
import { z } from 'zod';
import {
  evaluateExpression,
  expressionCatalogFromSchema,
  fromMinorUnits,
  validateExpression,
  type ExpressionFieldCatalog,
  type PayrollReportColumn,
} from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';

/**
 * The numeric shape of one grouped row.
 *
 * `amount` is the major-unit form of `amountMinor`, derived through the same conversion every other
 * payroll total uses. It is offered because a column written by a person reads in the currency they
 * think in; both are the same figure, and neither is rounded here (D-REPORT-8 = A).
 */
export const CostReportRowSchema = z.object({
  /** How many payslip lines fell into this group. */
  lines: z.number(),
  amountMinor: z.number(),
  amount: z.number(),
});

/** The catalog every calculated column is validated against. Built once — it never varies. */
export const COST_REPORT_CATALOG: ExpressionFieldCatalog = expressionCatalogFromSchema(
  'payrollRunCostRow',
  CostReportRowSchema,
);

/**
 * The row as the engine reads it: a FLAT record keyed by the catalog's own paths.
 *
 * Flat because that is what `evaluateExpression` takes, and it takes it flat on purpose — a nested
 * shape would need a path walk, and a path walk over author-influenced strings is how `constructor`
 * becomes a readable "field".
 */
export const flattenRow = (row: {
  lines: number;
  amountMinor: number;
}): Record<string, number> => ({
  lines: row.lines,
  amountMinor: row.amountMinor,
  amount: fromMinorUnits(row.amountMinor),
});

/**
 * Check every column before ANY of them runs.
 *
 * Two reasons this happens up front rather than per row. A column naming a field the row does not
 * have is a mistake in the request, and answering it with a page of empty cells would look like an
 * empty result rather than a rejected question. And an author fixing one bad column at a time,
 * learning of the next only after resubmitting, is the experience the page registry refuses — so
 * every faulty column is reported together, with its own key naming it.
 *
 * Duplicate keys are refused for the same reason: two columns called `perLine` would silently
 * become one, and the caller would never learn which survived.
 */
export const assertColumnsValid = (columns: readonly PayrollReportColumn[]): void => {
  const details: { field: string; code: string; message: string }[] = [];
  const seen = new Set<string>();

  for (const column of columns) {
    if (seen.has(column.key)) {
      details.push({
        field: `columns.${column.key}`,
        code: 'DUPLICATE',
        message: `column "${column.key}" is defined more than once`,
      });
    }
    seen.add(column.key);

    const result = validateExpression(column.expression, COST_REPORT_CATALOG);
    if (!result.valid) {
      for (const issue of result.issues) {
        details.push({
          field: `columns.${column.key}${issue.path === '' ? '' : `.${issue.path}`}`,
          code: issue.code.toUpperCase(),
          message: issue.message,
        });
      }
    }
  }

  if (details.length > 0) {
    throw new ValidationError(details, 'This report has columns that cannot be computed');
  }
};

/**
 * Every column's value for one row.
 *
 * `null` is an ordinary answer — a division by zero, or an input that was itself null — and it
 * reaches the caller as an empty cell. The row is still returned: a group that exists cost what it
 * cost, and hiding it because one derived column could not be computed would remove money from a
 * report to protect a formula (D-REPORT-7 = A).
 */
export const computeColumns = (
  columns: readonly PayrollReportColumn[],
  row: { lines: number; amountMinor: number },
): Record<string, number | null> => {
  if (columns.length === 0) return {};
  const values = flattenRow(row);
  const out: Record<string, number | null> = {};
  for (const column of columns) {
    out[column.key] = evaluateExpression(column.expression, values);
  }
  return out;
};
