// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import { type RecruitmentStageCountsQuery } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { stageCountsService } from './stage-counts.service';

export const listStageCounts = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, RecruitmentStageCountsQuery>(req);
  ok(res, await stageCountsService.list(ctx, query));
};
