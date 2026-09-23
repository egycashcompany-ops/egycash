// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { ok } from '../../../platform/web';
import { fleetPeopleService } from './people.service';

export const listFleetPeople = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetPeopleService.list());
};
