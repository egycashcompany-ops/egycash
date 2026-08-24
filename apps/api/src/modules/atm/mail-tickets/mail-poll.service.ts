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
import { AtmSettingKeys } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { settingsService } from '../../../platform/settings';
import { atmMailIngestionService } from './mail-ingestion.service';
import { getAtmMailSource } from './mail-source';

/** Organization scope: which mailbox category marks which branch is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/** How many unread messages one poll takes on. The backlog survives; the next tick continues it. */
const POLL_BATCH = 50;

export interface AtmMailPollReport {
  read: number;
  created: number;
  duplicates: number;
  /** Left unread on purpose — the backlog a human can still see. */
  unmatched: number;
  /** Ingestion threw; the message is left unread so the next poll retries it. */
  failed: number;
}

const EMPTY: AtmMailPollReport = { read: 0, created: 0, duplicates: 0, unmatched: 0, failed: 0 };

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
 * One poll. Returns what it did so the scheduled task can log a single line per run instead of one
 * per message — a mailbox with a permanently unparseable newsletter in it would otherwise produce
 * a warning every minute forever.
 */
export const pollAtmMailbox = async (): Promise<AtmMailPollReport> => {
  const source = getAtmMailSource();
  if (!source.available()) return EMPTY;

  const messages = await source.listUnread(POLL_BATCH);
  if (messages.length === 0) return EMPTY;

  const categories = await resolveBranchCategories();
  const report: AtmMailPollReport = { ...EMPTY, read: messages.length };
  const unmatchedReasons: string[] = [];

  for (const message of messages) {
    try {
      const outcome = await atmMailIngestionService.ingest(message);
      if (outcome.outcome === 'unmatched') {
        report.unmatched += 1;
        if (outcome.reason !== null) unmatchedReasons.push(outcome.reason);
        continue;
      }
      if (outcome.outcome === 'duplicateMessage') {
        report.duplicates += 1;
        await source.markHandled(message.providerMessageId, null);
        continue;
      }
      report.created += 1;
      // The ticket's branch came from the machine — the category follows it. A branch with no
      // configured category is still marked read; the tag is a convenience, not the record.
      const branchId = outcome.ticketId === null ? null : outcome.branchId;
      await source.markHandled(
        message.providerMessageId,
        branchId === null ? null : (categories.get(branchId) ?? null),
      );
    } catch (error) {
      // Left UNREAD on purpose: an ingestion that threw has not taken responsibility for the
      // message, and marking it read would lose it silently.
      report.failed += 1;
      logger.error(
        { err: error, providerMessageId: message.providerMessageId },
        'atm mail poll: ingestion failed, message left unread',
      );
    }
  }

  logger.info(
    { provider: source.providerId, ...report, unmatchedReasons: unmatchedReasons.slice(0, 5) },
    'atm mail poll complete',
  );
  return report;
};
