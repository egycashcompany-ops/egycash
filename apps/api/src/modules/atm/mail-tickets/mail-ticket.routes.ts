// Mail decisions ride ONE grant (`decide`) covering accept and reject — one screen, one
// authority, the two-direction-cell precedent. The log page had a STRICTLY SMALLER privilege set
// in legacy (creator|admin|atm-admin only, contad_app.js:2901 vs :2634), hence its own key.
import { Router } from 'express';
import { DecideAtmMailTicketsSchema, ListAtmMailLogQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  PendingListQuerySchema,
  acceptMailTickets,
  listMailLog,
  listPendingMailTickets,
  mailUnreadCount,
  rejectMailTickets,
} from './mail-ticket.controller';

export const buildAtmMailTicketsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('atmMailTicket.view'),
    validate({ query: PendingListQuerySchema }),
    asyncHandler(listPendingMailTickets),
  );
  router.get(
    '/log',
    authenticate,
    authorize('atmMailTicket.viewLog'),
    validate({ query: ListAtmMailLogQuerySchema }),
    asyncHandler(listMailLog),
  );
  // The badge is rendered on every ATM page, so it rides the module's most basic read.
  router.get(
    '/unread-count',
    authenticate,
    authorize('atmMailTicket.view'),
    asyncHandler(mailUnreadCount),
  );
  router.post(
    '/accept',
    authenticate,
    authorize('atmMailTicket.decide'),
    validate({ body: DecideAtmMailTicketsSchema }),
    asyncHandler(acceptMailTickets),
  );
  router.post(
    '/reject',
    authenticate,
    authorize('atmMailTicket.decide'),
    validate({ body: DecideAtmMailTicketsSchema }),
    asyncHandler(rejectMailTickets),
  );
  return router;
};
