// The ONE place Gold touches Fleet — the same single, reviewable import surface Operations uses
// for the same reason (`modules/operations/fleet-boundary.ts`).
//
// Gold needs exactly one fact from Fleet: which vehicle carried a shipment, so the receiving
// receipt can print its number (integration 1). READ-ONLY by contract — Gold resolves a vehicle
// through this export and never writes a Fleet collection. Anything beyond a read would go through
// a Fleet-owned service, never around it.
export { fleetVehicleRepository } from '../fleet/vehicles/vehicle.repository';
