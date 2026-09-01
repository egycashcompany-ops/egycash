// Thin HTTP mapping only (ADR-003). All arithmetic — km, expected reading, alarms — is the
// service's; nothing here computes (owner FL-4 point 3).
import { type Request, type Response } from 'express';
import {
  type CorrectFleetOdometer,
  type FleetOdometerBracketQuery,
  type FleetVehicleIdQuery,
  type ListFleetOdometerQuery,
  type RecordFleetOdometer,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toOdometerLogDto } from '../fleet.mappers';
import { fleetOdometerService } from './odometer.service';

type IdParam = { id: string };

export const listOdometerLogs = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetOdometerQuery>(req);
  const page = await fleetOdometerService.list(query);
  okPage(res, page, (doc) => toOdometerLogDto(doc, page.codes.get(String(doc.vehicleId)) ?? null));
};

export const recordOdometer = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetOdometer>(req);
  const { doc, vehicleCode } = await fleetOdometerService.record(body, authContext(req).userId);
  created(res, toOdometerLogDto(doc, vehicleCode));
};

export const expectedOdometerReading = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetVehicleIdQuery>(req);
  const expected = await fleetOdometerService.expectedReading(query.vehicleId);
  ok(res, {
    vehicleId: query.vehicleId,
    expectedReading: expected.reading,
    asOf: expected.asOf === null ? null : expected.asOf.toISOString(),
  });
};

/**
 * The bracket for one vehicle on one date.
 *
 * Exported from the ODOMETER module because the chain is what it answers about, and mounted on
 * two routers — the same two-doors-one-handler shape the alarm projection has. Its real audience
 * is the workshop:
 * the three maintenance dialogs ask it while somebody types a counter, and they must be able to
 * ask it under a maintenance permission rather than an odometer one, or the warning silently
 * disappears for exactly the people who type the number.
 */
export const odometerBracket = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetOdometerBracketQuery>(req);
  const bracket = await fleetOdometerService.bracket(query.vehicleId, query.on);
  ok(res, {
    vehicleId: query.vehicleId,
    on: query.on.toISOString(),
    lowerBound: bracket.lowerBound,
    lowerBoundAt: bracket.lowerBoundAt === null ? null : bracket.lowerBoundAt.toISOString(),
    upperBound: bracket.upperBound,
    upperBoundAt: bracket.upperBoundAt === null ? null : bracket.upperBoundAt.toISOString(),
  });
};

export const correctOdometer = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CorrectFleetOdometer, never, IdParam>(req);
  const { doc, vehicleCode } = await fleetOdometerService.correct(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toOdometerLogDto(doc, vehicleCode));
};
