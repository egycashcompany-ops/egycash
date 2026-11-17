// Thin HTTP mapping only (ADR-003). All arithmetic — km, expected reading, alarms — is the
// service's; nothing here computes (owner FL-4 point 3).
import { type Request, type Response } from 'express';
import {
  type CorrectFleetOdometer,
  type FleetOdometerBracketQuery,
  type FleetOdometerLogDto,
  type FleetOdometerSummaryQuery,
  type FleetVehicleIdQuery,
  type ListFleetOdometerQuery,
  type RecordFleetOdometer,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toOdometerLogDto } from '../fleet.mappers';
import { fleetOdometerService } from './odometer.service';
import { type FleetOdometerLogDoc } from './odometer.model';

type IdParam = { id: string };

/**
 * A row as every odometer answer sends it: the mapper's DTO plus the row's «فارق عداد الصيانة»,
 * which the service computed for it (D1/D7). The mapper's own `serviceGapKm: null` is only its
 * default — the list, a recorded reading and a corrected one all carry the computed value.
 */
const withGap = (
  doc: FleetOdometerLogDoc,
  vehicleCode: string | null,
  serviceGapKm: number | null,
): FleetOdometerLogDto => ({ ...toOdometerLogDto(doc, vehicleCode), serviceGapKm });

export const listOdometerLogs = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetOdometerQuery>(req);
  const page = await fleetOdometerService.list(query);
  okPage(res, page, (doc) =>
    withGap(
      doc,
      page.codes.get(String(doc.vehicleId)) ?? null,
      page.gaps.get(String(doc._id)) ?? null,
    ),
  );
};

/**
 * «إجمالي الكيلومترات» and «قراءات تحتاج مراجعة» over the register's own filters (R-14) — the same
 * filters the list takes, without its paging, so the total describes every row the list pages.
 */
export const odometerSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetOdometerSummaryQuery>(req);
  ok(res, await fleetOdometerService.summary(query));
};

export const recordOdometer = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetOdometer>(req);
  const { doc, vehicleCode, serviceGapKm } = await fleetOdometerService.record(
    body,
    authContext(req).userId,
  );
  created(res, withGap(doc, vehicleCode, serviceGapKm));
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
 * Every registry car's last reading (any status) — the car card's «آخر قراءة عداد». One answer
 * behind both the odometer's and the workshop's permission (`authorizeAny` on the route).
 */
export const listLatestReadings = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetOdometerService.latestReadingsOfFleet());
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
  const { doc, vehicleCode, serviceGapKm } = await fleetOdometerService.correct(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, withGap(doc, vehicleCode, serviceGapKm));
};

export const deleteOdometer = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetOdometerService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};
