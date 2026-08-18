// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ListOperationsCrewRequirementsQuery,
  type OperationsCrewBoardQuery,
  type OperationsCrewAttendanceQuery,
  type OperationsCrewDirectoryQuery,
  type PlanOperationsCrew,
  type SeedOperationsCrewFromStanding,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';
import { noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsCrewService } from './crew.service';
import { operationsStandingCrewService } from '../standing-crew/standing-crew.service';
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

/**
 * Put the standing crew onto this day's board — الطاقم الثابت ينزل في التشغيلة.
 *
 * Answers with the refreshed board AND the report of what was declined, in one round trip. The
 * report is not decoration: the seed skips vehicles for three different reasons and drops people
 * for three more, and a screen that showed only the result would present a half-planned day as a
 * finished one.
 */
export const seedCrewFromStanding = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SeedOperationsCrewFromStanding>(req);
  const report = await operationsStandingCrewService.seedDay(body.date, authContext(req).userId);
  ok(res, { ...(await operationsCrewService.board(body.date)), seed: report });
};

/** The board's pool for a day — who is on the roster, their flags, and who is already taken. */
export const getCrewDirectory = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsCrewDirectoryQuery>(req);
  ok(res, await operationsCrewRequirementsService.directory(query.date));
};

export const getCrewAttendance = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsCrewAttendanceQuery>(req);
  ok(res, await operationsCrewRequirementsService.attendance(query.date));
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
