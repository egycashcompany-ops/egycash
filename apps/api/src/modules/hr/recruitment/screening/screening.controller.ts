// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type AddScreeningNote,
  type CreateScreening,
  type DecideScreening,
  type ListAwaitingScreeningsQuery,
  type ListScreeningsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { screeningService } from './screening.service';
import { toScreeningDto } from './screening.mapper';

type IdParam = { id: string };

export const createScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateScreening>(req);
  const doc = await screeningService.create(ctx, body, scopeSelector(ctx, 'screening.create'));
  created(res, toScreeningDto(doc), `/api/v1/hr/screenings/${String(doc._id)}`);
};

export const listScreenings = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListScreeningsQuery>(req);
  const page = await screeningService.list(query, scopeSelector(ctx, 'screening.view'));
  okPage(res, page, toScreeningDto);
};

export const listAwaitingScreenings = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAwaitingScreeningsQuery>(req);
  ok(res, await screeningService.listAwaiting(query, scopeSelector(ctx, 'screening.view')));
};

export const getScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toScreeningDto(await screeningService.getById(params.id, scopeSelector(ctx, 'screening.view'))));
};

export const addScreeningNote = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddScreeningNote, never, IdParam>(req);
  const doc = await screeningService.addNote(ctx, params.id, body, scopeSelector(ctx, 'screening.edit'));
  ok(res, toScreeningDto(doc));
};

export const decideScreening = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideScreening, never, IdParam>(req);
  const doc = await screeningService.decide(ctx, params.id, body, scopeSelector(ctx, 'screening.decide'));
  ok(res, toScreeningDto(doc));
};
