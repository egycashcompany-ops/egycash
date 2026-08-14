// The final settlement summary (P-HR-11) — a COMPOSITION, not a calculation.
//
// WHY THIS FEATURE EXISTS, AND WHY IT IS SO SMALL. Everything a settlement has to state is already
// computed correctly somewhere: the exit month's pay by the payroll engine (a leaver is already in
// that month's batch and already prorated to the day), the loan balance by the loans feature, the
// expired leave by the leave ledger. What did not exist was anywhere that brought them together —
// so settling with a leaver meant opening four screens and adding up by hand.
//
// SO IT QUOTES, IT DOES NOT COMPUTE. There is no arithmetic in this file and no stored row behind
// it. That is deliberate: a second answer about somebody's last salary is strictly worse than one,
// and a summary that recomputed its sources could disagree with them.
//
// WHERE IT LIVES, AND WHY NOT IN PAYROLL. `payroll/compensation/loan-installment.port.ts` states
// plainly what may cross it — "not its balance, not its schedule, not its status" — because payroll
// prices a month and a repayment plan is not a payroll rule. Widening that port for a settlement
// would contradict the reason it is narrow. This feature is not payroll reaching into lending; it
// is a third reader above both, and nothing imports it back, so no cycle and no seam is bent.
import {
  type CompensationEffectsDto,
  type EmployeeSettlementDto,
  type SettlementLeaveBalanceDto,
  type SettlementLoanDto,
  type SettlementPendingAdjustmentDto,
  type SettlementUnresolvedItem,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { dateOnlyIso, toDateOnly } from '../shared/business-date';
import { employeeRepository } from '../employee-management/employees';
import { compensationService } from '../payroll/compensation';
import { payrollAdjustmentService } from '../payroll/adjustments';
import { payrollRunService } from '../payroll/runs/payroll-run.service';
import { employeeLoanService } from '../employee-loans';
import { toEmployeeLoanDto } from '../employee-loans/employee-loan.mapper';
import { leaveBalanceService } from '../leave-management/leave-balances';

/**
 * The three amounts that need a policy decision before they can exist (design §5).
 *
 * Constant rather than derived, because every one of them is unresolved for the SAME reason — no
 * rule — and none of them becomes resolved by anything about a particular employee. The day one is
 * ruled, it leaves this list in the change that implements it, which is the shape every "not yet"
 * in this repository uses.
 */
const UNRESOLVED: SettlementUnresolvedItem[] = [
  'endOfServiceGratuity',
  'leaveEncashment',
  'noticePeriod',
];

/** `YYYY-MM` of a date, in the Cairo terms every payroll period is stated in. */
const periodOf = (date: Date): string => dateOnlyIso(toDateOnly(date)).slice(0, 7);

class SettlementService {
  /**
   * One leaver's settlement summary.
   *
   * Refused for somebody still employed — not as a permission matter but as a factual one: there is
   * no settlement until there is an exit, and an "exit month" for a person who has not left would
   * be a month this system had invented.
   */
  async summaryFor(employeeId: string, scope: ScopeSelector): Promise<EmployeeSettlementDto> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const exit = employee.exit;
    if (exit === null) {
      throw new BusinessRuleError('this employee has not exited — there is nothing to settle');
    }

    const exitPeriod = periodOf(exit.effectiveDate);
    // The SAME engine the payslip used, asked for the same month. Not a copy of it.
    const finalPeriod: CompensationEffectsDto = await compensationService.effectsForEmployee(
      employee,
      exitPeriod,
    );
    const frozen = await payrollRunService.frozenPeriods();

    return {
      employeeId,
      employeeCode: employee.code,
      employeeName: employee.personal.fullNameAr,
      exitType: exit.type,
      effectiveDate: dateOnlyIso(toDateOnly(exit.effectiveDate)),
      exitPeriod,
      finalPeriod,
      finalPeriodFrozen: frozen.includes(exitPeriod),
      outstandingLoan: await this.loanFor(employeeId, scope),
      expiredLeave: await this.leaveFor(employeeId, exit.effectiveDate),
      pendingAdjustments: await this.pendingAdjustmentsFor(employeeId, exitPeriod, scope),
      unresolved: [...UNRESOLVED],
    };
  }

  /**
   * The loan still owing, or null.
   *
   * At most ONE, and that is D3's guarantee rather than an assumption here: an employee may have
   * one live loan at a time, so there is exactly one balance to talk about. `remaining` is quoted
   * as the loans feature derives it — principal minus everything repaid — and is never re-derived,
   * because a settlement that computed its own balance could differ from the one the loans tab
   * shows the same person.
   */
  private async loanFor(employeeId: string, scope: ScopeSelector): Promise<SettlementLoanDto | null> {
    const page = await employeeLoanService.listForEmployee(
      employeeId,
      { page: 1, pageSize: 50, sortDir: 'desc', status: 'outstandingAtExit' },
      scope,
    );
    const doc = page.items[0];
    if (doc === undefined) return null;
    const dto = toEmployeeLoanDto(doc);
    return {
      loanId: dto.id,
      type: dto.type,
      status: dto.status,
      remaining: dto.remaining,
      remainingMinor: dto.remainingMinor,
      repaid: dto.repaid,
      currency: dto.currency,
    };
  }

  /**
   * Money about the exit month that nobody has decided yet.
   *
   * ONLY the undecided ones — `draft` and `pendingApproval`. An approved adjustment is already a
   * line inside `finalPeriod`, so listing it again would put the same amount on the screen twice
   * and invite whoever settles to count it twice. A cancelled one is not money at all.
   *
   * What is left is the case that would otherwise be invisible: a bonus or a penalty sitting in
   * somebody's queue, about a month that is about to be settled, and in nobody's total.
   */
  private async pendingAdjustmentsFor(
    employeeId: string,
    period: string,
    scope: ScopeSelector,
  ): Promise<SettlementPendingAdjustmentDto[]> {
    const page = await payrollAdjustmentService.listForEmployee(
      employeeId,
      { page: 1, pageSize: 100, sortDir: 'desc', period },
      scope,
    );
    return page.items
      .filter((doc) => doc.status === 'draft' || doc.status === 'pendingApproval')
      .map((doc) => ({
        adjustmentId: String(doc._id),
        kind: doc.kind,
        status: doc.status,
        amount: doc.amount,
        currency: doc.currency,
        reason: doc.reason,
      }));
  }

  /**
   * What the exit expired, reported as expired.
   *
   * The leave feature already zeroes every balance at exit with a ledger entry reading `employee
   * exited`. Today that means unused leave is NOT paid — which is a real decision rather than an
   * oversight, and the reason `leaveEncashment` sits in `unresolved` above. This reports the days
   * that were lost so the question is visible to whoever settles, without answering it.
   */
  private async leaveFor(employeeId: string, exitDate: Date): Promise<SettlementLeaveBalanceDto[]> {
    // The LEDGER, not the balance. `expireAllFor` zeroes the balance, so asking it after an exit
    // reports that nothing was lost — the entries it wrote are the only surviving record of what
    // was. Filtered to `expire`: a grant or a consumption is not something a settlement is about.
    const page = await leaveBalanceService.ledgerFor(employeeId, {
      year: exitDate.getUTCFullYear(),
      page: 1,
      pageSize: 200,
    });
    return page.items
      .filter((row) => row.kind === 'expire' && row.days > 0)
      .map((row) => ({
        typeId: String(row.typeId),
        year: row.year,
        expiredDays: row.days,
      }));
  }
}

export const settlementService = new SettlementService();
