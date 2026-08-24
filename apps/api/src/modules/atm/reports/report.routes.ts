// The daily report — the legacy /reports_atm screen (contad_app.js:2208-2351).
//
// It rides the EXISTING view grants and declares no permission and no page of its own: a report is
// a read of operations the caller can already see, and it stores nothing (the operations B5-report
// precedent). `authorizeAny` opens the route to either half's reader; the service then computes
// ONLY the halves the caller actually holds, so a maintenance-only account gets maintenance counts
// and an empty replenishment list rather than a 403 or somebody else's numbers.
import { Router, type Request, type Response } from 'express';
import { AtmDailyReportQuerySchema, type AtmDailyReportQuery } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { atmReportService } from './report.service';

const dailyReport = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmDailyReportQuery>(req);
  ok(res, await atmReportService.daily(query, authContext(req)));
};

export const buildAtmReportsRouter = (): Router => {
  const router = Router();
  router.get(
    '/daily',
    authenticate,
    authorizeAny('atmReplenishment.view', 'atmMaintenance.view'),
    validate({ query: AtmDailyReportQuerySchema }),
    asyncHandler(dailyReport),
  );
  return router;
};
