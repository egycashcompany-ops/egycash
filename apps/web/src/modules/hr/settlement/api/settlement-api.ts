// Final settlement api/ surface (ADR-013 — P-HR-11).
//
// ONE function, and there is no second one coming. The settlement summary is a read: everything on
// it was decided by another feature, and every act that would change an amount — approving an
// adjustment, recording a repayment, freezing the run — already has its own screen. A write here
// would be a second way to do something that already has one.
import { type EmployeeSettlementDto } from '@ecms/contracts';
import { get } from '../../../../shared/lib/api-client';

export const getEmployeeSettlement = (employeeId: string): Promise<EmployeeSettlementDto> =>
  get<EmployeeSettlementDto>(`/hr/employees/${employeeId}/settlement`);
