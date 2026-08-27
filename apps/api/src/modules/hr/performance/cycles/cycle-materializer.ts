// Opening a round writes its rows (P-HR-PRF D2, D4, D14).
//
// «NOT STARTED» IS A PERSISTED ROW, NEVER THE ABSENCE OF ONE. The same stance recruitment's queue
// materializer takes, and it is taken again rather than borrowed: that engine is bound to
// recruitment's stage vocabulary, and coupling two modules through a shape neither owns would make
// every future change to one a change to both.
//
// What it buys is that every queue, counter and badge downstream is a plain indexed read over
// explicit statuses. The alternative — deriving who OUGHT to be in the round at display time — has
// nowhere to record that somebody was excused, nowhere to hold an evaluator assignment, and
// quietly changes its answer whenever anybody transfers.
//
// IT DECIDES NOTHING. The cycle's scope already said who is in the round (D3); this opens the rows
// that statement implies. Its only judgement is the evaluator DEFAULT, which is a starting point a
// human may change (D4) rather than a rule.
import { type Types } from 'mongoose';
import { type PerformanceCycleOpenResultDto } from '@ecms/contracts';
import { departmentRepository } from '../../../../platform/organization/departments/department.repository';
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { type EmployeeDoc } from '../../employee-management/employees/employee.model';
import { employeeLabelMap } from '../../shared/employee-labels';
import { performanceReviewRepository } from '../performance.repository';
import { type PerformanceCycleDoc } from './performance-cycle.model';

/** The employees the cycle's stated scope names — see `listEmployedByPlacementSystem` for why. */
export const employeesInScope = async (cycle: PerformanceCycleDoc): Promise<EmployeeDoc[]> => {
  if (cycle.scopeKind === 'everyone') {
    return employeeRepository.listEmployedByPlacementSystem([], []);
  }
  return employeeRepository.listEmployedByPlacementSystem(
    cycle.scopeBranchIds.map(String),
    cycle.scopeDepartmentIds.map(String),
  );
};

/**
 * Every department manager named by the employees in scope, read once instead of once per row.
 *
 * A MISSING DEPARTMENT IS NULL, NOT A FAILURE. `findById` rather than `getById` because a
 * department that has been removed under a still-employed person is a data problem somebody has to
 * fix — and refusing to open the whole round over it would make one bad row block a company-wide
 * cycle, which is a worse outcome than one review needing an evaluator assigned by hand.
 */
const departmentManagersOf = async (
  employees: readonly EmployeeDoc[],
): Promise<Map<string, Types.ObjectId | null>> => {
  const ids = [...new Set(employees.map((employee) => String(employee.employment.departmentId)))];
  const managers = new Map<string, Types.ObjectId | null>();
  for (const id of ids) {
    const department = await departmentRepository.findById(id);
    managers.set(id, department?.managerId ?? null);
  }
  return managers;
};

/**
 * The evaluator's default, in the order that survives an org chart with holes.
 *
 * THE EMPLOYEE'S OWN MANAGER FIRST, then their department's. The direct manager is who actually
 * reviews somebody; the department's is the fallback for the people the chart was never filled in
 * for. Whichever is found is written down ONCE and then belongs to the review — neither source is
 * consulted again after the round opens, which is the whole of D4.
 *
 * Null when neither exists. That is a real state and not an error: the round still opens, the
 * result says how many rows came out unassigned, and somebody assigns them.
 */
const defaultEvaluatorOf = (
  employee: EmployeeDoc,
  departmentManagers: Map<string, Types.ObjectId | null>,
): Types.ObjectId | null =>
  employee.employment.managerId ??
  departmentManagers.get(String(employee.employment.departmentId)) ??
  null;

/**
 * Write one review per employee in scope, and report what that came to.
 *
 * IDEMPOTENT BY CONSTRUCTION — the row is upserted against the same `(cycleId, employeeId)` the
 * unique index covers, and only on INSERT is anything written. That matters because opening is
 * exactly the kind of act that gets retried: a timeout, a double click, a redeploy halfway
 * through. A materializer that is not idempotent turns each of those into an assessment somebody
 * had already written being replaced by a blank one, with nothing to say it happened.
 */
export const materializeReviews = async (
  cycle: PerformanceCycleDoc,
  by: string,
): Promise<PerformanceCycleOpenResultDto> => {
  const employees = await employeesInScope(cycle);
  const departmentManagers = await departmentManagersOf(employees);

  const assignments = employees.map((employee) => ({
    employee,
    evaluatorId: defaultEvaluatorOf(employee, departmentManagers),
  }));
  // The evaluators' names, batched — the review stores the name beside the id (D7), and reading
  // them one at a time would be a query per row on the one act that touches every row.
  const evaluatorNames = await employeeLabelMap(
    assignments
      .map((assignment) => assignment.evaluatorId)
      .filter((id): id is Types.ObjectId => id !== null)
      .map(String),
  );

  let created = 0;
  let unassigned = 0;
  for (const { employee, evaluatorId } of assignments) {
    if (evaluatorId === null) unassigned += 1;
    const inserted = await performanceReviewRepository.openForEmployee(
      String(cycle._id),
      String(employee._id),
      {
        cycleName: cycle.name,
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        evaluatorId,
        evaluatorName:
          evaluatorId === null ? null : (evaluatorNames.get(String(evaluatorId))?.name ?? null),
        branchId: employee.branchId,
        departmentId: employee.departmentId,
      },
      by,
    );
    if (inserted) created += 1;
  }
  return { cycleId: String(cycle._id), matched: employees.length, created, unassigned };
};
