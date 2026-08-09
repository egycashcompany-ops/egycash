// Thin HTTP mapping only (ADR-003). Every transition answers with the TICKET in its new state, so
// a client never re-fetches to learn what its own action did.
//
// One thing here is security, not ergonomics: `toItTicketEventDto` is handed `maySeeInternal(ctx)`
// so a comment body is redacted even if an internal row somehow reached the mapper. The real
// guarantee is the query filter (FR-7) — this is the second belt on the same trousers.
import { type Request, type Response } from 'express';
import {
  type AssignItTicket,
  type CancelItTicket,
  type ChangeItTicketStatus,
  type CloseItTicket,
  type CreateItTicket,
  type CreateItTicketComment,
  type ListItTicketEventsQuery,
  type ListItTicketsQuery,
  type ReopenItTicket,
  type ResolveItTicket,
  type UpdateItTicket,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItTicketDto, toItTicketEventDto } from '../it.mappers';
import { itTicketService, maySeeInternal } from './ticket.service';

type IdParam = { id: string };

/** Reads and writes share the ticket's read scope — `own` is what makes FR-8 work. */
const ticketScope = (req: Request) => scopeSelector(authContext(req), 'itTicket.view');

export const listItTickets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItTicketsQuery>(req);
  const ctx = authContext(req);
  okPage(res, await itTicketService.list(query, ctx, ticketScope(req)), toItTicketDto);
};

export const getItTicket = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItTicketDto(await itTicketService.getById(params.id, ticketScope(req))));
};

export const createItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItTicket>(req);
  const ctx = authContext(req);
  created(res, toItTicketDto(await itTicketService.create(body, ctx, ticketScope(req))));
};

export const updateItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.update(params.id, body, ctx, ticketScope(req))));
};

export const assignItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AssignItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.assign(params.id, body, ctx, ticketScope(req))));
};

export const changeItTicketStatus = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ChangeItTicketStatus, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.start(params.id, body, ctx, ticketScope(req))));
};

export const resolveItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ResolveItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.resolve(params.id, body, ctx, ticketScope(req))));
};

export const closeItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CloseItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.close(params.id, body, ctx, ticketScope(req))));
};

export const reopenItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReopenItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.reopen(params.id, body, ctx, ticketScope(req))));
};

export const cancelItTicket = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CancelItTicket, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, toItTicketDto(await itTicketService.cancel(params.id, body, ctx, ticketScope(req))));
};

export const listItTicketEvents = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, ListItTicketEventsQuery, IdParam>(req);
  const ctx = authContext(req);
  const page = await itTicketService.events(params.id, query, ctx, ticketScope(req));
  okPage(res, page, (doc) => toItTicketEventDto(doc, maySeeInternal(ctx)));
};

export const createItTicketComment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CreateItTicketComment, never, IdParam>(req);
  const ctx = authContext(req);
  const event = await itTicketService.comment(params.id, body, ctx, ticketScope(req));
  created(res, toItTicketEventDto(event, maySeeInternal(ctx)));
};
