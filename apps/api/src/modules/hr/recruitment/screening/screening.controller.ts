// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
//
// I6 — every action that touches the candidate answers with the full workflow envelope
// (`{ data, workflow, timeline, counters }`), so the client never asks a second question to learn
// what just happened. Reads (GET) are unchanged.
import { type Request, type Response } from 'express';
import {
  type AddScreeningNote,
  type BulkScreenings,
  type CreateScreening,
  type DecideScreening,
  type ListScreeningsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { withBulkWorkflowEnvelope, withWorkflowEnvelope } from '../workflow';
import { screeningService } from './screening.service';
import { toScreeningDto } from './screening.mapper';
import { type ScreeningDoc } from './screening.model';

type IdParam = { id: string };

const applicantOf = (doc: ScreeningDoc): string => String(doc.applicantId);

export const createScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateScreening>(req);
  const scope = scopeSelector(ctx, 'screening.create');
  const envelope = await withWorkflowEnvelope(
    ctx,
    () => screeningService.create(ctx, body, scope),
    toScreeningDto,
    applicantOf,
  );
  created(res, envelope, `/api/v1/hr/screenings/${envelope.data.id}`);
};

export const listScreenings = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListScreeningsQuery>(req);
  const page = await screeningService.list(query, scopeSelector(ctx, 'screening.view'));
  okPage(res, page, toScreeningDto);
};

export const getScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toScreeningDto(await screeningService.getById(params.id, scopeSelector(ctx, 'screening.view'))));
};

export const addScreeningNote = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddScreeningNote, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'screening.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => screeningService.addNote(ctx, params.id, body, scope),
      toScreeningDto,
      applicantOf,
    ),
  );
};

export const decideScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideScreening, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'screening.decide');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => screeningService.decide(ctx, params.id, body, scope),
      toScreeningDto,
      applicantOf,
    ),
  );
};

export const redecideScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideScreening, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'screening.decide');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => screeningService.redecide(ctx, params.id, body, scope),
      toScreeningDto,
      applicantOf,
    ),
  );
};

export const bulkScreenings = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkScreenings>(req);
  const scope = scopeSelector(ctx, 'screening.decide');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => screeningService.bulk(ctx, body, scope)));
};
