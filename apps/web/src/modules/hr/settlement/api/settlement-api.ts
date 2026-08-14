// Final settlement api/ surface (ADR-013 — P-HR-11).
//
// ONE function, and there is no second one coming. The settlement summary is a read: everything on
// it was decided by another feature, and every act that would change an amount — approving an
// adjustment, recording a repayment, freezing the run — already has its own screen. A write here
// would be a second way to do something that already has one.
import { type EmployeeSettlementDto, type Paginated, type SettlementQueueRowDto } from '@ecms/contracts';
import { buildQuery, get, getPage, type QueryParams } from '../../../../shared/lib/api-client';

export const getEmployeeSettlement = (employeeId: string): Promise<EmployeeSettlementDto> =>
  get<EmployeeSettlementDto>(`/hr/employees/${employeeId}/settlement`);

/**
 * The queue (P-HR-17) — who has left and has not been settled.
 *
 * The other direction of the same question: the read above needs a name to start from, this one
 * produces the names. Note what a row does NOT carry — no balance and no final pay — so nothing on
 * this list can disagree with the settlement screen it links to.
 */
export const listSettlementQueue = (params: QueryParams): Promise<Paginated<SettlementQueueRowDto>> =>
  getPage<SettlementQueueRowDto>(`/hr/employees/settlement-queue${buildQuery(params)}`);
