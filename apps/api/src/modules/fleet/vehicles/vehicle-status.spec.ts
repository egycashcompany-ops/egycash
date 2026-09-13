import { describe, expect, it } from 'vitest';
import { canTransitionVehicle, isVehicleWritable } from './vehicle-status';

describe('vehicle lifecycle (§4.1)', () => {
  it('allows active ⇄ outOfService and either → disposed', () => {
    expect(canTransitionVehicle('active', 'outOfService')).toBe(true);
    expect(canTransitionVehicle('outOfService', 'active')).toBe(true);
    expect(canTransitionVehicle('active', 'disposed')).toBe(true);
    expect(canTransitionVehicle('outOfService', 'disposed')).toBe(true);
  });

  it('a disposed vehicle comes BACK — into service, and only into service', () => {
    // Disposal used to be terminal, and its reversal is an owner decision: «مكهنة لازم ترجع نشطة
    // تاني». A car keyed as disposed by mistake had no way back short of a database edit, and
    // nothing external ever required that — there is no retention, audit or legal rule anywhere
    // in docs/ that turns on disposal being final.
    expect(canTransitionVehicle('disposed', 'active')).toBe(true);
    // Into SERVICE, not into another kind of absence. A car that returns is a car the fleet is
    // using; standing it down again is `active → outOfService`, one more step that already works.
    expect(canTransitionVehicle('disposed', 'outOfService')).toBe(false);
  });

  it('but stays read-only WHILE it is disposed — the way back is the status, not an edit', () => {
    // Unchanged, and deliberately: disposal never deleted anything (it sets the status and the
    // reason; every reading, fine, accident and licence scan stays), but a car out of the fleet
    // should not drift while it is out. That is no longer a dead end — bring it back first.
    expect(isVehicleWritable('disposed')).toBe(false);
    expect(isVehicleWritable('active')).toBe(true);
    expect(isVehicleWritable('outOfService')).toBe(true);
  });

  it('a no-op transition is not a transition', () => {
    expect(canTransitionVehicle('active', 'active')).toBe(false);
  });
});
