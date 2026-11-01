// The mailbox seam — what the ATM module needs from a mail provider, and nothing more.
//
// The shape is the National-ID OCR seam's (`national-id-ocr.ts`): an interface, a NULL default
// that reports itself unavailable, and an opt-in registration at boot. A deployment that has not
// configured a mailbox keeps the exact behaviour it had before this existed — the poll task finds
// no source and returns — rather than failing a boot or logging an error every minute.
//
// WHY THE MODULE OWNS THIS AT ALL. The legacy ran one mail reader PER BRANCH as a separate Node
// service (Automation/src/index.js), and the target is one central reader. The reading is a
// TRANSPORT; everything that makes it a business decision — parsing the two bank formats, matching
// the machine, deriving the branch from that machine, the found/duplication flags — is ATM domain
// logic and already lives in `mail-ingestion.service.ts`. So this interface is deliberately tiny:
// list what is unread, mark one read, tag one. A different mailbox (IMAP, a shared drop folder,
// n8n posting in once A-6b lands) implements the same three methods and nothing above it moves.
import { type AtmMailIngest } from '@ecms/contracts';

/** One message, in the shape the ingestion seam consumes plus the id the transport acts on. */
export interface AtmMailMessage extends AtmMailIngest {
  /** Whether the provider already considers this message handled — for observability only. */
  isRead: boolean;
}

/** One page of the unread mail (`listUnreadPage`). */
export interface AtmMailPage {
  messages: AtmMailMessage[];
  /**
   * How many messages the provider listed on the page — `messages` leaves out the ones nothing can
   * be done with (no id, no body), which stay unread and still take up their place in the list.
   */
  listed: number;
}

export interface AtmMailSource {
  /** Stable id, recorded in the poll log so an operator knows which mailbox answered. */
  readonly providerId: string;

  /** False when the provider is not configured; the poll task then does nothing at all. */
  available(): boolean;

  /**
   * The unread backlog, oldest first, capped at `limit`.
   *
   * NO WATERMARK, deliberately, and this is a fix rather than an omission. The legacy reader
   * filtered on `isRead eq false AND receivedDateTime ge lastCheckedTime` with `lastCheckedTime`
   * held in memory and reset to "now" at every process start (index.js:29, 209) — so every unread
   * mail older than the last restart became invisible forever, including the ones it had just
   * decided to leave unread. Unread IS the backlog; the ingestion seam's `providerMessageId` key
   * makes re-reading a message harmless.
   */
  listUnread(limit: number): Promise<AtmMailMessage[]>;

  /**
   * The unread mail NEWEST first, `limit` messages after the first `skip` — the reading the mailbox
   * document runs on (mail-poll.service.ts). In the ONE shared mailbox the unread pile is mostly
   * mail left there on purpose (branches not switched on yet), and read oldest first that pile
   * would stand between the reader and every new mail. Optional: a source without it is read with
   * `listUnread` alone.
   */
  listUnreadPage?(limit: number, skip: number): Promise<AtmMailPage>;

  /**
   * Mark one message handled, optionally tagging it with the branch's colour category — the
   * legacy's "Green Category" (index.js:222-225), now per branch because one reader serves them
   * all. A provider with no notion of categories ignores the tag and still marks read.
   */
  markHandled(providerMessageId: string, category: string | null): Promise<void>;
}

const nullSource: AtmMailSource = {
  providerId: 'null',
  available: () => false,
  listUnread: async () => [],
  markHandled: async () => {
    /* nothing to mark: there is no mailbox */
  },
};

let source: AtmMailSource = nullSource;

/** Idempotent — the last registration wins, so a test can install a fake over the real one. */
export const registerAtmMailSource = (next: AtmMailSource): void => {
  source = next;
};

export const getAtmMailSource = (): AtmMailSource => source;

export const resetAtmMailSource = (): void => {
  source = nullSource;
};

/**
 * What the mailbox screen's document (`atm_mailbox_config`) hands a provider: where to connect,
 * and how to OBTAIN the secret rather than the secret itself — it stays sealed in the document and
 * is opened through the platform secret store only when a token is due.
 */
export interface AtmMailboxConnection {
  tenantId: string;
  clientId: string;
  userEmail: string;
  openSecret: () => Promise<string>;
}

/** Builds the source a stored mailbox document reads through. */
export type AtmMailSourceFactory = (connection: AtmMailboxConnection) => AtmMailSource;

let factory: AtmMailSourceFactory | null = null;

/**
 * The provider for a stored mailbox document. Microsoft Graph registers itself at module load
 * (graph-mail.source.ts); the last registration wins, so a test can install a fake mailbox exactly
 * as it installs a fake source above.
 */
export const registerAtmMailSourceFactory = (next: AtmMailSourceFactory | null): void => {
  factory = next;
};

export const getAtmMailSourceFactory = (): AtmMailSourceFactory | null => factory;
