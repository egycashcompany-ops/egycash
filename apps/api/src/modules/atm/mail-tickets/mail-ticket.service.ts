// Mail ticket behaviour — the legacy /mail_maintenance(+_log) handlers ported by parity
// (contad_app.js:2612-2978). A ticket is DECIDED once: accepted (a maintenance operation opens
// from it) or rejected; both are terminal, and the log page is the record of who decided what —
// now WITH when (`actionAt`, GAP G1).
//
// The owner's rule (2026-10-13, port doc OD-1) reaches this screen twice: a ticket whose machine
// already has an open maintenance is NOT accepted (it stays pending and the answer says so), and
// the `duplication` flag the screen paints is that very condition — any day, any branch.
import {
  type AtmMailAcceptRefusalDto,
  type DecideAtmMailTickets,
  type ListAtmMailLogQuery,
  type Paginated,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { type AuthContext, type ScopeSelector, scopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { actorName } from '../shared/atm-context';
import { isAlreadyOpenError } from '../shared/open-operation';
import { cairoDateString } from '../shared/cairo-time';
import { atmMaintenanceService } from '../maintenances/maintenance.service';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';
import { atmMailTicketRepository } from './mail-ticket.repository';
import { type AtmMailTicketDoc } from './mail-ticket.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'mailTicket', entityId: id });

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
   * A ticket whose machine already has an open maintenance — anywhere, including one accepted
   * earlier in this same selection — is REFUSED (the owner's rule, OD-1): nothing is written, the
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
   * Live duplication for a set of tickets: "this machine has an OPEN maintenance" — any day, any
   * branch (OD-1), one query for the whole page. A code only goes in and a yes/no comes out, so a
   * maintenance in a branch the reader cannot see flags the row without describing anything.
   */
  async duplicationFor(tickets: readonly AtmMailTicketDoc[]): Promise<Map<string, boolean>> {
    const open = await atmMaintenanceRepository.openMachineCodes(
      tickets.map((ticket) => ticket.machineCode),
    );
    return new Map(tickets.map((ticket) => [String(ticket._id), open.has(ticket.machineCode)]));
  }
}

export const atmMailTicketService = new AtmMailTicketService();

/** The ingest path needs a cross-status machine-code probe; keep the filter typed and local. */
export const pendingTicketFilter = (): FilterQuery<AtmMailTicketDoc> =>
  ({ status: 'pending' }) as FilterQuery<AtmMailTicketDoc>;
