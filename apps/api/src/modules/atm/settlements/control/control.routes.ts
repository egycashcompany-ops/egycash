// /atm/control — Control & Supplies (docs/12-planning/atm-settlements-phase1.md §6.3 C1–C7).
// authenticate → authorize(…) → (rate limit) → validate; a route that needs two keys chains two
// `authorize` calls, and the service asks each key to reach the branch. Literal paths first.
import { type Request, Router } from 'express';
import { z } from 'zod';
import {
  AssignAtmRoutesSchema,
  AtmControlPrintSchema,
  AtmRoutesFromZonesSchema,
  AtmSettlementDayQuerySchema,
  AtmVersionQuerySchema,
  CreateAtmRouteSchema,
  UpdateAtmRouteSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate, authContextOrNull } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import { rateLimit } from '../../../../infrastructure/redis/rate-limiter';
import {
  assignRoutes,
  createRoute,
  deleteRoute,
  getControlDay,
  printControl,
  routesFromZones,
  updateRoute,
} from './control.controller';

const RouteParamSchema = z.object({ routeId: objectId() }).strict();

const perUser = (req: Request): string | null => authContextOrNull(req)?.userId ?? null;

export const buildAtmControlRouter = (): Router => {
  const router = Router();
  const manage = authorize('atmControl.manage');

  router.get(
    '/day',
    authenticate,
    authorize('atmControl.view'),
    validate({ query: AtmSettlementDayQuerySchema }),
    asyncHandler(getControlDay),
  );
  router.post(
    '/routes',
    authenticate,
    manage,
    validate({ body: CreateAtmRouteSchema }),
    asyncHandler(createRoute),
  );
  router.post(
    '/routes/from-zones',
    authenticate,
    manage,
    authorize('atmMap.view'),
    validate({ body: AtmRoutesFromZonesSchema }),
    asyncHandler(routesFromZones),
  );
  router.put(
    '/routes/:routeId',
    authenticate,
    manage,
    validate({ body: UpdateAtmRouteSchema, params: RouteParamSchema }),
    asyncHandler(updateRoute),
  );
  router.delete(
    '/routes/:routeId',
    authenticate,
    manage,
    validate({ query: AtmVersionQuerySchema, params: RouteParamSchema }),
    asyncHandler(deleteRoute),
  );
  router.put(
    '/assignments',
    authenticate,
    manage,
    validate({ body: AssignAtmRoutesSchema }),
    asyncHandler(assignRoutes),
  );
  router.post(
    '/prints',
    authenticate,
    authorize('atmControl.print'),
    rateLimit({ name: 'atm-control-print', windowSeconds: 60, max: 30, keyOf: perUser }),
    validate({ body: AtmControlPrintSchema }),
    asyncHandler(printControl),
  );
  return router;
};
