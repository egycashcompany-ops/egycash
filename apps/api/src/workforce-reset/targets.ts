// What a workforce reset touches, and — more importantly — how it refuses to touch anything it has
// not been told about.
//
// THE PROBLEM WITH A HAND-WRITTEN LIST. Employee-scoped data lives in dozens of collections across
// four modules, and the set grows: every feature that files something against a person adds one. A
// list written today is wrong the first time somebody ships a new one, and wrong SILENTLY — the
// reset reports success while leaving records pointing at people who no longer exist, and the next
// import lands on top of them.
//
// THE PROBLEM WITH PURE DERIVATION. "Delete every collection with an employee reference" is worse.
// `users` carries `employeeId`, so that rule deletes every account including the administrators
// running the reset. `hr_job_offers` carries `hiredEmployeeId`, and a job offer is RECRUITMENT
// history that happens to name who was hired — deleting the offer to remove the person destroys the
// record of a hiring decision.
//
// SO: DERIVE THE SET, CLASSIFY IT BY HAND, AND FAIL ON ANYTHING UNCLASSIFIED. The schemas are
// walked at run time, so a new employee-scoped collection is always FOUND; it then has to appear in
// the table below or the reset refuses to start, naming it. A future feature cannot be silently
// skipped, and cannot be silently wiped either — somebody has to decide which it is.
import mongoose from 'mongoose';

/** Any schema path that names an employee: `employeeId`, `captainEmployeeIds`, `hiredEmployeeId`. */
const EMPLOYEE_PATH = /employeeid/i;

export type Action =
  /** The row exists only because the employee does. It goes. */
  | 'purge'
  /**
   * The row is a record in its own right that happens to name an employee. NOTHING is written to
   * it — not even to clear the reference.
   *
   * Clearing it would look tidy and would be a destructive edit to a record nobody asked to change:
   * a traffic violation stops saying who was driving, a gold receipt stops saying who signed for
   * the metal. A reference pointing at a deleted employee is the honest state — the record still
   * says what happened, and the employee it names can still be traced through the audit trail.
   */
  | 'keep'
  /** Not the employee rule's business — the user rule owns this collection. */
  | 'users';

export interface Target {
  collection: string;
  action: Action;
  /** The employee-naming paths on it, for the report. */
  paths: string[];
  why: string;
}

/**
 * The decision per collection. Every entry is a judgement about what the record IS, not about which
 * module it came from.
 */
const CLASSIFICATION: Record<string, { action: Action; why: string }> = {
  // ── Employee-scoped: the record is a fact ABOUT a person and is meaningless without them ──
  hr_attendance_days: { action: 'purge', why: 'a day worked by somebody' },
  hr_attendance_punches: { action: 'purge', why: 'a punch by somebody' },
  hr_attendance_regularizations: { action: 'purge', why: 'a correction to somebody’s attendance' },
  hr_attendance_enrollments: { action: 'purge', why: 'somebody’s device enrolment' },
  hr_shift_assignments: { action: 'purge', why: 'somebody’s shift' },
  hr_leave_requests: { action: 'purge', why: 'somebody’s leave request' },
  hr_leave_balances: { action: 'purge', why: 'somebody’s leave balance' },
  hr_leave_ledger: { action: 'purge', why: 'the ledger behind somebody’s balance' },
  hr_payslips: { action: 'purge', why: 'somebody’s payslip' },
  hr_payroll_adjustments: { action: 'purge', why: 'an adjustment to somebody’s pay' },
  hr_payroll_leave_snapshots: { action: 'purge', why: 'a payroll snapshot of somebody’s leave' },
  hr_employee_pay_items: { action: 'purge', why: 'somebody’s recurring pay item' },
  hr_contracts: { action: 'purge', why: 'somebody’s employment contract' },
  hr_employee_loans: { action: 'purge', why: 'somebody’s loan' },
  hr_loan_installments: { action: 'purge', why: 'an installment of somebody’s loan' },
  hr_loan_repayments: { action: 'purge', why: 'a repayment of somebody’s loan' },
  hr_medical_profiles: { action: 'purge', why: 'somebody’s medical profile' },
  hr_medical_events: { action: 'purge', why: 'somebody’s medical event' },
  hr_medical_insurance: { action: 'purge', why: 'somebody’s medical insurance card' },
  hr_training_records: { action: 'purge', why: 'what somebody was taught' },
  hr_training_enrollments: { action: 'purge', why: 'somebody’s seat on a session' },
  hr_training_nominations: { action: 'purge', why: 'somebody’s nomination' },
  hr_performance_goals: { action: 'purge', why: 'somebody’s goal' },
  hr_performance_reviews: { action: 'purge', why: 'somebody’s review' },
  hr_employee_actions: { action: 'purge', why: 'a personnel action applied to somebody' },
  hr_employee_files: { action: 'purge', why: 'somebody’s electronic file' },
  hr_cost_center_assignments: { action: 'purge', why: 'where somebody’s cost is reported' },
  hr_hiring_documents: { action: 'purge', why: 'the documents collected to hire somebody' },
  hr_job_requisition_fills: { action: 'purge', why: 'the record that somebody filled a seat' },
  fleet_driver_profiles: { action: 'purge', why: 'somebody’s driver profile' },
  fleet_driver_unavailability: { action: 'purge', why: 'when somebody is unavailable to drive' },
  operations_crew_assignments: { action: 'purge', why: 'a crew made of specific people' },
  operations_crew_requirements: { action: 'purge', why: 'somebody’s place in a crew requirement' },
  operations_standing_crews: { action: 'purge', why: 'a standing crew made of specific people' },
  operations_shipment_assignments: { action: 'purge', why: 'a shipment captained by somebody' },
  it_asset_assignments: { action: 'purge', why: 'an asset held by somebody — the ASSET survives' },
  fleet_duty_assignments: { action: 'purge', why: 'a day’s duty roster, made of specific people' },
  fleet_fixed_crews: { action: 'purge', why: 'a fixed crew IS the pairing of two drivers' },

  // ── Records in their own right, which merely name an employee. NOT TOUCHED AT ALL ──
  //
  // Each of these is a thing that happened, filed against a vehicle, a machine, a vault or a
  // recruitment decision — not against a person. Deleting one to remove somebody destroys a company
  // record; clearing its reference edits a record nobody asked to change. The reference is left
  // pointing at a deleted employee, which is the truthful state.
  hr_job_offers: { action: 'keep', why: 'recruitment history — an offer that was really made' },
  fleet_violations: { action: 'keep', why: 'a traffic violation is a legal record' },
  fleet_odometer_logs: { action: 'keep', why: 'a reading taken from a vehicle at a moment' },
  fleet_maintenance_visits: { action: 'keep', why: 'a workshop visit is a record about the vehicle' },
  atm_maintenances: { action: 'keep', why: 'a maintenance visit is a record about the machine' },
  gold_receiving_receipts: { action: 'keep', why: 'a printed financial record of received metal' },
  gold_delivery_receipts: { action: 'keep', why: 'a printed financial record of delivered metal' },
  gold_transfers: { action: 'keep', why: 'a financial record of metal moved between vaults' },

  // ── Owned by the user rule, not this one ──
  //
  // `users.employeeId` is the Employee ← one User link. If the employee rule owned this collection
  // it would delete every account in the system, administrators included, on the first run.
  users: { action: 'users', why: 'accounts are decided by the user rule, never by the employee rule' },
};

/**
 * Walk the registered schemas and classify every collection that names an employee.
 *
 * Throws when it finds one the table does not cover. That is the whole point: a new
 * employee-scoped collection must be a deliberate decision by whoever adds it, taken here, rather
 * than a row this tool quietly leaves behind or quietly destroys.
 *
 * Requires the module graph to be loaded (the CLI boots the platform first) — an unregistered model
 * is an invisible one.
 */
export const employeeTargets = (): Target[] => {
  const byCollection = new Map<string, Set<string>>();
  for (const model of Object.values(mongoose.models)) {
    const paths = Object.keys(model.schema.paths).filter((p) => EMPLOYEE_PATH.test(p));
    if (paths.length === 0) continue;
    // Two models can share one collection (the notification preference/quiet-hours pair does), so
    // the union of their paths is what that collection actually holds.
    const known = byCollection.get(model.collection.name) ?? new Set<string>();
    for (const p of paths) known.add(p);
    byCollection.set(model.collection.name, known);
  }

  const targets: Target[] = [];
  const unclassified: string[] = [];
  for (const [collection, paths] of byCollection) {
    const decision = CLASSIFICATION[collection];
    if (decision === undefined) {
      unclassified.push(`${collection} (${[...paths].join(', ')})`);
      continue;
    }
    targets.push({ collection, action: decision.action, paths: [...paths].sort(), why: decision.why });
  }

  if (unclassified.length > 0) {
    throw new Error(
      'the workforce reset found collections holding an employee reference that it has no ' +
        'instruction for. Each one has to be classified in `workforce-reset/targets.ts` — purge ' +
        '(the record is a fact about a person), keep (the record outlives them), or users:\n  ' +
        unclassified.sort().join('\n  '),
    );
  }
  return targets.sort((a, b) => a.collection.localeCompare(b.collection));
};

/**
 * Collections keyed on a USER that go with a deleted account.
 *
 * Not derived: these are few, they are platform-owned, and each is a deliberate statement about
 * what a deleted account leaves behind. The audit trail is the conspicuous absence — it records
 * what somebody did, and history is not rewritten because the actor's account was removed.
 */
export const USER_SCOPED_COLLECTIONS: readonly { collection: string; path: string; why: string }[] = [
  { collection: 'sessions', path: 'userId', why: 'a live session for a deleted account must not survive' },
  { collection: 'role_assignments', path: 'userId', why: 'grants to an account that no longer exists' },
  { collection: 'notification_preferences', path: 'userId', why: 'preferences of a deleted account' },
  { collection: 'push_subscriptions', path: 'userId', why: 'a push endpoint for a deleted account' },
  { collection: 'user_applications', path: 'userId', why: 'navigation grants of a deleted account' },
];

/** The roles whose holders survive. Everything else about an account is irrelevant to survival. */
export const SURVIVING_ROLE_KEYS = ['super-admin', 'platform-admin'] as const;
