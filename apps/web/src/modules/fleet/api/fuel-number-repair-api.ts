// «تصحيح أرقام الكروت» (6d) api/ surface (ADR-013): one typed function per endpoint.
//   GET  /fleet/fuel-cards/number-repair          the live dry run — `fleetFuelCard.view`; masked
//                                                 numbers only, never a PIN
//   POST /fleet/fuel-cards/number-repair/execute  { reviewed: true, units } — `fleetFuelCard.edit`
//                                                 and `fleetFuelCharge.approve`; each unit in its
//                                                 own transaction, re-checked at execution
import {
  type ExecuteFleetFuelNumberRepair,
  type FleetFuelNumberRepairDto,
  type FleetFuelNumberRepairResultDto,
} from '@ecms/contracts';
import { get, post } from '../../../shared/lib/api-client';

export const getNumberRepair = (): Promise<FleetFuelNumberRepairDto> =>
  get<FleetFuelNumberRepairDto>('/fleet/fuel-cards/number-repair');

export const executeNumberRepair = (
  body: ExecuteFleetFuelNumberRepair,
): Promise<FleetFuelNumberRepairResultDto> =>
  post<FleetFuelNumberRepairResultDto>('/fleet/fuel-cards/number-repair/execute', body);
