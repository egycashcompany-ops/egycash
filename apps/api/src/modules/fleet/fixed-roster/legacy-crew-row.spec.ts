// A fixed-crew row written BEFORE `missionTypeId` existed, mapped for the wire.
//
// The same trap `legacy-driver-row.spec.ts` guards on the driver registry, fired for real on this
// board. `.lean()` returns the stored BSON and a mongoose `default: null` is applied on WRITE, so
// a crew saved before the field existed has no `missionTypeId` key at all and arrives as
// `undefined`. The mapper tested `=== null`, so `undefined` failed that test and went to
// `String(undefined)` — the nine-character STRING `"undefined"`.
//
// What made it costly rather than merely untidy: that string travelled to the board DTO, where
// `?? null` cannot rescue it (it is an ordinary string), came back in the next save payload
// untouched, and the contract refused the whole save with
//
//   must be a 24-hex-char ObjectId (body.rows.1.missionTypeId)
//
// naming a row nobody had edited. The dispatcher could not save the board at all, and nothing on
// screen said why: the cell renders «—» for an unknown id, so the bad value was invisible.
//
// These assert the MAPPER, not the wording of any message: what the wire must carry for an absent
// field is `null`, and it must never be a string.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { snapshot } from './fixed-roster.service';
import { type FleetFixedCrewDoc } from './fixed-crew.model';

/**
 * Exactly the keys a pre-`missionTypeId` row has: the two late fields are ABSENT, not null.
 * Cast because that is precisely what `.lean<FleetFixedCrewDoc[]>()` does — an unchecked
 * assertion over raw BSON, which is why the type system never objected to the bug.
 */
const legacyRow = (over: Partial<Record<string, unknown>> = {}): FleetFixedCrewDoc =>
  ({
    _id: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(),
    driver1EmployeeId: new Types.ObjectId(),
    driver2EmployeeId: null,
    __v: 0,
    isDeleted: false,
    ...over,
  }) as unknown as FleetFixedCrewDoc;

describe('a fixed crew that predates the mission type', () => {
  it('maps instead of throwing — the board must still list the vehicle', () => {
    expect(() => snapshot(legacyRow())).not.toThrow();
  });

  it('reports the ABSENT mission type as null, never the string "undefined"', () => {
    // The whole defect, in one assertion.
    expect(snapshot(legacyRow()).missionTypeId).toBeNull();
    expect(snapshot(legacyRow()).missionTypeId).not.toBe('undefined');
  });

  it('reports an absent note as null too', () => {
    expect(snapshot(legacyRow()).notes).toBeNull();
  });

  it('never lets a NON-STRING become a string for any id field', () => {
    // Stated over every id field rather than the one that bit, because the next field added to
    // this collection inherits whatever this mapper does.
    const bare = snapshot(
      legacyRow({ driver1EmployeeId: undefined, driver2EmployeeId: undefined }),
    );
    for (const [field, value] of Object.entries(bare)) {
      expect(value === null || typeof value === 'string', `${field} is null or a string`).toBe(
        true,
      );
      expect(value, `${field} must not be the text "undefined"`).not.toBe('undefined');
      expect(value, `${field} must not be the text "null"`).not.toBe('null');
    }
  });

  it('still spells an EXPLICIT null as null — the ordinary modern row', () => {
    expect(snapshot(legacyRow({ missionTypeId: null, notes: null })).missionTypeId).toBeNull();
  });

  it('carries a REAL id through unchanged, in mongo’s own spelling', () => {
    const mission = new Types.ObjectId();
    const driver = new Types.ObjectId();
    const row = snapshot(legacyRow({ missionTypeId: mission, driver1EmployeeId: driver }));
    expect(row.missionTypeId).toBe(mission.toString());
    expect(row.driver1EmployeeId).toBe(driver.toString());
    // 24 hex characters — what the contract will accept on the way back in.
    expect(row.missionTypeId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('keeps its KEYS and their order — change detection is JSON.stringify over this object', () => {
    // Called out at the mapper: a key that appears or disappears makes every save look like a
    // change, which is how an audit trail fills with rewrites nobody made.
    expect(Object.keys(snapshot(legacyRow()))).toEqual([
      'missionTypeId',
      'driver1EmployeeId',
      'driver2EmployeeId',
      'notes',
    ]);
  });
});
