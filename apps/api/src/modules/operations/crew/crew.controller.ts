// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ListOperationsCrewRequirementsQuery,
  type OperationsCrewBoardQuery,
  type OperationsCrewDirectoryQuery,
  type PlanOperationsCrew,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';
import { noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsCrewService } from './crew.service';
import {
  operationsCrewRequirementsService,
  toRequirementsDto,
} from './crew-requirements.service';

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

/** The board's pool for a day — who is on the roster, their flags, and who is already taken. */
export const getCrewDirectory = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsCrewDirectoryQuery>(req);
  ok(res, await operationsCrewRequirementsService.directory(query.date));
};

export const listCrewRequirements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsCrewRequirementsQuery>(req);
  okPage(res, await operationsCrewRequirementsService.list(query), toRequirementsDto);
};

export const setCrewRequirements = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<
    SetOperationsCrewRequirements,
    never,
    { employeeId: string }
  >(req);
  const doc = await operationsCrewRequirementsService.set(
    params.employeeId,
    body,
    authContext(req).userId,
  );
  ok(res, toRequirementsDto(doc));
};

export const removeCrewRequirements = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  await operationsCrewRequirementsService.remove(params.employeeId, authContext(req).userId);
  noContent(res);
};
