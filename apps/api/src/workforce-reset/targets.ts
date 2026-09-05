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
import mongoose, { type Schema } from 'mongoose';

/** Any schema path that names an employee: `employeeId`, `captainEmployeeIds`, `hiredEmployeeId`. */
const EMPLOYEE_PATH = /employeeid/i;
/** Any schema path that names an applicant: `applicantId`, `items[].applicantId`. */
const APPLICANT_PATH = /applicantid/i;

export type Action =
  /** The row exists only because the employee (or applicant) does. It goes. */
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
  | 'users'
  /** Not the applicant rule's business — the employee rule already decided this collection. */
  | 'employees';

/**
 * Every path on `schema` whose NAME matches, including paths inside subdocument arrays and nested
 * schemas.
 *
 * `schema.paths` alone stops at the top level, and that gap is not theoretical:
 * `hr_evaluation_batches` holds its candidates only in `items[].applicantId`, so a flat walk does
 * not see the collection AT ALL — a reset would report success and leave it full of names. The
 * employee side was checked the same way and hides nothing this way, so the derived employee set
 * is identical under either walk; this is strictly a widening.
 *
 * `ancestors` guards against a schema that contains itself. It is the ancestor CHAIN rather than a
 * global visited set on purpose: one sub-schema reused by two sibling fields must be walked for
 * both, or the second field's paths go missing.
 */
const pathsMatching = (
  schema: Schema,
  pattern: RegExp,
  prefix = '',
  ancestors: readonly Schema[] = [],
): string[] => {
  if (ancestors.includes(schema)) return [];
  const chain = [...ancestors, schema];
  const found: string[] = [];
  for (const [name, type] of Object.entries(schema.paths)) {
    const full = prefix === '' ? name : `${prefix}.${name}`;
    if (pattern.test(name)) found.push(full);
    const nested = (type as { schema?: Schema | null }).schema;
    if (nested !== undefined && nested !== null) {
      found.push(...pathsMatching(nested, pattern, full, chain));
    }
  }
  return found;
};

/** Collection name → the matching paths on it, unioned across models that share a collection. */
const collectionsMatching = (pattern: RegExp): Map<string, Set<string>> => {
  const byCollection = new Map<string, Set<string>>();
  for (const model of Object.values(mongoose.models)) {
    const paths = pathsMatching(model.schema, pattern);
    if (paths.length === 0) continue;
    // Two models can share one collection (the notification preference/quiet-hours pair does), so
    // the union of their paths is what that collection actually holds.
    const known = byCollection.get(model.collection.name) ?? new Set<string>();
    for (const p of paths) known.add(p);
    byCollection.set(model.collection.name, known);
  }
  return byCollection;
};

/** Apply a classification table, refusing — by name — anything it does not cover. */
const classify = (
  byCollection: Map<string, Set<string>>,
  table: Record<string, { action: Action; why: string }>,
  refusal: string,
): Target[] => {
  const targets: Target[] = [];
  const unclassified: string[] = [];
  for (const [collection, paths] of byCollection) {
    const decision = table[collection];
    if (decision === undefined) {
      unclassified.push(`${collection} (${[...paths].join(', ')})`);
      continue;
    }
    targets.push({ collection, action: decision.action, paths: [...paths].sort(), why: decision.why });
  }
  if (unclassified.length > 0) {
    throw new Error(`${refusal}\n  ${unclassified.sort().join('\n  ')}`);
  }
  return targets.sort((a, b) => a.collection.localeCompare(b.collection));
};

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
export const employeeTargets = (): Target[] =>
  classify(
    collectionsMatching(EMPLOYEE_PATH),
    CLASSIFICATION,
    'the workforce reset found collections holding an employee reference that it has no ' +
      'instruction for. Each one has to be classified in `workforce-reset/targets.ts` — purge ' +
      '(the record is a fact about a person), keep (the record outlives them), or users:',
  );

/** The applicant registry. Not in the derived set — it has no `applicantId`, it IS the applicant. */
export const APPLICANT_REGISTRY = 'hr_applicants';

/**
 * The recruitment pipeline, purged only when the operator asks for it (`--include-recruitment`).
 *
 * SEPARATE FROM THE EMPLOYEE RULE ON PURPOSE. Emptying the workforce says nothing about whether
 * the people who were mid-application should also go: a normal pre-go-live reset keeps them, and
 * only a deliberate "empty the system completely" clears them out. So this is a second, opt-in
 * decision with its own table and its own refusal.
 */
const APPLICANT_CLASSIFICATION: Record<string, { action: Action; why: string }> = {
  // ── The pipeline itself: every row exists because somebody applied ──
  hr_screenings: { action: 'purge', why: 'somebody’s screening' },
  hr_interviews: { action: 'purge', why: 'somebody’s interview' },
  hr_evaluations: { action: 'purge', why: 'somebody’s evaluation' },
  hr_evaluation_batches: { action: 'purge', why: 'a batch made of specific candidates' },
  hr_applicant_document_sets: { action: 'purge', why: 'the documents somebody uploaded' },
  hr_recruitment_timeline: { action: 'purge', why: 'the history of somebody’s application' },
  hr_recruitment_events: { action: 'purge', why: 'the workflow events behind that history' },
  // The one reversal, and it is deliberate. The employee rule classifies job offers `keep`, because
  // an offer is recruitment history that merely names who was hired. Clearing the pipeline is the
  // one operation for which that reasoning does not hold: an offer made to an applicant who is
  // being erased is not history worth keeping, it is a dangling half of a deleted record. It is
  // purged ONLY under this opt-in rule, and the report says so explicitly.
  hr_job_offers: { action: 'purge', why: 'an offer made to an applicant being erased' },

  // ── Already decided by the employee rule; this rule must not double-handle them ──
  hr_employees: { action: 'employees', why: 'the employee registry — the employee rule owns it' },
  hr_employee_files: { action: 'employees', why: 'purged by the employee rule' },
  hr_hiring_documents: { action: 'employees', why: 'purged by the employee rule' },
  hr_job_requisition_fills: { action: 'employees', why: 'purged by the employee rule' },
};

/**
 * The recruitment collections, classified the same way and with the same refusal: a new collection
 * that files something against an applicant must be a decision somebody takes here.
 *
 * Reference catalogues — sources, forms, interview stages, evaluation phases, document types, job
 * requisitions — carry no `applicantId` and so are never in this set. That is right: they are
 * configuration the next recruitment round needs, not records about a person.
 */
export const applicantTargets = (): Target[] =>
  classify(
    collectionsMatching(APPLICANT_PATH),
    APPLICANT_CLASSIFICATION,
    'the workforce reset found collections holding an applicant reference that it has no ' +
      'instruction for. Each one has to be classified in `workforce-reset/targets.ts` — purge ' +
      '(the record is part of somebody’s application) or employees (the employee rule owns it):',
  );

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
