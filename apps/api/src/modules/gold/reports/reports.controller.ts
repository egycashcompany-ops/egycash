// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type GoldClientBalancesQuery, type GoldFundMovementQuery } from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { ok, validated } from '../../../platform/web';
import { scopeSelector } from '../../../shared/types';
import { goldReportsService } from './reports.service';

export const goldClientBalances = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldClientBalancesQuery>(req);
  const scope = scopeSelector(authContext(req), 'goldReport.view');
  ok(res, await goldReportsService.clientBalances(query, scope));
};

export const goldFundMovement = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldFundMovementQuery>(req);
  const scope = scopeSelector(authContext(req), 'goldReport.view');
  ok(res, await goldReportsService.fundMovement(query, scope));
};

export const goldFundClosing = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GoldFundMovementQuery>(req);
  const scope = scopeSelector(authContext(req), 'goldReport.view');
  ok(res, await goldReportsService.fundClosing(query, scope));
};
