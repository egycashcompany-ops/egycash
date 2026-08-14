// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { costBreakdownService } from './cost-breakdown.service';

type IdParam = { id: string };

/**
 * The whole HTTP surface of this feature — one GET, and there will not be a second.
 *
 * It takes no query parameter, deliberately. A grouping, a filter or a period selector would each
 * be a REPORT DEFINITION — which rows, for whom, sliced how — and P-HR-15's inventory records that
 * nobody has given one. The three splits this returns are the dimensions the payslip lines already
 * store, stated in full so the caller chooses nothing.
 */
export const getRunCostBreakdown = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await costBreakdownService.forRun(params.id, scopeSelector(ctx, 'employee.viewCompensation')),
  );
};
