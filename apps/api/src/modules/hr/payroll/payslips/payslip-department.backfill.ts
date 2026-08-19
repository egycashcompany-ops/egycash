// P-SCOPE-1 stage 3 — the payslips' share of the department backfill.
//
// IT ATTRIBUTES BY PERIOD, NOT BY PRINT DATE, and that distinction is the whole of this file.
// `issuedAt` is `new Date()` at the moment the pass runs (`payslip.service.ts`), so a February
// payslip issued in August carries an August timestamp. Attributing by it would put February's
// cost in the department the employee moved to in June — and every figure would still add up.
//
// D-CC-7 settled exactly this for the cost centre: «the one in force on the LAST DAY OF THE
// PERIOD, not on the day the pass happens to run». The department follows the same rule, so the
// two stamps on one payslip cannot disagree about which month it belongs to.
import { periodRange } from '../compensation/compensation-rules';
import { type BackfillResult, backfillDepartments } from '../../shared/department-backfill';
import { PayslipModel } from './payslip.model';

export const backfillPayslipDepartments = async (): Promise<BackfillResult> =>
  backfillDepartments(
    PayslipModel,
    (row) => {
      const period = row['period'];
      // A row with no readable period cannot be placed in a month, so it stays unattributed
      // rather than falling back to a date that would answer confidently and wrongly.
      if (typeof period !== 'string') return null;
      try {
        return periodRange(period).to;
      } catch {
        return null;
      }
    },
    { period: 1 },
  );
