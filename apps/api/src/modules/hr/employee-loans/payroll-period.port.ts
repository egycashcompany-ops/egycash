// The ONE place loans ask payroll a question (P-HR-05, phase A).
//
// Two questions, both about the CALENDAR rather than about money: what days a period covers, and
// which periods have been closed. Loans needs the first to check a schedule against an employment
// span, and the second to refuse scheduling a deduction into a month that has already been priced.
//
// It is a port rather than a pair of imports for the reason every other seam in this system is one:
// so that "how much does loans know about payroll?" has a one-file answer. Nothing about a loan
// crosses in the other direction here — phase A adds no payroll input at all, and the compensation
// engine does not know this feature exists.
import { periodRange } from '../payroll/compensation/compensation-rules';
import { payrollRunService } from '../payroll/runs/payroll-run.service';

export interface PayrollPeriodPort {
  /** The period's first and last calendar day, as date-only UTC midnights. */
  bounds(period: string): { from: Date; to: Date };
  /** The periods a frozen run has closed (PY-9). There is no unfreeze. */
  frozen(): Promise<string[]>;
}

export const payrollPeriodPort: PayrollPeriodPort = {
  bounds: (period) => periodRange(period),
  frozen: async () => payrollRunService.frozenPeriods(),
};
