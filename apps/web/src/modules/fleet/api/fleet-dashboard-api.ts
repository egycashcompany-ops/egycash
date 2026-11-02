// «لوحة تحكم الحركة» — the dashboard's two reads (plan §5.1, D15).
//
//   R1 `GET /fleet/dashboard/now`    — no query; the branch travels as X-Active-Branch, like every read.
//   R2 `GET /fleet/dashboard/period` — the period and the vehicle set (`FleetDashboardPeriodQuery`).
//
// Each answers only the sections its reader may see (null otherwise) and names the sections whose
// source failed in `unavailable`. Nothing here computes a figure.
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodQuery,
} from '@ecms/contracts';
import { buildQuery, get } from '../../../shared/lib/api-client';

export const getFleetDashboardNow = (): Promise<FleetDashboardNowDto> =>
  get<FleetDashboardNowDto>('/fleet/dashboard/now');

export const getFleetDashboardPeriod = (
  query: FleetDashboardPeriodQuery,
): Promise<FleetDashboardPeriodDto> =>
  get<FleetDashboardPeriodDto>(
    `/fleet/dashboard/period${buildQuery({
      preset: query.preset,
      from: query.from,
      to: query.to,
      typeIds: query.typeIds,
      operationIds: query.operationIds,
      vehicleCodes: query.vehicleCodes,
    })}`,
  );
