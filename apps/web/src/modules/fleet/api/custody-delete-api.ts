// «حذف العملية» and «العمليات المحذوفة» — the api/ surface (ADR-013), one typed function per
// endpoint:
//   DELETE /fleet/custody/fund/operations/:id   `{ reason, version }` → 204; a charge, a
//                                               replenishment (any status) or a settlement leaves
//                                               «سجل العهدة» and the fund's figures, softly
//   GET    /fleet/custody/fund/deleted          the deleted operations, newest delete first;
//                                               `from` / `to` are Cairo days of the delete
//   GET    /fleet/custody/fund/deleted/:id      one of them, for its drawer
import {
  type DeleteFleetCustodyOperation,
  type FleetCustodyOperationDto,
  type Paginated,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, type QueryParams } from '../../../shared/lib/api-client';

/** «حذف العملية» — nothing comes back (204); the log and the fund are read again. */
export const deleteCustodyOperation = (
  id: string,
  body: DeleteFleetCustodyOperation,
): Promise<void> => del<void>(`/fleet/custody/fund/operations/${id}`, body);

/** «العمليات المحذوفة» — each with its `deletion` and who recorded it. */
export const listCustodyDeleted = (
  params: QueryParams,
): Promise<Paginated<FleetCustodyOperationDto>> =>
  getPage<FleetCustodyOperationDto>(`/fleet/custody/fund/deleted${buildQuery(params)}`);

/** One deleted operation — its drawer in the deleted mode. */
export const custodyDeletedOperation = (id: string): Promise<FleetCustodyOperationDto> =>
  get<FleetCustodyOperationDto>(`/fleet/custody/fund/deleted/${id}`);
