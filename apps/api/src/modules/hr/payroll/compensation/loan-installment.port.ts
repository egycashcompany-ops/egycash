// The ONE place payroll touches employee loans (P-HR-05-B).
//
// Both directions, one file, deliberately. A read — what does this employee owe this month — and a
// write-back — a payslip has just taken it. Two ports would have made "how much does payroll know
// about lending?" a question you answer by grepping.
//
// WHAT CROSSES, AND WHAT DOES NOT. What crosses is an amount, a currency and a sentence to print.
// What does not cross is the loan: not its balance, not its schedule, not how many instalments are
// left, not its status. Payroll prices a month; a repayment plan is not a payroll rule, and the
// engine on the other side of this file is pure and could not read one anyway.
//
// THE WRITE-BACK IS THE AT-4 SHAPE. A payroll run already reaches into attendance to freeze a
// period through `attendance-freeze.port.ts`; this is the same move for the same reason — the
// payslip is the receipt, so the moment it is issued is the moment a repayment becomes a fact.
// No event is invented for it: payroll emits none, and a subscriber would have had to be told the
// payslip id anyway.
import { employeeLoanService } from '../../employee-loans';

/** One month's instalment, as the engine will see it: an amount and a name. Nothing else. */
export interface LoanInstallmentInput {
  /** The row this line came from. Opaque here — it is the receipt's counterfoil, not a schedule. */
  id: string;
  amountMinor: number;
  currency: string;
  /** What the deduction is FOR, in the words somebody wrote when the money was lent. */
  reference: string;
}

/** One deduction a payslip has just taken, on its way back to the ledger that records it. */
export interface TakenInstallment {
  installmentId: string;
  employeeId: string;
  amountMinor: number;
}

export interface LoanInstallmentPort {
  /** What this employee owes this month — an empty list when nothing is due. */
  dueFor(employeeId: string, period: string): Promise<LoanInstallmentInput[]>;
  /**
   * Record that an issued payslip took these instalments.
   *
   * Idempotent on the far side: a re-issued payslip, a second run over the same month or a retried
   * batch all collide on a ledger row that already exists and change nothing. Returns how many
   * were newly recorded, which is what a caller would log rather than act on.
   */
  recordTaken(
    context: { runId: string; payslipId: string; period: string },
    taken: readonly TakenInstallment[],
  ): Promise<number>;
}

export const loanInstallmentPort: LoanInstallmentPort = {
  async dueFor(employeeId, period) {
    const due = await employeeLoanService.deductionsDueFor(employeeId, period);
    // The loan id is deliberately dropped here rather than carried into the engine: the engine has
    // no use for it, and a field it cannot use is a field somebody later branches on.
    return due.map((row) => ({
      id: row.installmentId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      reference: row.reference,
    }));
  },

  async recordTaken(context, taken) {
    let recorded = 0;
    for (const row of taken) {
      const written = await employeeLoanService.recordDeducted({
        installmentId: row.installmentId,
        employeeId: row.employeeId,
        period: context.period,
        runId: context.runId,
        payslipId: context.payslipId,
        amountMinor: row.amountMinor,
      });
      if (written) recorded += 1;
    }
    return recorded;
  },
};
