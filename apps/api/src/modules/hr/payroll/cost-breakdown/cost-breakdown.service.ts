// What a run cost, along the dimensions its own payslip lines already carry (P-HR-14 / U14-1).
//
// THE ONE THING P-HR-14 CAN BUILD TODAY. A general-ledger posting needs a chart of accounts, a
// mapping from pay item to account, a posting rule, a trigger, a granularity and a reversal policy.
// This repository contains none of them, and the discovery for P-HR-14 keeps all six open as owner
// decisions. What it does contain is every FIGURE such a posting would carry, already written down
// on the payslips — so the arithmetic can be built now and the accounting cannot.
//
// SO THIS FILE NAMES NO ACCOUNT. No account code, no mapping, no journal, no debit or credit, no
// posting, no reversal. If those words ever appear here, a decision was taken that nobody made.
//
// EVERY READ TAKES THE CALLER'S SCOPE — the rule P-HR-15-A's audit finding (A2) established: a
// branch payroll reader must be shown their branch's cost, and an aggregate that ignored scope
// would hand them organization-wide money without ever looking like a permission bug.
//
// NOTHING IS STORED AND NOTHING IS RECOMPUTED. Every figure is a sum of lines a frozen payslip
// already holds. If a total here disagreed with the payslips it summed, the payslips would be
// right.
import {
  fromMinorUnits,
  type CompensationLineOrigin,
  type PayItemKind,
  type PayrollRunCostBreakdownDto,
  type PayrollRunCostByBranchDto,
  type PayrollRunCostByPayItemDto,
  type PayrollRunCostRowDto,
} from '@ecms/contracts';
import { branchService } from '../../../../platform/organization';
import { type ScopeSelector } from '../../../../shared/types';
import { payslipRepository, type PayslipLineGroupRow } from '../payslips/payslip.repository';
import { payrollRunRepository } from '../runs/payroll-run.repository';

class CostBreakdownService {
  /**
   * One run's cost, in three splits of the same money.
   *
   * The run is resolved first so a caller cannot ask about a run that does not exist, and a run
   * that has issued nothing answers with three empty lists rather than an error — "this month has
   * cost nothing yet" is a true answer.
   */
  async forRun(runId: string, scope: ScopeSelector): Promise<PayrollRunCostBreakdownDto> {
    const run = await payrollRunRepository.getById(runId);

    const [byOriginRows, byPayItemRows, byBranchRows] = await Promise.all([
      payslipRepository.lineTotalsByOriginForRun(runId, scope),
      payslipRepository.lineTotalsByPayItemForRun(runId, scope),
      payslipRepository.lineTotalsByBranchForRun(runId, scope),
    ]);

    return {
      runId,
      period: run.period,
      status: run.status,
      byOrigin: byOriginRows.map(
        (row): PayrollRunCostRowDto => ({
          currency: row.currency,
          kind: row.kind as PayItemKind,
          origin: row.origin as CompensationLineOrigin,
          lines: row.lines,
          ...money(row),
        }),
      ),
      byPayItem: byPayItemRows.map(
        (row): PayrollRunCostByPayItemDto => ({
          currency: row.currency,
          kind: row.kind as PayItemKind,
          origin: row.origin as CompensationLineOrigin,
          payItemId: row.payItemId,
          // The code the LINE stored, not the catalog's today: a payslip line keeps its own copy
          // precisely so a later rename cannot restate a document somebody was paid against.
          code: row.code ?? '',
          lines: row.lines,
          ...money(row),
        }),
      ),
      byBranch: await this.labelBranches(byBranchRows),
    };
  }

  /**
   * Branch names for display, resolved once per distinct branch.
   *
   * Labels only — the figures do not depend on them, so a branch that cannot be read yields a null
   * name rather than a missing row. Money is never withheld because a label was.
   */
  private async labelBranches(rows: PayslipLineGroupRow[]): Promise<PayrollRunCostByBranchDto[]> {
    const ids = [...new Set(rows.map((row) => row.branchId).filter((id): id is string => id !== null))];
    const names = new Map<string, { ar: string; en: string }>();
    for (const id of ids) {
      const branch = await branchService.getById(id).catch(() => null);
      if (branch !== null) names.set(id, { ar: branch.name.ar, en: branch.name.en });
    }
    return rows.map((row) => ({
      currency: row.currency,
      kind: row.kind as PayItemKind,
      branchId: row.branchId,
      branchName: row.branchId === null ? null : (names.get(row.branchId) ?? null),
      lines: row.lines,
      ...money(row),
    }));
  }
}

/**
 * Minor units are what was summed; the major figure is DERIVED on the way out, through the same
 * conversion every other payroll total uses. Returning both without a single source would let the
 * two drift.
 */
const money = (row: PayslipLineGroupRow): { amountMinor: number; amount: number } => ({
  amountMinor: row.amountMinor,
  amount: fromMinorUnits(row.amountMinor),
});

export const costBreakdownService = new CostBreakdownService();
