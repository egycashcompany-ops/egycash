// What a DROP means, tested without a DOM.
//
// The interaction needs a browser and is verified in one. These are the rules underneath it —
// the two the server enforces, and the difference calculation the save depends on — and they are
// here rather than inside the page because a rule that can only be exercised by dragging a card
// is a rule the node suite cannot defend.
import { describe, expect, it } from 'vitest';
import { type FleetFixedCrewRowDto } from '@ecms/contracts';
import { assignDriver, changedRows, clearSlot, findSeat, isDirty } from './fixed-roster-board';

const row = (
  vehicleId: string,
  code: string,
  d1: string | null = null,
  d2: string | null = null,
): FleetFixedCrewRowDto => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  driver1EmployeeId: d1,
  driver2EmployeeId: d2,
});

const BOARD = [row('v1', '150'), row('v2', '151')];
const crews = (rows: readonly FleetFixedCrewRowDto[]): string[] =>
  rows.map((r) => `${r.code}:${r.driver1EmployeeId ?? '-'}/${r.driver2EmployeeId ?? '-'}`);

describe('assignDriver', () => {
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

  it('leaves every other row alone', () => {
    const after = assignDriver(
      [row('v1', '150'), row('v2', '151', 'e9')],
      'v1',
      'driver1EmployeeId',
      'e1',
    );
    expect(crews(after)).toEqual(['150:e1/-', '151:e9/-']);
  });

  // ── rule 1: one person, one slot of a car ─────────────────────────────────

  it('MOVES between the two slots of one car rather than duplicating', () => {
    // Dropping the first driver onto the second slot of the same car is a move. Holding both
    // slots is a board the server refuses outright ("the two driver slots cannot hold the same
    // person"), so the UI must never propose it.
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:-/e1',
      '151:-/-',
    ]);
  });

  it('never lets one person occupy both slots, from any starting point', () => {
    for (const start of [
      [row('v1', '150', 'e1'), row('v2', '151')],
      [row('v1', '150', null, 'e1'), row('v2', '151')],
      [row('v1', '150'), row('v2', '151', 'e1')],
    ]) {
      for (const slot of ['driver1EmployeeId', 'driver2EmployeeId'] as const) {
        const after = assignDriver(start, 'v1', slot, 'e1');
        for (const r of after) {
          const both = r.driver1EmployeeId !== null && r.driver1EmployeeId === r.driver2EmployeeId;
          expect(both, `${r.code} holds e1 twice`).toBe(false);
        }
      }
    }
  });

  // ── rule 2: one driver, one crew ──────────────────────────────────────────

  it('RELEASES the car a driver was fixed to before seating them on another', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v2', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:e1/-',
    ]);
  });

  it('leaves the released car in the payload, so the save sends both sides of a move', () => {
    // This is what keeps the server's exclusivity check satisfiable: it refuses a payload that
    // claims a driver some row OUTSIDE the payload still holds.
    const saved = [row('v1', '150', 'e1'), row('v2', '151')];
    const moved = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e1');
    expect(
      changedRows(saved, moved)
        .map((r) => r.vehicleId)
        .sort(),
    ).toEqual(['v1', 'v2']);
  });

  it('replaces whoever was already in the slot', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver1EmployeeId', 'e2'))).toEqual([
      '150:e2/-',
      '151:-/-',
    ]);
  });

  it('is a no-op when the driver is dropped back on the slot they already hold', () => {
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    const after = assignDriver(before, 'v1', 'driver1EmployeeId', 'e1');
    expect(crews(after)).toEqual(crews(before));
    expect(changedRows(before, after)).toEqual([]);
  });
});

// ── the audit: a drop must not damage what it was given ────────────────────

describe('nothing is mutated in place', () => {
  // The page keeps TWO boards: the one the server last confirmed, and the draft the drags edit.
  // If a drop mutated the saved array, "reload before saving" would silently keep the unsaved
  // edit, and the dirty check would compare a board with itself and report no changes at all.
  const frozen = () => [row('v1', '150', 'e1'), row('v2', '151')];

  it('assignDriver returns a NEW board and leaves the old one exactly as it was', () => {
    const saved = frozen();
    const snapshot = JSON.stringify(saved);
    const next = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e1');
    expect(JSON.stringify(saved), 'the saved board is untouched').toBe(snapshot);
    expect(next).not.toBe(saved);
    // Not one row object is shared, or a later edit would reach through into the saved board.
    for (const r of next) expect(saved.includes(r), `${r.code} is a fresh object`).toBe(false);
  });

  it('clearSlot leaves the old board alone too', () => {
    const saved = frozen();
    const snapshot = JSON.stringify(saved);
    clearSlot(saved, 'v1', 'driver1EmployeeId');
    expect(JSON.stringify(saved)).toBe(snapshot);
  });

  it('changedRows reads both boards without touching either', () => {
    const saved = frozen();
    const draft = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e1');
    const a = JSON.stringify(saved);
    const b = JSON.stringify(draft);
    changedRows(saved, draft);
    expect(JSON.stringify(saved)).toBe(a);
    expect(JSON.stringify(draft)).toBe(b);
  });

  it('never invents, drops or reorders a vehicle — a drop moves a REFERENCE, nothing else', () => {
    const saved = frozen();
    const next = assignDriver(saved, 'v2', 'driver2EmployeeId', 'e1');
    expect(next.map((r) => r.vehicleId)).toEqual(saved.map((r) => r.vehicleId));
    // Every non-crew fact of every row survives the drop untouched.
    for (const [i, r] of next.entries()) {
      const was = saved[i] as (typeof saved)[number];
      expect({ code: r.code, plate: r.plateNumber, type: r.typeId, wip: r.inMaintenance }).toEqual({
        code: was.code,
        plate: was.plateNumber,
        type: was.typeId,
        wip: was.inMaintenance,
      });
    }
  });
});

describe('clearSlot', () => {
  it('empties one slot and touches nothing else', () => {
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151', 'e3')];
    expect(crews(clearSlot(before, 'v1', 'driver1EmployeeId'))).toEqual(['150:-/e2', '151:e3/-']);
  });
});

describe('findSeat', () => {
  it('answers where a driver sits, and null when they sit nowhere', () => {
    const board = [row('v1', '150', 'e1'), row('v2', '151', null, 'e2')];
    expect(findSeat(board, 'e1')).toEqual({ vehicleId: 'v1', slot: 'driver1EmployeeId' });
    expect(findSeat(board, 'e2')).toEqual({ vehicleId: 'v2', slot: 'driver2EmployeeId' });
    expect(findSeat(board, 'e3')).toBeNull();
  });
});

describe('changedRows', () => {
  it('sends nothing when nothing moved', () => {
    expect(changedRows(BOARD, BOARD)).toEqual([]);
    expect(isDirty(BOARD, BOARD)).toBe(false);
  });

  it('sends only the rows whose crew differs', () => {
    const next = assignDriver(BOARD, 'v2', 'driver1EmployeeId', 'e1');
    expect(changedRows(BOARD, next)).toEqual([
      { vehicleId: 'v2', driver1EmployeeId: 'e1', driver2EmployeeId: null },
    ]);
    expect(isDirty(BOARD, next)).toBe(true);
  });

  it('sends a cleared row, so emptying a crew is saved rather than ignored', () => {
    const saved = [row('v1', '150', 'e1')];
    expect(changedRows(saved, clearSlot(saved, 'v1', 'driver1EmployeeId'))).toEqual([
      { vehicleId: 'v1', driver1EmployeeId: null, driver2EmployeeId: null },
    ]);
  });

  it('ignores a row the saved board never had and that still holds nobody', () => {
    // Sending it would ask the server to create a record of a crew that never existed.
    expect(changedRows([], [row('v9', '999')])).toEqual([]);
  });

  it('carries a brand-new row that DOES hold somebody', () => {
    expect(changedRows([], [row('v9', '999', 'e1')])).toEqual([
      { vehicleId: 'v9', driver1EmployeeId: 'e1', driver2EmployeeId: null },
    ]);
  });

  it('sends the crew and nothing else — the vehicle facts are not the payload', () => {
    const next = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e1');
    expect(Object.keys(changedRows(BOARD, next)[0] as object).sort()).toEqual([
      'driver1EmployeeId',
      'driver2EmployeeId',
      'vehicleId',
    ]);
  });
});
