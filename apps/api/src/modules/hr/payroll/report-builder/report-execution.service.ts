// Running a report (scope B1) — saved or unsaved, the same path either way.
//
// IT REUSES P-HR-25'S PIPELINE RATHER THAN OWNING ONE. `lineTotalsForReport` is the same aggregation
// the cost breakdown and the dynamic report already run: the same scoped `$match`, the same
// concatenation of earnings and deductions, the same positive sums. A report ARRANGES what those
// surfaces show; it can never reach past them, because it is not asking a different question of the
// database.
//
// SCOPE IS THE CALLER'S, ALWAYS. The definition holds no branch and no employee — nothing in it can
// name whose money to show — so the same saved report hands a department manager their department's
// figures and hands an organization-scoped reader the whole company's. That is "لكل إدارة، بالإضافة
// إلى الشركة بالكامل" answered by the scope ladder rather than by an ownership model.
//
// NOTHING IS STORED. A result is computed and returned; there is no execution row, so no figure here
// can go stale against the payslips it summed.
import {
  type PayrollReportCellDto,
  type PayrollReportDefinitionBody,
  type PayrollReportDimension,
  type PayrollReportResultDto,
  type PayrollReportRowDto,
} from '@ecms/contracts';
import { branchService, costCenterRepository } from '../../../../platform/organization';
import { type ScopeSelector } from '../../../../shared/types';
import { payslipRepository } from '../payslips/payslip.repository';
import { payrollRunRepository } from '../runs/payroll-run.repository';
import { planFilters, sortRows } from './report-dimensions';
import { computeColumns } from './report-row';

/** Which `_id` sub-field carries each dimension's identity, and which carries its stored code. */
const CELL_FIELDS: Readonly<Record<PayrollReportDimension, { id: string; code?: string }>> = {
  kind: { id: 'kind' },
  origin: { id: 'origin' },
  payItem: { id: 'payItemId', code: 'code' },
  branch: { id: 'branchId' },
  costCenter: { id: 'costCenterId' },
};

const asString = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

class ReportExecutionService {
  /**
   * One run, one definition, one answer.
   *
   * The run is resolved first so a caller cannot report on a run that does not exist, and a run
   * that has issued nothing answers with no rows rather than an error — "this month has cost
   * nothing yet" is a true answer.
   */
  async run(
    runId: string,
    definition: PayrollReportDefinitionBody,
    scope: ScopeSelector,
  ): Promise<PayrollReportResultDto> {
    const run = await payrollRunRepository.getById(runId);
    const groups = await payslipRepository.lineTotalsForReport(
      runId,
      scope,
      definition.dimensions,
      planFilters(definition.filters),
    );

    const labels = await this.labelsFor(groups, definition.dimensions);

    const rows = groups.map((group) => {
      const cells: PayrollReportCellDto[] = definition.dimensions.map((dimension) => {
        const fields = CELL_FIELDS[dimension];
        const id = asString(group._id[fields.id]);
        const stored = fields.code === undefined ? null : asString(group._id[fields.code]);
        const label = id === null ? undefined : labels.get(`${dimension}:${id}`);
        return {
          dimension,
          id,
          code: stored ?? label?.code ?? null,
          label: label?.name ?? null,
        };
      });

      const measured = { lineCount: group.lines, amountMinor: group.amountMinor };
      const measures: Record<string, number> = {};
      for (const measure of definition.measures) measures[measure] = measured[measure];

      return {
        currency: String(group._id['currency'] ?? ''),
        cells,
        measures,
        calculated: computeColumns(definition.columns, measured),
      };
    });

    return {
      runId,
      period: run.period,
      dimensions: [...definition.dimensions],
      measures: [...definition.measures],
      columns: definition.columns.map((column) => column.key),
      // Sorted here rather than in the pipeline: a calculated column does not exist until after the
      // aggregation, so ordering by one could not be asked of the database at all. Doing it in one
      // place for every key beats doing it in two places for two kinds of key.
      rows: sortRows(rows, definition.sort) as PayrollReportRowDto[],
    };
  }

  /**
   * Display names for the id-valued dimensions this report selected.
   *
   * LABELS ONLY — the figures do not depend on them, so a record that cannot be read yields a null
   * name rather than a missing row. These lookups are unscoped, and that is safe rather than
   * convenient: every id came out of the scoped aggregation above, so each is already attached to
   * money this caller may see.
   */
  private async labelsFor(
    groups: readonly { _id: Record<string, unknown> }[],
    dimensions: readonly PayrollReportDimension[],
  ): Promise<Map<string, { code: string | null; name: { ar: string; en: string } | null }>> {
    const labels = new Map<string, { code: string | null; name: { ar: string; en: string } | null }>();

    if (dimensions.includes('costCenter')) {
      const ids = [
        ...new Set(groups.map((g) => asString(g._id['costCenterId'])).filter((id): id is string => id !== null)),
      ];
      // One query for the whole page — the batch reader P-HR-23 already built.
      const centres = await costCenterRepository.byIdsSystem(ids);
      for (const [id, centre] of centres) {
        labels.set(`costCenter:${id}`, {
          code: centre.code,
          name: { ar: centre.name.ar, en: centre.name.en },
        });
      }
    }

    if (dimensions.includes('branch')) {
      const ids = [
        ...new Set(groups.map((g) => asString(g._id['branchId'])).filter((id): id is string => id !== null)),
      ];
      for (const id of ids) {
        const branch = await branchService.getById(id).catch(() => null);
        if (branch !== null) {
          labels.set(`branch:${id}`, {
            code: branch.code,
            name: { ar: branch.name.ar, en: branch.name.en },
          });
        }
      }
    }

    return labels;
  }
}

export const reportExecutionService = new ReportExecutionService();
