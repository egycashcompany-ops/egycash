// Mail ticket behaviour — the legacy /mail_maintenance(+_log) handlers ported by parity
// (contad_app.js:2612-2978). A ticket is DECIDED: accepted (a maintenance operation opens from it)
// or rejected, and the log page is the record of who decided what — now WITH when (`actionAt`,
// GAP G1). Both decisions were terminal, as in the legacy, until the owner asked for a way back
// from the log: «إسترجاع ويقدر يرجعه مفتوح لو قبل أو رفض غلط» (2026-10-28 — `restore`).
//
// The `duplication` flag the pending screen paints asks whether the ticket's machine already has an
// open maintenance ON THE TICKET'S DAY (the day it was received, the day accept opens it on — D6),
// any branch. A WARNING ONLY since 2026-11-02 (port doc OD-1c: «في الصيانة عايزك تسمح إنه يضيف أكتر
// من صيانة عادي»): accepting such a ticket opens another maintenance for the machine, as the legacy
// did. From 2026-10-13 to then the owner's rule (OD-1) refused it and left it pending.
import {
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
import { assertNoBranchMoveRunning } from '../branch-links/move-fence';
import { actorName } from '../shared/atm-context';
import { openDayOf } from '../shared/open-operation';
import { cairoDateString } from '../shared/cairo-time';
import { atmMaintenanceService, isMailTicketTaken } from '../maintenances/maintenance.service';
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
 * Pure: what restoring one ticket does. `fromTicket` = every maintenance carrying the ticket,
 * deleted ones included — one after an accept here, still there (deleted) once removed on the
 * board. A rejected ticket opened nothing and simply returns to pending. An accepted one returns by
 * taking back what it opened, with two refusals that leave the ticket as it is:
 *   · NO maintenance carries it (`noLinkedMaintenance`) — every accept here links the one it
 *     opens, so this is an accept from the legacy system, whose import links none. Its maintenance,
 *     if any, cannot be found to take back: returning the ticket would leave it on the board while
 *     the confirm says it goes, and a second accept could open another for the same mail;
 *   · a LIVE one is CLOSED (`maintenanceClosed`) — a closed maintenance is work done, on the done
 *     page and in the daily report, and deleting it to reopen a mail would erase that record.
 */
export const planMailRestore = (
  status: AtmMailTicketStatus,
  fromTicket: readonly Pick<AtmMaintenanceDoc, '_id' | 'closedAt' | 'isDeleted'>[],
): MailRestorePlan => {
  if (status === 'pending') return { kind: 'skip' };
  if (status === 'rejected') return { kind: 'restore', removeMaintenanceIds: [] };
  if (fromTicket.length === 0) return { kind: 'refuse', reason: 'noLinkedMaintenance' };
  const live = fromTicket.filter((row) => !row.isDeleted);
  if (live.some((row) => row.closedAt !== null)) {
    return { kind: 'refuse', reason: 'maintenanceClosed' };
  }
  return { kind: 'restore', removeMaintenanceIds: live.map((row) => String(row._id)) };
};

/**
 * Pure: the restore's audit changes — the status back to pending and each maintenance THIS restore
 * removed: accept's `maintenanceId` change, reversed. One already deleted on the board is not named
 * again (its own `delete` row is its record). The decider's name and time leave the ticket; the
 * accept or reject row already on the trail keeps who and when.
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
   * a read is not (decision D5). The check: "this machine has an open maintenance on the ticket's
   * day", any branch — a warning since OD-1c; `accept` opens another one all the same.
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
   * A ticket whose machine already has an open maintenance on the ticket's day — the row painted
   * `duplication`, or one accepted earlier in this same selection — is ACCEPTED and opens another
   * one (OD-1c, 2026-11-02; until then it was refused and left pending).
   *
   * Each ticket's two writes — its maintenance and its flip to accepted — are ONE transaction, so
   * neither ever lands alone. A concurrent decision of the same ticket (a double click, two people
   * on one screen, an accept racing a reject) makes the flip stale or the insert collide with the
   * one-live-maintenance-per-ticket index; ours rolls back, writes nothing, and the ticket is
   * skipped like any decided one. A live maintenance that already carries a still-PENDING ticket
   * — left by an accept from before this transaction existed, whose flip never landed — is
   * ADOPTED: the ticket is accepted onto it rather than stuck behind it forever.
   */
  async accept(input: DecideAtmMailTickets, ctx: AuthContext): Promise<AtmMailTicketDoc[]> {
    // Each accept opens a maintenance (work the move's twin plan reads): refused before the first
    // ticket, so a selection is never half accepted while a move runs.
    await assertNoBranchMoveRunning();
    const scope = scopeSelector(ctx, 'atmMailTicket.decide');
    const decided: AtmMailTicketDoc[] = [];
    for (const id of input.ids) {
      const ticket = await atmMailTicketRepository.findById(id, scope);
      if (ticket === null || ticket.status !== 'pending') continue;
      let accepted: { updated: AtmMailTicketDoc; maintenanceId: string; adopted: boolean };
      try {
        accepted = await unitOfWork(async (session) => {
          // Read INSIDE the transaction, so a maintenance a concurrent accept commits after this
          // read makes our own insert a write conflict, and the retry reads it here.
          const live = (
            await atmMaintenanceRepository.findFromTicket(ticket.branchId, ticket._id, session)
          ).filter((row) => row.isDeleted !== true);
          const carrier = live[0];
          const maintenanceId =
            carrier === undefined
              ? String(
                  (
                    await atmMaintenanceService.openFromMail(
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
                      session,
                    )
                  )._id,
                )
              : String(carrier._id);
          const updated = await atmMailTicketRepository.updateById(
            id,
            {
              status: 'accepted',
              actionById: new Types.ObjectId(ctx.userId),
              actionByName: actorName(ctx),
              actionAt: new Date(),
            },
            { by: ctx.userId, version: ticket.__v, scope, session },
          );
          return { updated, maintenanceId, adopted: carrier !== undefined };
        });
      } catch (error) {
        // A concurrent decision of this very ticket won: an accept whose maintenance holds the
        // ticket's slot in the per-ticket index, or any accept or reject that flipped it first
        // (our version is stale). Ours rolled back — nothing written — and the ticket is skipped
        // like any decided one.
        if (isMailTicketTaken(error)) continue;
        if (error instanceof StaleDocumentError && (await this.decidedConcurrently(id, scope))) {
          continue;
        }
        throw error;
      }
      // After commit, once — `withTransaction` may have run the callback twice.
      await auditService.record({
        entityRef: entityRef(id),
        action: 'accept',
        changes: diffChanges(
          {},
          accepted.adopted
            ? { maintenanceId: accepted.maintenanceId, adopted: true }
            : { maintenanceId: accepted.maintenanceId },
        ),
      });
      decided.push(accepted.updated);
    }
    return decided;
  }

  /**
   * Reject (contad_app.js:2761-2783): the tickets flip to rejected; nothing is created.
   *
   * ONE write for the whole selection, then one read of what it decided (`decidePending`) — it was
   * a read and a write per ticket, measured at 1.7 s for a screenful. The answer is unchanged: the
   * selected tickets this request rejected, in the selection's order. One already decided, outside
   * the caller's scope or not there at all is left out, as it always was; and one decided by
   * someone else between the screen and this write is left out the same way — the per-ticket loop
   * answered that race with a 409 for the whole selection.
   */
  async reject(input: DecideAtmMailTickets, ctx: AuthContext): Promise<AtmMailTicketDoc[]> {
    const decided = await atmMailTicketRepository.decidePending(
      input.ids,
      {
        status: 'rejected',
        actionById: new Types.ObjectId(ctx.userId),
        actionByName: actorName(ctx),
        actionAt: new Date(),
      },
      { by: ctx.userId, scope: scopeSelector(ctx, 'atmMailTicket.decide') },
    );
    await auditService.recordMany(
      decided.map((ticket) => ({
        entityRef: entityRef(String(ticket._id)),
        action: 'reject',
        changes: [],
      })),
    );
    return decided;
  }

  /**
   * The log's «إسترجاع» — «ويقدر يرجعه مفتوح لو قبل أو رفض غلط» (2026-10-28): a decided ticket
   * back to PENDING, decided again on the pending screen. An accepted one takes back the
   * maintenance it opened, removed from /atm/maintenance in the SAME transaction as the ticket's
   * return, so neither half ever lands alone — and is refused, nothing written, when that
   * maintenance is closed or when no maintenance carries the ticket at all, a legacy accept
   * (`planMailRestore`). Already pending, or outside the caller's scope: skipped silently, as
   * accept and reject skip a decided one.
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
              ? await atmMaintenanceRepository.findFromTicket(ticket.branchId, ticket._id, session)
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
  /**
   * Did a CONCURRENT decision of this very ticket land first — an accept (a double click) or a
   * reject (another person on the screen)? Then its write is what made ours stale, and the ticket
   * is decided: ours is skipped, as a decided ticket always is.
   */
  private async decidedConcurrently(id: string, scope: ScopeSelector): Promise<boolean> {
    const current = await atmMailTicketRepository.findById(id, scope);
    return current === null || current.status !== 'pending';
  }

  private async restoredConcurrently(id: string, scope: ScopeSelector): Promise<boolean> {
    const current = await atmMailTicketRepository.findById(id, scope);
    return current === null || current.status === 'pending';
  }

  /**
   * Live duplication for a set of tickets: "this machine has an OPEN maintenance on the ticket's
   * day" — the Cairo day it was received, which is the day accept would open it on (D6) — in any
   * branch. A warning (OD-1c): accept opens another one all the same. One query per distinct day on
   * the page. A code only goes in and a yes/no comes out, so a maintenance in a branch the reader
   * cannot see flags the row without describing anything.
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
