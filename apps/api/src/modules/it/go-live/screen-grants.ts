// The IT screens' own permissions, handed once to everyone who ran them — «فى الصلاحيات مش لاقى حاجة
// لـ /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات عشان أقدر أتحكم فيها»
// (the owner, 17 November 2026).
//
// WHY IT EXISTS. Until this deploy the mobile lines and the consumables rode the asset grants
// (`itAsset.*`, it-module-design.md §7), so the role matrix had no row for either screen and an
// administrator could not give one without the other, or without the assets. They now authorize on
// keys of their own — `itMobileLine.*` and `itConsumable.*`, each with its own page — and the asset
// keys stop opening them. Without this step every role that runs those screens today would lose
// them the moment the deploy lands. So, once, every role and every live delegated grant holding an
// `itAsset` key is given the matching new keys (`IT_SCREEN_GRANT_PAIRS`). Strictly additive, and it
// widens nobody: each holder already had exactly these powers, in the same grant, through
// `itAsset.*`. From then on the owner gives and takes the two screens separately on the roles screen.
//
// WHY THIS IS NOT THE ATM CASE. The ATM data-edit split widened no role at boot
// (atm-operations-port.md §9, lead override O-1) — and rightly: there the old key KEPT opening the
// page, nobody lost anything, and the new keys were an administrator's to hand out. Here the old
// key STOPS opening the screens. Not copying would not be declining to widen anyone; it would be
// taking two screens away from the IT team. A deliberate, documented exception, made once.
//
// ONCE. A versioned run key: after the run row, a key an administrator removes stays removed, and
// a role made later is an administrator's to fill. Another copy is another key.
//
// ONE TRANSACTION, the go-live's terms (`go-live-run.model.ts`): the copied keys and the run row
// commit together or not at all, and a second process racing the first conflicts and finds the run
// row on its retry. The audit rows, the dropped permission snapshots and the role-changed events
// follow the commit, as the role editor's do.
//
// THE API ONLY. Every other go-live step starts from both processes; this one from `server.ts`
// alone. The worker boots the new build first — it has no health check and builds no web — while
// the old api keeps serving the old roles screen until the new api is healthy: a copy made from the
// worker would land minutes early, and a role an administrator made with `itAsset.*` in that
// window would never get the new keys (the run row is already there). From the api the window is
// the health check's hand-over alone. What remains of it is the same kind of edge as the next one.
//
// ONE WINDOW IT CANNOT CLOSE. A role form opened before the copy and saved after it gets the usual
// version conflict (the copy moves the role's version). The delegation screen has no such check: it
// sends a unit's whole list and the server replaces it, reading the version itself — so a manager
// who opened a deputy's delegation before the deploy and saves it after would drop that deputy's
// copied keys, and nothing copies them again. A property of the delegation editor for any two
// edits, not of this step; the run row counts the delegated grants copied, so the owner can look.
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
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';

/** The run key — versioned, so another copy is a decision and never a redeploy's accident. */
export const IT_SCREEN_GRANTS_MARK = 'go-live:it-screen-grants:v1';

/**
 * Each asset grant, and the screen grants that did the same on the two screens until this deploy.
 * `delete` and `dispose` have no counterpart: neither screen ever authorized on them.
 */
export const IT_SCREEN_GRANT_PAIRS: readonly GrantAlongsidePair[] = [
  { from: 'itAsset.view', add: ['itConsumable.view', 'itMobileLine.view'] },
  { from: 'itAsset.create', add: ['itConsumable.create', 'itMobileLine.create'] },
  { from: 'itAsset.edit', add: ['itConsumable.edit', 'itMobileLine.edit'] },
  { from: 'itAsset.assign', add: ['itConsumable.assign', 'itMobileLine.assign'] },
  // The line acknowledgment's national ID; the device receipt keeps `itAsset.viewNationalId`.
  { from: 'itAsset.viewNationalId', add: ['itMobileLine.viewNationalId'] },
];

/**
 * What the run row keeps — readable from the database, because the owner cannot read the log: how
 * many were changed, and the roles BY NAME (a role's name is administration data, not a person).
 * A delegated grant is named by its id alone: it is one person's, and the run row names no one.
 */
export type ScreenGrantsRunOutcome = {
  rolesChanged: number;
  delegatedGrantsChanged: number;
  roles: { id: string; name: { ar: string; en: string }; added: string[] }[];
  delegatedGrants: { id: string; added: string[] }[];
};

export type ScreenGrantsOutcome =
  { status: 'alreadyDone' } | ({ status: 'done' } & ScreenGrantsRunOutcome);

/** The run row's outcome for what the copy changed. Pure. */
export const screenGrantsOutcome = (result: GrantsAlongsideResult): ScreenGrantsRunOutcome => ({
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
export const copyItScreenGrants = async (): Promise<ScreenGrantsOutcome> => {
  // 0. A run that is done is asked first, outside any transaction, so a boot after it reads
  //    nothing. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_SCREEN_GRANTS_MARK)) return { status: 'alreadyDone' };

  // 1. The run row's unique index before the transaction inserts — `autoIndex` is off in
  //    production, and the index is what turns a racing twin's run row into a refusal.
  await ensureItGoLiveRunIndexes();

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_SCREEN_GRANTS_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }
    // Read and written inside the transaction, so a role an administrator saved a moment ago is
    // copied as it now stands — and one saved DURING the copy conflicts and is retried.
    const result = await rbacService.grantAlongside(IT_SCREEN_GRANT_PAIRS, session);
    const outcome = screenGrantsOutcome(result);
    await recordItGoLiveRun(IT_SCREEN_GRANTS_MARK, outcome, session);
    return { kind: 'done' as const, result, outcome };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit: the trail, every holder's permission snapshot dropped (so the new keys are
  // in force at their next request, not at the snapshot's TTL), and the roles screen told.
  await rbacService.afterGrantsAlongside(run.result);
  return { status: 'done', ...run.outcome };
};

/** Run it once and say what happened. Exported so a test can await it. */
export const runItScreenGrantsGoLive = async (): Promise<void> => {
  const outcome = await copyItScreenGrants();
  if (outcome.status === 'done') {
    logger.warn(
      outcome,
      'it go-live: the lines and consumables grants were copied from the asset grants — done, and never again',
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the other IT steps' terms.
 */
export const startItScreenGrantsGoLive = (): void => {
  if (isTest) return;
  runItScreenGrantsGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: copying the lines and consumables grants failed — no boot was harmed',
    );
  });
};
