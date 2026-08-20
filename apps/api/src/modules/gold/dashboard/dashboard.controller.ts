// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { authContext } from '../../../platform/auth';
import { ok } from '../../../platform/web';
import { scopeSelector } from '../../../shared/types';
import { goldDashboardService } from './dashboard.service';

export const getGoldDashboardStats = async (req: Request, res: Response): Promise<void> => {
  const scope = scopeSelector(authContext(req), 'goldReport.view');
  ok(res, await goldDashboardService.stats(scope));
};

export const getGoldDashboardCharts = async (req: Request, res: Response): Promise<void> => {
  const scope = scopeSelector(authContext(req), 'goldReport.view');
  ok(res, await goldDashboardService.charts(scope));
};
