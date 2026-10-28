// ATM-6 — the poll loop. The legacy reader's `getUnreadEmails` (Automation/src/index.js:103-213)
// with its two rules made explicit and its two holes closed.
//
// THE RULE THAT DRIVES EVERYTHING, in the owner's words: "الرسائل التي لا يتم قراءتها يجب أن تظل
// Unread حتى يمكن رؤيتها عند فتح الـmail". So the outcome of ingestion decides what happens to the
// message, and only a message ECMS actually took responsibility for is marked read:
//
//   created          → mark read + tag with the BRANCH's colour category
//   duplicateMessage → mark read, no tag (a retry after a half-failure; the ticket already exists)
//   unmatched        → LEAVE UNREAD, log why — the human opening the mailbox must still see it
//
// The legacy dropped unmatched mail on the floor (index.js:199-201): no record, no ticket, and —
// because the message was never marked read but the in-memory watermark moved past it — no second
// look either. Here it stays unread and is retried on every poll, which is what makes "add the
// machine to the master and the mail lands" work without anybody re-sending anything.
//
// WHICH MAILBOX, AND WHICH BRANCHES (/atm/settings; the owner, 2026-10-28: one shared mailbox for
// every branch, «هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع»). With the screen's
// document in force (mailbox-source.ts) a mail is filed only when the document switches its
// machine's branch on; otherwise it is unmatched — "branch not enabled for mail" — and left unread
// like any other, so a branch switched on later picks up its backlog. The category comes from the
// document's row, and the old setting answers for a row without one. The document is read NEWEST
// first with a sweep below (`readNewestFirst`): the mail it leaves unread piles up in the shared
// mailbox and must never stand between the reader and a new one. With no document nothing here
// changed: the oldest page, every branch, the old setting.
//
// A run on the document is recorded on it (`lastPoll`, the screen's last-run line) — best effort:
// a record that fails is logged and never fails the run.
import { ATM_MAIL_POLL_REASONS_MAX, AtmSettingKeys } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { settingsService } from '../../../platform/settings';
import { atmMailIngestionService, type AtmMailIngestGate } from './mail-ingestion.service';
import { type AtmMailMessage, type AtmMailPage, type AtmMailSource } from './mail-source';
import { type AtmMailPollRunRecord, type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';
import { mailboxSourceFor, resolveAtmMailPollPlan, type AtmMailPollPlan } from './mailbox-source';

/** Organization scope: which mailbox category marks which branch is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/** How many unread messages one poll takes on. The backlog survives; the next tick continues it. */
const POLL_BATCH = 50;

/** A run's error is a provider's sentence, not a log: kept short on the document. */
const ERROR_MAX = 500;

export interface AtmMailPollReport {
  read: number;
  created: number;
  duplicates: number;
  /** Left unread on purpose — the backlog a human can still see. */
  unmatched: number;
  /** Ingestion threw; the message is left unread so the next poll retries it. */
  failed: number;
}

/**
 * One run, as `lastPoll` keeps it and «قراءة الآن» answers it: the counts, when the run STARTED,
 * why it failed as a whole (else null), and the first `ATM_MAIL_POLL_REASONS_MAX` unmatched
 * reasons.
 */
export type AtmMailPollRun = AtmMailPollRunRecord;

const EMPTY: AtmMailPollReport = { read: 0, created: 0, duplicates: 0, unmatched: 0, failed: 0 };

const idleRun = (at: Date): AtmMailPollRun => ({ at, ...EMPTY, error: null, unmatchedReasons: [] });

/**
 * branchId → mailbox category name, from the module setting. One reader serves every branch, so
 * the category is what tells a person looking at the shared mailbox which branch a mail went to —
 * the legacy's single hard-coded "Green Category" made per branch (port doc §6).
 */
export const resolveBranchCategories = async (): Promise<Map<string, string>> => {
  const rows = await settingsService.resolve<{ branchId: string; category: string }[]>(
    AtmSettingKeys.MailBranchCategories,
    ORG_SUBJECT,
  );
  return new Map(rows.map((row) => [row.branchId, row.category]));
};

/** The switched-on branches, and the category each row names (rows naming none are absent). */
const documentRules = (
  doc: AtmMailboxConfigDoc,
): { gate: AtmMailIngestGate; categories: Map<string, string> } => {
  const categories = new Map<string, string>();
  for (const row of doc.branches) {
    if (row.category !== null) categories.set(String(row.branchId), row.category);
  }
  return {
    gate: { branchIds: new Set(doc.branches.map((row) => String(row.branchId))) },
    categories,
  };
};

/** What a run has done so far — kept when the mailbox fails part-way through. */
interface Tally {
  report: AtmMailPollReport;
  unmatchedReasons: string[];
}

const emptyTally = (): Tally => ({ report: { ...EMPTY }, unmatchedReasons: [] });

/** The category a filed mail is tagged with: the document's row, else the old setting. */
type CategoryOf = (branchId: string) => string | null;

const categoryLookup = async (
  documentCategories: ReadonlyMap<string, string>,
): Promise<CategoryOf> => {
  const categories = await resolveBranchCategories();
  return (branchId) => documentCategories.get(branchId) ?? categories.get(branchId) ?? null;
};

/**
 * One message through ingestion, and what the mailbox is told about it. True when it was marked
 * read — it has left the unread list — and false when it stays there. Never throws: a message
 * that fails is counted and left unread.
 */
const takeOn = async (
  source: AtmMailSource,
  message: AtmMailMessage,
  gate: AtmMailIngestGate | undefined,
  categoryOf: CategoryOf,
  tally: Tally,
): Promise<boolean> => {
  const { report } = tally;
  report.read += 1;
  try {
    const outcome = await atmMailIngestionService.ingest(message, gate);
    if (outcome.outcome === 'unmatched') {
      report.unmatched += 1;
      if (outcome.reason !== null) tally.unmatchedReasons.push(outcome.reason);
      return false;
    }
    if (outcome.outcome === 'duplicateMessage') {
      report.duplicates += 1;
      await source.markHandled(message.providerMessageId, null);
      return true;
    }
    report.created += 1;
    // The ticket's branch came from the machine — the category follows it. A branch with no
    // configured category is still marked read; the tag is a convenience, not the record.
    const branchId = outcome.ticketId === null ? null : outcome.branchId;
    await source.markHandled(
      message.providerMessageId,
      branchId === null ? null : categoryOf(branchId),
    );
    return true;
  } catch (error) {
    // Left UNREAD on purpose: an ingestion that threw has not taken responsibility for the
    // message, and marking it read would lose it silently.
    report.failed += 1;
    logger.error(
      { err: error, providerMessageId: message.providerMessageId },
      'atm mail poll: ingestion failed, message left unread',
    );
    return false;
  }
};

/**
 * The environment's reading, as it always was: the oldest `POLL_BATCH` unread, once. Throws only
 * when the mailbox itself fails (the listing, the token, the category setting).
 */
const readOnce = async (
  source: AtmMailSource,
  gate: AtmMailIngestGate | undefined,
  documentCategories: ReadonlyMap<string, string>,
  tally: Tally,
): Promise<void> => {
  const messages = await source.listUnread(POLL_BATCH);
  if (messages.length === 0) return;
  const categoryOf = await categoryLookup(documentCategories);
  for (const message of messages) await takeOn(source, message, gate, categoryOf, tally);
};

/**
 * Where the document's backlog sweep stands (`readNewestFirst`): how far below the newest page the
 * next older page starts. Per document VERSION, so a save — a branch switched on — starts it over.
 */
let sweep: { key: string; offset: number } | null = null;

/**
 * The mailbox document's reading. ONE mailbox serves every branch, and the mail ECMS leaves unread
 * on purpose — a branch not switched on yet, a machine not in the master — stays in it. Read oldest
 * first, fifty of those would stand between the reader and every new mail for good; so it reads
 * NEWEST first, and a new mail is filed on the next run however large that pile grows.
 *
 * The pile is not abandoned either: when the newest page is full, the run also takes ONE older
 * page, the next step of a sweep that walks the rest of the unread mail a page per run and starts
 * over at its end — so a backlog deeper than a page (a branch switched on after weeks, a machine
 * added to the master later) is still filed, and no run lists more than two pages.
 */
const readNewestFirst = async (
  source: AtmMailSource,
  listPage: (limit: number, skip: number) => Promise<AtmMailPage>,
  gate: AtmMailIngestGate | undefined,
  documentCategories: ReadonlyMap<string, string>,
  sweepKey: string,
  tally: Tally,
): Promise<void> => {
  const newest = await listPage(POLL_BATCH, 0);
  const offset = sweep?.key === sweepKey ? sweep.offset : 0;
  if (newest.listed === 0) return;
  const categoryOf = await categoryLookup(documentCategories);
  const seen = new Set<string>();
  let markedRead = 0;
  for (const message of newest.messages) {
    seen.add(message.providerMessageId);
    if (await takeOn(source, message, gate, categoryOf, tally)) markedRead += 1;
  }
  if (newest.listed < POLL_BATCH) {
    // The whole unread list fitted on one page: nothing below it to sweep.
    sweep = { key: sweepKey, offset: 0 };
    return;
  }

  // What the newest page left unread still heads the list; the sweep continues below it.
  const older = await listPage(POLL_BATCH, newest.listed - markedRead + offset);
  let olderMarkedRead = 0;
  for (const message of older.messages) {
    // The list can shift between the two listings (mail arrives, someone opens one in Outlook).
    if (seen.has(message.providerMessageId)) continue;
    seen.add(message.providerMessageId);
    if (await takeOn(source, message, gate, categoryOf, tally)) olderMarkedRead += 1;
  }
  sweep = {
    key: sweepKey,
    // A short page is the end of the list: the next run starts the sweep over.
    offset: older.listed < POLL_BATCH ? 0 : offset + older.listed - olderMarkedRead,
  };
};

/** Best effort: the run is the reader's work, its record a convenience for the screen. */
const recordRun = async (plan: AtmMailPollPlan, run: AtmMailPollRun): Promise<void> => {
  if (plan.mode !== 'mailbox') return;
  try {
    await atmMailboxConfigRepository.recordLastPoll(plan.doc._id, run);
  } catch (error) {
    logger.warn({ err: error }, 'atm mail poll: the run was not recorded on the mailbox settings');
  }
};

/**
 * One run — the per-minute scheduled task, and «قراءة الآن». Returns what it did so the task logs
 * a single line per run instead of one per message (a mailbox with a permanently unparseable
 * newsletter in it would otherwise produce a warning every minute forever). A mailbox that fails
 * as a whole is the run's `error`, not a throw: the screen shows it, and the scheduled task turns
 * it back into a failed run (atm.module.ts).
 */
export const pollAtmMailbox = async (): Promise<AtmMailPollRun> => {
  const at = new Date();
  const plan = await resolveAtmMailPollPlan();
  if (plan.mode === 'off') return idleRun(at);
  if (plan.mode === 'environment' && !plan.source.available()) return idleRun(at);

  const tally = emptyTally();
  let error: string | null = null;
  let providerId: string | null = null;
  try {
    if (plan.mode === 'environment') {
      providerId = plan.source.providerId;
      await readOnce(plan.source, undefined, new Map<string, string>(), tally);
    } else {
      const { gate, categories } = documentRules(plan.doc);
      const source = mailboxSourceFor(plan.doc);
      providerId = source.providerId;
      const listPage = source.listUnreadPage?.bind(source);
      if (listPage === undefined) await readOnce(source, gate, categories, tally);
      else {
        const sweepKey = `${String(plan.doc._id)}:${String(plan.doc.__v)}`;
        await readNewestFirst(source, listPage, gate, categories, sweepKey, tally);
      }
    }
  } catch (failure) {
    // The listing (or the token before it) failed; whatever was taken on before stays counted.
    logger.warn({ err: failure, mode: plan.mode }, 'atm mail poll failed');
    const text = failure instanceof Error ? failure.message : String(failure);
    error = text.slice(0, ERROR_MAX);
  }

  const unmatchedReasons = tally.unmatchedReasons.slice(0, ATM_MAIL_POLL_REASONS_MAX);
  if (tally.report.read > 0) {
    logger.info(
      { provider: providerId, ...tally.report, unmatchedReasons },
      'atm mail poll complete',
    );
  }
  const run: AtmMailPollRun = { at, ...tally.report, error, unmatchedReasons };
  await recordRun(plan, run);
  return run;
};

/** Test seam — the sweep position is process-wide. */
export const resetAtmMailSweep = (): void => {
  sweep = null;
};
