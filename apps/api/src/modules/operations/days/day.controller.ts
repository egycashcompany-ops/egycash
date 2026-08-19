// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsDay,
  type GetOperationsDayQuery,
  type TransitionOperationsDay,
} from '@ecms/contracts';
import { created, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toDayDto } from '../operations.mappers';
import { operationsDayService } from './day.service';

type IdParam = { id: string };

export const getDayByDate = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, GetOperationsDayQuery>(req);
  const doc = await operationsDayService.findByDate(query.date);
  ok(res, doc === null ? null : toDayDto(doc));
};

export const createDay = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsDay>(req);
  const doc = await operationsDayService.create(body.date, authContext(req).userId);
  created(res, toDayDto(doc));
};

export const openDay = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<TransitionOperationsDay, never, IdParam>(req);
  const doc = await operationsDayService.transition(
    params.id,
    'open',
    body.version,
    authContext(req).userId,
  );
  ok(res, toDayDto(doc));
};

export const closeDay = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<TransitionOperationsDay, never, IdParam>(req);
  const doc = await operationsDayService.transition(
    params.id,
    'closed',
    body.version,
    authContext(req).userId,
  );
  ok(res, toDayDto(doc));
};
