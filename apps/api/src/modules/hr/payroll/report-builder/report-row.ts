// What a calculated column may name in a built report (scope B1).
//
// WHY THIS IS NOT `cost-report.row.ts`. The mechanism is identical and deliberately so — the same
// `expressionCatalogFromSchema`, the same `validateExpression`, the same `evaluateExpression`. What
// differs is the VOCABULARY: P-HR-25's row calls its count `lines`, while a built report selects
// measures by their contract names, and `lineCount` is one of them. A column referring to
// `lineCount` must find `lineCount`, so the catalog is derived from this shape rather than that one.
// Sharing the file would mean sharing the wrong names.
//
// D-REPORT-13 STILL HOLDS: a column sees the measures of its own row and nothing else. There is no
// run total here, so "share of the whole run" remains inexpressible — a decision, not an omission.
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
 * Both measures are always present whatever the definition selected, because the pipeline computes
 * both regardless — selecting measures is a projection of the answer, not a different question. So a
 * column may reference either without the report having to have asked for it.
 */
export const ReportRowSchema = z.object({
  lineCount: z.number(),
  amountMinor: z.number(),
  /** The major-unit form, through the same conversion every other payroll total uses. */
  amount: z.number(),
});

export const REPORT_ROW_CATALOG: ExpressionFieldCatalog = expressionCatalogFromSchema(
  'payrollReportRow',
  ReportRowSchema,
);

/** Flat, keyed by the catalog's own paths — what `evaluateExpression` takes, and why. */
export const flattenRow = (row: {
  lineCount: number;
  amountMinor: number;
}): Record<string, number> => ({
  lineCount: row.lineCount,
  amountMinor: row.amountMinor,
  amount: fromMinorUnits(row.amountMinor),
});

/**
 * Refuse every uncomputable column, together, before any of them runs.
 *
 * Reported as one failure listing each offending column by its own key: an author fixing one at a
 * time, learning of the next only after saving again, is the experience the page registry refuses
 * and this refuses for the same reason.
 */
export const assertColumnsValid = (columns: readonly PayrollReportColumn[]): void => {
  const details: { field: string; code: string; message: string }[] = [];

  for (const column of columns) {
    const result = validateExpression(column.expression, REPORT_ROW_CATALOG);
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
 * `null` is an ordinary answer — a division by zero, a field that was itself null — and it reaches
 * the caller as an empty cell with the row intact (D-REPORT-7). A group that exists cost what it
 * cost; removing it to protect a formula would take money out of a report.
 */
export const computeColumns = (
  columns: readonly PayrollReportColumn[],
  row: { lineCount: number; amountMinor: number },
): Record<string, number | null> => {
  if (columns.length === 0) return {};
  const values = flattenRow(row);
  const out: Record<string, number | null> = {};
  for (const column of columns) {
    out[column.key] = evaluateExpression(column.expression, values);
  }
  return out;
};
