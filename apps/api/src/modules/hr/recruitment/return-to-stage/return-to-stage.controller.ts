// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import { type ReturnToStage, type StageRef } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { toApplicantDto } from '../applicants/applicant.mapper';
import { returnToStageService } from './return-to-stage.service';
import { type ReturnToStagePreviewQuery } from './return-to-stage.validation';

type IdParam = { id: string };

export const previewReturnToStage = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ReturnToStagePreviewQuery, IdParam>(req);
  const target: StageRef = { kind: query.kind, refId: query.refId ?? null };
  ok(res, await returnToStageService.preview(params.id, target, scopeSelector(ctx, 'applicant.view')));
};

export const returnApplicantToStage = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReturnToStage, never, IdParam>(req);
  const plan = await returnToStageService.execute(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'applicant.returnToStage'),
  );
  ok(res, {
    applicant: toApplicantDto(plan.applicant),
    target: plan.target.dto,
    newAttempt: plan.newAttempt,
    superseded: plan.supersedes.map((s) => ({ entityType: s.kind, entityId: s.id, status: s.status })),
  });
};
