// Mail ticket behaviour — the legacy /mail_maintenance(+_log) handlers ported by parity
// (contad_app.js:2612-2978). A ticket is DECIDED: accepted (a maintenance operation opens from it)
// or rejected, and the log page is the record of who decided what — now WITH when (`actionAt`,
// GAP G1). Both decisions were terminal, as in the legacy, until the owner asked for a way back
// from the log: «إسترجاع ويقدر يرجعه مفتوح لو قبل أو رفض غلط» (2026-10-28 — `restore`).
//
// The owner's rule (2026-10-13, per day since 2026-10-27 — port doc OD-1) reaches this screen
// twice: a ticket whose machine already has an open maintenance ON THE TICKET'S DAY (the day it was
// received, the day accept opens it on — D6) is NOT accepted (it stays pending and the answer says
// so), and the `duplication` flag the screen paints is that very condition — any branch.
import {
  type AtmMailAcceptRefusalDto,
  type AtmMailRestoreRefusalDto,
  type AtmMailRestoreRefusalReason,
  type AtmMailTicketStatus,
  type AuditChange,
  type DecideAtmMailTickets,
  type ListAtmMailLogQuery,
  type Paginated,
  type RestoreAtmMailTickets,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService, type AuditEntry } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { StaleDocumentError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector, scopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { actorName } from '../shared/atm-context';
import { isAlreadyOpenError, openDayOf } from '../shared/open-operation';
import { cairoDateString } from '../shared/cairo-time';
import { atmMaintenanceService } from '../maintenances/maintenance.service';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';
import { type AtmMaintenanceDoc } from '../maintenances/maintenance.model';
import { atmMailTicketRepository } from './mail-ticket.repository';
import { type AtmMailTicketDoc } from './mail-ticket.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'mailTicket', entityId: id });

/** What a restore writes on the ticket: pending again, with the decision's who and when cleared. */
const REOPENED = { status: 'pending', actionById: null, actionByName: null, actionAt: null };

/** One decided ticket's restore, as `planMailRestore` decides it. */
export type MailRestorePlan =
  | { kind: 'skip' }
  | { kind: 'refuse'; reason: AtmMailRestoreRefusalReason }
  | { kind: 'restore'; removeMaintenanceIds: string[] };

/** What one ticket's restore transaction came to: its plan, unless it restored the ticket. */
type MailRestoreOutcome =
  | Exclude<MailRestorePlan, { kind: 'restore' }>
  | { kind: 'restored'; updated: AtmMailTicketDoc; removed: string[]; audits: AuditEntry[] };

/**
 * Pure: what restoring one ticket does. `fromTicket` = the live maintenances it opened — one after
 * an accept, none once that one was deleted on the board. A rejected ticket opened nothing and
 * simply returns to pending. An accepted one returns by taking back what it opened — unless that
 * is CLOSED: a closed maintenance is work done, on the done page and in the daily report, and
 * deleting it to reopen a mail would erase that record, so the ticket stays as it is and the
 * answer says why (`maintenanceClosed`).
 */
export const planMailRestore = (
  status: AtmMailTicketStatus,
  fromTicket: readonly Pick<AtmMaintenanceDoc, '_id' | 'closedAt'>[],
): MailRestorePlan => {
  if (status === 'pending') return { kind: 'skip' };
  if (status === 'rejected') return { kind: 'restore', removeMaintenanceIds: [] };
  if (fromTicket.some((row) => row.closedAt !== null)) {
    return { kind: 'refuse', reason: 'maintenanceClosed' };
  }
  return { kind: 'restore', removeMaintenanceIds: fromTicket.map((row) => String(row._id)) };
};

/**
 * Pure: the restore's audit changes — the status back to pending and, for an accepted ticket, the
 * maintenance it no longer has: accept's `maintenanceId` change, reversed. The decider's name and
 * time leave the ticket; the accept or reject row already on the trail keeps who and when.
 */
export const mailRestoreChanges = (
  from: AtmMailTicketStatus,
  removedMaintenanceIds: readonly string[],
): AuditChange[] => [
  ...diffChanges({ status: from }, { status: REOPENED.status }),
  ...removedMaintenanceIds.map((maintenanceId) => ({
    field: 'maintenanceId',
    old: maintenanceId,
    new: null,
  })),
];

/** A ticket row + the duplication answer the pending screen renders beside it. */
export interface PendingTicketRow {
  ticket: AtmMailTicketDoc;
  duplication: boolean;
}

class AtmMailTicketService {
  /**
   * Pending list with duplication RECOMPUTED per row — the legacy GET re-ran its check on every
   * render and wrote it back (contad_app.js:2674-2698). The recompute is kept; the write-back on
   * a read is not (decision D5). The check itself is the owner's rule now (OD-1): "this machine
   * has an open maintenance", any day, any branch — exactly what `accept` refuses.
   */
  async listPending(
    query: { page: number; pageSize: number },
    ctx: AuthContext,
  ): Promise<{ page: Paginated<AtmMailTicketDoc>; duplication: Map<string, boolean> }> {
    const page = await atmMailTicketRepository.listPending({
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmMailTicket.view'),
    });
    return { page, duplication: await this.duplicationFor(page.items) };
  }

  async listLog(
    query: ListAtmMailLogQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmMailTicketDoc>> {
    const today = cairoDateString(new Date());
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? query.from ?? today;
    return atmMailTicketRepository.listLog({
      from,
      to,
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmMailTicket.viewLog'),
    });
  }

  async unreadCount(ctx: AuthContext): Promise<number> {
    return atmMailTicketRepository.unreadCount(scopeSelector(ctx, 'atmMailTicket.view'));
  }

  /**
   * Accept (contad_app.js:2797-2846): one maintenance row per accepted ticket — open time = the
   * ticket's received time (decision D6), service = the issue text, zone/reference empty — then
   * the ticket flips to accepted with the decider recorded. Already-decided tickets in the
   * selection are skipped, which is what the legacy's `status:0`-only screen guaranteed by
   * construction.
   *
   * A ticket whose machine already has an open maintenance on the ticket's day — anywhere,
   * including one accepted earlier in this same selection — is REFUSED (the owner's rule, OD-1): nothing is written, the
   * ticket stays pending, and it is named in `refused` so the screen can say which and why.
   */
  async accept(
    input: DecideAtmMailTickets,
    ctx: AuthContext,
  ): Promise<{ decided: AtmMailTicketDoc[]; refused: AtmMailAcceptRefusalDto[] }> {
    const scope = scopeSelector(ctx, 'atmMailTicket.decide');
    const decided: AtmMailTicketDoc[] = [];
    const refused: AtmMailAcceptRefusalDto[] = [];
    for (const id of input.ids) {
      const ticket = await atmMailTicketRepository.findById(id, scope);
      if (ticket === null || ticket.status !== 'pending') continue;
      let maintenanceId: string;
      try {
        const maintenance = await atmMaintenanceService.openFromMail(
          {
            branchId: ticket.branchId,
            machineId: ticket.machineId,
            machineCode: ticket.machineCode,
            bankName: ticket.bankName,
            machineName: ticket.machineName,
            area: ticket.area,
            openedAt: ticket.receivedAt,
            serviceType: ticket.issueText,
            mailTicketId: ticket._id,
          },
          ctx,
        );
        maintenanceId = String(maintenance._id);
      } catch (error) {
        if (isAlreadyOpenError(error)) {
          if (await this.acceptedConcurrently(ticket, scope)) continue;
          refused.push({
            ticketId: String(ticket._id),
            machineCode: ticket.machineCode,
            reason: 'maintenanceAlreadyOpen',
          });
          continue;
        }
        throw error;
      }
      const updated = await atmMailTicketRepository.updateById(
        id,
        {
          status: 'accepted',
          actionById: new Types.ObjectId(ctx.userId),
          actionByName: actorName(ctx),
          actionAt: new Date(),
        },
        { by: ctx.userId, version: ticket.__v, scope },
      );
      await auditService.record({
        entityRef: entityRef(id),
        action: 'accept',
        changes: diffChanges({}, { maintenanceId }),
      });
      decided.push(updated);
    }
    return { decided, refused };
  }

  /**
   * Did a CONCURRENT accept of this very ticket win? Then the open maintenance that refused it is
   * the one opened from it — the ticket was accepted, not refused, and `refused` (which promises
   * "still pending") must not name it. The loser skips it like any already-decided ticket. Asked
   * two ways, because the winner opens the maintenance BEFORE it flips the ticket: the maintenance
   * from this ticket covers the moment between those two writes, the re-read covers the rest.
   */
  private async acceptedConcurrently(
    ticket: AtmMailTicketDoc,
    scope: ScopeSelector,
  ): Promise<boolean> {
    if (await atmMaintenanceRepository.hasOpenFromTicket(ticket.branchId, ticket._id)) {
      return true;
    }
    const current = await atmMailTicketRepository.findById(String(ticket._id), scope);
    return current === null || current.status !== 'pending';
  }

  /** Reject (contad_app.js:2761-2783): the ticket flips to rejected; nothing is created. */
  async reject(input: DecideAtmMailTickets, ctx: AuthContext): Promise<AtmMailTicketDoc[]> {
    const scope = scopeSelector(ctx, 'atmMailTicket.decide');
    const decided: AtmMailTicketDoc[] = [];
    for (const id of input.ids) {
      const ticket = await atmMailTicketRepository.findById(id, scope);
      if (ticket === null || ticket.status !== 'pending') continue;
      const updated = await atmMailTicketRepository.updateById(
        id,
        {
          status: 'rejected',
          actionById: new Types.ObjectId(ctx.userId),
          actionByName: actorName(ctx),
          actionAt: new Date(),
        },
        { by: ctx.userId, version: ticket.__v, scope },
      );
      await auditService.record({ entityRef: entityRef(id), action: 'reject', changes: [] });
      decided.push(updated);
    }
    return decided;
  }

  /**
   * The log's «إسترجاع» — «ويقدر يرجعه مفتوح لو قبل أو رفض غلط» (2026-10-28): a decided ticket
   * back to PENDING, decided again on the pending screen. An accepted one takes back the
   * maintenance it opened, removed from /atm/maintenance in the SAME transaction as the ticket's
   * return, so neither half ever lands alone — and is refused, nothing written, when that
   * maintenance is closed (`planMailRestore`). Already pending, or outside the caller's scope:
   * skipped silently, as accept and reject skip a decided one.
   */
  async restore(
    input: RestoreAtmMailTickets,
    ctx: AuthContext,
  ): Promise<{ restored: AtmMailTicketDoc[]; refused: AtmMailRestoreRefusalDto[] }> {
    const scope = scopeSelector(ctx, 'atmMailTicket.decide');
    const restored: AtmMailTicketDoc[] = [];
    const refused: AtmMailRestoreRefusalDto[] = [];
    for (const id of input.ids) {
      const ticket = await atmMailTicketRepository.findById(id, scope);
      if (ticket === null || ticket.status === 'pending') continue;
      let outcome: MailRestoreOutcome;
      try {
        outcome = await unitOfWork<MailRestoreOutcome>(async (session) => {
          // Read INSIDE the transaction: a close landing after this read makes the delete below a
          // write conflict, and the retry reads the maintenance closed — a closed one is never
          // deleted.
          const fromTicket =
            ticket.status === 'accepted'
              ? await atmMaintenanceRepository.findLiveFromTicket(
                  ticket.branchId,
                  ticket._id,
                  session,
                )
              : [];
          const plan = planMailRestore(ticket.status, fromTicket);
          if (plan.kind !== 'restore') return plan;
          const updated = await atmMailTicketRepository.updateById(id, REOPENED, {
            by: ctx.userId,
            version: ticket.__v,
            scope,
            session,
          });
          const audits: AuditEntry[] = [];
          for (const maintenanceId of plan.removeMaintenanceIds) {
            audits.push(await atmMaintenanceService.removeFromMail(maintenanceId, ctx, session));
          }
          return { kind: 'restored', updated, removed: plan.removeMaintenanceIds, audits };
        });
      } catch (error) {
        if (error instanceof StaleDocumentError && (await this.restoredConcurrently(id, scope))) {
          continue;
        }
        throw error;
      }
      if (outcome.kind === 'skip') continue;
      if (outcome.kind === 'refuse') {
        refused.push({
          ticketId: String(ticket._id),
          machineCode: ticket.machineCode,
          reason: outcome.reason,
        });
        continue;
      }
      // After commit, once — `withTransaction` may have run the callback twice.
      await auditService.record({
        entityRef: entityRef(id),
        action: 'restore',
        changes: mailRestoreChanges(ticket.status, outcome.removed),
      });
      for (const audit of outcome.audits) await auditService.record(audit);
      restored.push(outcome.updated);
    }
    return { restored, refused };
  }

  /**
   * Did a CONCURRENT restore of this very ticket return it first — a double click, or two people
   * on one log? Then its write is what made ours stale, and the ticket is pending, which is all
   * this request asked: skipped like one already pending, never answered as a conflict.
   */
  private async restoredConcurrently(id: string, scope: ScopeSelector): Promise<boolean> {
    const current = await atmMailTicketRepository.findById(id, scope);
    return current === null || current.status === 'pending';
  }

  /**
   * Live duplication for a set of tickets: "this machine has an OPEN maintenance on the ticket's
   * day" — the Cairo day it was received, which is the day accept would open it on (D6) — in any
   * branch (OD-1). One query per distinct day on the page. A code only goes in and a yes/no comes
   * out, so a maintenance in a branch the reader cannot see flags the row without describing
   * anything.
   */
  async duplicationFor(tickets: readonly AtmMailTicketDoc[]): Promise<Map<string, boolean>> {
    const byDay = new Map<string, AtmMailTicketDoc[]>();
    for (const ticket of tickets) {
      const day = openDayOf(ticket.receivedAt);
      byDay.set(day, [...(byDay.get(day) ?? []), ticket]);
    }
    const answer = new Map<string, boolean>();
    for (const [day, group] of byDay) {
      const open = await atmMaintenanceRepository.openMachineCodes(
        group.map((ticket) => ticket.machineCode),
        day,
      );
      for (const ticket of group) answer.set(String(ticket._id), open.has(ticket.machineCode));
    }
    return answer;
  }
}

export const atmMailTicketService = new AtmMailTicketService();

/** The ingest path needs a cross-status machine-code probe; keep the filter typed and local. */
export const pendingTicketFilter = (): FilterQuery<AtmMailTicketDoc> =>
  ({ status: 'pending' }) as FilterQuery<AtmMailTicketDoc>;
