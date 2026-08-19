// The standing crew's two adapters, and the one place it deliberately differs from the day.
//
// The interaction itself is NOT retested here — it is the same code as the daily board and is
// covered in `crew-board.spec.ts`. What is tested is exactly what this file owns: the shape going
// in, the shape going out, and `notes` never reaching a `.strict()` schema that has no such field.
import { describe, expect, it } from 'vitest';
import { CREW_SLOT_CAPACITY, type OperationsStandingCrewRowDto } from '@ecms/contracts';
import { assignToSlot, changedRows, slotOccupants, type BoardRow } from './crew-board';
import {
  mergeStandingRows,
  newStandingRow,
  toStandingPayloadRows,
  toStandingRows,
} from './standing-crew';

const stored = (over: Partial<OperationsStandingCrewRowDto> = {}): OperationsStandingCrewRowDto => ({
  id: 'sc1',
  vehicleId: 'v1',
  vehicleCode: 'C-1',
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  version: 0,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('toStandingRows', () => {
  it('pads every slot to the full set of cards, so each card is droppable', () => {
    const [row] = toStandingRows([stored({ captainEmployeeIds: ['e1'] })]);
    expect(row?.captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
    expect(row?.captainEmployeeIds[0]).toBe('e1');
    expect(row?.captainEmployeeIds[1]).toBeNull();
  });

  it('carries a full six-person crew — the same ceiling as a day', () => {
    const [row] = toStandingRows([
      stored({
        captainEmployeeIds: ['e1', 'e2'],
        specialist1EmployeeIds: ['e3', 'e4'],
        specialist2EmployeeIds: ['e5', 'e6'],
      }),
    ]);
    expect(slotOccupants(row as BoardRow, 'captain')).toEqual(['e1', 'e2']);
    expect(slotOccupants(row as BoardRow, 'specialist2')).toEqual(['e5', 'e6']);
  });

  it('always sets notes to null — a standing row has none', () => {
    expect(toStandingRows([stored()])[0]?.notes).toBeNull();
  });

  it('keeps direction and plannedTime, which a standing row does have', () => {
    const [row] = toStandingRows([stored({ direction: 'الجيزة', plannedTime: '07:30' })]);
    expect(row?.direction).toBe('الجيزة');
    expect(row?.plannedTime).toBe('07:30');
  });
});

describe('toStandingPayloadRows', () => {
  it('never sends notes — the standing schema is strict and has no such field', () => {
    const [payload] = toStandingPayloadRows(toStandingRows([stored()]));
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('vehicleCode');
    expect(payload).not.toHaveProperty('date');
  });

  it('compacts the empty cell out of a slot rather than sending a hole', () => {
    const rows = assignToSlot(toStandingRows([stored()]), 'v1', 'captain', 1, 'e1');
    expect(toStandingPayloadRows(rows)[0]?.captainEmployeeIds).toEqual(['e1']);
  });

  it('sends an empty list for a slot nobody is in', () => {
    const [payload] = toStandingPayloadRows(toStandingRows([stored()]));
    expect(payload?.captainEmployeeIds).toEqual([]);
    expect(payload?.specialist1EmployeeIds).toEqual([]);
  });
});

describe('newStandingRow — a vehicle joining the cash-transfer fleet', () => {
  const added = newStandingRow({ vehicleId: 'v9', vehicleCode: 'C-9' });

  it('starts empty, with every card ready to receive a drop', () => {
    expect(slotOccupants(added, 'captain')).toEqual([]);
    expect(added.captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
  });

  it('counts as CHANGED even while empty — membership is the row', () => {
    // This is the divergence from the daily board that matters most. There, an empty row for a
    // vehicle with no row means nothing happened. Here it means "this vehicle carries cash and has
    // no standing crew yet", which must survive a save.
    expect(changedRows([added], []).map((r) => r.vehicleId)).toEqual(['v9']);
  });

  it('is saveable as an empty payload row rather than being dropped', () => {
    const [payload] = toStandingPayloadRows(changedRows([added], []));
    expect(payload?.vehicleId).toBe('v9');
    expect(payload?.captainEmployeeIds).toEqual([]);
  });
});


describe('mergeStandingRows — a refetch must not destroy the draft', () => {
  const server = (vehicleId: string, direction: string | null = null) =>
    toStandingRows([stored({ id: vehicleId, vehicleId, vehicleCode: `C-${vehicleId}`, direction })])[0] as BoardRow;

  it('keeps the LOCAL row for a vehicle the server also has', () => {
    // The bug this exists for: Remove refetches the list, and a plain setRows(serverRows) threw
    // away every unsaved edit on every OTHER vehicle. The operator's own click destroyed their work.
    const previous = [server('v1')];
    const edited = { ...server('v1'), direction: 'الجيزة' };
    const merged = mergeStandingRows([server('v1')], [edited], previous);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.direction).toBe('الجيزة');
  });

  it('takes a vehicle the server has and the draft does not', () => {
    const merged = mergeStandingRows([server('v1'), server('v2')], [server('v1')], [server('v1')]);
    expect(merged.map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
  });

  it('keeps a vehicle added from the picker and not yet saved', () => {
    const added = newStandingRow({ vehicleId: 'v9', vehicleCode: 'C-9' });
    const merged = mergeStandingRows([server('v1')], [server('v1'), added], [server('v1')]);
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1', 'v9']);
  });

  it('does NOT resurrect a vehicle that was removed on the server', () => {
    // It was on the server last time and is gone now — that is a removal, not a local addition.
    const merged = mergeStandingRows([server('v1')], [server('v1'), server('v2')], [
      server('v1'),
      server('v2'),
    ]);
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1']);
  });

  it('survives a remove with the rest of the draft intact — the whole point', () => {
    const before = [server('v1'), server('v2'), server('v3')];
    const draft = [{ ...server('v1'), direction: 'بنها' }, server('v2'), server('v3')];
    // v3 is removed on the server; v1's unsaved direction must still be there afterwards.
    const merged = mergeStandingRows([server('v1'), server('v2')], draft, before);
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1', 'v2']);
    expect(merged[0]?.direction).toBe('بنها');
  });

  it('takes the server wholesale on the very first reconcile', () => {
    expect(mergeStandingRows([server('v1')], [], []).map((r) => r.vehicleId)).toEqual(['v1']);
  });
});
