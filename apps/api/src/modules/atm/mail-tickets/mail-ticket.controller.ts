// Thin HTTP mapping only (ADR-003). Pending rows carry the LIVE duplication answer beside the
// stored ticket — the mapper takes the map so the DTO stays one shape.
import { type Request, type Response } from 'express';
import { type z } from 'zod';
import {
  PaginationQuerySchema,
  type AtmMailAcceptMetaDto,
  type AtmMailRestoreMetaDto,
  type AtmMailTicketDto,
  type DecideAtmMailTickets,
  type ListAtmMailLogQuery,
  type RestoreAtmMailTickets,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAtmMailTicketDto } from '../atm.mappers';
import { atmMailTicketService } from './mail-ticket.service';

export const PendingListQuerySchema = PaginationQuerySchema.strict();
type PendingListQuery = z.infer<typeof PendingListQuerySchema>;

export const listPendingMailTickets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, PendingListQuery>(req);
  const { page, duplication } = await atmMailTicketService.listPending(query, authContext(req));
  okPage(res, page, (doc) => toAtmMailTicketDto(doc, duplication.get(String(doc._id))));
};

export const listMailLog = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmMailLogQuery>(req);
  // The log shows the STORED ingest-time duplication — the legacy log never recomputed it.
  okPage(res, await atmMailTicketService.listLog(query, authContext(req)), (doc) =>
    toAtmMailTicketDto(doc),
  );
};

export const mailUnreadCount = async (req: Request, res: Response): Promise<void> => {
  ok(res, { count: await atmMailTicketService.unreadCount(authContext(req)) });
};

// `data` stays the ACCEPTED tickets, as it always was. `meta.refused` named the tickets the owner's
// rule left pending (their machine already had an open maintenance — OD-1); since OD-1c
// (2026-11-02) such a ticket is accepted, so it is always empty — kept, so the answer's shape does
// not change for a client that reads it.
export const acceptMailTickets = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<DecideAtmMailTickets>(req);
  const decided = await atmMailTicketService.accept(body, authContext(req));
  ok<AtmMailTicketDto[], AtmMailAcceptMetaDto>(
    res,
    decided.map((doc) => toAtmMailTicketDto(doc)),
    { refused: [] },
  );
};

export const rejectMailTickets = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<DecideAtmMailTickets>(req);
  const decided = await atmMailTicketService.reject(body, authContext(req));
  ok(
    res,
    decided.map((doc) => toAtmMailTicketDto(doc)),
  );
};

// Accept's answer, mirrored: `data` is the tickets RESTORED to pending, and the ones refused (their
// maintenance is already closed) ride in `meta`, so the log can name the machine that stayed
// decided.
export const restoreMailTickets = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RestoreAtmMailTickets>(req);
  const { restored, refused } = await atmMailTicketService.restore(body, authContext(req));
  ok<AtmMailTicketDto[], AtmMailRestoreMetaDto>(
    res,
    restored.map((doc) => toAtmMailTicketDto(doc)),
    { refused },
  );
};
