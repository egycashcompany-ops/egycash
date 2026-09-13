// The vehicle lifecycle (design §4.1) as a pure decision — testable without a database.
// `active` ⇄ `outOfService` ⇄ `disposed`: every state can be left.
//
// DISPOSAL USED TO BE TERMINAL, and its reversal is an OWNER DECISION rather than a bugfix.
// «مكهنة لازم ترجع نشطة تاني». The old rule was stated in six places and meant exactly what it
// said — a car keyed as disposed by mistake was disposed for good, and the only way back was a
// database edit. Nothing external ever required it: there is no retention rule, no audit rule and
// no legal note anywhere in docs/ that turns on disposal being final; it was a modelling choice,
// and the owner has made a different one.
//
// What did NOT change, deliberately: while a car IS disposed it stays read-only
// (`isVehicleWritable`), so its record cannot drift while it is out of the fleet. That is not a
// dead end any more — bring it back to `active` first, and every edit is available again.
import { type FleetVehicleStatus } from '@ecms/contracts';

const ALLOWED: Readonly<Record<FleetVehicleStatus, readonly FleetVehicleStatus[]>> = {
  active: ['outOfService', 'disposed'],
  outOfService: ['active', 'disposed'],
  // Back into service, and back into service only. A disposed car that returns is a car the fleet
  // is using again; if it then needs to be stood down, `active → outOfService` is one more step
  // and already allowed. Offering `disposed → outOfService` as well would let a car be "returned"
  // into a state it cannot be driven in, which is a distinction without a difference on the way
  // in and a confusing one on the way out.
  disposed: ['active'],
};

export const canTransitionVehicle = (from: FleetVehicleStatus, to: FleetVehicleStatus): boolean =>
  ALLOWED[from].includes(to);

/**
 * A disposed vehicle refuses every write except its own status change and a soft delete.
 *
 * Still true, and still deliberate: disposal never deleted anything — it sets the status and the
 * reason, and every reading, fine, accident and licence scan stays exactly where it was — but a
 * car that is out of the fleet should not be quietly edited while it is out. The way to edit one
 * is to bring it back.
 */
export const isVehicleWritable = (status: FleetVehicleStatus): boolean => status !== 'disposed';
