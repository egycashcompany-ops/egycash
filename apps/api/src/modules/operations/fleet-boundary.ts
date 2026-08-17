// The ONE place Operations touches Fleet — the frozen §9.4 boundary made a single, reviewable
// import surface (fleet-module-design.md §9.4: "OPS reads `fleet_duty_assignments` by date and
// attaches work orders to `assignmentId`; mission-type catalog is Fleet-owned, OPS-readable.
// Fleet never knows what the mission did.").
//
// READ-ONLY by contract: Operations resolves duty rows and vehicle codes through these exports
// and never writes a Fleet collection. Anything Operations needs beyond a read goes through a
// Fleet-owned service, never around it.
export { fleetDutyAssignmentRepository } from '../fleet/roster/duty-assignment.repository';
export { fleetVehicleRepository } from '../fleet/vehicles/vehicle.repository';
