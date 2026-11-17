import { type Request, type Response } from 'express';
import { ok } from '../../../infrastructure/http/respond';
import { orgChartService } from './org-chart.service';

/** `GET /platform/org-chart` — the whole company (P-ORG-3 §4.4). */
export const getOrgChart = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await orgChartService.chart());
};
