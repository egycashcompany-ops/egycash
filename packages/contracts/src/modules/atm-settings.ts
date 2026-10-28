// The /atm/settings page — «إعدادات الصراف الآلي» — and the two things it administers (module
// `atm`): the Banque Misr maintenance mailbox the central reader polls, and the branches that work
// as one in ATM. Both are `atmSettings.manage`, held at ORGANIZATION scope (as `atmBank.*` is): one
// mailbox serves every branch, and which branch works as which is one fact about the company — a
// branch-scoped holder editing either would be editing it for everybody.
//
// The owner (2026-10-28): «عايز نبدأ فى موضوع الـ Automation بتاع الميلات اللى بيجي من بنك مصر
// لماكينات الصيانة — هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع». Asked how, the owner
// answered: ONE shared mailbox for every branch, branches switched on one at a time, and the
// mailbox credentials typed on a screen with the secret stored encrypted — never in code.
import { z } from 'zod';
import { EMAIL_RE, objectId, type LocalizedString } from '../common/index.js';
// `import type`: atm-register.ts imports atm.ts at runtime, and this file needs only the type.
import type { AtmBankCode } from './atm-register.js';

/**
 * A branch id, lower-cased. The server compares these with `String(ObjectId)` — lower-case hex —
 * so an id typed in capitals on the generic settings screen would otherwise never match anything.
 */
const branchRef = () => objectId().transform((id) => id.toLowerCase());

// ── The maintenance mailbox (`atm_mailbox_config`; GET/PUT /atm/mailbox, POST …/test, …/poll) ───
//
// ONE document. While none exists the reader keeps the deployment's `ATM_MAIL_GRAPH_*` environment
// exactly as before (every branch, the old category setting); once one exists it is the only
// source, and a disabled one reads nothing. THE MACHINE STILL DECIDES THE BRANCH (port doc §6): a
// mail is filed under its machine's branch, and — with a document — only when that branch is
// switched on in it. Otherwise it stays UNREAD in the mailbox — the owner's rule for every mail the
// system does not take on — so a branch switched on later picks up its backlog without anybody
// re-sending anything. The machine's branch is read as ATM resolves it (`atm.branchLinks`): a
// machine still filed under a linked source is its target's, so the target's row switches its
// mail on and files it under the target — the owner (2026-10-28) saw a Mohandessin machine's mail
// only under «كل الشركة»: mail filed under the linked October shows nowhere else.

/**
 * Branches one mailbox switches on — a ceiling on a hand-kept list, the one
 * `atm.mail.branchCategories` has.
 */
export const ATM_MAILBOX_BRANCHES_MAX = 100;

/** The unmatched reasons one poll record keeps — the first five, as the reader's log line does. */
export const ATM_MAIL_POLL_REASONS_MAX = 5;

/**
 * A directory (tenant) id as Microsoft writes it: a GUID or a verified domain
 * (`egycash.onmicrosoft.com`). It is interpolated into the token URL's PATH, so nothing that could
 * reshape a URL (`/`, `?`, `#`, `%`, a space) is accepted.
 */
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** An application (client) id is always a GUID. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One switched-on branch and the Outlook category its mail is tagged with when the reader takes it
 * on — the legacy's one hard-coded "Green Category" (Automation/src/index.js:224) made per branch.
 * Blank or null = no category of its own: `atm.mail.branchCategories` answers for it, else the
 * message is marked read untagged (the ticket is the record, the colour a convenience).
 */
export const AtmMailboxBranchSchema = z
  .object({
    branchId: branchRef(),
    category: z
      .string()
      .trim()
      .max(64)
      .nullable()
      .transform((category) => (category === '' ? null : category)),
  })
  .strict();
export type AtmMailboxBranch = z.output<typeof AtmMailboxBranchSchema>;

const eachBranchOnce = (rows: readonly { branchId: string }[], ctx: z.RefinementCtx): void => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.branchId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'branchId'],
        message: 'duplicateBranch',
      });
    }
    seen.add(row.branchId);
  });
};

/**
 * PUT /atm/mailbox — the whole card in one save.
 *
 * `clientSecret` is the one field never read back: absent or blank keeps the stored secret (the
 * screen shows «محفوظ» and leaves the box empty); a value replaces it and is SEALED through the
 * platform secret store before anything is written — the plaintext is never stored, logged,
 * audited or answered. It carries a length rule only, whose message never quotes the input, so no
 * 400 can echo a secret back. `version` is the document's, or null for the first save (the GET
 * answered null: there is no document yet).
 */
export const SaveAtmMailboxConfigSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(100).regex(TENANT_ID),
    clientId: z.string().trim().regex(GUID),
    clientSecret: z
      .string()
      .max(512)
      .transform((secret) => (secret.trim() === '' ? undefined : secret.trim()))
      .optional(),
    /** The mailbox read — Graph's `/users/{userEmail}/messages`, as the legacy reader did. */
    userEmail: z.string().trim().max(254).regex(EMAIL_RE),
    /** «تفعيل القراءة» — off, the reader reads nothing at all, environment included. */
    enabled: z.boolean(),
    /**
     * A linked SOURCE on this list is saved as its target, or dropped when the target is on it too:
     * its mail is filed under the target, so a row of its own would switch nothing on. The card
     * marks such a row before the save.
     */
    branches: z
      .array(AtmMailboxBranchSchema)
      .max(ATM_MAILBOX_BRANCHES_MAX)
      .superRefine(eachBranchOnce),
    version: z.number().int().min(0).nullable(),
  })
  .strict();
export type SaveAtmMailboxConfigInput = z.input<typeof SaveAtmMailboxConfigSchema>;
export type SaveAtmMailboxConfig = z.output<typeof SaveAtmMailboxConfigSchema>;

/** One switched-on branch as the card lists it. */
export interface AtmMailboxBranchDto {
  branchId: string;
  /** Null when the branch no longer exists — the row still shows, so it can be removed. */
  branchName: LocalizedString | null;
  category: string | null;
}

/**
 * One run of the reader — the per-minute scheduled one, or «قراءة الآن» — as the document keeps
 * the latest. `read` is what the mailbox handed over; of those, `created` became tickets,
 * `duplicates` were tickets already (marked read again), `unmatched` were LEFT UNREAD (no machine,
 * an ambiguous code, or a branch not switched on — `unmatchedReasons` holds the first
 * `ATM_MAIL_POLL_REASONS_MAX` reasons), and `failed` threw and are retried on the next run.
 */
export interface AtmMailPollRunDto {
  /** When the run started (ISO). */
  at: string;
  read: number;
  created: number;
  duplicates: number;
  unmatched: number;
  failed: number;
  /** Why the run failed as a whole (the token refused, the mailbox unreachable); else null. */
  error: string | null;
  unmatchedReasons: string[];
}

/**
 * GET /atm/mailbox (and the PUT's answer) — the document, or `null` from the GET while there is
 * none. The secret is never in it, sealed or plain: `hasSecret` says whether one is stored.
 */
export interface AtmMailboxConfigDto {
  tenantId: string;
  clientId: string;
  hasSecret: boolean;
  userEmail: string;
  enabled: boolean;
  branches: AtmMailboxBranchDto[];
  /** Null until the reader has run on this document. */
  lastPoll: AtmMailPollRunDto | null;
  version: number;
}

/**
 * POST /atm/mailbox/test — a token is acquired and ONE unread message listed with the stored
 * settings; nothing is marked read or filed. `unreadSample` is how many came back (0 or 1);
 * `error` is the provider's refusal, never the secret.
 */
export interface AtmMailboxTestResultDto {
  ok: boolean;
  unreadSample: number;
  error: string | null;
}

// ── Branches that work as one in ATM (`atm.branchLinks`; GET/PUT /atm/branch-links) ────────────
//
// The owner (2026-10-28), for ATM only: «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم
// والبيانات دي متسجله إنها المهندسين — يعني أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى
// والمهندسين شايف أكتوبر إنه شغال معاه بردو».
//
// So a link is DIRECTED: `branchId` (October) acts as `actsAsBranchId` (Mohandessin). On an ATM
// request a user placed in the source is answered as if placed in the target — they see the
// target's ATM data and what they write is filed under the target, which is how the target's own
// people see the source's work on the same rows. Saving a link copies or re-files nothing, and
// nothing outside ATM changes; what was filed under the source BEFORE — the workbook import's rows
// and their machines, their mail — is moved to the target by «نقل البيانات» (below), once, after a
// preview.

/** Links one list may hold — a ceiling on a hand-kept list, never reached by a real org chart. */
export const ATM_BRANCH_LINKS_MAX = 100;

export const AtmBranchLinkSchema = z
  .object({ branchId: branchRef(), actsAsBranchId: branchRef() })
  .strict();
export type AtmBranchLink = z.output<typeof AtmBranchLinkSchema>;

/**
 * Why a list of links is refused, per row:
 * · `sameBranch` — a branch cannot act as itself;
 * · `duplicateSource` — a branch acts as ONE other branch, so it is the source of one row at most;
 * · `chain` — the row's target is itself a source (A→B with B→C, or A→B with B→A). Refused, not
 *   followed: a user is moved once, so what "B's data" means never depends on another row.
 */
export const ATM_BRANCH_LINK_ISSUES = ['sameBranch', 'duplicateSource', 'chain'] as const;
export type AtmBranchLinkIssue = (typeof ATM_BRANCH_LINK_ISSUES)[number];

export interface AtmBranchLinkIssueAt {
  index: number;
  field: 'branchId' | 'actsAsBranchId';
  issue: AtmBranchLinkIssue;
}

/**
 * Every rule a list breaks, in row order — the setting's own refinement, shared so the screen's add
 * row can check `[...links, candidate]` before it sends anything. Ids are compared lower-cased.
 * Whether both branches exist and are active is the server's question, not this function's.
 */
export const atmBranchLinkIssues = (
  links: readonly { branchId: string; actsAsBranchId: string }[],
): AtmBranchLinkIssueAt[] => {
  const sources = new Set(links.map((link) => link.branchId.toLowerCase()));
  const seen = new Set<string>();
  const issues: AtmBranchLinkIssueAt[] = [];
  links.forEach((link, index) => {
    const source = link.branchId.toLowerCase();
    const target = link.actsAsBranchId.toLowerCase();
    if (seen.has(source)) issues.push({ index, field: 'branchId', issue: 'duplicateSource' });
    seen.add(source);
    if (source === target) issues.push({ index, field: 'actsAsBranchId', issue: 'sameBranch' });
    else if (sources.has(target)) issues.push({ index, field: 'actsAsBranchId', issue: 'chain' });
  });
  return issues;
};

/**
 * `atm.branchLinks` — organization scope, DEFAULT EMPTY: no branch acts as another until an
 * administrator links them. Each refusal is reported at its row and field with the issue as the
 * message (`body.links.0.actsAsBranchId` · `chain`).
 */
export const AtmBranchLinksSettingSchema = z
  .array(AtmBranchLinkSchema)
  .max(ATM_BRANCH_LINKS_MAX)
  .superRefine((links, ctx) => {
    for (const { index, field, issue } of atmBranchLinkIssues(links)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, field], message: issue });
    }
  });
export type AtmBranchLinksSetting = z.output<typeof AtmBranchLinksSettingSchema>;

/** PUT /atm/branch-links — the whole list, replacing the stored one. */
export const SaveAtmBranchLinksSchema = z.object({ links: AtmBranchLinksSettingSchema }).strict();
export type SaveAtmBranchLinks = z.output<typeof SaveAtmBranchLinksSchema>;

/** One link as the card lists it: «أكتوبر ← يعمل باسم المهندسين». */
export interface AtmBranchLinkDto {
  branchId: string;
  /** Null when the branch no longer exists — the row still shows, so it can be removed. */
  branchName: LocalizedString | null;
  actsAsBranchId: string;
  actsAsBranchName: LocalizedString | null;
}

/** GET /atm/branch-links, and the PUT's answer. */
export interface AtmBranchLinksDto {
  links: AtmBranchLinkDto[];
}

// ── «نقل البيانات» — a linked source's ATM data moved to its target ─────────────────────────────
//
// GET /atm/branch-links/:sourceBranchId/move previews, POST moves.
//
// A link answers the source's people AS the target from the moment it is saved, but it moves no
// row: whatever was filed under October before — the workbook rows of the code mapped to it, the
// machines coupled to them, the mail of those machines — stays under October, readable only under
// «كل الشركة». The owner's report (2026-10-28): a Mohandessin machine shown only under «كل الشركة»,
// its mail too — «أنا عايز كل ماكينه تظهر فى الفرع بتاعها طبقاً للفرع المتسجله فيه». So an
// administrator moves the source's ATM data to its target, from the links card: a PREVIEW first
// (what moves, what merges, what refuses the move), then the move.
//
// The pair is the STORED link — the path names the source, a source not stored is 404, and the
// target is never taken from the request. `atmSettings.manage` at organization scope, as the links
// save. The link stays: the source's people keep working as the target afterwards.

/** `:sourceBranchId` — the link's source, lower-cased as every stored link id is. */
export const AtmBranchMoveParamsSchema = z.object({ sourceBranchId: branchRef() }).strict();
export type AtmBranchMoveParams = z.output<typeof AtmBranchMoveParamsSchema>;

/**
 * What a move re-files, in the order the dialog lists it — every ATM collection whose rows carry a
 * `branchId`, but one: the source's zone-set document stays (the target's revision moves on, so an
 * open zone editor reloads). The bank catalog and the register import runs carry no branch; the note
 * counters hold it inside their key and are left behind, because the next Note issued in the target
 * raises its counter past every moved serial; the mailbox list is re-pointed (`mailboxRepointed`).
 */
export const ATM_BRANCH_MOVE_COLLECTIONS = [
  'machines',
  'registerEntries',
  'mailTickets',
  'maintenances',
  'replenishments',
  'refLabels',
  'machineLocations',
  'cassetteLayouts',
  'cassetteLayoutVersions',
  'mapZones',
  'dispatchRoutes',
  'routeAssignments',
  'standardLoads',
  'replenishmentPlans',
  'planLines',
  'linePreparations',
  'layoutImportRuns',
] as const;
export const AtmBranchMoveCollectionSchema = z.enum(ATM_BRANCH_MOVE_COLLECTIONS);
export type AtmBranchMoveCollection = z.infer<typeof AtmBranchMoveCollectionSchema>;

/** Rows per collection, every key present — 0 when there are none. */
export type AtmBranchMoveCountsDto = Record<AtmBranchMoveCollection, number>;

/** No rows anywhere: the shape a count starts from. */
export const emptyAtmBranchMoveCounts = (): AtmBranchMoveCountsDto => ({
  machines: 0,
  registerEntries: 0,
  mailTickets: 0,
  maintenances: 0,
  replenishments: 0,
  refLabels: 0,
  machineLocations: 0,
  cassetteLayouts: 0,
  cassetteLayoutVersions: 0,
  mapZones: 0,
  dispatchRoutes: 0,
  routeAssignments: 0,
  standardLoads: 0,
  replenishmentPlans: 0,
  planLines: 0,
  linePreparations: 0,
  layoutImportRuns: 0,
});

/** Σ of the counts — a preview's and a result's `total`. */
export const atmBranchMoveTotal = (counts: AtmBranchMoveCountsDto): number =>
  ATM_BRANCH_MOVE_COLLECTIONS.reduce((sum, collection) => sum + counts[collection], 0);

/**
 * What a move merges or changes beyond re-filing rows — a count each, 0 for nothing:
 * · `labelsMerged` — a source bank spelling or area whose name the target also holds live: the
 *   target's row stays and takes only what it left empty (its bank, its display names) and the
 *   union of the former names; the source's row is retired and moved with the rest;
 * · `labelsRetired` — a live source name the target renamed away (in its `formerNames`): retired,
 *   so a renamed name never comes back (DEC-38) in the merged branch either;
 * · `machineTwinsRetired` — one code held by a master in each branch: the one that stays (the
 *   active one; of two active ones, the one holding the code's open register period; of two
 *   archived ones, the target's) keeps its id and history, the other is retired the legacy way
 *   (`<code>-D`, deleted) and keeps its own history on its own id;
 * · `zonesRenamed` — source zones whose name the target already uses, renamed with a suffix (within
 *   `ATM_MAP_ZONE_NAME_MAX`); every source zone's order follows the target's;
 * · `routesRenamed` — source dispatch lines whose name the target uses on the same day, renamed;
 * · `standardLoadDefaultsUnset` — a source default for a bank the target already has a default for
 *   is no longer the default; the target's stays;
 * · `layoutImportRunsAbandoned` — source Full list imports left `running` for over 30 minutes,
 *   closed first, as the import's own takeover does;
 * · `mailboxRepointed` — the source's row in the mailbox list, saved as the target's, or dropped
 *   when the target is switched on already (0 or 1);
 * · `settingsRepointed` — rows of `atm.mail.branchCategories` and `atm.register.branchCodes` that
 *   name the source, re-pointed to the target where the target has none of its own.
 */
export const ATM_BRANCH_MOVE_MERGES = [
  'labelsMerged',
  'labelsRetired',
  'machineTwinsRetired',
  'zonesRenamed',
  'routesRenamed',
  'standardLoadDefaultsUnset',
  'layoutImportRunsAbandoned',
  'mailboxRepointed',
  'settingsRepointed',
] as const;
export type AtmBranchMoveMerge = (typeof ATM_BRANCH_MOVE_MERGES)[number];
export type AtmBranchMoveMergesDto = Record<AtmBranchMoveMerge, number>;

/** Nothing merged: the shape the merges start from. */
export const emptyAtmBranchMoveMerges = (): AtmBranchMoveMergesDto => ({
  labelsMerged: 0,
  labelsRetired: 0,
  machineTwinsRetired: 0,
  zonesRenamed: 0,
  routesRenamed: 0,
  standardLoadDefaultsUnset: 0,
  layoutImportRunsAbandoned: 0,
  mailboxRepointed: 0,
  settingsRepointed: 0,
});

/**
 * What refuses a move — each one for the administrator to resolve first, listed with what it names
 * (the move never guesses past one):
 * · `machineActiveInBoth` — a machine code ACTIVE in both branches where the register does not
 *   decide which machine exists (D2: the one holding the code's open register period stays):
 *   neither holds it, or both do through exempt twins (DEC-11);
 * · `machineTwinOpen` — the twin the move would retire still holds an open register entry or an
 *   open replenishment or maintenance;
 * · `planSerialCollision` — Notes of the same bank issued in both branches: each branch's serials
 *   start at 1, and a serial printed on a «محضر جرد» Note is never renumbered;
 * · `planSameDay` — a replenishment plan of the same bank for the same day in both branches;
 * · `zoneCaps` — the target would pass a map cap (`ATM_MAP_ZONES_PER_BRANCH_MAX` zones or
 *   `ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX` points), after which no zone save could pass again;
 *   `zones` and `points` are the target's totals after the move;
 * · `layoutImportRunning` — a Full list import of the source `running` for under 30 minutes;
 * · `moveRunning` — another move holds the run lock (one at a time, 30 minutes before it is stale).
 */
export const ATM_BRANCH_MOVE_BLOCKERS = [
  'machineActiveInBoth',
  'machineTwinOpen',
  'planSerialCollision',
  'planSameDay',
  'zoneCaps',
  'layoutImportRunning',
  'moveRunning',
] as const;
export type AtmBranchMoveBlockerKind = (typeof ATM_BRANCH_MOVE_BLOCKERS)[number];

/** One refusal and what it names — machine codes, bank codes, (bank, `YYYY-MM-DD`) pairs. */
export type AtmBranchMoveBlockerDto =
  | { kind: 'machineActiveInBoth'; codes: string[] }
  | { kind: 'machineTwinOpen'; codes: string[] }
  | { kind: 'planSerialCollision'; bankCodes: AtmBankCode[] }
  | { kind: 'planSameDay'; items: { bankCode: AtmBankCode; replenishDate: string }[] }
  | { kind: 'zoneCaps'; zones: number; points: number }
  | { kind: 'layoutImportRunning'; bankCodes: AtmBankCode[] }
  | { kind: 'moveRunning' };

/** `atm_branch_move_runs.state` — the run lock: one `running` at a time, 30 minutes to stale. */
export const ATM_BRANCH_MOVE_RUN_STATES = ['running', 'done', 'failed'] as const;
export type AtmBranchMoveRunState = (typeof ATM_BRANCH_MOVE_RUN_STATES)[number];

/** GET /atm/branch-links/:sourceBranchId/move — read-only: what a move would do now. */
export interface AtmBranchMovePreviewDto {
  sourceBranchId: string;
  /** The ECMS names, as the top bar shows them; null for a branch that no longer exists. */
  sourceBranchName: LocalizedString | null;
  targetBranchId: string;
  targetBranchName: LocalizedString | null;
  /** Rows filed under the source, per collection. */
  counts: AtmBranchMoveCountsDto;
  /** `atmBranchMoveTotal(counts)` — 0: nothing is filed under the source any more. */
  total: number;
  merges: AtmBranchMoveMergesDto;
  blockers: AtmBranchMoveBlockerDto[];
  /** `blockers.length === 0`. The dialog also holds «نقل» back while `total` is 0. */
  canMove: boolean;
}

/**
 * POST /atm/branch-links/:sourceBranchId/move — what the run did. Refused 409
 * `ATM_BRANCH_MOVE_BLOCKED` while the preview carries a blocker, before anything is written. A
 * blocker that appears while the run goes stops it at the step that meets it — 409
 * `ATM_BRANCH_MOVE_STOPPED`, what the earlier steps moved staying moved. A run stopped or cut off
 * part-way is continued by running it again: every step reads only the rows still filed under the
 * source.
 */
export interface AtmBranchMoveResultDto {
  /** The run (`atm_branch_move_runs`) — the run's one `atmBranchMove` audit row names it. */
  runId: string;
  sourceBranchId: string;
  sourceBranchName: LocalizedString | null;
  targetBranchId: string;
  targetBranchName: LocalizedString | null;
  /** Rows now filed under the target, per collection — a retired label or machine twin included. */
  moved: AtmBranchMoveCountsDto;
  /** `atmBranchMoveTotal(moved)`. */
  total: number;
  merges: AtmBranchMoveMergesDto;
  /** Rows still filed under the source after the run, per collection — all 0 once it completed. */
  remaining: AtmBranchMoveCountsDto;
}
