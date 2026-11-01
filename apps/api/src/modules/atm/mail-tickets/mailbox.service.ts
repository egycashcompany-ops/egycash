// /atm/mailbox — «بريد الصيانة — بنك مصر» on /atm/settings: the document the central reader polls
// (mailbox-config.model.ts), the connection test and «قراءة الآن».
//
// `atmSettings.manage` at ORGANIZATION scope (shared/settings-authority.ts): one mailbox serves
// every branch. The client secret only ever travels TOWARD the server: a given one is SEALED
// through the platform secret store before anything is written, an omitted one keeps the stored
// ref, and no answer, log line or audit row carries it — the DTO says `hasSecret`, the audit says
// that it changed (the register's redaction, register/register-secrets.ts).
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type AtmMailPollRunDto,
  type AtmMailboxConfigDto,
  type AtmMailboxTestResultDto,
  type EntityRef,
  type SaveAtmMailboxConfig,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { branchRepository } from '../../../platform/organization';
import { getSecretStore } from '../../../platform/secrets';
import {
  BusinessRuleError,
  ConflictError,
  StaleDocumentError,
  ValidationError,
} from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { linkedBranchOf, loadAtmBranchLinks } from '../shared/atm-context';
import { assertAtmSettingsManager } from '../shared/settings-authority';
import { pollAtmMailbox, type AtmMailPollRun } from './mail-poll.service';
import { ATM_MAILBOX_KEY, type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';
import { buildMailboxSource, mailboxSecretContext } from './mailbox-source';

/** The audit entity — a LITERAL pair, so the realtime registry spec can find it. */
const mailboxRef = (id: string): EntityRef => ({
  moduleId: 'atm',
  entityType: 'mailboxConfig',
  entityId: id,
});

const REDACTED = '[redacted]';

/** Everything the audit may show — the secret is not in it, sealed or plain. */
const snapshot = (doc: AtmMailboxConfigDoc): Record<string, unknown> => ({
  tenantId: doc.tenantId,
  clientId: doc.clientId,
  userEmail: doc.userEmail,
  enabled: doc.enabled,
  branches: doc.branches.map((row) => ({ branchId: String(row.branchId), category: row.category })),
});

export const toAtmMailPollRunDto = (run: AtmMailPollRun): AtmMailPollRunDto => ({
  at: run.at.toISOString(),
  read: run.read,
  created: run.created,
  duplicates: run.duplicates,
  unmatched: run.unmatched,
  failed: run.failed,
  error: run.error,
  unmatchedReasons: [...run.unmatchedReasons],
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Pure: the card's branch rows as they are saved — a linked SOURCE is saved as its target
 * (`atm.branchLinks`), keeping its place and its category, and dropped when the target is on the
 * list already: its mail is filed under the target (mail-ingestion.service.ts), so a row of its own
 * would switch nothing on, and the target's own row keeps its colour. Each branch stays once.
 */
export const mailboxBranchesFiledAs = <T extends { branchId: string; category: string | null }>(
  rows: readonly T[],
  links: ReadonlyMap<string, string>,
): { branchId: string; category: string | null }[] => {
  const listed = new Set(rows.map((row) => row.branchId.toLowerCase()));
  const kept = new Set<string>();
  const out: { branchId: string; category: string | null }[] = [];
  for (const row of rows) {
    const branchId = linkedBranchOf(links, row.branchId);
    if (branchId !== row.branchId.toLowerCase() && listed.has(branchId)) continue;
    if (kept.has(branchId)) continue;
    kept.add(branchId);
    out.push({ branchId, category: row.category });
  }
  return out;
};

class AtmMailboxService {
  /** GET — the document without its secret, or `null` while the reader runs on the environment. */
  async get(ctx: AuthContext): Promise<AtmMailboxConfigDto | null> {
    assertAtmSettingsManager(ctx);
    const doc = await atmMailboxConfigRepository.findSingleton();
    return doc === null ? null : this.toDto(doc);
  }

  /**
   * PUT — the whole card in one save. `version: null` is the FIRST save and may only create the
   * document (the custody papers' rule): one that exists by now, or a racing first save the unique
   * key refuses, is a stale 409, never a silent overwrite. Every later save carries the version it
   * read.
   */
  async save(input: SaveAtmMailboxConfig, ctx: AuthContext): Promise<AtmMailboxConfigDto> {
    assertAtmSettingsManager(ctx);
    const before = await atmMailboxConfigRepository.findSingleton();
    if ((before === null) !== (input.version === null)) throw new StaleDocumentError();

    // Switched on with no secret anywhere, the reader could only fail every minute.
    const storedSecret = before?.clientSecretRef ?? null;
    if (input.enabled && input.clientSecret === undefined && storedSecret === null) {
      throw new ValidationError([
        {
          field: 'body.clientSecret',
          code: 'REQUIRED',
          message: 'a client secret is required to switch reading on',
        },
      ]);
    }

    // The id exists BEFORE the first insert, so the sealing context can name the record (the
    // credential precedent).
    const id = before?._id ?? new Types.ObjectId();
    const clientSecretRef =
      input.clientSecret === undefined
        ? storedSecret
        : await this.seal(input.clientSecret, String(id));
    const branches = mailboxBranchesFiledAs(input.branches, await loadAtmBranchLinks());
    const fields = {
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientSecretRef,
      userEmail: input.userEmail,
      enabled: input.enabled,
      branches: branches.map((row) => ({
        branchId: new Types.ObjectId(row.branchId),
        category: row.category,
      })),
    };

    const saved =
      before === null
        ? await this.createFirst(id, fields, ctx.userId)
        : await atmMailboxConfigRepository.updateById(String(before._id), fields, {
            by: ctx.userId,
            version: input.version ?? before.__v,
          });

    const changes = diffChanges(before === null ? {} : snapshot(before), snapshot(saved));
    if (input.clientSecret !== undefined) {
      changes.push({
        field: 'clientSecret',
        old: storedSecret === null ? null : REDACTED,
        new: REDACTED,
      });
    }
    await auditService.record({
      entityRef: mailboxRef(String(saved._id)),
      action: before === null ? 'create' : 'update',
      changes,
    });
    return this.toDto(saved);
  }

  /**
   * POST /test — a token is acquired and ONE unread message listed with the STORED settings,
   * through a source built for this call alone (a cached token must not answer for a secret that
   * was just replaced), and with the listing the reader itself runs (`listUnreadPage`), so a query
   * the provider would refuse fails here rather than on the first run. Nothing is marked read or
   * filed. Works while reading is off: testing before switching on is the point.
   */
  async test(ctx: AuthContext): Promise<AtmMailboxTestResultDto> {
    assertAtmSettingsManager(ctx);
    const doc = await atmMailboxConfigRepository.findSingleton();
    if (doc === null) {
      return { ok: false, unreadSample: 0, error: 'no mailbox settings are saved yet' };
    }
    try {
      const source = buildMailboxSource(doc);
      const unreadSample =
        source.listUnreadPage === undefined
          ? (await source.listUnread(1)).length
          : (await source.listUnreadPage(1, 0)).listed;
      return { ok: true, unreadSample, error: null };
    } catch (error) {
      return { ok: false, unreadSample: 0, error: errorText(error) };
    }
  }

  /**
   * POST /poll — «قراءة الآن»: one run of the reader, exactly the scheduled one, answered with its
   * report. Refused while reading is switched off — the switch means the reader reads nothing.
   */
  async pollNow(ctx: AuthContext): Promise<AtmMailPollRunDto> {
    assertAtmSettingsManager(ctx);
    const doc = await atmMailboxConfigRepository.findSingleton();
    if (doc !== null && !doc.enabled) {
      throw new BusinessRuleError('mail reading is switched off — switch it on and save first');
    }
    return toAtmMailPollRunDto(await pollAtmMailbox());
  }

  /** Refuses rather than storing a secret in the clear (the register's `sealCombination`). */
  private async seal(plaintext: string, id: string) {
    const store = getSecretStore();
    if (!store.available()) {
      throw new BusinessRuleError(
        'the client secret cannot be stored: the secret store has no usable key on this deployment',
      );
    }
    return store.seal(plaintext, mailboxSecretContext(id));
  }

  /** The first document; a racing first save that lost on the unique key reads as stale. */
  private async createFirst(
    id: Types.ObjectId,
    fields: Partial<AtmMailboxConfigDoc>,
    by: string,
  ): Promise<AtmMailboxConfigDoc> {
    try {
      return await atmMailboxConfigRepository.create(
        { _id: id, key: ATM_MAILBOX_KEY, ...fields, lastPoll: null },
        { by },
      );
    } catch (error) {
      if (error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE) {
        throw new StaleDocumentError();
      }
      throw error;
    }
  }

  /** Names resolved for the card; a branch gone since is named null so its row can be removed. */
  private async toDto(doc: AtmMailboxConfigDoc): Promise<AtmMailboxConfigDto> {
    const branches = await branchRepository.findByIdsSystem(
      doc.branches.map((row) => String(row.branchId)),
    );
    const named = new Map(
      branches
        .filter((branch) => !branch.isDeleted)
        .map((branch) => [String(branch._id), { ar: branch.name.ar, en: branch.name.en }]),
    );
    const lastPoll = doc.lastPoll ?? null;
    return {
      tenantId: doc.tenantId,
      clientId: doc.clientId,
      hasSecret: (doc.clientSecretRef ?? null) !== null,
      userEmail: doc.userEmail,
      enabled: doc.enabled,
      branches: doc.branches.map((row) => ({
        branchId: String(row.branchId),
        branchName: named.get(String(row.branchId)) ?? null,
        category: row.category,
      })),
      lastPoll: lastPoll === null ? null : toAtmMailPollRunDto(lastPoll),
      version: doc.__v,
    };
  }
}

export const atmMailboxService = new AtmMailboxService();
