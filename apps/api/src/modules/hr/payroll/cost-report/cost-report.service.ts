// The dynamic run cost report (P-HR-25).
//
// WHAT MAKES THIS DIFFERENT FROM U14-1, AND WHY IT IS ALLOWED. The cost breakdown beside this file
// states three splits at once and the caller chooses nothing — deliberately, because P-HR-15
// recorded that a report is a DEFINITION (which rows, for whom, sliced how) and nobody had given
// one. This is the other half of that sentence: the caller names the axis and writes the calculated
// columns, so a definition exists without this system having invented one. The rule was not
// relaxed; it was satisfied from the other side.
//
// AND THE FIGURES ARE STILL THE PAYSLIPS'. Nothing here recomputes pay. Every amount is a sum of
// lines a frozen payslip already holds, and if a total here disagreed with the payslips it summed,
// the payslips would be right.
//
// EVERY READ TAKES THE CALLER'S SCOPE — audit finding A2. An axis is a way of arranging what
// somebody may already see; it must never be a way of seeing more, so the grouping goes through the
// same scoped pipeline the breakdown uses rather than a query of its own.
import {
  fromMinorUnits,
  type PayItemKind,
  type PayrollReportColumn,
  type PayrollReportGroupBy,
  type PayrollRunCostReportDto,
  type PayrollRunCostReportRowDto,
} from '@ecms/contracts';
import { branchService, costCenterRepository } from '../../../../platform/organization';
import { type ScopeSelector } from '../../../../shared/types';
import { payslipRepository, type PayslipLineGroupRow } from '../payslips/payslip.repository';
import { payrollRunRepository } from '../runs/payroll-run.repository';
import { assertColumnsValid, computeColumns } from './cost-report.row';

/** A display name and, where the axis has one, the code that identifies it to a person. */
interface AxisLabel {
  code: string | null;
  name: { ar: string; en: string } | null;
}

/**
 * Which field of the grouped row carries the chosen axis's id.
 *
 * `origin` groups by a value that IS its own identifier — there is no row to look up — so it reads
 * from the row directly like the others and simply resolves to no label.
 */
const axisIdOf = (row: PayslipLineGroupRow, axis: PayrollReportGroupBy): string | null => {
  if (axis === 'origin') return row.origin;
  if (axis === 'payItem') return row.payItemId;
  if (axis === 'branch') return row.branchId;
  return row.costCenterId;
};

class CostReportService {
  /**
   * One run's cost, along the axis the caller chose, with the columns they wrote.
   *
   * The run is resolved first so a caller cannot report on a run that does not exist, and a run
   * that has issued nothing answers with an empty row list rather than an error — "this month has
   * cost nothing yet" is a true answer.
   *
   * The columns are checked BEFORE the aggregation runs. A request that cannot be computed should
   * be refused as a request, not answered with a page of empty cells that reads like an empty
   * result.
   */
  async forRun(
    runId: string,
    groupBy: PayrollReportGroupBy,
    columns: readonly PayrollReportColumn[],
    scope: ScopeSelector,
  ): Promise<PayrollRunCostReportDto> {
    assertColumnsValid(columns);

    const run = await payrollRunRepository.getById(runId);
    const rows = await payslipRepository.lineTotalsByAxisForRun(runId, scope, groupBy);
    const labels = await this.labelsFor(rows, groupBy);

    return {
      runId,
      period: run.period,
      status: run.status,
      groupBy,
      columns: columns.map((column) => column.key),
      rows: rows.map((row): PayrollRunCostReportRowDto => {
        const axisId = axisIdOf(row, groupBy);
        const label = axisId === null ? undefined : labels.get(axisId);
        return {
          currency: row.currency,
          kind: row.kind as PayItemKind,
          axisId,
          // The pay-item axis carries the code the LINE stored, not the catalog's today: a payslip
          // line keeps its own copy precisely so a later rename cannot restate a document somebody
          // was paid against.
          axisCode: groupBy === 'payItem' ? row.code : (label?.code ?? null),
          axisLabel: label?.name ?? null,
          lines: row.lines,
          amountMinor: row.amountMinor,
          amount: fromMinorUnits(row.amountMinor),
          calculated: computeColumns(columns, row),
        };
      }),
    };
  }

  /**
   * Display names for whichever axis was chosen.
   *
   * LABELS ONLY. The figures do not depend on them, so an axis value whose record cannot be read
   * yields a null name rather than a missing row — money is never withheld because a label was.
   *
   * These lookups are unscoped, and that is safe rather than convenient: the ids being resolved
   * came out of the scoped aggregation above, so every one of them is already attached to money
   * this caller may see. Nothing here can surface a branch or a centre they could not.
   */
  private async labelsFor(
    rows: readonly PayslipLineGroupRow[],
    axis: PayrollReportGroupBy,
  ): Promise<Map<string, AxisLabel>> {
    const labels = new Map<string, AxisLabel>();
    if (axis === 'origin' || axis === 'payItem') return labels;

    const ids = [
      ...new Set(
        rows.map((row) => axisIdOf(row, axis)).filter((id): id is string => id !== null),
      ),
    ];
    if (ids.length === 0) return labels;

    if (axis === 'costCenter') {
      // One query for the whole page — the batch reader P-HR-23 already built for the payroll pass.
      const centres = await costCenterRepository.byIdsSystem(ids);
      for (const [id, centre] of centres) {
        labels.set(id, { code: centre.code, name: { ar: centre.name.ar, en: centre.name.en } });
      }
      return labels;
    }

    for (const id of ids) {
      const branch = await branchService.getById(id).catch(() => null);
      if (branch !== null) {
        labels.set(id, { code: branch.code, name: { ar: branch.name.ar, en: branch.name.en } });
      }
    }
    return labels;
  }
}

export const costReportService = new CostReportService();
