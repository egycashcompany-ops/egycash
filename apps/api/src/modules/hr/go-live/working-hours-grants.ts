// «ساعات العمل» handed, once, to everyone who manages the working day today — the owner's ruling
// of 22 November: "«ساعات العمل» replaces something HR already manages, so it must not disappear
// for them after the update."
//
// WHY IT EXISTS. Until this deploy the working day was HR's to set through the shift catalog, which
// authorizes on `attendance.manageShifts`: a shift carries the start, the end and the break, and
// changing them is how the hours of the people on that shift were changed. The new screen is where
// that responsibility now lives for everyone ELSE — the employees with no shift assignment, set per
// department — and it authorizes on a key of its own, `attendance.manageWorkingHours`, because a
// hub tab needs a page and the role matrix has to say which key administers which screen. A new key
// is held by nobody. So, once, every role and every live delegated grant holding the shift key is
// given the new one, and from then on the owner gives and takes the two separately on the roles
// screen.
//
// IT WIDENS NOBODY BY ACCIDENT, and this is the whole safety argument: a holder gains the key only
// beside the key it already exercised the same power under, in the SAME grant — the same role, the
// same delegated unit, the same scope (`platform/rbac/grant-alongside.ts`). Whoever could already
// set the company's working hours can still set them; nobody else gains anything.
//
// WHAT IT DOES NOT TOUCH (ADR-026 §4, enforced by `roleTakesGrantsAlongside`): `super-admin`, which
// is widened instead by `attendance.migration.ts` because a seeded system role is frozen at its
// first seed; `platform-admin`, which holds the platform's own keys and no module's; and the
// `hr-only:*` derivatives, which the HR-only reconciliation re-derives from their source role on
// every boot — so they pick the key up there, and a second writer here would be reverted.
//
// ONCE. A versioned run key: after the run row, a key an administrator REMOVES stays removed, and a
// role made later is an administrator's to fill. Without the row this would re-grant on every
// deploy and the owner could never take the screen away from anyone. Another copy is another key.
//
// ONE TRANSACTION: the copied keys and the run row commit together or not at all, and a second
// process racing the first conflicts and finds the run row on its retry. The audit rows, the
// dropped permission snapshots and the role-changed events follow the commit, as the role editor's
// do.
//
// THE API ONLY. The worker boots the new build first — it has no health check and builds no web —
// while the old api keeps serving the old roles screen until the new api is healthy. A copy made
// from the worker would land minutes early, and a role an administrator made with
// `attendance.manageShifts` in that window would never get the new key (the run row is already
// there). From the api the window is the health check's hand-over alone.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import {
  keysAdded,
  rbacService,
  type GrantAlongsidePair,
  type GrantsAlongsideResult,
} from '../../../platform/rbac';
import {
  ensureHrGoLiveRunIndexes,
  isHrGoLiveRunDone,
  recordHrGoLiveRun,
} from './go-live-run.model';

/** The run key — versioned, so another copy is a decision and never a redeploy's accident. */
export const HR_WORKING_HOURS_GRANTS_MARK = 'go-live:hr-working-hours-grants:v1';

/**
 * The one pair. `attendance.manageShifts` is the key that set the working day until this deploy;
 * `attendance.manageWorkingHours` is the key that sets it now for the people with no shift.
 *
 * Deliberately NOT `attendance.assign`, `attendance.view` or `setting.edit`: assigning a person to
 * a shift, reading the sheet and editing the settings screen are each a different power, and none
 * of them ever set the company's hours.
 */
export const HR_WORKING_HOURS_GRANT_PAIRS: readonly GrantAlongsidePair[] = [
  { from: 'attendance.manageShifts', add: ['attendance.manageWorkingHours'] },
];

/**
 * What the run row keeps — readable from the database, because the owner cannot read the log: how
 * many were changed, and the roles BY NAME (a role's name is administration data, not a person).
 * A delegated grant is named by its id alone: it is one person's, and the run row names no one.
 */
export type WorkingHoursGrantsRunOutcome = {
  rolesChanged: number;
  delegatedGrantsChanged: number;
  roles: { id: string; name: { ar: string; en: string }; added: string[] }[];
  delegatedGrants: { id: string; added: string[] }[];
};

export type WorkingHoursGrantsOutcome =
  | { status: 'alreadyDone' }
  | ({ status: 'done' } & WorkingHoursGrantsRunOutcome);

/** The run row's outcome for what the copy changed. Pure. */
export const workingHoursGrantsOutcome = (
  result: GrantsAlongsideResult,
): WorkingHoursGrantsRunOutcome => ({
  rolesChanged: result.roles.length,
  delegatedGrantsChanged: result.delegatedGrants.length,
  roles: result.roles.map((role) => ({
    id: role.roleId,
    name: role.name,
    added: keysAdded(role.before, role.after),
  })),
  delegatedGrants: result.delegatedGrants.map((grant) => ({
    id: grant.grantId,
    added: keysAdded(grant.before, grant.after),
  })),
});

/** Run the copy. Exported so a test can drive it against a real database. */
export const copyHrWorkingHoursGrants = async (): Promise<WorkingHoursGrantsOutcome> => {
  // 0. A run that is done is asked first, outside any transaction, so a boot after it reads
  //    nothing. The check inside the transaction still settles two processes racing.
  if (await isHrGoLiveRunDone(HR_WORKING_HOURS_GRANTS_MARK)) return { status: 'alreadyDone' };

  // 1. The run row's unique index before the transaction inserts — `autoIndex` is off in
  //    production, and the index is what turns a racing twin's run row into a refusal.
  await ensureHrGoLiveRunIndexes();

  const run = await unitOfWork(async (session) => {
    if (await isHrGoLiveRunDone(HR_WORKING_HOURS_GRANTS_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }
    // Read and written inside the transaction, so a role an administrator saved a moment ago is
    // copied as it now stands — and one saved DURING the copy conflicts and is retried.
    const result = await rbacService.grantAlongside(HR_WORKING_HOURS_GRANT_PAIRS, session);
    const outcome = workingHoursGrantsOutcome(result);
    await recordHrGoLiveRun(HR_WORKING_HOURS_GRANTS_MARK, outcome, session);
    return { kind: 'done' as const, result, outcome };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit: the trail, every holder's permission snapshot dropped (so the new key is in
  // force at their next request, not at the snapshot's TTL), and the roles screen told.
  await rbacService.afterGrantsAlongside(run.result);
  return { status: 'done', ...run.outcome };
};

/** Run it once and say what happened. Exported so a test can await it. */
export const runHrWorkingHoursGrantsGoLive = async (): Promise<void> => {
  const outcome = await copyHrWorkingHoursGrants();
  if (outcome.status === 'done') {
    logger.warn(
      outcome,
      'hr go-live: the working-hours grant was copied from the shift grant — done, and never again',
    );
  }
};

/**
 * What the api calls: start the step and carry on. Not awaited, cannot reject, and skipped under
 * test — the other go-live steps' terms.
 */
export const startHrWorkingHoursGrantsGoLive = (): void => {
  if (isTest) return;
  runHrWorkingHoursGrantsGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'hr go-live: copying the working-hours grant failed — no boot was harmed',
    );
  });
};
