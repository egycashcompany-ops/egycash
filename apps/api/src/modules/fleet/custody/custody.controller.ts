// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type FleetCustodySummaryQuery,
  type ListFleetCustodyMovementsQuery,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { fleetCustodyService } from './custody.service';

export const custodySummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetCustodySummaryQuery>(req);
  ok(res, await fleetCustodyService.summary(query));
};

export const listCustodyMovements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetCustodyMovementsQuery>(req);
  okPage(res, await fleetCustodyService.movements(query), (row) => row);
};
