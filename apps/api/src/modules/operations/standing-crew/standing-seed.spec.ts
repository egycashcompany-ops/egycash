// The descent, tested exhaustively — because this is the rule that can overwrite a real morning.
//
// The endpoint around it needs mongod and therefore only runs in CI. The RULE does not, so it is
// pinned here: every skip reason, every drop reason, the veto, idempotence, and the two cases
// where seeding would actively damage the day rather than merely fail to help it.
import { describe, expect, it } from 'vitest';
import { planStandingSeed, type StandingSeedInput, type StandingSeedSource } from './standing-seed';

const source = (over: Partial<StandingSeedSource> = {}): StandingSeedSource => ({
  vehicleId: 'v1',
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  ...over,
});

const plan = (over: Partial<StandingSeedInput> = {}) =>
  planStandingSeed({
    standing: [],
    rosteredVehicleIds: new Set(),
    plannedVehicleIds: new Set(),
    takenBy: new Map(),
    unavailable: new Map(),
    ...over,
  });

/** The ordinary case: one vehicle, rostered, unplanned, with a full standing crew. */
const ordinary = (over: Partial<StandingSeedInput> = {}) =>
  plan({
    standing: [
      source({
        captainEmployeeIds: ['cap1', 'cap2'],
        specialist1EmployeeIds: ['s1'],
        specialist2EmployeeIds: ['s2'],
        direction: 'الجيزة',
        plannedTime: '07:30',
      }),
    ],
    rosteredVehicleIds: new Set(['v1']),
    ...over,
  });

describe('the ordinary descent', () => {
  it('carries the whole standing crew onto the day, direction and time included', () => {
    const result = ordinary();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.captainEmployeeIds).toEqual(['cap1', 'cap2']);
    expect(result.rows[0]?.specialist1EmployeeIds).toEqual(['s1']);
    expect(result.rows[0]?.specialist2EmployeeIds).toEqual(['s2']);
    expect(result.rows[0]?.direction).toBe('الجيزة');
    expect(result.rows[0]?.plannedTime).toBe('07:30');
    expect(result.skipped).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('never carries a note — a note belongs to the day somebody writes it on', () => {
    expect(ordinary().rows[0]?.notes).toBeNull();
  });

  it('reports what it seeded by vehicle, so the caller can say what happened', () => {
    expect(ordinary().rows.map((r) => r.vehicleId)).toEqual(['v1']);
  });
});

describe('the veto — a vehicle that already has a crew row is never touched', () => {
  it('skips it entirely rather than merging into it', () => {
    const result = ordinary({ plannedVehicleIds: new Set(['v1']) });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ vehicleId: 'v1', reason: 'alreadyPlanned' }]);
  });

  it('does NOT top up a row whose slots were deliberately emptied', () => {
    // THE CASE THE WHOLE DESIGN TURNS ON. `plan()` has no delete path, so a captain taken off sick
    // this morning is stored as an empty list — byte-identical to "never filled". A field-level
    // merge would put him back on the vehicle every morning, and nothing on the row could tell the
    // two apart. Row existence is the only durable signal, so the row is what the veto is keyed on.
    const result = ordinary({ plannedVehicleIds: new Set(['v1']) });
    expect(result.rows).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('is idempotent: re-running after a seed finds every vehicle planned and writes nothing', () => {
    const first = ordinary();
    const again = ordinary({
      plannedVehicleIds: new Set(first.rows.map((r) => r.vehicleId)),
    });
    expect(again.rows).toEqual([]);
    expect(again.skipped).toEqual([{ vehicleId: 'v1', reason: 'alreadyPlanned' }]);
  });
});

describe('the Fleet roster bounds the seed', () => {
  it('skips a vehicle Fleet did not roster for the date', () => {
    // `plan()` would refuse it with OPERATIONS_FLEET_DUTY_REQUIRED and take the whole seed down.
    // A vehicle sitting in the yard today is normal, not an error.
    const result = ordinary({ rosteredVehicleIds: new Set() });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ vehicleId: 'v1', reason: 'notRostered' }]);
  });

  it('seeds the rostered vehicles and reports the rest, rather than failing the lot', () => {
    const result = plan({
      standing: [
        source({ vehicleId: 'v1', captainEmployeeIds: ['cap1'] }),
        source({ vehicleId: 'v2', captainEmployeeIds: ['cap2'] }),
      ],
      rosteredVehicleIds: new Set(['v1']),
    });
    expect(result.rows.map((r) => r.vehicleId)).toEqual(['v1']);
    expect(result.skipped).toEqual([{ vehicleId: 'v2', reason: 'notRostered' }]);
  });

  it('reports "already planned" ahead of "not rostered" — the first true reason is the useful one', () => {
    const result = ordinary({
      rosteredVehicleIds: new Set(),
      plannedVehicleIds: new Set(['v1']),
    });
    expect(result.skipped).toEqual([{ vehicleId: 'v1', reason: 'alreadyPlanned' }]);
  });
});

describe('people the day cannot take', () => {
  it('drops someone who has exited, and seeds the rest of the crew anyway', () => {
    // Failing a whole morning's seed because one person left in March is not a useful answer.
    const result = ordinary({ unavailable: new Map([['cap1', 'exited']]) });
    expect(result.rows[0]?.captainEmployeeIds).toEqual(['cap2']);
    expect(result.dropped).toEqual([{ employeeId: 'cap1', vehicleId: 'v1', reason: 'exited' }]);
  });

  it('drops someone who no longer resolves in the directory at all', () => {
    const result = ordinary({ unavailable: new Map([['s1', 'unknown']]) });
    expect(result.rows[0]?.specialist1EmployeeIds).toEqual([]);
    expect(result.dropped).toEqual([{ employeeId: 's1', vehicleId: 'v1', reason: 'unknown' }]);
  });

  it("drops someone already crewed on ANOTHER vehicle today — Q11 beats the standing crew", () => {
    // Somebody moved this person by hand after the standing crew was written. The day's plan is
    // the more recent and more specific statement, and `plan()` would refuse the seed over it.
    const result = ordinary({ takenBy: new Map([['cap1', 'v9']]) });
    expect(result.rows[0]?.captainEmployeeIds).toEqual(['cap2']);
    expect(result.dropped).toEqual([
      { employeeId: 'cap1', vehicleId: 'v1', reason: 'takenElsewhere' },
    ]);
  });

  it('does NOT drop someone already held on the SAME vehicle', () => {
    // Unreachable while the veto holds — a planned vehicle is skipped before we get here — but the
    // rule is "held elsewhere", not "held", and the two must not be confused.
    const result = ordinary({ takenBy: new Map([['cap1', 'v1']]) });
    expect(result.rows[0]?.captainEmployeeIds).toEqual(['cap1', 'cap2']);
    expect(result.dropped).toEqual([]);
  });

  it('keeps the surviving occupants in their original order', () => {
    const result = ordinary({ unavailable: new Map([['cap1', 'exited']]) });
    expect(result.rows[0]?.captainEmployeeIds).toEqual(['cap2']);
  });
});

describe('a row with nothing left to seed', () => {
  it('skips a standing row that has nobody on it', () => {
    const result = plan({
      standing: [source({ direction: 'الجيزة', plannedTime: '07:30' })],
      rosteredVehicleIds: new Set(['v1']),
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ vehicleId: 'v1', reason: 'noCrewToSeed' }]);
  });

  it('refuses to seed direction and time alone — the empty row would become a veto', () => {
    // Seeding a crewless row is actively harmful, not merely useless: the row would EXIST, and its
    // existence blocks every later seed of this vehicle-day while carrying nobody.
    const result = plan({
      standing: [source({ direction: 'بنها', plannedTime: '06:00' })],
      rosteredVehicleIds: new Set(['v1']),
    });
    expect(result.rows).toEqual([]);
  });

  it('skips a row whose entire crew was dropped, and still reports every drop', () => {
    const result = plan({
      standing: [source({ captainEmployeeIds: ['cap1'], specialist1EmployeeIds: ['s1'] })],
      rosteredVehicleIds: new Set(['v1']),
      unavailable: new Map([
        ['cap1', 'exited'],
        ['s1', 'unknown'],
      ]),
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ vehicleId: 'v1', reason: 'noCrewToSeed' }]);
    expect(result.dropped).toHaveLength(2);
  });
});

describe('an empty standing crew', () => {
  it('plans nothing and reports nothing — the caller must then call no writer at all', () => {
    // The service checks `rows.length` before calling `plan()`, because `plan()` emits
    // `operations.crew.planned` on every invocation and the automation bridge starts a run per
    // envelope. A no-op seed that still called it would manufacture a run every morning.
    const result = plan();
    expect(result).toEqual({ rows: [], skipped: [], dropped: [] });
  });
});

describe('the whole fleet at once', () => {
  it('sorts each vehicle into exactly one outcome, and loses none of them', () => {
    const result = plan({
      standing: [
        source({ vehicleId: 'v1', captainEmployeeIds: ['a'] }), // seeded
        source({ vehicleId: 'v2', captainEmployeeIds: ['b'] }), // already planned
        source({ vehicleId: 'v3', captainEmployeeIds: ['c'] }), // not rostered
        source({ vehicleId: 'v4' }), // nobody on it
        source({ vehicleId: 'v5', captainEmployeeIds: ['e'] }), // everyone unavailable
      ],
      rosteredVehicleIds: new Set(['v1', 'v2', 'v4', 'v5']),
      plannedVehicleIds: new Set(['v2']),
      unavailable: new Map([['e', 'exited']]),
    });
    expect(result.rows.map((r) => r.vehicleId)).toEqual(['v1']);
    expect(result.skipped).toEqual([
      { vehicleId: 'v2', reason: 'alreadyPlanned' },
      { vehicleId: 'v3', reason: 'notRostered' },
      { vehicleId: 'v4', reason: 'noCrewToSeed' },
      { vehicleId: 'v5', reason: 'noCrewToSeed' },
    ]);
    // Every vehicle is accounted for exactly once — nothing is silently absorbed.
    const accounted = [...result.rows.map((r) => r.vehicleId), ...result.skipped.map((s) => s.vehicleId)];
    expect(accounted.sort()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
  });

  it('never produces a payload that breaks Q11 across its own rows', () => {
    // The standing crew already forbids one person on two vehicles, so the payload cannot conflict
    // with itself — and everyone held elsewhere today is dropped, so it cannot conflict with the
    // day either. `plan()` would refuse the whole seed over either, which is why both are handled
    // before it is called.
    const result = plan({
      standing: [
        source({ vehicleId: 'v1', captainEmployeeIds: ['a'] }),
        source({ vehicleId: 'v2', captainEmployeeIds: ['b'] }),
      ],
      rosteredVehicleIds: new Set(['v1', 'v2']),
      takenBy: new Map([['b', 'v9']]),
    });
    const everyone = result.rows.flatMap((r) => [
      ...(r.captainEmployeeIds ?? []),
      ...(r.specialist1EmployeeIds ?? []),
      ...(r.specialist2EmployeeIds ?? []),
    ]);
    expect(new Set(everyone).size).toBe(everyone.length);
    expect(everyone).not.toContain('b');
  });
});
