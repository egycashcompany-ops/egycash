// «لوحة تحكم الحركة» — the fleet module's home, two reads (plan §5.1, §5.5):
//   GET /fleet/dashboard/now     tabs 1–5   (no query)
//   GET /fleet/dashboard/period  tabs 6–10  (?preset&from&to&typeIds&operationIds&vehicleCodes)
//
// `authorizeAny` over the union of each read's section gates, exported once from contracts. It is
// not a weaker gate: what a caller is SHOWN is decided section by section inside the service, each
// against EVERY key of its own gate (the data's API key AND the linked screen's guard, R-28). Holding
// one key opens the door and nothing behind it the holder could not already open on its screen; a
// caller with none gets the 403 (and its audit row) here. The old `GET /fleet/dashboard` is retired
// (P1-13).
import {
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FleetDashboardPeriodQuerySchema,
} from '@ecms/contracts';
import { Router } from 'express';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getFleetDashboardNow, getFleetDashboardPeriod } from './dashboard.controller';

/** `authorizeAny` takes at least one key; the contracts' unions always have several. */
const anyOf = (keys: readonly string[]): [string, ...string[]] => {
  const [first, ...rest] = keys;
  if (first === undefined) throw new Error('a dashboard read must name at least one permission');
  return [first, ...rest];
};

export const buildFleetDashboardRouter = (): Router => {
  const router = Router();
  router.get(
    '/now',
    authenticate,
    authorizeAny(...anyOf(FLEET_DASHBOARD_NOW_KEYS)),
    asyncHandler(getFleetDashboardNow),
  );
  router.get(
    '/period',
    authenticate,
    authorizeAny(...anyOf(FLEET_DASHBOARD_PERIOD_KEYS)),
    validate({ query: FleetDashboardPeriodQuerySchema }),
    asyncHandler(getFleetDashboardPeriod),
  );
  return router;
};
