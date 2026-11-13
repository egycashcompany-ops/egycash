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
//
// ONE READING AT A TIME, AND A SHORT ONE (2026-11-13: «الـ Automation بتاع الميل واقف بقاله شوية
// كتير» — the screen's test said «This operation was aborted»). The mailbox answers four requests
// at once per application; past that it queues them. A run that timed out was retried by the job
// queue four more times, 2 to 16 seconds apart between 20-second timeouts — some two minutes of
// retries — while the next minutes' runs started, so up to five readers met in the mailbox, every
// request waited behind the others, timed out, and was retried again. So: a run holds a lease
// (`MAIL_POLL_LEASE_KEY`) — the scheduled one and «قراءة الآن» alike, across the api and the worker
// — and a run that finds it taken steps aside; it stops taking on new mail after a bounded time
// (`RUN_BUDGET_MS`) and leaves the rest to the next minute; and its failure is not retried
// (`retry: false` on the task): the next minute IS the retry.
//
// A FAILING MAILBOX IS GIVEN TIME (2026-11-13, after the above: one reading a minute, and Graph
// still answered every one with a 502 after some twenty seconds). A reading a minute that the
// mailbox cannot answer only adds to what it is struggling with. After readings in a row whose
// first listing it did not answer, the scheduled reading waits longer before the next try — 2, 4,
// 8, then 10 minutes at most (`MAIL_POLL_BACKOFF_KEY`, `backoffAfter`); «قراءة الآن» never waits,
// and the first reading the mailbox answers, either one, puts the minute back.
//
// Branches are read as ATM files them (`atm.branchLinks`): a mail is filed under its machine's
// RESOLVED branch (mail-ingestion.service.ts), so the switched-on set and the colours are resolved
// the same way — a linked source's row switches its target on and colours it, unless the target
// has a row of its own.
import { randomUUID } from 'node:crypto';
import { ATM_MAIL_POLL_REASONS_MAX, AtmSettingKeys } from '@ecms/contracts';
import { env } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { getCache } from '../../../infrastructure/redis/cache';
import { settingsService } from '../../../platform/settings';
import { linkedBranchOf, loadAtmBranchLinks } from '../shared/atm-context';
import { atmMailIngestionService, type AtmMailIngestGate } from './mail-ingestion.service';
import {
  type AtmMailMessage,
  type AtmMailPage,
  type AtmMailSource,
  type AtmMailWindow,
} from './mail-source';
import { type AtmMailPollRunRecord, type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';
import { mailboxSourceFor, resolveAtmMailPollPlan, type AtmMailPollPlan } from './mailbox-source';

/** Organization scope: which mailbox category marks which branch is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/** How many unread messages one poll takes on. The backlog survives; the next tick continues it. */
const POLL_BATCH = 50;

/**
 * How long one run may START new work — the next message, the older page — before it leaves the
 * rest to the next minute. Counted from the moment the newest page has been listed, so a slow
 * listing does not eat the time the mail itself needs. It does not bound how long a run lasts: a
 * request it let start runs to the transport's timeout, a token fetched first to its own, so a slow
 * mailbox can carry a run past the next minute's tick. The lease (`LEASE_TTL_SECONDS`), not this
 * budget, keeps two runs apart: the minute that finds it taken steps aside.
 */
export const RUN_BUDGET_MS = 40_000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The newest page is the unread mail of the last fifteen minutes — a new mail is in it on the next
 * minute's reading, and after any one wait of a failing mailbox (`BACKOFF_MAX_MS`). Waits add up,
 * though: after a gap longer than this (`MAIL_POLL_ANSWERED_KEY`) the mail of the gap is the
 * sweep's, which then starts just below the newest page. What the mailbox is asked to look at is
 * what it costs: asked for every date, then for two days, it gave up after some twenty seconds
 * every time (2026-11-13, Graph's «502 UnknownError»), the shared mailbox holding mostly mail left
 * unread on purpose. The old reader asked for the minute since its last look, and was answered for
 * years. Older unread mail is the sweep's.
 */
export const NEWEST_WINDOW_MS = 15 * MINUTE_MS;

/** One step of the sweep: two hours of receipt times below where it stands — a small question too. */
export const SWEEP_WINDOW_MS = 2 * HOUR_MS;

/**
 * The smallest step a sweep makes when the mailbox cannot answer a window: a failing step is halved
 * (two hours, one, thirty minutes) down to this.
 */
export const SWEEP_MIN_WINDOW_MS = 15 * MINUTE_MS;

/**
 * Failed older pages in a row at one place after which the sweep passes over the window it was
 * asking for — the step already at its smallest — rather than ask the mailbox for it every minute
 * for good. Its mail stays unread; the next cycle asks again.
 */
export const SWEEP_SKIP_AFTER = 5;

/**
 * How far back the sweep walks before it starts over: thirty days. Mail left unread longer than
 * that — a branch switched on after more than a month — is not filed by the reader; the human
 * opening the mailbox still sees it unread.
 */
export const SWEEP_HORIZON_MS = 30 * DAY_MS;

/** A receipt time as the mailbox writes one: to the second, in UTC. */
export const mailInstant = (ms: number): string =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The lease one reading holds — company-wide: the worker's minute and the api's «قراءة الآن». */
export const MAIL_POLL_LEASE_KEY = 'lock:atm-mail-poll';

/**
 * How long the lease outlives a reader that died holding it (a worker restarted mid-reading, as
 * every deploy does). Above any run: the token and the newest listing, the budget, then the one
 * request the budget let start (the older listing or a mark-read) behind a fresh token — four
 * requests each bounded by the transport's timeout — and a margin: 4 × 45 s + 40 s + 30 s = 250 s
 * at the default timeout. A restart costs the mailbox that long at most.
 */
const LEASE_TTL_SECONDS =
  Math.ceil((4 * env.ATM_MAIL_GRAPH_TIMEOUT_MS + RUN_BUDGET_MS) / 1000) + 30;

/**
 * Readings in a row the mailbox did not answer, and when the next SCHEDULED one is due —
 * company-wide like the lease. Gone after a reading it answers; it expires on its own a day after
 * the last failure.
 */
export const MAIL_POLL_BACKOFF_KEY = 'atm-mail-poll:backoff';

const BACKOFF_TTL_SECONDS = 24 * 60 * 60;

/** The longest a failing mailbox waits between scheduled readings. */
export const BACKOFF_MAX_MS = 10 * 60_000;

/**
 * How long the scheduled reading waits after `failures` unanswered readings in a row, counted from
 * when the last one started: not at all after one (a passing hiccup), then 2, 4, 8 minutes, and
 * `BACKOFF_MAX_MS` from then on.
 */
export const backoffAfter = (failures: number): number =>
  failures <= 1 ? 0 : Math.min(BACKOFF_MAX_MS, 60_000 * 2 ** (failures - 1));

/** The cron fires a few seconds either side of the minute: a wait that ends just short of it counts. */
const TICK_SLACK_MS = 5_000;

interface PollBackoff {
  failures: number;
  /** Epoch ms before which no scheduled reading starts. */
  until: number;
}

const readBackoff = async (): Promise<PollBackoff | null> => {
  const raw = await getCache().get(MAIL_POLL_BACKOFF_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PollBackoff>;
    return typeof parsed.failures === 'number' && typeof parsed.until === 'number'
      ? { failures: parsed.failures, until: parsed.until }
      : null;
  } catch {
    return null;
  }
};

/**
 * What a finished reading leaves for the next scheduled one. A mailbox that answered the first
 * listing is not failing, whatever failed after it (the older page, a mark-read): new mail is still
 * filed every minute. One that did not — the token, or the listing itself — counts. Best effort:
 * the cache failing costs the back-off, never the reading.
 */
const noteOutcome = async (
  run: AtmMailPollRun,
  answered: boolean,
  scheduled: boolean,
): Promise<void> => {
  try {
    if (run.error === null || answered) {
      await getCache().del(MAIL_POLL_BACKOFF_KEY);
      if (scheduled) {
        await getCache().set(
          MAIL_POLL_ANSWERED_KEY,
          String(run.at.getTime()),
          ANSWERED_TTL_SECONDS,
        );
      }
      return;
    }
    const failures = ((await readBackoff())?.failures ?? 0) + 1;
    const wait = backoffAfter(failures);
    const until = run.at.getTime() + wait - TICK_SLACK_MS;
    await getCache().set(
      MAIL_POLL_BACKOFF_KEY,
      JSON.stringify({ failures, until } satisfies PollBackoff),
      BACKOFF_TTL_SECONDS,
    );
    if (wait > 0) {
      logger.warn(
        { failures, nextReadingAt: new Date(until + TICK_SLACK_MS).toISOString() },
        'atm mail poll: the mailbox keeps failing — the scheduled reading waits',
      );
    }
  } catch (error) {
    logger.warn({ err: error }, 'atm mail poll: the back-off was not recorded');
  }
};

/** Whether the scheduled reading is still waiting after failures. A cache that fails says no. */
const stillWaiting = async (): Promise<boolean> => {
  try {
    const backoff = await readBackoff();
    return backoff !== null && Date.now() < backoff.until;
  } catch {
    return false;
  }
};

/**
 * When the last SCHEDULED reading the mailbox answered started (epoch ms). The newest page reaches
 * back `NEWEST_WINDOW_MS` from now, not from that reading: after a longer gap (waits that add up,
 * an outage) the mail between them is the sweep's, and the sweep is sent there first
 * (`readNewestFirst`'s catch-up). Only the scheduled reading writes and reads it: the sweep that
 * walks the gap is the worker's — «قراءة الآن» runs in the api, with a sweep of its own, and taking
 * the gap there would leave the worker's sweep wherever it stood.
 */
export const MAIL_POLL_ANSWERED_KEY = 'atm-mail-poll:answered';

const ANSWERED_TTL_SECONDS = 31 * 24 * 60 * 60;

/**
 * How much shorter than the newest window a gap may be and still count as one: the last reading's
 * listing ran a little after it started, and a mail is not always listed the second it arrives.
 */
const CATCH_UP_MARGIN_MS = 2 * MINUTE_MS;

/** The last answered reading's start, or null — never read, expired, or a cache that fails. */
const readLastAnswered = async (): Promise<number | null> => {
  try {
    const raw = await getCache().get(MAIL_POLL_ANSWERED_KEY);
    const at = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
};

/**
 * For a reading starting `at` after a gap the newest page does not reach back over: the receipt
 * time the sweep must walk down to before the gap is behind it — the bottom of the last answered
 * reading's newest page. Null when there is no such gap (or nothing to measure it by).
 */
const gapFloorOf = (at: number, lastAnswered: number | null): number | null =>
  lastAnswered !== null && at - lastAnswered > NEWEST_WINDOW_MS - CATCH_UP_MARGIN_MS
    ? lastAnswered - NEWEST_WINDOW_MS
    : null;

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

/**
 * Pure: branch → category, keyed as ATM files the branch — a linked source's category stands for
 * its target unless the target names its own (rows naming none are absent).
 */
export const categoriesFiledAs = (
  rows: readonly { branchId: string; category: string | null }[],
  links: ReadonlyMap<string, string>,
): Map<string, string> => {
  const categories = new Map<string, string>();
  for (const row of rows) {
    if (row.category === null) continue;
    const branchId = linkedBranchOf(links, row.branchId);
    if (branchId === row.branchId.toLowerCase() || !categories.has(branchId)) {
      categories.set(branchId, row.category);
    }
  }
  return categories;
};

/** Pure: the switched-on branches as ATM files them, and the category each one is tagged with. */
export const documentRules = (
  doc: Pick<AtmMailboxConfigDoc, 'branches'>,
  links: ReadonlyMap<string, string>,
): { gate: AtmMailIngestGate; categories: Map<string, string> } => {
  const rows = doc.branches.map((row) => ({
    branchId: String(row.branchId),
    category: row.category,
  }));
  return {
    gate: { branchIds: new Set(rows.map((row) => linkedBranchOf(links, row.branchId))) },
    categories: categoriesFiledAs(rows, links),
  };
};

/**
 * What a run has done so far — kept when the mailbox fails part-way through — and until when it may
 * go on taking mail (`RUN_BUDGET_MS`).
 */
interface Tally {
  report: AtmMailPollReport;
  unmatchedReasons: string[];
  endsAt: number;
  /** The mailbox answered the run's first listing — whatever failed after it. */
  answered: boolean;
}

const emptyTally = (now: number): Tally => ({
  report: { ...EMPTY },
  unmatchedReasons: [],
  endsAt: now + RUN_BUDGET_MS,
  answered: false,
});

/** The run's time for taking on mail is spent: what is left is the next minute's. */
const outOfTime = (tally: Tally): boolean => Date.now() >= tally.endsAt;

/**
 * The budget runs from when the mail is in hand: a listing that took the mailbox thirty seconds
 * (2026-11-13) must not leave its fifty messages ten.
 */
const startTheClock = (tally: Tally): void => {
  tally.endsAt = Date.now() + RUN_BUDGET_MS;
  tally.answered = true;
};

/** The category a filed mail is tagged with: the document's row, else the old setting. */
type CategoryOf = (branchId: string) => string | null;

const categoryLookup = async (
  documentCategories: ReadonlyMap<string, string>,
): Promise<CategoryOf> => {
  const [setting, links] = await Promise.all([resolveBranchCategories(), loadAtmBranchLinks()]);
  const categories = categoriesFiledAs(
    [...setting].map(([branchId, category]) => ({ branchId, category })),
    links,
  );
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
  startTheClock(tally);
  if (messages.length === 0) return;
  const categoryOf = await categoryLookup(documentCategories);
  for (const message of messages) {
    if (outOfTime(tally)) return;
    await takeOn(source, message, gate, categoryOf, tally);
  }
};

/**
 * A place the sweep goes back to once a gap is walked: where it stood before the gap — with the
 * step and the failures it had there, so a window the mailbox cannot answer is still passed over —
 * the receipt time below which the gap is behind it, and the place it had itself left for an
 * earlier gap (`then`): a gap that comes while another is walked sends the walk to the top again
 * and back to where it was, not back to the start of the older gap.
 */
interface SweepResume {
  before: string;
  below: number;
  step: number;
  failures: number;
  then: SweepResume | null;
}

/**
 * Where the document's backlog sweep stands (`readNewestFirst`): the receipt time the next older
 * page lies below (null: just below the newest page), the size of its next step, how many older
 * pages in a row failed there, and — while it walks gaps first — where to go back to. Per document
 * VERSION, so a save — a branch switched on — starts it over.
 */
interface SweepState {
  key: string;
  before: string | null;
  step: number;
  failures: number;
  resume: SweepResume | null;
}

/**
 * The sweep's state, kept in Redis as well as in memory (`MAIL_POLL_SWEEP_KEY`): a worker restart —
 * every deploy — would otherwise start it over at the top, and a backlog deeper than the time
 * between two deploys would never be reached. One state, company-wide like the lease: the worker
 * and «قراءة الآن» (in the api) walk the same sweep, one reading at a time. A cache that fails
 * leaves the memory's.
 */
export const MAIL_POLL_SWEEP_KEY = 'atm-mail-poll:sweep';

const SWEEP_TTL_SECONDS = 31 * 24 * 60 * 60;

/** How many places to go back to the sweep keeps; past that, the oldest is let go and walked to. */
export const SWEEP_RESUME_DEPTH_MAX = 8;

let sweep: SweepState | null = null;

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const resumeOf = (raw: unknown, depth: number): SweepResume | null => {
  if (raw === null || typeof raw !== 'object' || depth >= SWEEP_RESUME_DEPTH_MAX) return null;
  const r = raw as Partial<Record<keyof SweepResume, unknown>>;
  if (!isInstant(r.before)) return null;
  if (typeof r.below !== 'number' || typeof r.step !== 'number') return null;
  if (typeof r.failures !== 'number') return null;
  return {
    before: r.before,
    below: r.below,
    step: r.step,
    failures: r.failures,
    then: resumeOf(r.then ?? null, depth + 1),
  };
};

/** The places to go back to, the oldest past `SWEEP_RESUME_DEPTH_MAX` let go. */
const capped = (resume: SweepResume | null): SweepResume | null => resumeOf(resume, 0);

/** The stored state, read at the start of a reading; anything unreadable leaves the memory's. */
const loadSweep = async (): Promise<void> => {
  try {
    const raw = await getCache().get(MAIL_POLL_SWEEP_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as Partial<Record<keyof SweepState, unknown>>;
    if (typeof parsed.key !== 'string') return;
    if (parsed.before !== null && !isInstant(parsed.before)) return;
    if (typeof parsed.step !== 'number' || typeof parsed.failures !== 'number') return;
    sweep = {
      key: parsed.key,
      before: parsed.before,
      step: parsed.step,
      failures: parsed.failures,
      resume: resumeOf(parsed.resume ?? null, 0),
    };
  } catch {
    // Unreadable or unreachable: the memory's state stands.
  }
};

/** Where the sweep now stands — in memory at once, in Redis best effort. */
const storeSweep = async (next: SweepState): Promise<void> => {
  sweep = next;
  try {
    await getCache().set(MAIL_POLL_SWEEP_KEY, JSON.stringify(next), SWEEP_TTL_SECONDS);
  } catch (error) {
    logger.warn({ err: error }, 'atm mail poll: the sweep position was not stored');
  }
};

/**
 * The mailbox document's reading. ONE mailbox serves every branch, and the mail ECMS leaves unread
 * on purpose — a branch not switched on yet, a machine not in the master — stays in it. Read oldest
 * first, fifty of those would stand between the reader and every new mail for good; so it reads
 * NEWEST first: the unread mail of the last fifteen minutes (`NEWEST_WINDOW_MS`), fifty at most, and a
 * new mail is filed on the next run however large the pile grows.
 *
 * The pile is not abandoned either: the run also takes ONE older page, the next step of a sweep
 * that walks the older unread mail two hours at a time (`SWEEP_WINDOW_MS`) — fifty of them at
 * most, below the last page's oldest — back to thirty days (`SWEEP_HORIZON_MS`), and starts over.
 * So a backlog deeper than a page (a branch switched on after weeks, a machine added to the master
 * later) is still filed, and no run lists more than two pages. Every page is a SHORT range of
 * receipt times: the mailbox weighs every mail in the range, and a page of «every date», of two
 * days, or one counted down the pile (`$skip`) outgrew its patience (2026-11-13). A page's edge is a receipt time to the second, so the rest of
 * a same-second group cut by an edge is passed over by that sweep; a later sweep reaches it once
 * the unread list moves the edges (new mail, a mail filed or read), and in an unchanged pile it
 * waits. Past fifty unread mails in one second — which the mailbox has never received — the rest
 * are never swept: an accepted limit.
 */
const readNewestFirst = async (
  source: AtmMailSource,
  listPage: (limit: number, window: AtmMailWindow) => Promise<AtmMailPage>,
  gate: AtmMailIngestGate | undefined,
  documentCategories: ReadonlyMap<string, string>,
  sweepKey: string,
  tally: Tally,
  gapFloor: number | null,
): Promise<void> => {
  const now = Date.now();
  const newestSince = mailInstant(now - NEWEST_WINDOW_MS);
  const newest = await listPage(POLL_BATCH, { since: newestSince, before: null });
  startTheClock(tally);
  // Where the sweep stands, as the last reading — here or in the other process — left it.
  await loadSweep();
  // The first scheduled reading answered after a gap longer than the newest window: the mail of the
  // gap lies just below the newest page, so the sweep walks it first instead of reaching it after a
  // full cycle (six hours) — and once below it, goes back to where it stood, so recurring gaps do
  // not keep the deep backlog out of reach. Set before anything else, so a run cut short keeps it.
  if (gapFloor !== null) {
    const prior = sweep?.key === sweepKey ? sweep : null;
    let resume: SweepResume | null = null;
    if (prior !== null && prior.before !== null) {
      // Where it stood — in the backlog, or partway down an earlier gap — is where it goes back to.
      resume = {
        before: prior.before,
        below: gapFloor,
        step: prior.step,
        failures: prior.failures,
        then: prior.resume,
      };
    } else if (prior?.resume) {
      // Already at the top of a walk: the walk now goes down to the lower of the two floors.
      resume = { ...prior.resume, below: Math.min(prior.resume.below, gapFloor) };
    }
    await storeSweep({
      key: sweepKey,
      before: null,
      step: SWEEP_WINDOW_MS,
      failures: 0,
      resume: capped(resume),
    });
  }
  let categoryOf: CategoryOf | null = null;
  const take = async (message: AtmMailMessage): Promise<void> => {
    categoryOf ??= await categoryLookup(documentCategories);
    await takeOn(source, message, gate, categoryOf, tally);
  };
  const seen = new Set<string>();
  for (const message of newest.messages) {
    if (outOfTime(tally)) return;
    seen.add(message.providerMessageId);
    await take(message);
  }
  // The newest page took the run's time: the sweep waits, where it stood, for a quieter minute.
  if (outOfTime(tally)) return;

  // Where the sweep stands: kept from the last run, else just below the newest page — below its
  // oldest when it was full, below its fifteen minutes when it held all of them.
  const floor = now - SWEEP_HORIZON_MS;
  const stands = sweep?.key === sweepKey ? sweep : null;
  const step = stands?.step ?? SWEEP_WINDOW_MS;
  const failures = stands?.failures ?? 0;
  const resume = stands?.resume ?? null;
  const before =
    stands?.before ??
    (newest.listed >= POLL_BATCH && newest.oldest !== null ? newest.oldest : newestSince);
  if (Date.parse(before) <= floor) {
    await storeSweep({
      key: sweepKey,
      before: null,
      step: SWEEP_WINDOW_MS,
      failures: 0,
      resume: null,
    });
    return;
  }
  const since = mailInstant(Math.max(floor, Date.parse(before) - step));
  let older: AtmMailPage;
  try {
    older = await listPage(POLL_BATCH, { since, before });
  } catch (error) {
    // A window the mailbox cannot answer must neither hold the sweep for good nor be asked for
    // every minute at full size (the newest page answered, so no back-off slows it): the next run
    // asks for half of it, down to `SWEEP_MIN_WINDOW_MS`, and after `SWEEP_SKIP_AFTER` failures
    // in a row the sweep passes over it. The run still fails with the error.
    if (step <= SWEEP_MIN_WINDOW_MS && failures + 1 >= SWEEP_SKIP_AFTER) {
      logger.warn(
        { since, before, failures: failures + 1 },
        'atm mail poll: the sweep passed over a window the mailbox could not answer',
      );
      await storeSweep({
        key: sweepKey,
        before: Date.parse(since) <= floor ? null : since,
        step: SWEEP_WINDOW_MS,
        failures: 0,
        // Passed over down to the horizon: the sweep starts over, and a gap it was walking is behind it.
        resume: Date.parse(since) <= floor ? null : resume,
      });
    } else {
      await storeSweep({
        key: sweepKey,
        before,
        step: Math.max(SWEEP_MIN_WINDOW_MS, step / 2),
        failures: failures + 1,
        resume,
      });
    }
    throw error;
  }
  // Answered: whatever this run gets through, the window is not failing — a run cut short below
  // keeps its place without carrying a streak of failures into the next.
  await storeSweep({ key: sweepKey, before, step, failures: 0, resume });
  for (const message of older.messages) {
    // A page cut short keeps the sweep where it was: the page is listed again next run, and what
    // this run already took on is either gone from the unread list or judged again, harmlessly.
    if (outOfTime(tally)) return;
    // The list can shift between the two listings (mail arrives, someone opens one in Outlook).
    if (seen.has(message.providerMessageId)) continue;
    seen.add(message.providerMessageId);
    await take(message);
  }
  // A full page: the next one lies below its oldest. A short one: these days are done, the next
  // step is the two hours below them — and past the horizon, the sweep starts over.
  let next = older.listed >= POLL_BATCH && older.oldest !== null ? older.oldest : since;
  let nextStep = Math.min(SWEEP_WINDOW_MS, step * 2);
  let nextFailures = 0;
  let goingOn = resume;
  // A gap is walked — or the walk reached the horizon, below which a gap older than thirty days
  // cannot be walked: back to where the sweep stood before it, with the step and the failures it
  // had there, unless that is above here; then the same for the gap before it, if this is below
  // that one too.
  while (goingOn !== null && Date.parse(next) <= Math.max(goingOn.below, floor)) {
    if (Date.parse(goingOn.before) < Date.parse(next)) {
      next = goingOn.before;
      nextStep = goingOn.step;
      nextFailures = goingOn.failures;
    }
    goingOn = goingOn.then;
  }
  await storeSweep({
    key: sweepKey,
    before: Date.parse(next) <= floor ? null : next,
    step: nextStep,
    failures: nextFailures,
    resume: goingOn,
  });
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
 *
 * Null when another reading holds the lease (`MAIL_POLL_LEASE_KEY`): nothing was read, nothing is
 * recorded, and that reading's own result is the one the screen will show. Null too for the
 * SCHEDULED reading (`scheduled`) while a failing mailbox is given time (`MAIL_POLL_BACKOFF_KEY`):
 * the screen keeps the last reading, and its error.
 */
export const pollAtmMailbox = async (
  options: { scheduled?: boolean } = {},
): Promise<AtmMailPollRun | null> => {
  const at = new Date();
  const plan = await resolveAtmMailPollPlan();
  if (plan.mode === 'off') return idleRun(at);
  if (plan.mode === 'environment' && !plan.source.available()) return idleRun(at);
  if (options.scheduled === true && (await stillWaiting())) return null;

  const cache = getCache();
  const lease = randomUUID();
  if (!(await cache.setIfAbsent(MAIL_POLL_LEASE_KEY, lease, LEASE_TTL_SECONDS))) return null;
  try {
    const scheduled = options.scheduled === true;
    const gapFloor = scheduled ? gapFloorOf(at.getTime(), await readLastAnswered()) : null;
    const { run, answered } = await readAndRecord(plan, at, gapFloor);
    await noteOutcome(run, answered, scheduled);
    return run;
  } finally {
    // Compare-and-delete: a lease that outlived its TTL and was taken by another reading stays.
    await cache.delIfValue(MAIL_POLL_LEASE_KEY, lease).catch((error: unknown) => {
      logger.warn({ err: error }, 'atm mail poll: the reading lease was not released');
    });
  }
};

/** The run inside its lease, and whether the mailbox answered its first listing. */
const readAndRecord = async (
  plan: AtmMailPollPlan,
  at: Date,
  gapFloor: number | null,
): Promise<{ run: AtmMailPollRun; answered: boolean }> => {
  if (plan.mode === 'off') return { run: idleRun(at), answered: true };
  const tally = emptyTally(Date.now());
  let error: string | null = null;
  let providerId: string | null = null;
  try {
    if (plan.mode === 'environment') {
      providerId = plan.source.providerId;
      await readOnce(plan.source, undefined, new Map<string, string>(), tally);
    } else {
      const { gate, categories } = documentRules(plan.doc, await loadAtmBranchLinks());
      const source = mailboxSourceFor(plan.doc);
      providerId = source.providerId;
      const listPage = source.listUnreadPage?.bind(source);
      if (listPage === undefined) await readOnce(source, gate, categories, tally);
      else {
        const sweepKey = `${String(plan.doc._id)}:${String(plan.doc.__v)}`;
        await readNewestFirst(source, listPage, gate, categories, sweepKey, tally, gapFloor);
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
  return { run, answered: tally.answered };
};

/**
 * Test seam — forgets the sweep's position in memory, as a restart does. Its stored copy
 * (`MAIL_POLL_SWEEP_KEY`) is the cache's, and a test that starts the sweep over deletes it too.
 */
export const resetAtmMailSweep = (): void => {
  sweep = null;
};
