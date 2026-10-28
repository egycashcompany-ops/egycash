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
// re-sending anything.

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
// people see the source's work on the same rows. Nothing is copied or re-filed (the data already IS
// the target's), and nothing outside ATM changes.

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
