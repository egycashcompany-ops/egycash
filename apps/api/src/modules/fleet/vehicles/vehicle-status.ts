// The vehicle lifecycle (design §4.1) as a pure decision — testable without a database.
// `active` ⇄ `outOfService` → `disposed`; `disposed` is terminal. Reasons for leaving `active`
// are enforced by the input schema; this guards the TRANSITIONS.
import { type FleetVehicleStatus } from '@ecms/contracts';

const ALLOWED: Readonly<Record<FleetVehicleStatus, readonly FleetVehicleStatus[]>> = {
  active: ['outOfService', 'disposed'],
  outOfService: ['active', 'disposed'],
  disposed: [],
};

export const canTransitionVehicle = (from: FleetVehicleStatus, to: FleetVehicleStatus): boolean =>
  ALLOWED[from].includes(to);

/** Terminal states refuse every write except soft delete — a disposed vehicle is history. */
export const isVehicleWritable = (status: FleetVehicleStatus): boolean => status !== 'disposed';
