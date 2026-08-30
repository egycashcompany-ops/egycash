// The day board's mapper, held to the same rule as the fixed board's.
//
// Every field of `fleet_duty_assignments` shipped with the collection, so no stored row is
// missing one today — this is the trap being disarmed BEFORE it fires, not after. `findForDate`
// is a `.lean()` read, so the day a field is added to this collection every row written before
// it arrives as `undefined`; a mapper testing `=== null` would turn that into the string
// `"undefined"`, hand it to the board as a stored fact, and have the contract refuse the next
// save of a row nobody edited. That is exactly what happened on the fixed board.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { snapshot } from './roster.service';
import { type FleetDutyAssignmentDoc } from './duty-assignment.model';

const dutyRow = (over: Partial<Record<string, unknown>> = {}): FleetDutyAssignmentDoc =>
  ({
    _id: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(),
    date: new Date('2026-09-01T00:00:00.000Z'),
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    missionTypeId: null,
    notes: null,
    __v: 0,
    isDeleted: false,
    ...over,
  }) as unknown as FleetDutyAssignmentDoc;

describe('the day board maps a row the same way the fixed board does', () => {
  it('reports an ABSENT field as null, never the string "undefined"', () => {
    const bare = snapshot(
      dutyRow({ missionTypeId: undefined, driver1EmployeeId: undefined, notes: undefined }),
    );
    expect(bare.missionTypeId).toBeNull();
    expect(bare.driver1EmployeeId).toBeNull();
    expect(bare.notes).toBeNull();
    for (const [field, value] of Object.entries(bare)) {
      expect(value, `${field} must not be the text "undefined"`).not.toBe('undefined');
    }
  });

  it('spells an explicit null as null', () => {
    expect(snapshot(dutyRow()).missionTypeId).toBeNull();
    expect(snapshot(dutyRow()).notes).toBeNull();
  });

  it('carries a real id through unchanged', () => {
    const mission = new Types.ObjectId();
    expect(snapshot(dutyRow({ missionTypeId: mission })).missionTypeId).toBe(mission.toString());
  });

  it('keeps its keys and their order — change detection compares this object', () => {
    expect(Object.keys(snapshot(dutyRow()))).toEqual([
      'missionTypeId',
      'driver1EmployeeId',
      'driver2EmployeeId',
      'notes',
    ]);
  });
});
