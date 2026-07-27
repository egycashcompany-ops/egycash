// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import { type AddTimelineNote, type ListRecruitmentTimelineQuery } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { applicantService } from '../applicants';
import { recruitmentTimelineService } from './recruitment-timeline.service';
import { timelineEntryDto } from './recruitment-timeline.mapper';

type IdParam = { id: string };

export const listRecruitmentTimeline = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListRecruitmentTimelineQuery, IdParam>(req);
  const entries = await recruitmentTimelineService.listForApplicant(
    params.id,
    {
      type: query.type,
      correlationType: query.correlationType,
      correlationId: query.correlationId,
      stageKind: query.stageKind,
      from: query.from,
      to: query.to,
      includeSuperseded: query.includeSuperseded,
    },
    query.limit,
    scopeSelector(ctx, 'applicant.view'),
  );
  ok(res, entries.map(timelineEntryDto));
};

export const addRecruitmentTimelineNote = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddTimelineNote, never, IdParam>(req);
  const applicant = await applicantService.getById(params.id, scopeSelector(ctx, 'applicant.edit'));
  const entry = await recruitmentTimelineService.addNote({
    applicantId: params.id,
    applicantCode: applicant.code,
    branchId: applicant.branchId,
    actorUserId: ctx.userId,
    note: body.note,
  });
  ok(res, timelineEntryDto(entry));
};
