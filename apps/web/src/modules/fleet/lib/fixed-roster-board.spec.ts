// What a DROP means, tested without a DOM.
//
// The interaction needs a browser and is verified in one. These are the rules underneath it —
// the two the server enforces, and the difference calculation the save depends on — and they are
// here rather than inside the page because a rule that can only be exercised by dragging a card
// is a rule the node suite cannot defend.
import { describe, expect, it } from 'vitest';
import { type FleetFixedCrewRowDto } from '@ecms/contracts';
import {
  applyEdit,
  assignDriver,
  availableDrivers,
  changedRows,
  clearSlot,
  CREW_SLOTS,
  findSeat,
  isDirty,
} from './fixed-roster-board';

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
  missionTypeId: null,
  driver1EmployeeId: d1,
  driver2EmployeeId: d2,
  notes: null,
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
    // …except into slot 2 of a car with no first driver, which is the one state a crew may not
    // be in. The card lands in slot 1 instead of creating a second driver with no first.
    expect(crews(assignDriver(BOARD, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:e1/-',
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
  //
  // The rule is that a person holds ONE slot of a crew, not that the two slots are sealed off
  // from each other. Dragging between them is a legitimate correction — the crew is right, the
  // seats are the wrong way round — so it MOVES, and nobody is asked to clear a slot first.

  it('keeps a LONE driver in slot 1 — moving them to slot 2 would leave a crew with no first', () => {
    // The gesture is legal on a crew of two (the swap below); on a crew of one there is nobody
    // to take slot 1, so the move is not a move at all and the driver stays where they are.
    // The cell refuses the drop before it reaches here — this is the arithmetic behind that.
    const before = [row('v1', '150', 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:e1/-',
      '151:-/-',
    ]);
  });

  it('moves in both directions — slot 2 → slot 1 is the same gesture', () => {
    const before = [row('v1', '150', null, 'e1'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:e1/-',
      '151:-/-',
    ]);
  });

  it('SWAPS when the other slot is taken — the crew is the same two people, reseated', () => {
    // The alternative would be to displace e2 back to the pool, which loses a crew member the
    // user never touched. Handing them the vacated slot is the smallest thing the board can do.
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    expect(crews(assignDriver(before, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:e2/e1',
      '151:-/-',
    ]);
    expect(crews(assignDriver(before, 'v1', 'driver1EmployeeId', 'e2'))).toEqual([
      '150:e2/e1',
      '151:-/-',
    ]);
  });

  it('sends the swap as ONE changed row — the crew moved, the fleet did not', () => {
    const saved = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    expect(changedRows(saved, assignDriver(saved, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: null,
        driver1EmployeeId: 'e2',
        driver2EmployeeId: 'e1',
        notes: null,
      },
    ]);
  });

  it('a swap loses nobody — both people are still seated afterwards', () => {
    const after = assignDriver([row('v1', '150', 'e1', 'e2')], 'v1', 'driver2EmployeeId', 'e1');
    const seated = after.flatMap((r) => [r.driver1EmployeeId, r.driver2EmployeeId]);
    expect(seated.filter((id) => id !== null).sort()).toEqual(['e1', 'e2']);
  });

  it('never lets one person occupy both slots, from any starting point', () => {
    for (const start of [
      [row('v1', '150', 'e1'), row('v2', '151')],
      [row('v1', '150', null, 'e1'), row('v2', '151')],
      [row('v1', '150', 'e1', 'e2'), row('v2', '151')],
      [row('v1', '150', 'e2', 'e1'), row('v2', '151')],
      [row('v1', '150'), row('v2', '151', 'e1')],
    ]) {
      for (const slot of ['driver1EmployeeId', 'driver2EmployeeId'] as const) {
        // Whatever shape the drop takes, it lands on a board where nobody holds both slots.
        for (const r of assignDriver(start, 'v1', slot, 'e1')) {
          const both = r.driver1EmployeeId !== null && r.driver1EmployeeId === r.driver2EmployeeId;
          expect(both, `${r.code} holds e1 twice`).toBe(false);
        }
      }
    }
  });

  it('never seats one person on two cars, whatever the drop', () => {
    // The other half of the same guarantee: a driver id appears at most once on the WHOLE board.
    for (const start of [
      [row('v1', '150', 'e1'), row('v2', '151')],
      [row('v1', '150'), row('v2', '151', 'e1', 'e2')],
      [row('v1', '150', 'e2'), row('v2', '151', null, 'e1')],
    ]) {
      for (const vehicleId of ['v1', 'v2']) {
        for (const slot of ['driver1EmployeeId', 'driver2EmployeeId'] as const) {
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

  it('displaces the occupant to the POOL when the drop comes from another car', () => {
    // The swap is a SAME-CAR affair. Arriving from elsewhere, the person you land on leaves the
    // crew — shuffling them into the car's free slot instead would rewrite a crew nobody dragged,
    // and would keep them out of the pool where the user expects to find them again.
    // The occupant sits in slot 1 because that is the only seat a lone driver may hold.
    const before = [row('v1', '150', 'e1'), row('v2', '151', 'e9')];
    const after = assignDriver(before, 'v2', 'driver1EmployeeId', 'e1');
    expect(crews(after)).toEqual(['150:-/-', '151:e1/-']);
    expect(
      availableDrivers([{ employeeId: 'e1' }, { employeeId: 'e9' }], after).map(
        (d) => d.employeeId,
      ),
      'the displaced driver is free again',
    ).toEqual(['e9']);
  });

  it('does not shuffle the destination car when the free slot is the OTHER one', () => {
    // Same trap from the mirror side: landing on slot 1 must not push the occupant into slot 2.
    const before = [row('v1', '150', null, 'e1'), row('v2', '151', 'e9')];
    expect(crews(assignDriver(before, 'v2', 'driver1EmployeeId', 'e1'))).toEqual([
      '150:-/-',
      '151:e1/-',
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
    expect(crews(clearSlot(before, 'v1', 'driver2EmployeeId'))).toEqual(['150:e1/-', '151:e3/-']);
  });

  it('PROMOTES the second driver when the first is cleared — never a crew with no first', () => {
    // Removing the first driver of a two-man crew leaves one person on the car, and the seat a
    // lone driver holds is slot 1. Dropping them instead would take somebody off a crew nobody
    // asked to disband; leaving them in slot 2 is the state the server refuses to store.
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151', 'e3')];
    expect(crews(clearSlot(before, 'v1', 'driver1EmployeeId'))).toEqual(['150:e2/-', '151:e3/-']);
  });

  it('clearing the LAST driver empties the crew rather than promoting nobody', () => {
    expect(crews(clearSlot([row('v1', '150', 'e1')], 'v1', 'driver1EmployeeId'))).toEqual([
      '150:-/-',
    ]);
  });
});

// ── the pool: derived from the DRAFT, not from the server's own answer ─────

describe('availableDrivers', () => {
  const ALL = [{ employeeId: 'e1' }, { employeeId: 'e2' }, { employeeId: 'e3' }];
  const ids = (rows: readonly FleetFixedCrewRowDto[]): string[] =>
    availableDrivers(ALL, rows).map((d) => d.employeeId);

  it('offers everyone when the board seats nobody', () => {
    expect(ids([row('v1', '150'), row('v2', '151')])).toEqual(['e1', 'e2', 'e3']);
  });

  it('takes a driver out the moment the DRAFT seats them', () => {
    const after = assignDriver(
      [row('v1', '150'), row('v2', '151')],
      'v1',
      'driver1EmployeeId',
      'e1',
    );
    expect(ids(after)).toEqual(['e2', 'e3']);
  });

  it('gives them back the moment the slot is cleared', () => {
    const seated = assignDriver([row('v1', '150')], 'v1', 'driver1EmployeeId', 'e1');
    expect(ids(clearSlot(seated, 'v1', 'driver1EmployeeId'))).toEqual(['e1', 'e2', 'e3']);
  });

  it('counts BOTH slots', () => {
    const two = assignDriver(
      assignDriver([row('v1', '150')], 'v1', 'driver1EmployeeId', 'e1'),
      'v1',
      'driver2EmployeeId',
      'e2',
    );
    expect(ids(two)).toEqual(['e3']);
  });

  it('never lets a driver flicker back while MOVING between vehicles', () => {
    // The move is one operation over one board, so there is no intermediate state to leak.
    const before = assignDriver(
      [row('v1', '150'), row('v2', '151')],
      'v1',
      'driver1EmployeeId',
      'e1',
    );
    expect(ids(before)).toEqual(['e2', 'e3']);
    const moved = assignDriver(before, 'v2', 'driver1EmployeeId', 'e1');
    expect(ids(moved), 'still seated, just elsewhere').toEqual(['e2', 'e3']);
  });

  it('cannot duplicate a card, because membership is COMPUTED not adjusted', () => {
    const seated = assignDriver([row('v1', '150')], 'v1', 'driver1EmployeeId', 'e1');
    // The same driver dropped on the car's other slot is still ONE seat, so still one absence.
    const reseated = assignDriver(seated, 'v1', 'driver2EmployeeId', 'e1');
    expect(ids(reseated)).toEqual(['e2', 'e3']);
    expect(new Set(ids(reseated)).size, 'no repeats').toBe(ids(reseated).length);
  });

  it('is unchanged by a move between the two slots of one vehicle', () => {
    // Nobody left the crew, so nobody joins the pool — the card must not flicker back into it.
    const crewed = assignDriver(
      assignDriver([row('v1', '150')], 'v1', 'driver1EmployeeId', 'e1'),
      'v1',
      'driver2EmployeeId',
      'e2',
    );
    expect(ids(crewed)).toEqual(['e3']);
    // And a SWAP of those two keeps the pool exactly where it was.
    expect(ids(assignDriver(crewed, 'v1', 'driver2EmployeeId', 'e1'))).toEqual(['e3']);
  });

  it('does not mutate the server array it was given', () => {
    const snapshot = JSON.stringify(ALL);
    availableDrivers(ALL, assignDriver([row('v1', '150')], 'v1', 'driver1EmployeeId', 'e1'));
    expect(JSON.stringify(ALL)).toBe(snapshot);
  });

  it('keeps the server order, and carries the whole driver object through', () => {
    const rich = [
      { employeeId: 'e1', assignedVehicleId: 'vX' },
      { employeeId: 'e2', assignedVehicleId: null },
    ];
    expect(availableDrivers(rich, [row('v1', '150')])).toEqual(rich);
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
      {
        vehicleId: 'v2',
        missionTypeId: null,
        driver1EmployeeId: 'e1',
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
    expect(isDirty(BOARD, next)).toBe(true);
  });

  it('sends a cleared row, so emptying a crew is saved rather than ignored', () => {
    const saved = [row('v1', '150', 'e1')];
    expect(changedRows(saved, clearSlot(saved, 'v1', 'driver1EmployeeId'))).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('ignores a row the saved board never had and that still holds nobody', () => {
    // Sending it would ask the server to create a record of a crew that never existed.
    expect(changedRows([], [row('v9', '999')])).toEqual([]);
  });

  it('carries a brand-new row that DOES hold somebody', () => {
    expect(changedRows([], [row('v9', '999', 'e1')])).toEqual([
      {
        vehicleId: 'v9',
        missionTypeId: null,
        driver1EmployeeId: 'e1',
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('sends the four editable facts and nothing else — the vehicle facts are not the payload', () => {
    // `code`, `plateNumber`, `typeId` and `inMaintenance` describe the CAR and are read-only
    // here; sending them would invite the server to treat a board save as a registry edit.
    const next = assignDriver(BOARD, 'v1', 'driver1EmployeeId', 'e1');
    expect(Object.keys(changedRows(BOARD, next)[0] as object).sort()).toEqual([
      'driver1EmployeeId',
      'driver2EmployeeId',
      'missionTypeId',
      'notes',
      'vehicleId',
    ]);
  });
});

// ── the edit dialog's four values, applied on the board's own terms ─────────
//
// `applyEdit` is what the «تعديل» dialog commits through. It must not be a second, parallel set
// of rules: a driver seated here who is fixed to another car has to be RELEASED from it, exactly
// as dragging them would, or the dialog becomes a way around the one rule the board exists to
// keep. These pin that it routes through `assignDriver` rather than writing rows directly.

describe('applyEdit', () => {
  const board = () => [row('v1', '150'), row('v2', '151', 'e9')];

  it('writes all four values of the row it names, and nothing on any other row', () => {
    const after = applyEdit(board(), 'v1', {
      missionTypeId: 'wt1',
      driver1EmployeeId: 'e1',
      driver2EmployeeId: null,
      notes: 'من المخزن',
    });
    const v1 = after.find((r) => r.vehicleId === 'v1') as FleetFixedCrewRowDto;
    expect(v1.missionTypeId).toBe('wt1');
    expect(v1.driver1EmployeeId).toBe('e1');
    expect(v1.driver2EmployeeId).toBeNull();
    expect(v1.notes).toBe('من المخزن');
    expect(after.find((r) => r.vehicleId === 'v2')).toEqual(board()[1]);
  });

  it('RELEASES the other car when the dialog seats a driver fixed elsewhere', () => {
    // The rule the dialog must not be able to sidestep. e9 crews v2; choosing them for v1 has
    // to take them off v2, or one driver would hold two crews.
    const after = applyEdit(board(), 'v1', {
      missionTypeId: null,
      driver1EmployeeId: 'e9',
      driver2EmployeeId: null,
      notes: null,
    });
    expect(crews(after)).toEqual(['150:e9/-', '151:-/-']);
    const seats = after.flatMap((r) => [r.driver1EmployeeId, r.driver2EmployeeId]).filter(Boolean);
    expect(new Set(seats).size, 'nobody is seated twice').toBe(seats.length);
  });

  it('clears a slot when the dialog chooses "no driver"', () => {
    const seated = applyEdit(board(), 'v1', {
      missionTypeId: null,
      driver1EmployeeId: 'e1',
      driver2EmployeeId: 'e2',
      notes: null,
    });
    const cleared = applyEdit(seated, 'v1', {
      missionTypeId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: 'e2',
      notes: null,
    });
    // e2 is promoted into the seat e1 vacated — the dialog cannot leave a crew with no first
    // driver any more than a drag can. The dialog disables slot 2 while slot 1 is empty, so this
    // pair is not offerable there; the promotion is what makes the rule hold regardless.
    expect(crews(cleared)).toEqual(['150:e2/-', '151:e9/-']);
    // …and the released driver is offered again.
    expect(
      availableDrivers([{ employeeId: 'e1' }, { employeeId: 'e2' }], cleared).map(
        (d) => d.employeeId,
      ),
    ).toEqual(['e1']);
  });

  it('keeps the row’s own drivers selectable — re-saving them changes nothing', () => {
    const seated = applyEdit(board(), 'v1', {
      missionTypeId: 'wt1',
      driver1EmployeeId: 'e1',
      driver2EmployeeId: 'e2',
      notes: 'x',
    });
    const again = applyEdit(seated, 'v1', {
      missionTypeId: 'wt1',
      driver1EmployeeId: 'e1',
      driver2EmployeeId: 'e2',
      notes: 'x',
    });
    expect(crews(again)).toEqual(crews(seated));
    expect(changedRows(seated, again), 'a no-op edit sends nothing').toEqual([]);
  });

  it('swaps within the car when the dialog reverses the two slots', () => {
    const seated = applyEdit(board(), 'v1', {
      missionTypeId: null,
      driver1EmployeeId: 'e1',
      driver2EmployeeId: 'e2',
      notes: null,
    });
    const reversed = applyEdit(seated, 'v1', {
      missionTypeId: null,
      driver1EmployeeId: 'e2',
      driver2EmployeeId: 'e1',
      notes: null,
    });
    expect(crews(reversed)).toEqual(['150:e2/e1', '151:e9/-']);
  });

  it('never loses or duplicates a driver, whatever the dialog asks for', () => {
    const people = ['e1', 'e2', 'e9'];
    const all = people.map((employeeId) => ({ employeeId }));
    for (const d1 of [null, ...people]) {
      for (const d2 of [null, ...people]) {
        if (d1 !== null && d1 === d2) continue; // the dialog refuses this pair before applying
        const after = applyEdit(board(), 'v1', {
          missionTypeId: null,
          driver1EmployeeId: d1,
          driver2EmployeeId: d2,
          notes: null,
        });
        const seated = after
          .flatMap((r) => [r.driver1EmployeeId, r.driver2EmployeeId])
          .filter((x): x is string => x !== null);
        expect(new Set(seated).size, `${String(d1)}/${String(d2)} duplicated somebody`).toBe(
          seated.length,
        );
        const pooled = availableDrivers(all, after).map((d) => d.employeeId);
        for (const person of people) {
          expect(
            seated.includes(person) !== pooled.includes(person),
            `${person} is in both or neither for ${String(d1)}/${String(d2)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('sends a work-type-only edit — a change with no driver in it still travels', () => {
    const saved = board();
    const after = applyEdit(saved, 'v1', {
      missionTypeId: 'wt1',
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    expect(changedRows(saved, after)).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: 'wt1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('sends a notes-only edit too', () => {
    const saved = board();
    const after = applyEdit(saved, 'v2', {
      missionTypeId: null,
      driver1EmployeeId: 'e9',
      driver2EmployeeId: null,
      notes: 'ملاحظة',
    });
    expect(changedRows(saved, after)).toEqual([
      {
        vehicleId: 'v2',
        missionTypeId: null,
        driver1EmployeeId: 'e9',
        driver2EmployeeId: null,
        notes: 'ملاحظة',
      },
    ]);
  });

  it('does not mutate the board it was given', () => {
    const saved = board();
    const snapshot = JSON.stringify(saved);
    applyEdit(saved, 'v1', {
      missionTypeId: 'wt1',
      driver1EmployeeId: 'e9',
      driver2EmployeeId: null,
      notes: 'x',
    });
    expect(JSON.stringify(saved)).toBe(snapshot);
  });
});

// ── a second driver needs a first ──────────────────────────────────────────
//
// The slots are ORDERED. Slot 1 is the crew's driver; slot 2 is the second man beside them. A row
// holding only a second driver reads as a crewless car on every screen that shows "the driver",
// while a real person is committed to it — so the server refuses to store one, and the board must
// not be able to propose one. These prove the rule survives EVERY gesture that could reach it,
// not just the obvious one.
describe('a second driver needs a first', () => {
  const lonelySecond = (rows: readonly FleetFixedCrewRowDto[]): FleetFixedCrewRowDto[] =>
    rows.filter((r) => r.driver1EmployeeId === null && r.driver2EmployeeId !== null);

  it('cannot be produced by dropping onto slot 2 of an empty car', () => {
    expect(lonelySecond(assignDriver(BOARD, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([]);
  });

  it('cannot be produced by clearing slot 1', () => {
    const before = [row('v1', '150', 'e1', 'e2')];
    expect(lonelySecond(clearSlot(before, 'v1', 'driver1EmployeeId'))).toEqual([]);
  });

  it('cannot be produced by dragging the FIRST driver away to another car', () => {
    // The releasing row is the trap: it keeps its second driver and loses its first, which is
    // exactly the forbidden state — reached without anybody touching slot 2.
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    const after = assignDriver(before, 'v2', 'driver1EmployeeId', 'e1');
    expect(lonelySecond(after)).toEqual([]);
    expect(crews(after)).toEqual(['150:e2/-', '151:e1/-']);
  });

  it('cannot be produced by the edit dialog writing the pair directly', () => {
    const after = applyEdit(BOARD, 'v1', {
      missionTypeId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: 'e1',
      notes: null,
    });
    expect(lonelySecond(after)).toEqual([]);
    expect(crews(after)).toEqual(['150:e1/-', '151:-/-']);
  });

  it('holds from EVERY starting board and every drop — exhaustively', () => {
    const starts = [
      [row('v1', '150'), row('v2', '151')],
      [row('v1', '150', 'e1'), row('v2', '151')],
      [row('v1', '150', 'e1', 'e2'), row('v2', '151')],
      [row('v1', '150', 'e1', 'e2'), row('v2', '151', 'e3')],
    ];
    for (const start of starts) {
      for (const vehicleId of ['v1', 'v2']) {
        for (const slot of CREW_SLOTS) {
          for (const who of ['e1', 'e2', 'e3', 'e4']) {
            expect(
              lonelySecond(assignDriver(start, vehicleId, slot, who)),
              `assign ${who} -> ${vehicleId}.${slot}`,
            ).toEqual([]);
          }
          expect(lonelySecond(clearSlot(start, vehicleId, slot)), `clear ${vehicleId}.${slot}`)
            .toEqual([]);
        }
      }
    }
  });

  it('a promotion travels in the payload, so the save is not silently partial', () => {
    const saved = [row('v1', '150', 'e1', 'e2')];
    expect(changedRows(saved, clearSlot(saved, 'v1', 'driver1EmployeeId'))).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: null,
        driver1EmployeeId: 'e2',
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });
});

// ── a save carries what the user EDITED, and nothing else ──────────────────
//
// The regression that made «حفظ» answer `Validation failed` on a real fleet.
//
// `seatOrder` is a normalisation, and it was applied inside `assignDriver`'s "any other car"
// branch — i.e. to EVERY row on the board. Any row stored before the driver-order rule existed
// (driver 2 with no driver 1) was therefore silently promoted by a drag somewhere else, which
// made it DIFFER from the saved board, which put it in the payload. The server then re-validated
// those untouched rows against rules they were never written under — a driver whose profile has
// since been deactivated, a mission type since archived — and one such row anywhere in the fleet
// failed the WHOLE save. On a hundred-vehicle board that is one bad row away from unsaveable.
describe('the save payload is the edit, not the board', () => {
  const legacy = (vehicleId: string, code: string, d2: string, mission: string | null) => ({
    ...row(vehicleId, code, null, d2),
    missionTypeId: mission,
  });

  it('sends ONLY the two sides of a move, on a board full of untouched rows', () => {
    const saved = [
      legacy('v1', '150', 'e9', 'm-archived'),
      legacy('v2', '151', 'e8', 'm-archived'),
      row('v3', '152'),
      row('v4', '153', 'e3'),
      row('v5', '154', 'e4', 'e5'),
    ];
    const sent = changedRows(saved, assignDriver(saved, 'v3', 'driver1EmployeeId', 'e3'));
    expect(
      sent.map((r) => r.vehicleId).sort(),
      'the receiving car and the releasing car — nobody else',
    ).toEqual(['v3', 'v4']);
  });

  it('leaves a row the drag did not touch IDENTICAL — the same object, not an equal one', () => {
    // Value equality is what `changedRows` asks, but identity is the stronger guarantee and the
    // one that says the row was not rebuilt behind the user's back.
    const saved = [legacy('v1', '150', 'e9', 'm1'), row('v2', '151'), row('v3', '152', 'e3')];
    const after = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e3');
    expect(after[0], 'the legacy row is the very row that came in').toBe(saved[0]);
  });

  it('does not quietly rewrite a stored driver2-only row somebody else created', () => {
    const saved = [legacy('v1', '150', 'e9', 'm1'), row('v2', '151'), row('v3', '152', 'e3')];
    const after = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e3');
    expect(crews(after)[0], 'still exactly as stored').toBe('150:-/e9');
    expect(isDirty(saved, after), 'and it is not part of what is pending').toBe(true);
    expect(changedRows(saved, after).some((r) => r.vehicleId === 'v1')).toBe(false);
  });

  it('STILL normalises the row the drag actually empties', () => {
    // The rule has not been weakened where it applies: a car that gives up its FIRST driver is
    // left holding only a second, and that IS this gesture's business.
    const saved = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    const after = assignDriver(saved, 'v2', 'driver1EmployeeId', 'e1');
    expect(crews(after)).toEqual(['150:e2/-', '151:e1/-']);
    expect(changedRows(saved, after).map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
  });

  it('STILL normalises a row edited through the dialog', () => {
    const saved = [legacy('v1', '150', 'e9', 'm1')];
    const after = applyEdit(saved, 'v1', {
      missionTypeId: 'm1',
      driver1EmployeeId: null,
      driver2EmployeeId: 'e9',
      notes: null,
    });
    expect(crews(after), 'editing it promotes it — the schema refuses the other shape').toEqual([
      '150:e9/-',
    ]);
  });

  it('an ordinary edit on a big board sends exactly one row', () => {
    const saved = [
      row('v1', '150', 'e1'),
      legacy('v2', '151', 'e9', 'm1'),
      row('v3', '152', 'e2', 'e3'),
      legacy('v4', '153', 'e8', 'm2'),
    ];
    const after = applyEdit(saved, 'v3', {
      missionTypeId: 'm-new',
      driver1EmployeeId: 'e2',
      driver2EmployeeId: 'e3',
      notes: null,
    });
    expect(changedRows(saved, after).map((r) => r.vehicleId)).toEqual(['v3']);
  });
});
