// The toggle that loads the standing crew onto the day's board.
//
// Off by default, on fills the EMPTY vehicles, off again clears exactly what it filled. Each of
// those is a claim about what the operator's own work survives, so each is pinned here.
import { describe, expect, it } from 'vitest';
import { CREW_SLOT_CAPACITY } from '@ecms/contracts';
import { SLOT_POSITIONS, rowCrew, slotOccupants, type BoardRow, type SlotCells } from './crew-board';
import { clearStandingCrew, loadStandingCrew, type StandingCrewSource } from './standing-load';

const cells = (...ids: (string | null)[]): SlotCells =>
  SLOT_POSITIONS.map((position) => ids[position] ?? null);

const row = (vehicleId: string, over: Partial<BoardRow> = {}): BoardRow => ({
  vehicleId,
  vehicleCode: `C-${vehicleId}`,
  captainEmployeeIds: cells(),
  specialist1EmployeeIds: cells(),
  specialist2EmployeeIds: cells(),
  direction: null,
  plannedTime: null,
  notes: null,
  ...over,
});

const standing = (
  vehicleId: string,
  captains: string[] = [],
  s1: string[] = [],
  s2: string[] = [],
): StandingCrewSource => ({
  vehicleId,
  captainEmployeeIds: captains,
  specialist1EmployeeIds: s1,
  specialist2EmployeeIds: s2,
});

describe('loadStandingCrew — switching the toggle on', () => {
  it('fills an empty vehicle from its standing crew', () => {
    const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'], ['s1'], ['s2'])]);
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['cap']);
    expect(slotOccupants(load.rows[0] as BoardRow, 'specialist1')).toEqual(['s1']);
    expect(slotOccupants(load.rows[0] as BoardRow, 'specialist2')).toEqual(['s2']);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('carries a full six-person standing crew across', () => {
    const load = loadStandingCrew(
      [row('v1')],
      [standing('v1', ['c1', 'c2'], ['a1', 'a2'], ['b1', 'b2'])],
    );
    expect(rowCrew(load.rows[0] as BoardRow)).toEqual(['c1', 'c2', 'a1', 'a2', 'b1', 'b2']);
    expect((load.rows[0] as BoardRow).captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
  });

  it('NEVER overwrites a vehicle that already carries somebody', () => {
    // The rule that makes the toggle safe to press: a crew saved this morning, or one just dragged
    // by hand, is somebody's decision and the toggle is not entitled to replace it.
    const board = [row('v1', { captainEmployeeIds: cells('mine') })];
    const load = loadStandingCrew(board, [standing('v1', ['standing'])]);
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['mine']);
    expect(load.filledVehicleIds).toEqual([]);
  });

  it('does not place somebody who is already on the board elsewhere (Q11)', () => {
    // One person, one vehicle per operating day — the save would refuse a plan that broke it, so
    // the board must not offer one.
    const board = [row('v1', { captainEmployeeIds: cells('cap') }), row('v2')];
    const load = loadStandingCrew(board, [standing('v2', ['cap'], ['s1'])]);
    expect(slotOccupants(load.rows[1] as BoardRow, 'captain')).toEqual([]);
    expect(slotOccupants(load.rows[1] as BoardRow, 'specialist1')).toEqual(['s1']);
  });

  it('gives a contested person to the FIRST vehicle in board order, deterministically', () => {
    const load = loadStandingCrew(
      [row('v1'), row('v2')],
      [standing('v2', ['shared']), standing('v1', ['shared'])],
    );
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['shared']);
    expect(slotOccupants(load.rows[1] as BoardRow, 'captain')).toEqual([]);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('leaves a standing crew whose vehicle is not on the board IN THE POOL, and says so', () => {
    // "لو فى طاقم على سيارة والسيارة مش متاحه سيب الطاقم بدون تحميله على سيارة" — the van is in the
    // yard today. Its people are not forced somewhere wrong, and not silently swallowed either.
    const load = loadStandingCrew([row('v1')], [standing('v9', ['cap'], ['s1'])]);
    expect(load.rows.map((r) => r.vehicleId)).toEqual(['v1']);
    expect(load.filledVehicleIds).toEqual([]);
    expect(load.unavailableVehicleIds).toEqual(['v9']);
  });

  it('does not report an EMPTY standing crew as stranded — it has nobody to strand', () => {
    expect(loadStandingCrew([row('v1')], [standing('v9')]).unavailableVehicleIds).toEqual([]);
  });

  it('leaves a board vehicle with no standing crew untouched', () => {
    const load = loadStandingCrew([row('v1'), row('v2')], [standing('v1', ['cap'])]);
    expect(rowCrew(load.rows[1] as BoardRow)).toEqual([]);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('does not mutate the rows it was given', () => {
    const board = [row('v1')];
    loadStandingCrew(board, [standing('v1', ['cap'])]);
    expect(rowCrew(board[0] as BoardRow)).toEqual([]);
  });

  it('keeps direction and plannedTime as the board had them', () => {
    // The toggle loads a CREW. What time a vehicle leaves today is the day's business.
    const board = [row('v1', { direction: 'بنها', plannedTime: '06:00' })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'])]);
    expect(load.rows[0]?.direction).toBe('بنها');
    expect(load.rows[0]?.plannedTime).toBe('06:00');
  });
});

describe('clearStandingCrew — switching the toggle off', () => {
  it('empties exactly the vehicles the load filled', () => {
    const load = loadStandingCrew([row('v1'), row('v2')], [standing('v1', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(rowCrew(cleared[0] as BoardRow)).toEqual([]);
  });

  it('leaves a vehicle the toggle never touched alone', () => {
    const board = [row('v1', { captainEmployeeIds: cells('mine') }), row('v2')];
    const load = loadStandingCrew(board, [standing('v2', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(slotOccupants(cleared[0] as BoardRow, 'captain')).toEqual(['mine']);
    expect(rowCrew(cleared[1] as BoardRow)).toEqual([]);
  });

  it('on → off returns the board to exactly where it started', () => {
    const board = [row('v1'), row('v2', { specialist1EmployeeIds: cells('kept') })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'], ['s1'])]);
    expect(clearStandingCrew(load.rows, load.filledVehicleIds)).toEqual(board);
  });

  it('keeps direction and plannedTime when it clears a crew', () => {
    const board = [row('v1', { direction: 'الجيزة' })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(cleared[0]?.direction).toBe('الجيزة');
  });
});
