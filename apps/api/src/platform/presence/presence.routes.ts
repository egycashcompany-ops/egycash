// /platform/presence — who is on the system now (the «المستخدمون النشطون» page).
//
// The heartbeat is open to every signed-in staff member and needs no permission: it says nothing
// but «I am here», about the caller only. It is limited per person, well above the browser's own
// once-a-minute, so only a runaway client meets the limit. The page is `activeUser.view`, scoped
// exactly like the users list.
import { type Request, Router } from 'express';
import { ListActiveUsersQuerySchema } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { rateLimit } from '../../infrastructure/redis/rate-limiter';
import { authContextOrNull, authenticate } from '../auth';
import { authorize } from '../rbac';
import { heartbeat, listActiveUsers } from './presence.controller';

const perUser = (req: Request): string | null => authContextOrNull(req)?.userId ?? null;

export const buildPresenceRouter = (): Router => {
  const router = Router();
  router.post(
    '/heartbeat',
    authenticate,
    rateLimit({ name: 'presence-heartbeat', windowSeconds: 60, max: 10, keyOf: perUser }),
    asyncHandler(heartbeat),
  );
  router.get(
    '/active-users',
    authenticate,
    authorize('activeUser.view'),
    validate({ query: ListActiveUsersQuerySchema }),
    asyncHandler(listActiveUsers),
  );
  return router;
};
