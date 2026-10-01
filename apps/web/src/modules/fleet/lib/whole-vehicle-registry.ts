// The WHOLE vehicle registry, every page of it — «انا عاوز كل العربيات تكون موجوده فعلا».
//
// The registry's list endpoint answers at most `MAX_PAGE_SIZE` (100) cars a page. Every screen that
// offered «كود السيارة» from one page, or turned a row's vehicle id into its code through it,
// stopped at the hundredth car by code: the cars after it were not in the list at all, and a row
// filed against one of them showed «—». `fetchWholeCatalog` walks the pages; this names the
// question and keeps the cars in the fleet's own order.
import { compareFleetVehicleCodes, type FleetVehicleDto, type Paginated } from '@ecms/contracts';
import { fetchWholeCatalog } from './whole-catalog';
import { type FleetListParams } from '../api/fleet-api';

export const fetchWholeVehicleRegistry = async (
  listVehicles: (params: FleetListParams) => Promise<Paginated<FleetVehicleDto>>,
  anyStatus: boolean,
): Promise<Paginated<FleetVehicleDto>> => {
  const whole = await fetchWholeCatalog((page, pageSize) =>
    listVehicles({
      // Every lifecycle status for a HISTORICAL fact (an accident, a violation) that may name a car
      // disposed of since; the active cars only otherwise.
      ...(anyStatus ? {} : { status: 'active' }),
      page,
      pageSize,
      sortBy: 'code',
      sortDir: 'asc',
    }),
  );
  // The fleet's own order — 150 upward, then the cars written in words, then «الملاكى» below 150 —
  // which is what the server already applies to `sortBy: 'code'`; sorted again here so the pages
  // read as one list however they arrived.
  const items = [...whole.items].sort((a, b) => compareFleetVehicleCodes(a.code, b.code));
  return { ...whole, items };
};
