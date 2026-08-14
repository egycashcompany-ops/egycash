// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListSettlementQueueQuery } from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { settlementService } from './settlement.service';

type IdParam = { id: string };

/**
 * The whole HTTP surface of this feature — one GET, and there will not be a second.
 *
 * There is no POST here and no handler that writes, because a settlement summary states what other
 * features already decided. Anything that changes an amount is an act those features own: an
 * adjustment on the exit month, a repayment against the loan, a decision on the run.
 */
export const getEmployeeSettlement = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await settlementService.summaryFor(params.id, scopeSelector(ctx, 'employee.viewCompensation')));
};

/**
 * The queue (P-HR-17) — who has left and has not been settled.
 *
 * The rows are already the DTO the service assembled, so `okPage` is given the identity mapper:
 * there is no document behind this list to map from. That is the shape of the whole feature — it
 * owns no collection.
 */
export const listSettlementQueue = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListSettlementQueueQuery>(req);
  const page = await settlementService.queue(query, scopeSelector(ctx, 'employee.viewCompensation'));
  okPage(res, page, (row) => row);
};
