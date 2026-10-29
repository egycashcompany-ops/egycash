// The two request-derived facts every ATM write needs: WHERE it is filed and WHO did it.
//
// Branch: the legacy had no branch field anywhere — a branch WAS a separate deployment
// (contad_app.js:221-224, one server+DB per branch). In one central database the branch is
// explicit and is resolved from the CALLER, never accepted from a form (the owner's rule:
// "لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية"). The resolution is gold's
// `resolveCreateBranchId` — the branch the caller is acting in (`currentBranchId`: placement, or
// the command bar's choice within their reach — ADR-028), then the single-branch fallback,
// otherwise an explicit refusal naming the control.
//
// GM-20 for ATM (2026-10-28): an ORGANIZATION-WIDE holder of the write's key files where the TOP
// BAR points, as their reads already do (`scopeSelector` narrows an organization grant to the top
// bar's branch). `currentBranchId` puts the home placement first — an organization grant adds
// nothing to the reach list — so such a user placed in Alexandria filed every machine,
// replenishment and maintenance under Alexandria whatever the top bar said, and silently under
// «كل الشركة», while the page they were looking at read another branch: written where nobody looked
// (the owner's report: a machine shown only under «كل الشركة»). On «كل الشركة» they file in the
// company's only active branch, or are asked to choose one first — never their home. Every other
// caller keeps the rule above unchanged; `currentBranchId` itself is the platform's, used outside
// ATM, and is not touched. The key is the WRITE's own: the top bar is honoured only where that key
// reaches every branch, so a branch-scoped employee sending another branch in the header still
// files at home; and a caller whose grants list units (a reach list) keeps today's rule exactly —
// the top bar within that reach, else home. Settlements and the map already follow the top bar
// (`resolveWorkBranch`, `resolveZoneEditBranch`).
//
// Actor: the legacy read the acting user's name from a HIDDEN FORM INPUT and trusted the body
// (atm_replenishment.ejs:559, contad_app.js:689 — port doc conflict T2). Here the name is
// snapshotted from the authenticated identity, which is the same visible outcome ("Added By" /
// "Closed By" columns) minus the spoofability.
import { AtmSettingKeys, type AtmBranchLinksSetting } from '@ecms/contracts';
import {
  currentBranchId,
  keyReachesBranch,
  reachOfKey,
  touchedBranches,
  type AuthContext,
} from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { branchRepository } from '../../../platform/organization';
import { settingsService } from '../../../platform/settings';
import { activeBranchIds } from './branch-scope';

/** Organization scope: which branch works as which is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/** The refusal an organization-wide caller gets on «كل الشركة» — the top bar is the control. */
export const CHOOSE_ATM_BRANCH_MESSAGE = 'اختر فرعًا محددًا من القائمة العلوية أولًا.';

/**
 * Pure: the branch an ATM Operations write under `writeKey` is filed in, before any fallback —
 * null when the caller has not said one. `orgWide`: the key is held at organization scope and the
 * grants list no units (an organization grant adds none), so the top bar decides (GM-20);
 * otherwise the platform's `currentBranchId`, exactly as before.
 */
export const atmWriteBranchOf = (
  ctx: AuthContext,
  writeKey: string,
): { orgWide: boolean; branchId: string | null } => {
  const orgWide =
    ctx.permissions[writeKey] === 'organization' && touchedBranches(ctx.reach).length === 0;
  return { orgWide, branchId: orgWide ? (ctx.activeBranchId ?? null) : currentBranchId(ctx) };
};

/**
 * The company's only branch, or null. `active`: among the active ones — the top bar's list, what an
 * organization-wide caller on «كل الشركة» could have chosen; otherwise today's count, unchanged.
 */
const onlyBranchId = async (active: boolean): Promise<string | null> => {
  if (active) {
    const live = await activeBranchIds();
    const only = live[0];
    return live.length === 1 && only !== undefined ? only : null;
  }
  const page = await branchRepository.list({ page: 1, pageSize: 2 });
  const only = page.items[0];
  return page.meta.totalItems === 1 && only !== undefined ? String(only._id) : null;
};

/**
 * Where an ATM Operations write under `writeKey` is filed, or null when an organization-wide holder
 * must choose a branch first — on «كل الشركة» while the company has more than one active branch.
 * The data-edit dialogs show it before the add (`AtmRefLabelOptionsDto.branch`), so the branch
 * named is the branch written. A caller with no branch at all, and no top bar to choose one with,
 * is refused here as before.
 */
export const actingAtmBranchId = async (
  ctx: AuthContext,
  writeKey: string,
): Promise<string | null> => {
  const { orgWide, branchId } = atmWriteBranchOf(ctx, writeKey);
  if (branchId !== null) return branchId;
  const only = await onlyBranchId(orgWide);
  if (only !== null || orgWide) return only;
  throw new BusinessRuleError(
    ctx.isPrivileged ? CHOOSE_ATM_BRANCH_MESSAGE : 'حسابك غير مرتبط بفرع. تواصل مع مدير النظام.',
  );
};

/**
 * `actingAtmBranchId`, refused when the caller must choose — what every ATM Operations write asks.
 */
export const resolveAtmBranchId = async (ctx: AuthContext, writeKey: string): Promise<string> => {
  const branchId = await actingAtmBranchId(ctx, writeKey);
  if (branchId === null) throw new BusinessRuleError(CHOOSE_ATM_BRANCH_MESSAGE);
  return branchId;
};

/**
 * `atm.branchLinks` as one lookup, source → target (a cached settings read, the refiner's own —
 * branch-links/link-context.ts). For the ids the refiner cannot move because they do not come from
 * the caller: a branch a request names, the register's code mapping, a mail's machine.
 */
export const loadAtmBranchLinks = async (): Promise<ReadonlyMap<string, string>> => {
  const links = await settingsService.resolve<AtmBranchLinksSetting>(
    AtmSettingKeys.BranchLinks,
    ORG_SUBJECT,
  );
  return new Map(links.map((link) => [link.branchId, link.actsAsBranchId]));
};

/**
 * Pure: a branch as ATM files it — a linked source is its target. ONE lookup, as the refiner moves
 * a caller once: the links refuse chains, so a target is never itself a source.
 */
export const linkedBranchOf = (links: ReadonlyMap<string, string>, branchId: string): string => {
  const id = branchId.toLowerCase();
  return links.get(id) ?? id;
};

/**
 * Pure: the branches whose rows a read of `branchId` stands for — the branch ATM files it as, and
 * every linked source working as that one: rows filed under a source before its link existed are
 * the target's until they are moved (`AtmRegisterMetaBranchOptionDto.sourceBranchIds`).
 */
export const branchesFiledAs = (links: ReadonlyMap<string, string>, branchId: string): string[] => {
  const target = linkedBranchOf(links, branchId);
  return [target, ...[...links].filter(([, to]) => to === target).map(([from]) => from)];
};

/** `linkedBranchOf` against the stored links — a branch a REQUEST names, resolved before use. */
export const resolveLinkedBranchId = async (branchId: string): Promise<string> =>
  linkedBranchOf(await loadAtmBranchLinks(), branchId);

/**
 * Whether `atmMachine.manage` lets the caller write Operations data in `branchId`: the key reaches
 * that whole branch, or — the "manage at home" rule — it is held at a scope that reaches no whole
 * branch (department, section or own), lists no units elsewhere, and `branchId` is the branch the
 * caller is PLACED in. Before the reach checks every `manage` holder could add in the branch they
 * act in; a finer-scoped one reaches no whole branch, so the reach check alone took that away, and
 * the placement is the one branch no other key can stretch (review finding F1). A `branch` grant
 * (a delegated deputy's, say) answers through `keyReachesBranch` alone, so a deputy reaching
 * Alexandria cannot write into the Tanta branch they happen to be placed in.
 *
 * Shared by the label add (`ref-label.service.ts`) and the machine add, which since DEC-36 also
 * writes the company-wide register — so it must not land in a branch only an unrelated key reaches.
 */
export const manageActsInBranch = (ctx: AuthContext, branchId: string): boolean => {
  if (keyReachesBranch(ctx, 'atmMachine.manage', branchId)) return true;
  const scope = ctx.permissions['atmMachine.manage'];
  const reach = reachOfKey(ctx, 'atmMachine.manage');
  return (
    (scope === 'department' || scope === 'section' || scope === 'own') &&
    reach.branchIds.length === 0 &&
    reach.departments.length === 0 &&
    ctx.branchId !== null &&
    branchId === ctx.branchId
  );
};

/** The display-name snapshot a row stores for "Added By"/"Closed By"/"Action By". */
export const actorName = (ctx: AuthContext): string | null =>
  ctx.identity?.displayName.ar ?? ctx.identity?.displayName.en ?? null;
