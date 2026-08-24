// Mail ticket behaviour — the legacy /mail_maintenance(+_log) handlers ported by parity
// (contad_app.js:2612-2978). A ticket is DECIDED once: accepted (a maintenance operation opens
// from it) or rejected; both are terminal, and the log page is the record of who decided what —
// now WITH when (`actionAt`, GAP G1).
import {
  type DecideAtmMailTickets,
  type ListAtmMailLogQuery,
  type Paginated,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { type AuthContext, scopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { actorName } from '../shared/atm-context';
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
   * Pending list with duplication RECOMPUTED per row — the legacy GET re-ran the open-today
   * check on every render and wrote it back (contad_app.js:2674-2698). The recompute is kept;
   * the write-back on a read is not (decision D5) — the screen shows the same answer either way.
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
    const duplication = new Map<string, boolean>();
    for (const ticket of page.items) {
      duplication.set(
        String(ticket._id),
        await atmMaintenanceRepository.hasOpenToday(ticket.branchId, ticket.machineCode),
      );
    }
    return { page, duplication };
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
   */
  async accept(input: DecideAtmMailTickets, ctx: AuthContext): Promise<AtmMailTicketDoc[]> {
    const scope = scopeSelector(ctx, 'atmMailTicket.decide');
    const decided: AtmMailTicketDoc[] = [];
    for (const id of input.ids) {
      const ticket = await atmMailTicketRepository.findById(id, scope);
      if (ticket === null || ticket.status !== 'pending') continue;
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
        changes: diffChanges({}, { maintenanceId: String(maintenance._id) }),
      });
      decided.push(updated);
    }
    return decided;
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

  /** Live duplication for a set of tickets — shared with the DTO mapper on decide responses. */
  async duplicationFor(tickets: readonly AtmMailTicketDoc[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    for (const ticket of tickets) {
      map.set(
        String(ticket._id),
        await atmMaintenanceRepository.hasOpenToday(ticket.branchId, ticket.machineCode),
      );
    }
    return map;
  }
}

export const atmMailTicketService = new AtmMailTicketService();

/** The ingest path needs a cross-status machine-code probe; keep the filter typed and local. */
export const pendingTicketFilter = (): FilterQuery<AtmMailTicketDoc> =>
  ({ status: 'pending' }) as FilterQuery<AtmMailTicketDoc>;
