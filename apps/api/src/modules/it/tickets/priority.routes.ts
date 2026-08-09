// Ticket priorities — the SLA policy surface (design §7).
//
// Reads take EITHER grant: the ticket form's priority dropdown must populate for anyone who can
// open a ticket, while the help-desk settings screen is `itSlaPolicy.manage`. Same shape, and same
// reason, as the catalog read gate.
//
// No DELETE: priorities archive (FR-11) — every ticket ever opened points at one.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItTicketPrioritySchema,
  ListItTicketPrioritiesQuerySchema,
  UpdateItTicketPrioritySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItTicketPriority,
  listItTicketPriorities,
  updateItTicketPriority,
} from './priority.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItTicketPrioritiesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('itTicket.view', 'itSlaPolicy.manage'),
    validate({ query: ListItTicketPrioritiesQuerySchema }),
    asyncHandler(listItTicketPriorities),
  );
  router.post(
    '/',
    authenticate,
    authorize('itSlaPolicy.manage'),
    validate({ body: CreateItTicketPrioritySchema }),
    asyncHandler(createItTicketPriority),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itSlaPolicy.manage'),
    validate({ body: UpdateItTicketPrioritySchema, params: IdParamSchema }),
    asyncHandler(updateItTicketPriority),
  );
  return router;
};
