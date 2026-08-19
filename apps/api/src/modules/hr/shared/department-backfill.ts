// The mechanics of the department backfill, once (P-SCOPE-1 stage 3).
//
// `department-at.ts` holds the RULE; this holds the loop that applies it — read the un-stamped
// rows, ask the rule, write the answer. It is here rather than in any one feature because four
// collections across three features need it, and the seams forbid a single file from reaching
// them: payroll may not name a loan collection (P-HR-05-B), and the adjustments model is reachable
// from three files inside its own feature only.
//
// So this function never names a collection. The CALLER hands in its own model, from inside the
// feature that owns it, and the seam guards keep holding — each model still appears only where it
// is allowed to.
import { Types, type Model } from 'mongoose';
import { EmployeeActionModel } from '../employee-management/employee-actions/employee-action.model';
import { employeeRepository } from '../employee-management/employees';
import { departmentAt, type DepartmentMove } from './department-at';

/** What the backfill needs any row to have: whose it is, and when it happened. */
export interface DepartmentStamped {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  departmentId: Types.ObjectId | null;
}

export interface BackfillResult {
  filled: number;
  /** Rows no department could be established for. They stay null — invisible under D-DEPT-4. */
  unattributed: number;
}

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

/**
 * Stamp the department onto every row of one collection that carries none.
 *
 * IDEMPOTENT AND ADDITIVE BY FILTER, not by a flag: both the read and the write name
 * `departmentId: null`, so a second run finds nothing and a row somebody corrected between the two
 * is never overwritten. It sets one field and reads no other.
 */
export const backfillDepartments = async <T extends DepartmentStamped>(
  model: Model<T>,
  dateField: 'issuedAt' | 'createdAt',
): Promise<BackfillResult> => {
  const rows = (await model
    .find({ departmentId: null })
    .select({ employeeId: 1, [dateField]: 1 })
    .lean()
    .exec()) as unknown as Record<string, unknown>[];
  if (rows.length === 0) return { filled: 0, unattributed: 0 };

  const employeeIds = [...new Set(rows.map((row) => String(row['employeeId'])))];
  const employees = await employeeRepository.findByIdsSystem(employeeIds);
  const current = new Map<string, string | null>(
    employees.map((employee) => [String(employee._id), String(employee.departmentId)]),
  );
  const moves = await departmentMovesFor(employeeIds);

  let filled = 0;
  let unattributed = 0;
  for (const row of rows) {
    const at = row[dateField] as Date | undefined;
    const employeeId = String(row['employeeId']);
    // A row with no date cannot be placed in time, so it cannot be attributed.
    const resolved =
      at === undefined
        ? null
        : departmentAt(moves.get(employeeId) ?? [], at, current.get(employeeId) ?? null);

    if (resolved === null || !Types.ObjectId.isValid(resolved)) {
      unattributed += 1;
      continue;
    }
    await model
      .updateOne(
        { _id: row['_id'], departmentId: null } as never,
        { $set: { departmentId: new Types.ObjectId(resolved) } } as never,
      )
      .exec();
    filled += 1;
  }
  return { filled, unattributed };
};
