// Reading where an employee has BEEN, from the append-only action log (P-SCOPE-1).
//
// Separate from both neighbours on purpose. `department-at.ts` is the pure rule and touches no
// database; `department-backfill.ts` is the write loop. This is the read they share — and it is
// its own module because the ISSUING path needs it too, and `payslip.service.ts` may not so much
// as name a backfill: D-CC-5 decided that phase invents no membership for the past, and a guard
// holds the word itself out of that file. A module should say what it does, and this one reads.
import { Types } from 'mongoose';
import { EmployeeActionModel } from '../employee-management/employee-actions/employee-action.model';
import { type DepartmentMove } from './department-at';

/**
 * Every recorded department move for these employees, from the applied action log.
 *
 * A transfer writes `{ field: 'departmentId', from, to }` alongside an `effectiveDate`
 * (`employee-action.service.ts:593`). Scheduled and cancelled actions are excluded: a move that
 * has not been applied did not happen.
 */
export const departmentMovesFor = async (
  employeeIds: readonly string[],
): Promise<Map<string, DepartmentMove[]>> => {
  const actions = await EmployeeActionModel.find({
    employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
    status: 'applied',
    'changes.field': 'departmentId',
  })
    .select({ employeeId: 1, effectiveDate: 1, changes: 1 })
    .lean()
    .exec();

  const byEmployee = new Map<string, DepartmentMove[]>();
  for (const action of actions) {
    for (const change of action.changes) {
      if (change.field !== 'departmentId') continue;
      const key = String(action.employeeId);
      const moves = byEmployee.get(key) ?? [];
      moves.push({
        from: change.from === null ? null : String(change.from),
        to: change.to === null ? null : String(change.to),
        effectiveDate: action.effectiveDate,
      });
      byEmployee.set(key, moves);
    }
  }
  return byEmployee;
};
