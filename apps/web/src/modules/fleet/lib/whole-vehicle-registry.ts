// The WHOLE vehicle registry, every page of it — «انا عاوز كل العربيات تكون موجوده فعلا».
//
// The registry's list endpoint answers at most `MAX_PAGE_SIZE` (100) cars a page. Every screen that
// offered «كود السيارة» from one page, or turned a row's vehicle id into its code through it,
// stopped at the hundredth car by code: the cars after it were not in the list at all, and a row
// filed against one of them showed «—». `fetchWholeCatalog` walks the pages; this names the
// question and puts the cars in the order a reader counts them.
import { type FleetVehicleDto, type Paginated } from '@ecms/contracts';
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
  // «99» before «100», which the server's text order reverses.
  const items = [...whole.items].sort((a, b) =>
    a.code.localeCompare(b.code, 'en', { numeric: true }),
  );
  return { ...whole, items };
};
