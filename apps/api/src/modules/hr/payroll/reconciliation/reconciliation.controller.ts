// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { reconciliationService } from './reconciliation.service';

type IdParam = { id: string };

/**
 * The whole HTTP surface of this feature — one GET, and there will not be a second.
 *
 * A reconciliation states what the documents already say. Anything that changed a figure would be
 * an act one of the owning features already has: issuing payslips, deciding an adjustment, moving
 * the run's state.
 */
export const getRunReconciliation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await reconciliationService.forRun(params.id, scopeSelector(ctx, 'employee.viewCompensation')),
  );
};
