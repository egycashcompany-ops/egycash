// «إجمالي الكيلومترات» and «قراءات تحتاج مراجعة» for the odometer register (fleet dashboard R-14).
//
// `GET /fleet/odometer/summary` takes the register's FILTERS — the same object the list is asked
// with, less its paging and order — and answers the total over every matching row, not one page.
// The server applies the rule (valid closed rows only; negative ones counted apart); the screen
// only prints the two numbers. The dashboard's period total links here and is counted the same way.
import { useQuery } from '@tanstack/react-query';
import { type FleetOdometerSummaryDto } from '@ecms/contracts';
import { buildQuery, get } from '../../../shared/lib/api-client';

/** The register's filters as the page sends them — every key optional, lists comma-joined on the wire. */
export interface OdometerSummaryParams {
  vehicleId?: string | undefined;
  vehicleCodes?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  alerts?: string[] | undefined;
  driverEmployeeIds?: string[] | undefined;
  notes?: string | undefined;
  typeIds?: string[] | undefined;
  operationIds?: string[] | undefined;
  branchIds?: string[] | undefined;
}

export const getOdometerSummary = (
  params: OdometerSummaryParams,
): Promise<FleetOdometerSummaryDto> =>
  get<FleetOdometerSummaryDto>(`/fleet/odometer/summary${buildQuery({ ...params })}`);

/**
 * Under the register's own key (`['fleet', 'odometer']`), so recording, correcting or deleting a
 * reading — and the realtime signal for one — refreshes the total with the rows it describes.
 */
export const odometerSummaryKey = (params: OdometerSummaryParams): readonly unknown[] => [
  'fleet',
  'odometer',
  'summary',
  params,
];

export const useOdometerSummary = (params: OdometerSummaryParams, enabled = true) =>
  useQuery({
    queryKey: odometerSummaryKey(params),
    queryFn: () => getOdometerSummary(params),
    // The previous total stays while the next filter is asked, as the table keeps its rows.
    placeholderData: (prev) => prev,
    enabled,
  });
