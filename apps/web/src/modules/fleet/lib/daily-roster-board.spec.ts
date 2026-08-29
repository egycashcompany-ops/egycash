// What a DAY'S draft means, tested without a DOM.
//
// The interaction needs a browser and is verified in one. These are the rules underneath it: what
// a drop does to the day, what the pool shows while the drag is still unsaved, and which rows a
// Save actually sends. They live here rather than in the page because a rule that can only be
// exercised by dragging a card is a rule the node suite cannot defend.
import { describe, expect, it } from 'vitest';
import { type FleetRosterRowDto } from '@ecms/contracts';
import {
  assignDriver,
  availableDrivers,
  changedRows,
  clearSlot,
  DUTY_SLOTS,
  findSeat,
  isDirty,
  setMission,
} from './daily-roster-board';

const row = (
  vehicleId: string,
  code: string,
  d1: string | null = null,
  d2: string | null = null,
  extra: Partial<FleetRosterRowDto> = {},
): FleetRosterRowDto => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  missionTypeId: null,
  driver1EmployeeId: d1,
  driver2EmployeeId: d2,
  notes: null,
  ...extra,
});

const BOARD = [row('v1', '150'), row('v2', '151')];
const crews = (rows: readonly FleetRosterRowDto[]): string[] =>
  rows.map((r) => `${r.code}:${r.driver1EmployeeId ?? '-'}/${r.driver2EmployeeId ?? '-'}`);
const ids = <T extends { employeeId: string }>(list: readonly T[]): string[] =>
  list.map((d) => d.employeeId);

describe('assignDriver — a drop on the day', () => {
  it('seats a driver in the slot the card was dropped on', () => {
    expect(crews(assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:e1/-',
      '151:-/-',
    ]);
    expect(crews(assignDriver(BOARD, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:-/e1',
      '151:-/-',
    ]);
  });

  it('SWAPS between the two slots of one car — the crew is the same two people', () => {
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:e2/e1',
      '151:-/-',
    ]);
  });

  it('RELEASES the vehicle a driver held before seating them on another — FR-7', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v2', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:e1/-',
    ]);
  });

  it('never seats one person on two vehicles for the date, whatever the drop', () => {
    for (const start of [
      [row('v1', '150', 'e1'), row('v2', '151')],
      [row('v1', '150'), row('v2', '151', 'e1', 'e2')],
      [row('v1', '150', 'e2'), row('v2', '151', 'e1')],
    ]) {
      for (const vehicleId of ['v1', 'v2']) {
        for (const slot of DUTY_SLOTS) {
          const seats = assignDriver(start, vehicleId, slot, 'e1')
            .flatMap((r) => [r.driver1EmployeeId, r.driver2EmployeeId])
            .filter((id) => id !== null);
          expect(new Set(seats).size, `${vehicleId}/${slot} duplicated somebody`).toBe(
            seats.length,
          );
        }
      }
    }
  });

  it('is a no-op when the driver is dropped back on the slot they already hold', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    const after = assignDriver(before, 'v1', 'driver1EmployeeId', 'e1');
    expect(isDirty(before, after)).toBe(false);
  });

  it('returns a NEW board and leaves the old one exactly as it was', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    const snapshot = crews(before);
    assignDriver(before, 'v2', 'driver1EmployeeId', 'e1');
    expect(crews(before)).toEqual(snapshot);
  });
});

// ── FR-5: the workshop takes precedence over the standing crew ─────────────
describe('a vehicle in maintenance', () => {
  const withWorkshop = [row('v1', '150', null, null, { inMaintenance: true }), row('v2', '151')];

  it('takes nobody — the drop changes nothing', () => {
    expect(crews(assignDriver(withWorkshop, 'v1', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:-/-',
    ]);
    expect(isDirty(withWorkshop, assignDriver(withWorkshop, 'v1', 'driver1EmployeeId', 'e1'))).toBe(
      false,
    );
  });

  it('does not release a driver seated elsewhere — a refused drop is not a move', () => {
    // The trap: releasing first and seating second would empty the source row and drop the driver
    // on the floor, so a refused drop would still cost the day a crew member.
    const before = [row('v1', '150', null, null, { inMaintenance: true }), row('v2', '151', 'e1')];
    expect(crews(assignDriver(before, 'v1', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:e1/-',
    ]);
  });

  it('still lets every OTHER vehicle be crewed', () => {
    expect(crews(assignDriver(withWorkshop, 'v2', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:e1/-',
    ]);
  });
});

// ── the pool: derived from the DRAFT, so it answers before any save ────────
describe('availableDrivers', () => {
  const pool = [{ employeeId: 'e1' }, { employeeId: 'e2' }, { employeeId: 'e3' }];

  it('offers everyone when the day seats nobody', () => {
    expect(ids(availableDrivers(pool, BOARD))).toEqual(['e1', 'e2', 'e3']);
  });

  it('takes a driver out the moment the DRAFT seats them — before any save', () => {
    const draft = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e2');
    expect(ids(availableDrivers(pool, draft))).toEqual(['e1', 'e3']);
  });

  it('gives them back the moment the slot is cleared', () => {
    const seated = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e2');
    const cleared = clearSlot(seated, 'v1', 'driver1EmployeeId');
    expect(ids(availableDrivers(pool, cleared))).toEqual(['e1', 'e2', 'e3']);
  });

  it('never flickers a driver back while MOVING between vehicles', () => {
    const seated = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e2');
    const moved = assignDriver(seated, 'v2', 'driver1EmployeeId', 'e2');
    expect(ids(availableDrivers(pool, moved))).toEqual(['e1', 'e3']);
  });

  it('cannot duplicate a card, because membership is COMPUTED not adjusted', () => {
    const seated = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e2');
    const swapped = assignDriver(seated, 'v1', 'driver2EmployeeId', 'e2');
    const list = ids(availableDrivers(pool, swapped));
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual(['e1', 'e3']);
  });

  it('counts BOTH slots', () => {
    const draft = [row('v1', '150', 'e1', 'e3'), row('v2', '151')];
    expect(ids(availableDrivers(pool, draft))).toEqual(['e2']);
  });

  it('does not mutate the server array it was given', () => {
    const draft = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e2');
    availableDrivers(pool, draft);
    expect(ids(pool)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('setMission', () => {
  it('points one vehicle at a mission and leaves the rest alone', () => {
    const after = setMission(BOARD, 'v1', 'm1');
    expect(after.map((r) => r.missionTypeId)).toEqual(['m1', null]);
  });

  it('clears it back to none', () => {
    const after = setMission(setMission(BOARD, 'v1', 'm1'), 'v1', null);
    expect(after.map((r) => r.missionTypeId)).toEqual([null, null]);
  });

  it('does not disturb the crew', () => {
    const before = [row('v1', '150', 'e1', 'e2')];
    expect(crews(setMission(before, 'v1', 'm1'))).toEqual(['150:e1/e2']);
  });
});

describe('findSeat', () => {
  it('answers where a driver sits, and null when they sit nowhere', () => {
    const board = [row('v1', '150', 'e1'), row('v2', '151', null, 'e2')];
    expect(findSeat(board, 'e2')).toEqual({ vehicleId: 'v2', slot: 'driver2EmployeeId' });
    expect(findSeat(board, 'e9')).toBeNull();
  });
});

// ── the save: only what the dispatcher actually changed ────────────────────
describe('changedRows — measured against the day the board arrived as', () => {
  it('sends nothing when nothing moved, so an untouched derived day stays unplanned', () => {
    // THE point of the derivation: opening tomorrow and saving must not write the standing crew
    // into `fleet_duty_assignments` as if somebody had planned it.
    const derived = [row('v1', '150', 'e1'), row('v2', '151', 'e2')];
    expect(changedRows(derived, derived)).toEqual([]);
    expect(isDirty(derived, derived)).toBe(false);
  });

  it('sends only the rows whose day differs', () => {
    const baseline = [row('v1', '150', 'e1'), row('v2', '151')];
    const draft = setMission(baseline, 'v2', 'm1');
    expect(changedRows(baseline, draft)).toEqual([
      {
        vehicleId: 'v2',
        missionTypeId: 'm1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('sends BOTH sides of a move, so the server can check FR-7 against the end state', () => {
    const baseline = [row('v1', '150', 'e1'), row('v2', '151')];
    const moved = assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e1');
    expect(
      changedRows(baseline, moved)
        .map((r) => r.vehicleId)
        .sort(),
    ).toEqual(['v1', 'v2']);
  });

  it('sends a cleared row, so emptying a derived crew is SAVED rather than ignored', () => {
    // Without this, "this car runs nobody today" would be unsaveable: the row would come back
    // from the fixed crew on every reload and the dispatcher could never say otherwise.
    const baseline = [row('v1', '150', 'e1')];
    const cleared = clearSlot(baseline, 'v1', 'driver1EmployeeId');
    expect(changedRows(baseline, cleared)).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('measures over all four editable facts — a mission edited alone still travels', () => {
    const baseline = [row('v1', '150', 'e1')];
    expect(changedRows(baseline, setMission(baseline, 'v1', 'm1'))).toHaveLength(1);
  });

  it('sends the four editable facts and nothing else — the vehicle facts are not the payload', () => {
    const baseline = [row('v1', '150')];
    const draft = assignDriver(baseline, 'v1', 'driver1EmployeeId', 'e1');
    expect(Object.keys(changedRows(baseline, draft)[0] ?? {}).sort()).toEqual([
      'driver1EmployeeId',
      'driver2EmployeeId',
      'missionTypeId',
      'notes',
      'vehicleId',
    ]);
  });

  it('accumulates several edits into ONE payload — the draft is not saved a change at a time', () => {
    const baseline = [row('v1', '150'), row('v2', '151')];
    let draft = assignDriver(baseline, 'v1', 'driver1EmployeeId', 'e1');
    draft = assignDriver(draft, 'v2', 'driver1EmployeeId', 'e2');
    draft = setMission(draft, 'v1', 'm1');
    expect(isDirty(baseline, draft)).toBe(true);
    expect(changedRows(baseline, draft)).toHaveLength(2);
    expect(changedRows(baseline, draft).find((r) => r.vehicleId === 'v1')).toEqual({
      vehicleId: 'v1',
      missionTypeId: 'm1',
      driver1EmployeeId: 'e1',
      driver2EmployeeId: null,
      notes: null,
    });
  });

  it('reads both boards without touching either', () => {
    const baseline = [row('v1', '150', 'e1')];
    const draft = clearSlot(baseline, 'v1', 'driver1EmployeeId');
    const a = crews(baseline);
    const b = crews(draft);
    changedRows(baseline, draft);
    expect(crews(baseline)).toEqual(a);
    expect(crews(draft)).toEqual(b);
  });
});
