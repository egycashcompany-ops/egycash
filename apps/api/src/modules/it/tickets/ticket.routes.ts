// Help-desk routes (design §7, §12).
//
// The permission split is the design's, not an invention:
//   * `itTicket.view`   — read. SCOPED: `own` is what makes FR-8 true ("a requester always sees
//                          their own tickets") without a line of special-case code.
//   * `itTicket.create` — open a ticket.
//   * `itTicket.edit`   — WORK the ticket: edit its fields, move its status, post internal notes.
//   * `itTicket.assign` — dispatch. Its own grant: deciding who does the work is a different
//                          authority from doing it.
//   * `itTicket.close`  — close, reopen, cancel. One grant for both directions (the design's
//                          both-directions precedent).
//
// Two endpoints are deliberately NOT gated on a work grant, because FR-14 says the rule is
// OWNERSHIP, not a permission: cancelling your own open ticket, and commenting on your own ticket.
// Both ride `itTicket.view` at the route and enforce ownership in the service, where the ticket is
// actually in hand.
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignItTicketSchema,
  CancelItTicketSchema,
  ChangeItTicketStatusSchema,
  CloseItTicketSchema,
  CreateItTicketCommentSchema,
  CreateItTicketSchema,
  ListItTicketEventsQuerySchema,
  ListItTicketsQuerySchema,
  ReopenItTicketSchema,
  ResolveItTicketSchema,
  UpdateItTicketSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  assignItTicket,
  cancelItTicket,
  changeItTicketStatus,
  closeItTicket,
  createItTicket,
  createItTicketComment,
  getItTicket,
  listItTicketEvents,
  listItTickets,
  reopenItTicket,
  resolveItTicket,
  updateItTicket,
} from './ticket.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItTicketsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('itTicket.view'),
    validate({ query: ListItTicketsQuerySchema }),
    asyncHandler(listItTickets),
  );
  router.post(
    '/',
    authenticate,
    authorize('itTicket.create'),
    validate({ body: CreateItTicketSchema }),
    asyncHandler(createItTicket),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itTicket.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItTicket),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itTicket.edit'),
    validate({ body: UpdateItTicketSchema, params: IdParamSchema }),
    asyncHandler(updateItTicket),
  );

  // ── Transitions ─────────────────────────────────────────────────────────
  router.post(
    '/:id/assign',
    authenticate,
    authorize('itTicket.assign'),
    validate({ body: AssignItTicketSchema, params: IdParamSchema }),
    asyncHandler(assignItTicket),
  );
  router.post(
    '/:id/status',
    authenticate,
    authorize('itTicket.edit'),
    validate({ body: ChangeItTicketStatusSchema, params: IdParamSchema }),
    asyncHandler(changeItTicketStatus),
  );
  router.post(
    '/:id/resolve',
    authenticate,
    authorize('itTicket.edit'),
    validate({ body: ResolveItTicketSchema, params: IdParamSchema }),
    asyncHandler(resolveItTicket),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('itTicket.close'),
    validate({ body: CloseItTicketSchema, params: IdParamSchema }),
    asyncHandler(closeItTicket),
  );
  router.post(
    '/:id/reopen',
    authenticate,
    authorize('itTicket.close'),
    validate({ body: ReopenItTicketSchema, params: IdParamSchema }),
    asyncHandler(reopenItTicket),
  );
  // FR-14 — the requester's own cancel. Ownership is checked in the service; no grant is minted
  // for it, exactly as the design requires.
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('itTicket.view'),
    validate({ body: CancelItTicketSchema, params: IdParamSchema }),
    asyncHandler(cancelItTicket),
  );

  // ── The stream ──────────────────────────────────────────────────────────
  router.get(
    '/:id/comments',
    authenticate,
    authorize('itTicket.view'),
    validate({ query: ListItTicketEventsQuerySchema, params: IdParamSchema }),
    asyncHandler(listItTicketEvents),
  );
  // FR-14's other half: a requester may comment publicly on their own ticket. Internal visibility
  // still needs `itTicket.edit`, refused in the service.
  router.post(
    '/:id/comments',
    authenticate,
    authorize('itTicket.view'),
    validate({ body: CreateItTicketCommentSchema, params: IdParamSchema }),
    asyncHandler(createItTicketComment),
  );
  return router;
};
