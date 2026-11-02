// Thin HTTP mapping only (ADR-003). The ONE clock of a dashboard read is taken here — the only
// `new Date()` in `dashboard/` — and handed to the service, so every "today" below it is the same
// Cairo day (R-01) and a spec can pin it.
import { type FleetDashboardPeriodQuery } from '@ecms/contracts';
import { type Request, type Response } from 'express';
import { authContext } from '../../../platform/auth';
import { ok, validated } from '../../../platform/web';
import { fleetDashboardNowService } from './now.service';
import { fleetDashboardPeriodService } from './period.service';

/** R1 — tabs 1–5. No query: the branch travels as X-Active-Branch (`ctx.activeBranchId`). */
export const getFleetDashboardNow = async (req: Request, res: Response): Promise<void> => {
  ok(res, await fleetDashboardNowService.read(authContext(req), new Date()));
};

/** R2 — tabs 6–10, over the validated period and vehicle filters. */
export const getFleetDashboardPeriod = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetDashboardPeriodQuery>(req);
  ok(res, await fleetDashboardPeriodService.read(authContext(req), new Date(), query));
};
