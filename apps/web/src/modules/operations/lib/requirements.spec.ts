// The roster screen's one decision: what a checkbox toggle sends.
//
// The endpoint upserts the WHOLE row — the legacy screen saved a checkbox LINE, not a single box —
// so a toggle must carry every other flag with it. Getting this wrong silently clears flags the
// operator did not touch, which is the kind of bug nobody notices until a report is wrong.
import { describe, expect, it } from 'vitest';
import { type OperationsCrewRequirementsDto } from '@ecms/contracts';
import { REQUIREMENT_FLAGS, toFlagPayload } from './requirements';

const existing = (over: Partial<OperationsCrewRequirementsDto> = {}): OperationsCrewRequirementsDto => ({
  id: 'r1',
  employeeId: 'e1',
  isCaptain: true,
  isSpecialist: false,
  hasWeapon: true,
  hasSignature: false,
  hasLicense: true,
  hasTemporaryLicense: false,
  isOpsAdmin: false,
  isNewJoiner: false,
  isAssignedSpecialTask: false,
  isPriority: false,
  notes: 'ملاحظة قائمة',
  version: 3,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('toFlagPayload', () => {
  it('sets the toggled flag', () => {
    expect(toFlagPayload(existing(), 'hasSignature', true).hasSignature).toBe(true);
  });

  it('carries every OTHER flag through unchanged', () => {
    const payload = toFlagPayload(existing(), 'hasSignature', true);
    expect(payload.isCaptain).toBe(true);
    expect(payload.hasWeapon).toBe(true);
    expect(payload.hasLicense).toBe(true);
    expect(payload.isSpecialist).toBe(false);
  });

  it('can turn a flag OFF as well as on', () => {
    expect(toFlagPayload(existing(), 'hasWeapon', false).hasWeapon).toBe(false);
  });

  it('preserves notes the screen does not edit', () => {
    expect(toFlagPayload(existing(), 'isPriority', true).notes).toBe('ملاحظة قائمة');
  });

  it('starts a member with no row from all-false, which is what an unticked line means', () => {
    const payload = toFlagPayload(null, 'isCaptain', true);
    expect(payload.isCaptain).toBe(true);
    for (const flag of REQUIREMENT_FLAGS) {
      if (flag !== 'isCaptain') expect(payload[flag]).toBe(false);
    }
    expect(payload.notes).toBeNull();
  });

  it('sends every flag the contract expects, so a partial save cannot drop one', () => {
    const payload = toFlagPayload(existing(), 'isNewJoiner', true);
    for (const flag of REQUIREMENT_FLAGS) {
      expect(payload).toHaveProperty(flag);
      expect(typeof payload[flag]).toBe('boolean');
    }
  });
});

describe('REQUIREMENT_FLAGS', () => {
  it('is the legacy nine plus the explicit specialist role (Q17)', () => {
    expect(REQUIREMENT_FLAGS).toHaveLength(10);
    expect(REQUIREMENT_FLAGS).toContain('isCaptain');
    expect(REQUIREMENT_FLAGS).toContain('isSpecialist');
  });

  it('has no duplicates', () => {
    expect(new Set(REQUIREMENT_FLAGS).size).toBe(REQUIREMENT_FLAGS.length);
  });
});
