// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type SetOperationsStandingCrew } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsStandingCrewService } from './standing-crew.service';

export const getStandingCrew = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await operationsStandingCrewService.board());
};

export const setStandingCrew = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SetOperationsStandingCrew>(req);
  const { changedCount } = await operationsStandingCrewService.save(
    body,
    authContext(req).userId,
  );
  // A write answers with the refreshed board in the same round-trip (the roster convention).
  ok(res, { ...(await operationsStandingCrewService.board()), changedCount });
};

export const removeStandingCrew = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { vehicleId: string }>(req);
  await operationsStandingCrewService.remove(params.vehicleId, authContext(req).userId);
  // The refreshed board rather than 204: removing a vehicle moves it into `available`, and the
  // client would have to refetch to learn that anyway.
  ok(res, await operationsStandingCrewService.board());
};
