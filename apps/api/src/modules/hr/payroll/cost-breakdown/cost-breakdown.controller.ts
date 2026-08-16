// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { costBreakdownService } from './cost-breakdown.service';

type IdParam = { id: string };

/**
 * The whole HTTP surface of THIS feature — one GET, taking no query parameter.
 *
 * That was originally written as "and there will not be a second", because a grouping or a filter
 * would each be a REPORT DEFINITION — which rows, for whom, sliced how — and P-HR-15's inventory
 * recorded that nobody had given one. **P-HR-25 supersedes the second half of that sentence, and
 * the reasoning is worth keeping rather than quietly deleting.** A definition now exists, supplied
 * by the CALLER rather than invented here, and it is served by `POST …/cost-report` beside this.
 *
 * This endpoint is unchanged: it still states all three splits in full, and the caller still
 * chooses nothing. What it answers is "what did this run cost, along every dimension the lines
 * already carry" — a question with no parameters, which is why it keeps none.
 */
export const getRunCostBreakdown = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await costBreakdownService.forRun(params.id, scopeSelector(ctx, 'employee.viewCompensation')),
  );
};
