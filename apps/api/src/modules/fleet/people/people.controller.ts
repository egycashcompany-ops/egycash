// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type FleetPeopleQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { fleetPeopleService } from './people.service';

export const listFleetPeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetPeopleQuery>(req);
  ok(res, await fleetPeopleService.list({ includeExited: query.includeExited === 'true' }));
};
