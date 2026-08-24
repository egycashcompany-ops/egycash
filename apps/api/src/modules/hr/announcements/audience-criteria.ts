// Turning a chosen audience into the criteria that select employees — PURE, so the decisions that
// decide who gets a company-wide message are testable without a database.
//
// Two of them are the reason this is its own file:
//
//   • WHO IS EXCLUDED BY DEFAULT. A login outlives an exit: somebody who left in March still has a
//     User row, and an announcement addressed to "everyone" would reach them. The employed
//     statuses are the default, and asking for `exited` has to be typed.
//
//   • THE CALLER'S SCOPE IS A CEILING, NOT A DEFAULT. A branch-scoped HR manager who names three
//     branches must still only reach their own. That is an intersection, and an intersection is
//     easy to write as a union by accident — which is the whole bug: a message meant for one
//     branch delivered to the company.
//
// The scope half is applied by the repository's own `scopeFilter` (the same one every employee
// list already goes through), so this file never re-implements it; what it does is make sure the
// criteria it produces can only ever NARROW that, never widen it.
import { EMPLOYED_STATUSES, type AnnouncementAudience, type EmployeeAudienceFilter } from '@ecms/contracts';
import { Types } from 'mongoose';
import { type FilterQuery } from 'mongoose';
import { type EmployeeDoc } from '../employee-management/employees/employee.model';

/** The employee fields each criterion selects on. Named once, so a typo is one place, not ten. */
const FIELD = {
  branchIds: 'branchId',
  departmentIds: 'departmentId',
  sectionIds: 'sectionId',
  jobTitleIds: 'employment.jobTitleId',
  managerIds: 'employment.managerId',
  employmentTypes: 'employment.employmentType',
  genders: 'personal.gender',
  religions: 'personal.religion',
  nationalities: 'personal.nationality',
  maritalStatuses: 'personal.maritalStatus',
} as const;

/** Criteria whose values are ids and must be cast before they will match anything. */
const ID_CRITERIA = new Set(['branchIds', 'departmentIds', 'sectionIds', 'jobTitleIds', 'managerIds']);

const toValues = (criterion: string, values: readonly string[]): unknown[] =>
  ID_CRITERIA.has(criterion) ? values.map((v) => new Types.ObjectId(v)) : [...values];

/**
 * The status clause: what the sender asked for, or the employed ones.
 *
 * Split out because it is the one criterion with a non-empty default, and the default is a rule
 * about people rather than a query convenience — a company announcement is not for somebody whose
 * employment ended.
 */
export const statusCriterion = (
  statuses: EmployeeAudienceFilter['statuses'],
): FilterQuery<EmployeeDoc> => ({
  status: { $in: statuses === undefined ? [...EMPLOYED_STATUSES] : [...statuses] },
});

/**
 * A filter, as an AND of ORs.
 *
 * Every criterion given must hold; within one, any listed value qualifies. "The drivers and the
 * guards, in Maadi and Giza" is two criteria of two values — not four sends, and not everybody who
 * is either a driver or in Maadi.
 */
export const filterCriteria = (filter: EmployeeAudienceFilter): FilterQuery<EmployeeDoc> => {
  const clauses: FilterQuery<EmployeeDoc>[] = [statusCriterion(filter.statuses)];
  for (const [criterion, field] of Object.entries(FIELD)) {
    const values = filter[criterion as keyof typeof FIELD];
    if (values === undefined || values.length === 0) continue;
    clauses.push({ [field]: { $in: toValues(criterion, values as readonly string[]) } } as FilterQuery<EmployeeDoc>);
  }
  return clauses.length === 1 ? (clauses[0] as FilterQuery<EmployeeDoc>) : { $and: clauses };
};

/**
 * The criteria for any audience.
 *
 * `employees` — a hand-picked list — is the one case that does NOT apply the employed-status
 * default: naming somebody is saying you mean them, and there are real reasons to message an
 * employee whose status is `exited` (a final payslip, a document they still owe). Naming is
 * explicit in a way a filter is not.
 *
 * Naming somebody does not escape the caller's SCOPE, though. That ceiling is applied by the
 * repository, outside this function, to every audience alike.
 */
export const audienceCriteria = (audience: AnnouncementAudience): FilterQuery<EmployeeDoc> => {
  if (audience.kind === 'everyone') return statusCriterion(undefined);
  if (audience.kind === 'employees') {
    return { _id: { $in: audience.employeeIds.map((id) => new Types.ObjectId(id)) } };
  }
  return filterCriteria(audience.filter);
};

/**
 * How many people an audience describes, split into who can be reached and who cannot.
 *
 * An audience is chosen in EMPLOYEES and delivered to LOGINS, and the two are not the same set. A
 * company of 300 with 180 accounts means a company-wide announcement reaches 180 people, and a
 * sender who is only told "sent to everyone" is wrong about their own announcement in a way
 * nothing corrects.
 */
export const splitReachable = <T extends { userId: unknown }>(
  employees: readonly T[],
): { recipients: T[]; unreachable: number } => {
  const recipients = employees.filter((employee) => employee.userId !== null && employee.userId !== undefined);
  return { recipients, unreachable: employees.length - recipients.length };
};

/** Recipient user ids, deduplicated — one person is one notification however they were matched. */
export const recipientUserIds = (employees: readonly { userId: unknown }[]): string[] => [
  ...new Set(
    employees
      .filter((employee) => employee.userId !== null && employee.userId !== undefined)
      .map((employee) => String(employee.userId)),
  ),
];
