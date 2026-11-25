// The names a permanent delete REWRITES, because deleting the row they sit on is not an option.
//
// THE PROBLEM THIS SOLVES. `workforce-reset/targets.ts` splits every collection that names an
// employee into `purge` (the row exists only because the person does) and `keep` (the row is a
// record in its own right — a gold receipt, a traffic violation, the consumables stock ledger whose
// every on-hand figure is the sum of its rows). Purging an employee empties the first set and must
// not touch the second.
//
// But a `keep` row does not merely POINT at the employee. Several COPY their name onto themselves
// at the moment they are written, so the grid can show «محمد» without a lookup. Delete the employee
// and the copy stays: the person is gone from the registry and still named on a violation. Removing
// them «من كل مكان» therefore means rewriting those copies, not only deleting rows.
//
// WHY THIS IS A HAND-WRITTEN TABLE AND NOT A PATTERN. A rule like "every field ending in Name"
// is catastrophic here, and not subtly: the same collections carry `fileName`, `bankName`,
// `machineName` and a plain `name`. Scrubbing by shape would rename a bank. So the fields are
// DERIVED (so a new one is always found) and CLASSIFIED BY HAND (so what happens to it is a
// decision), and anything unclassified refuses the purge by name — the same bargain `targets.ts`
// makes, for the same reason.
//
// WHAT THIS DELIBERATELY CANNOT SEE. A collection that copies an employee's name while holding no
// employee reference at all is not in the derived set, so no field of it reaches this table. That
// is a real residual gap rather than a solved problem: the derivation starts from
// `employeeTargets()`, and a row that names nobody by id is a row this tool cannot find.
import mongoose, { type Schema } from 'mongoose';
import { employeeTargets } from '../../../../workforce-reset/targets';

/** What replaces a name that is rewritten. Not blanked: a reader must see that somebody was here. */
export const PURGED_EMPLOYEE_NAME = 'موظف محذوف';

/** Any field whose NAME says it holds a person's name, including inside subdocument arrays. */
const NAME_PATH = /name$/i;

export type NameCopyAction =
  /** A copy of THIS employee's name. Rewritten wherever the paired id is them. */
  | 'scrub'
  /** Not a copy of an employee's name, or not one that can be matched to a person. Left alone. */
  | 'leave';

export interface NameCopy {
  action: NameCopyAction;
  /**
   * The field holding the id this name belongs to, so only the purged person's rows are rewritten.
   *
   * `employee` — an employee id, matched against the employee being purged.
   * `user` — an account id, matched against that employee's account, which the purge also removes.
   */
  by?: { path: string; kind: 'employee' | 'user' };
  why: string;
}

/**
 * Every name field on a `keep` collection, decided.
 *
 * The key is `<collection>.<path>`. A `scrub` entry names the id field beside it, because a name
 * with nothing to match on cannot be rewritten for ONE person without rewriting it for everybody.
 */
const CLASSIFICATION: Record<string, NameCopy> = {
  // ── Copies of an employee's own name, beside the id that says whose ──
  'fleet_violations.driverName': {
    action: 'scrub',
    by: { path: 'driverEmployeeId', kind: 'employee' },
    why: 'the driver’s name as the violation recorded it',
  },
  'fleet_receipts.driverName': {
    action: 'scrub',
    by: { path: 'driverEmployeeId', kind: 'employee' },
    why: 'the driver’s name on a fuel, tyre or washing receipt',
  },
  'fleet_maintenance_visits.driverInName': {
    action: 'scrub',
    by: { path: 'driverInEmployeeId', kind: 'employee' },
    why: 'who brought the vehicle in, as the visit recorded it',
  },
  'fleet_maintenance_visits.driverOutName': {
    action: 'scrub',
    by: { path: 'driverOutEmployeeId', kind: 'employee' },
    why: 'who took the vehicle out, as the visit recorded it',
  },
  'atm_maintenances.leaderName': {
    action: 'scrub',
    by: { path: 'leaderEmployeeId', kind: 'employee' },
    why: 'the employee assigned at close — the display string the grid shows',
  },
  'gold_receiving_receipts.teamLeaderName': {
    action: 'scrub',
    by: { path: 'teamLeaderEmployeeId', kind: 'employee' },
    why: 'who signed for the metal, as the printed receipt names them',
  },
  // The two supervisors who witnessed each movement of metal. Three collections carry the same
  // pair, because a receiving receipt, a delivery receipt and a vault-to-vault transfer are each
  // witnessed the same way.
  'gold_receiving_receipts.supervisor1Name': {
    action: 'scrub',
    by: { path: 'supervisor1EmployeeId', kind: 'employee' },
    why: 'first supervisor witnessing metal received',
  },
  'gold_receiving_receipts.supervisor2Name': {
    action: 'scrub',
    by: { path: 'supervisor2EmployeeId', kind: 'employee' },
    why: 'second supervisor witnessing metal received',
  },
  'gold_delivery_receipts.supervisor1Name': {
    action: 'scrub',
    by: { path: 'supervisor1EmployeeId', kind: 'employee' },
    why: 'first supervisor witnessing metal delivered',
  },
  'gold_delivery_receipts.supervisor2Name': {
    action: 'scrub',
    by: { path: 'supervisor2EmployeeId', kind: 'employee' },
    why: 'second supervisor witnessing metal delivered',
  },
  'gold_transfers.supervisor1Name': {
    action: 'scrub',
    by: { path: 'supervisor1EmployeeId', kind: 'employee' },
    why: 'first supervisor witnessing metal moved between vaults',
  },
  'gold_transfers.supervisor2Name': {
    action: 'scrub',
    by: { path: 'supervisor2EmployeeId', kind: 'employee' },
    why: 'second supervisor witnessing metal moved between vaults',
  },
  // A reading is taken from a vehicle, but it records WHO was driving it that day.
  'fleet_odometer_logs.driver1Name': {
    action: 'scrub',
    by: { path: 'driver1EmployeeId', kind: 'employee' },
    why: 'first driver on the vehicle when the reading was taken',
  },
  'fleet_odometer_logs.driver2Name': {
    action: 'scrub',
    by: { path: 'driver2EmployeeId', kind: 'employee' },
    why: 'second driver on the vehicle when the reading was taken',
  },
  // Administrative Affairs' purchase request, kept by the reset (OD-64 A): its requester's name,
  // stored top level beside the id for exactly this rewrite (D-22).
  'administration_purchase_requests.requesterName': {
    action: 'scrub',
    by: { path: 'requesterEmployeeId', kind: 'employee' },
    why: 'who raised the purchase request, as the request recorded them',
  },

  // ── Copies carried on the ACCOUNT rather than the employee, and still this person ──
  // The purge removes their account too, so without this the name would outlive both records it
  // belongs to. Matched on the account id, which is why `by.kind` exists at all.
  'atm_maintenances.openedByName': {
    action: 'scrub',
    by: { path: 'openedById', kind: 'user' },
    why: 'who opened the maintenance ticket, by account',
  },
  'atm_maintenances.closedByName': {
    action: 'scrub',
    by: { path: 'closedById', kind: 'user' },
    why: 'who closed the maintenance ticket, by account',
  },

  // ── Names of people this purge is not about ──
  'fleet_accidents.byName': {
    action: 'leave',
    why: 'who RECORDED the accident, not who caused it — and it carries no id to match a person on. The culprit is `culpritEmployeeId`, which copies no name, so a purge already removes them here',
  },
  'hr_job_offers.managerName': {
    action: 'leave',
    why: 'a manager typed by hand BECAUSE they have no account (null whenever `managerId` is set) — not a copy of anybody’s employee record',
  },
  'hr_job_offers.applicantName': {
    action: 'leave',
    why: 'the candidate the offer was made to, who is not the employee being purged',
  },
  // An approval trail's deciders sit inside arrays, which a scrub cannot address one person at a
  // time; the gap is recorded (RK-34), the cost of the snapshot an archived round prints.
  'administration_purchase_requests.approvalSteps.deciderName': {
    action: 'leave',
    why: 'who decided a rung, inside the trail’s array — RK-34’s recorded gap',
  },
  'administration_purchase_requests.approvalRounds.steps.deciderName': {
    action: 'leave',
    why: 'who decided a rung of an archived round, inside the array — RK-34’s recorded gap',
  },

  // ── Not people at all. Named here so the refusal below never has to guess ──
  'fleet_accidents.transfersIn.byName': {
    action: 'leave',
    why: 'who recorded a transfer between accident files — the recorder again, with no id to match on',
  },
  'hr_job_offers.terms.managerName': { action: 'leave', why: 'as `managerName` above' },
  'hr_job_offers.revisions.terms.managerName': { action: 'leave', why: 'as `managerName` above' },
  'hr_job_offers.acceptedSnapshot.terms.managerName': {
    action: 'leave',
    why: 'as `managerName` above',
  },

  // ── Not people at all. Named here so the refusal below never has to guess ──
  'hr_job_offers.name': { action: 'leave', why: 'not a person' },
  'hr_job_offers.terms.allowances.name': { action: 'leave', why: 'an allowance’s name' },
  'hr_job_offers.revisions.terms.allowances.name': {
    action: 'leave',
    why: 'an allowance’s name',
  },
  'hr_job_offers.acceptedSnapshot.terms.allowances.name': {
    action: 'leave',
    why: 'an allowance’s name',
  },
  'fleet_odometer_logs.name': { action: 'leave', why: 'not a person' },
  'fleet_notices.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_notices.checkImage.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_notices.driverLicenseImage.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_notices.noticeImage.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_notices.vehicleLicenseImage.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_receipts.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_receipts.image.fileName': { action: 'leave', why: 'an uploaded file’s name' },
  'fleet_maintenance_visits.name': { action: 'leave', why: 'not a person' },
  'atm_maintenances.bankName': { action: 'leave', why: 'the bank that owns the machine' },
  'atm_maintenances.machineName': { action: 'leave', why: 'the machine' },
  'atm_maintenances.name': { action: 'leave', why: 'not a person' },
  'it_mobile_line_assignments.name': { action: 'leave', why: 'not a person' },
  'administration_purchase_requests.attachments.fileName': {
    action: 'leave',
    why: 'an uploaded file’s name',
  },
};

/** Every path on `schema` whose name matches, including paths inside subdocument arrays. */
const pathsMatching = (
  schema: Schema,
  prefix = '',
  ancestors: readonly Schema[] = [],
): string[] => {
  if (ancestors.includes(schema)) return [];
  const chain = [...ancestors, schema];
  const found: string[] = [];
  for (const [name, type] of Object.entries(schema.paths)) {
    const full = prefix === '' ? name : `${prefix}.${name}`;
    if (NAME_PATH.test(name)) found.push(full);
    const nested = (type as { schema?: Schema | null }).schema;
    if (nested !== undefined && nested !== null) {
      found.push(...pathsMatching(nested, full, chain));
    }
  }
  return found;
};

export interface ResolvedNameCopy {
  collection: string;
  path: string;
  by: { path: string; kind: 'employee' | 'user' };
  why: string;
}

/**
 * The name copies to rewrite, derived from the `keep` collections and refused on anything the
 * table above does not cover.
 *
 * Requires the module graph to be loaded — an unregistered model is an invisible one, exactly as
 * in `targets.ts`.
 */
export const nameCopiesToScrub = (): ResolvedNameCopy[] => {
  const keep = new Set(
    employeeTargets()
      .filter((t) => t.action === 'keep')
      .map((t) => t.collection),
  );
  const scrub: ResolvedNameCopy[] = [];
  const unclassified: string[] = [];

  for (const model of Object.values(mongoose.models)) {
    const collection = model.collection.name;
    if (!keep.has(collection)) continue;
    for (const path of pathsMatching(model.schema)) {
      const key = `${collection}.${path}`;
      const decision = CLASSIFICATION[key];
      if (decision === undefined) {
        unclassified.push(key);
        continue;
      }
      if (decision.action === 'scrub' && decision.by !== undefined) {
        // A rewrite reaches ONE person's rows by matching the id beside the name, which a dotted
        // path inside an array cannot do with a plain `$set` — it would need positional operators
        // and a per-element match. Every scrub today is top-level; this refuses rather than
        // writing an update that silently matches nothing.
        if (path.includes('.')) {
          throw new Error(
            `${collection}.${path} is classified \`scrub\` but sits inside a subdocument. ` +
              'Rewriting one person’s name there needs a positional update, which this tool does ' +
              'not do — classify it `leave`, or teach the scrub to address array elements.',
          );
        }
        if (scrub.some((s) => s.collection === collection && s.path === path)) continue;
        scrub.push({ collection, path, by: decision.by, why: decision.why });
      }
    }
  }

  if (unclassified.length > 0) {
    throw new Error(
      'the permanent delete found name fields on records it must KEEP that it has no instruction ' +
        'for. Each one has to be classified in `employee-name-copies.ts` — scrub (it is a copy of ' +
        'the employee’s own name, beside the id that says whose) or leave (it names somebody or ' +
        'something else). Guessing by shape would rename a bank:\n  ' +
        [...new Set(unclassified)].sort().join('\n  '),
    );
  }
  return scrub.sort((a, b) =>
    `${a.collection}.${a.path}`.localeCompare(`${b.collection}.${b.path}`),
  );
};
