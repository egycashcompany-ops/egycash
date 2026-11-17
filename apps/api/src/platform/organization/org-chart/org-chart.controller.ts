import { type Request, type Response } from 'express';
import {
  type AddChartSection,
  type RenameChartSection,
  type StopChartSection,
} from '@ecms/contracts';
import { created, ok } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { authContext } from '../../auth';
import { orgChartService } from './org-chart.service';
import { chartSections } from './org-chart.sections';

type SectionParam = { sectionCatalogId: string };

/** `GET /platform/org-chart` — the whole company (P-ORG-3 §4.4). */
export const getOrgChart = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await orgChartService.chart());
};

/** «إضافة قسم» — answers with the fresh chart, which the page puts straight into its cache (§6.1). */
export const addChartSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<AddChartSection>(req);
  await chartSections.add(body, ctx.userId);
  created(res, await orgChartService.chart(), '/api/v1/platform/org-chart');
};

export const renameChartSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RenameChartSection, never, SectionParam>(req);
  await chartSections.rename(params.sectionCatalogId, body, ctx.userId);
  ok(res, await orgChartService.chart());
};

export const stopChartSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<StopChartSection, never, SectionParam>(req);
  await chartSections.stop(params.sectionCatalogId, body, ctx.userId);
  ok(res, await orgChartService.chart());
};
