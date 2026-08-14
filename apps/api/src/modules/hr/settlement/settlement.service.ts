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
  type ListSettlementQueueQuery,
  type Paginated,
  type SettlementQueueRowDto,
  type SettlementLeaveBalanceDto,
  type SettlementLoanDto,
  type SettlementPendingAdjustmentDto,
  type SettlementUnresolvedItem,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { dateOnlyIso, toDateOnly } from '../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../employee-management/employees';
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
   * WHO is waiting to be settled (P-HR-17) — the opposite question to the summary below.
   *
   * The summary answers "what does this person's settlement consist of?" and is reached from their
   * profile, which means you have to know their name already. This answers "whose settlement has
   * not happened?", which is the question somebody doing the settling actually starts from.
   *
   * IT STATES NO AMOUNT. Not the balance, not the final pay. A queue exists to say who and why;
   * the figures are one click away on the settlement screen behind the same key, and a list that
   * restated them would be a second place for the same money to be read.
   */
  async queue(
    query: ListSettlementQueueQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<SettlementQueueRowDto>> {
    // The employees feature's own read, with `employed: false` — which IS "has exited". Nothing
    // here re-derives who has left, and no filter was added to that query for this screen.
    const page = await employeeRepository.listEmployees({
      filter: {
        employed: false,
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.branchId === undefined ? {} : { branchId: [query.branchId] }),
        ...(query.departmentId === undefined ? {} : { departmentId: query.departmentId }),
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'hiredAt',
      sortDir: query.sortDir ?? 'desc',
      scope,
    });

    // One call for the whole page — which months are settled is a property of the runs, not of
    // any employee.
    const frozen = await payrollRunService.frozenPeriods();

    const items: SettlementQueueRowDto[] = [];
    for (const employee of page.items) {
      const exit = employee.exit;
      // `employed: false` is the exit filter, so this cannot normally be null. It is skipped rather
      // than asserted because a row with no exit has nothing to settle and inventing an exit month
      // for it would be worse than leaving it out.
      if (exit === null) continue;
      const exitPeriod = periodOf(exit.effectiveDate);
      items.push({
        employeeId: String(employee._id),
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        exitType: exit.type,
        effectiveDate: dateOnlyIso(toDateOnly(exit.effectiveDate)),
        exitPeriod,
        hasOutstandingLoan: await this.owesAtExit(String(employee._id), scope),
        finalPeriodOpen: !frozen.includes(exitPeriod),
      });
    }
    return { items, meta: page.meta };
  }

  /**
   * Does this leaver still owe money? A point lookup, not a scan.
   *
   * ONE QUERY PER ROW, and the exception to P-HR-06's "one query per page" is argued rather than
   * assumed: the alternative is reading every `outstandingAtExit` loan in the organization, a set
   * that grows without bound as leavers accumulate and that `MAX_PAGE_SIZE` would silently
   * truncate — producing a FALSE flag rather than a slow one. This is indexed, exact, and bounded
   * by the page size.
   */
  private async owesAtExit(employeeId: string, scope: ScopeSelector): Promise<boolean> {
    const page = await employeeLoanService.listForEmployee(
      employeeId,
      { page: 1, pageSize: 1, sortDir: 'desc', status: 'outstandingAtExit' },
      scope,
    );
    return page.items.length > 0;
  }

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
      expiredLeave: await this.leaveFor(employeeId, employee),
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
  private async leaveFor(
    employeeId: string,
    employee: EmployeeDoc,
  ): Promise<SettlementLeaveBalanceDto[]> {
    // The LEDGER, not the balance. `expireAllFor` zeroes the balance, so asking it after an exit
    // reports that nothing was lost — the entries it wrote are the only surviving record of what
    // was. Filtered to `expire`: a grant or a consumption is not something a settlement is about.
    //
    // NOT FILTERED BY THE EXIT'S YEAR, and that distinction is the whole correctness of this read.
    // `expireAllFor` stamps each entry with the BALANCE's year — the year the days belonged to —
    // which is not the year somebody left in. A balance granted for 2026 that is expired by an
    // exit dated 2025 is written as 2026, so asking for 2025 finds nothing and the screen reports
    // that no leave was lost. Every expired day is reported instead, each carrying its own year.
    const page = await leaveBalanceService.ledgerFor(employeeId, { page: 1, pageSize: 200 });

    // Only what THIS employment lost. A rehired employee carries the previous exit's entries too,
    // and those were settled at the time — scoped by the current period's hire year, because a
    // balance granted during this employment cannot belong to a year before it began.
    const hiredAt = employee.employmentPeriods.reduce<Date | null>(
      (latest, period) =>
        latest === null || period.hiredAt > latest ? period.hiredAt : latest,
      null,
    );
    const fromYear = hiredAt === null ? Number.NEGATIVE_INFINITY : hiredAt.getUTCFullYear();

    // Summed per type and year: one exit writes at most one entry per balance, but a rehire inside
    // the same calendar year can produce a second, and two rows for one type-and-year would read
    // as two separate losses.
    const byKey = new Map<string, SettlementLeaveBalanceDto>();
    for (const row of page.items) {
      if (row.kind !== 'expire' || row.days <= 0 || row.year < fromYear) continue;
      const typeId = String(row.typeId);
      const key = `${typeId}:${String(row.year)}`;
      const found = byKey.get(key);
      if (found === undefined) {
        byKey.set(key, { typeId, year: row.year, expiredDays: row.days });
      } else {
        found.expiredDays += row.days;
      }
    }
    return [...byKey.values()];
  }
}

export const settlementService = new SettlementService();
