// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ItDashboardQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { itDashboardService } from './dashboard.service';

/** Read in the asset register's own scope — the dashboard counts what the reader can list. */
const viewScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

export const getItDashboardAssets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ItDashboardQuery>(req);
  ok(res, await itDashboardService.assets(query, viewScope(req)));
};

export const getItDashboardActivity = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ItDashboardQuery>(req);
  ok(res, await itDashboardService.activity(query, viewScope(req)));
};
