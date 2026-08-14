// Run reconciliation (P-HR-15-A) — identities, not opinions.
//
// WHAT THIS IS, AND WHAT IT IS NOT. Every figure here is a SUM or a COUNT of documents this system
// already wrote, so each line either agrees with the payslips or something is wrong. It is not a
// report: which reports exist, for whom and with which columns is a requirement nobody has given,
// and that half of P-HR-15 stays blocked (design §3).
//
// NOTHING IS STORED AND NOTHING IS RECOMPUTED. A payslip is a frozen copy of what somebody was
// paid; this adds it up and says so. If a total here ever disagreed with the payslips it summed,
// the payslips would be right.
//
// EVERY READ TAKES THE CALLER'S SCOPE, and that is a correctness rule rather than a courtesy: a
// branch payroll reader must reconcile THEIR branch. Mixing scopes — organization-wide approvals
// against branch-scoped payslips — would not merely over-report, it would state a discrepancy that
// does not exist, which is worse than refusing to answer.
//
// THE ONE CHECK THAT IS MISSING, ON PURPOSE. Loan repayments recorded for a run against the
// `loanInstallment` lines on its payslips would be the most valuable identity of all — and payroll
// may not read the loan ledger. The P-HR-05-B port allows an amount and a sentence across, "not its
// balance, not its schedule, not its status", and widening it is an architectural decision rather
// than a reporting one. Recorded in design §4, left out here.
import {
  fromMinorUnits,
  type PayrollRunAdjustmentReconciliationDto,
  type PayrollRunCoverageDto,
  type PayrollRunReconciliationDto,
  type PayrollRunTotalsDto,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { employeeRepository } from '../../employee-management/employees';
import { employmentSpansOf } from '../compensation/employment-spans';
import { periodRange } from '../compensation/compensation-rules';
import { payrollAdjustmentRepository } from '../adjustments/payroll-adjustment.repository';
import { employedDuring } from '../payslips/payslip-eligibility';
import { payslipRepository } from '../payslips/payslip.repository';
import { payrollRunRepository } from '../runs/payroll-run.repository';

class ReconciliationService {
  /**
   * One run, reconciled.
   *
   * The run is resolved first so a caller cannot reconcile a run that does not exist, and a draft
   * that has issued nothing reconciles to ZERO rather than to an error — "nothing has been issued
   * yet" is a true and useful answer, not a failure.
   */
  async forRun(runId: string, scope: ScopeSelector): Promise<PayrollRunReconciliationDto> {
    const run = await payrollRunRepository.getById(runId);

    const totalRows = await payslipRepository.totalsForRun(runId, scope);
    const totals: PayrollRunTotalsDto[] = totalRows.map((row) => ({
      currency: row.currency,
      payslips: row.payslips,
      totalEarningsMinor: row.totalEarningsMinor,
      totalEarnings: fromMinorUnits(row.totalEarningsMinor),
      totalDeductionsMinor: row.totalDeductionsMinor,
      totalDeductions: fromMinorUnits(row.totalDeductionsMinor),
      netMinor: row.netMinor,
      net: fromMinorUnits(row.netMinor),
    }));

    return {
      runId,
      period: run.period,
      status: run.status,
      totals,
      coverage: await this.coverageFor(runId, run.period, scope),
      adjustments: await this.adjustmentsFor(runId, run.period, scope),
    };
  }

  /**
   * Who should have been paid, against who was.
   *
   * The population is the SAME one PY-7 issues from — `employedDuring` over each employee's spans —
   * so a gap here is the gap that batch left rather than a second opinion about who works here.
   * Reusing the pure function is the point: two definitions of "employed in this month" would be
   * one definition too many.
   */
  private async coverageFor(
    runId: string,
    period: string,
    scope: ScopeSelector,
  ): Promise<PayrollRunCoverageDto> {
    const window = periodRange(period);
    const everyone = await employeeRepository.listAllInScope(scope);
    const employedInPeriod = everyone.filter((employee) =>
      employedDuring(employmentSpansOf(employee), window),
    ).length;
    const withPayslip = (await payslipRepository.employeeIdsForRun(runId, scope)).length;
    return {
      employedInPeriod,
      withPayslip,
      // Never negative: a payslip belongs to somebody employed in the period by construction, but
      // clamping says so out loud rather than trusting arithmetic on two independent reads.
      withoutPayslip: Math.max(0, employedInPeriod - withPayslip),
    };
  }

  /**
   * Approved adjustments for the period, against what actually reached a payslip.
   *
   * A DIFFERENCE IS NOT AN ERROR, and nothing here calls it one. The ordinary cause is an
   * adjustment approved after the run issued its payslips — which P-HR-04 permits and P-HR-08 has
   * a forward path for. It is surfaced because somebody settling a month needs to see it.
   *
   * Both sides count POSITIVE amounts: an adjustment's `amount` is always positive and its
   * direction is `kind`'s job, so the payslip side sums bonus and penalty lines the same way.
   * Signing one side and not the other would compare two different quantities.
   */
  private async adjustmentsFor(
    runId: string,
    period: string,
    scope: ScopeSelector,
  ): Promise<PayrollRunAdjustmentReconciliationDto[]> {
    const approved = await payrollAdjustmentRepository.approvedTotalsForPeriod(period, scope);
    const onPayslips = await payslipRepository.adjustmentLineTotalsForRun(runId, scope);

    // Every currency that appears on either side — a currency present only on the payslips is as
    // much a discrepancy as one present only among the approvals, and dropping it would hide it.
    const currencies = [
      ...new Set([...approved.map((r) => r.currency), ...onPayslips.map((r) => r.currency)]),
    ].sort();

    return currencies.map((currency) => {
      const approvedRow = approved.find((r) => r.currency === currency);
      const paidMinor = onPayslips.find((r) => r.currency === currency)?.minor ?? 0;
      const approvedMinor = approvedRow?.minor ?? 0;
      return {
        currency,
        approvedForPeriod: approvedRow?.count ?? 0,
        approvedMinor,
        onPayslipsMinor: paidMinor,
        differenceMinor: approvedMinor - paidMinor,
      };
    });
  }
}

export const reconciliationService = new ReconciliationService();
