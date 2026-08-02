import { describe, expect, it } from 'vitest';
import { canTransitionVehicle, isVehicleWritable } from './vehicle-status';

describe('vehicle lifecycle (§4.1)', () => {
  it('allows active ⇄ outOfService and either → disposed', () => {
    expect(canTransitionVehicle('active', 'outOfService')).toBe(true);
    expect(canTransitionVehicle('outOfService', 'active')).toBe(true);
    expect(canTransitionVehicle('active', 'disposed')).toBe(true);
    expect(canTransitionVehicle('outOfService', 'disposed')).toBe(true);
  });

  it('disposed is terminal — no way out, and not writable', () => {
    expect(canTransitionVehicle('disposed', 'active')).toBe(false);
    expect(canTransitionVehicle('disposed', 'outOfService')).toBe(false);
    expect(isVehicleWritable('disposed')).toBe(false);
    expect(isVehicleWritable('active')).toBe(true);
  });

  it('a no-op transition is not a transition', () => {
    expect(canTransitionVehicle('active', 'active')).toBe(false);
  });
});
