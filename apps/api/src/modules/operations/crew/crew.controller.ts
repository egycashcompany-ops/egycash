// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type OperationsCrewBoardQuery, type PlanOperationsCrew } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsCrewService } from './crew.service';

export const getCrewBoard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsCrewBoardQuery>(req);
  ok(res, await operationsCrewService.board(query.date));
};

export const planCrew = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PlanOperationsCrew>(req);
  const { changedCount } = await operationsCrewService.plan(body, authContext(req).userId);
  // A write answers with the refreshed board in the same round-trip (the roster convention).
  ok(res, { ...(await operationsCrewService.board(body.date)), changedCount });
};
