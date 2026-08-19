// The crew board's interaction, asserted as state transitions.
//
// The legacy board enforced its one rule — a crew member holds one vehicle per day — in browser
// JavaScript (tashghela.ejs:1332) while the server blind-upserted whatever it was sent (:2413).
// The rule now lives in the domain; what is tested here is that a DROP produces the end state the
// domain will accept, so the operator is never shown a plan the save then rejects.
//
// A slot holds up to CREW_SLOT_CAPACITY people and the board edits it as that many CARDS, so every
// drop names a card. The one-occupant cases below are the legacy behaviour at the new capacity —
// they read the same as they did — and the two-occupant cases are the new ground.
import { describe, expect, it } from 'vitest';
import { CREW_SLOT_CAPACITY, type OperationsCrewMemberDto } from '@ecms/contracts';
import {
  CREW_SLOTS,
  SLOT_POSITIONS,
  assignCaptainWithCrew,
  assignToSlot,
  availablePool,
  changedRows,
  clearSlot,
  filterPool,
  removeFromBoard,
  rowCrew,
  setRowField,
  slotOccupants,
  slotValue,
  slotsHolding,
  toBoardRows,
  toPlanRows,
  type BoardRow,
  type SlotCells,
} from './crew-board';

/** A slot's cells from the people in it, padded to capacity — what the board holds. */
const cells = (...ids: (string | null)[]): SlotCells =>
  SLOT_POSITIONS.map((position) => ids[position] ?? null);

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  vehicleId: 'v1',
  vehicleCode: 'C-1',
  captainEmployeeIds: cells(),
  specialist1EmployeeIds: cells(),
  specialist2EmployeeIds: cells(),
  direction: null,
  plannedTime: null,
  notes: null,
  ...over,
});

const member = (id: string, over: Partial<OperationsCrewMemberDto> = {}): OperationsCrewMemberDto => ({
  employeeId: id,
  code: `E-${id}`,
  fullNameAr: `موظف ${id}`,
  status: 'active',
  requirements: null,
  assignedVehicleId: null,
  ...over,
});

const flags = (over: Record<string, boolean>) =>
  ({
    id: 'r',
    employeeId: 'e',
    isCaptain: false,
    isSpecialist: false,
    hasWeapon: false,
    hasSignature: false,
    hasLicense: false,
    hasTemporaryLicense: false,
    isOpsAdmin: false,
    isNewJoiner: false,
    isAssignedSpecialTask: false,
    isPriority: false,
    notes: null,
    version: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as OperationsCrewMemberDto['requirements'];

describe('toBoardRows', () => {
  it('gives a vehicle with no crew yet three empty slots rather than no row', () => {
    const [built] = toBoardRows([
      {
        vehicleId: 'v1',
        vehicleCode: 'C-1',
        fleetDutyAssignmentId: 'd1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        missionTypeId: null,
        crew: null,
      },
    ]);
    expect(built?.captainEmployeeIds).toEqual(cells());
    expect(built?.specialist1EmployeeIds).toEqual(cells());
    expect(built?.specialist2EmployeeIds).toEqual(cells());
  });

  it('pads a stored slot out to the full set of cards, so every card is droppable', () => {
    const [built] = toBoardRows([
      {
        vehicleId: 'v1',
        vehicleCode: 'C-1',
        fleetDutyAssignmentId: 'd1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        missionTypeId: null,
        crew: {
          id: 'c1',
          captainEmployeeIds: ['e1'],
          specialist1EmployeeIds: [],
          specialist2EmployeeIds: [],
          direction: null,
          plannedTime: null,
          notes: null,
        },
      },
    ]);
    expect(built?.captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
    expect(built?.captainEmployeeIds[0]).toBe('e1');
    expect(built?.captainEmployeeIds[1]).toBeNull();
  });

  it('carries both occupants of a full slot', () => {
    const [built] = toBoardRows([
      {
        vehicleId: 'v1',
        vehicleCode: 'C-1',
        fleetDutyAssignmentId: 'd1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        missionTypeId: null,
        crew: {
          id: 'c1',
          captainEmployeeIds: ['e1', 'e2'],
          specialist1EmployeeIds: ['e3', 'e4'],
          specialist2EmployeeIds: ['e5', 'e6'],
          direction: null,
          plannedTime: null,
          notes: null,
        },
      },
    ]);
    // Six people on one vehicle — two captains and two of each specialist.
    expect(rowCrew(built as BoardRow)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });
});

describe('assignToSlot — a drop', () => {
  it('fills the target card', () => {
    const next = assignToSlot([row()], 'v1', 'captain', 0, 'e1');
    expect(slotValue(next[0] as BoardRow, 'captain', 0)).toBe('e1');
  });

  it('adds a SECOND captain beside the first rather than replacing them', () => {
    let rows = [row()];
    rows = assignToSlot(rows, 'v1', 'captain', 0, 'e1');
    rows = assignToSlot(rows, 'v1', 'captain', 1, 'e2');
    expect(slotOccupants(rows[0] as BoardRow, 'captain')).toEqual(['e1', 'e2']);
  });

  it('MOVES a member already crewed on another vehicle (Q11 — one vehicle per day)', () => {
    const rows = [
      row({ vehicleId: 'v1', captainEmployeeIds: cells('e1') }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignToSlot(rows, 'v2', 'captain', 0, 'e1');
    // The old card is vacated, so the end state is one the server accepts.
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual([]);
    expect(slotOccupants(next[1] as BoardRow, 'captain')).toEqual(['e1']);
    expect(slotsHolding(next, 'e1')).toHaveLength(1);
  });

  it('moves a member between slots on the SAME vehicle without cloning them', () => {
    const rows = [row({ specialist1EmployeeIds: cells('e1') })];
    const next = assignToSlot(rows, 'v1', 'specialist2', 0, 'e1');
    expect(slotOccupants(next[0] as BoardRow, 'specialist1')).toEqual([]);
    expect(slotOccupants(next[0] as BoardRow, 'specialist2')).toEqual(['e1']);
  });

  it('moves a member between CARDS of one slot without leaving a copy behind', () => {
    const rows = [row({ captainEmployeeIds: cells('e1') })];
    const next = assignToSlot(rows, 'v1', 'captain', 1, 'e1');
    // The intra-slot duplicate the contract refuses is unreachable from the board.
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual(['e1']);
    expect(slotValue(next[0] as BoardRow, 'captain', 0)).toBeNull();
  });

  it('displaces whoever held the target card — a card holds one person', () => {
    const rows = [row({ captainEmployeeIds: cells('e1', 'e9') })];
    const next = assignToSlot(rows, 'v1', 'captain', 0, 'e2');
    expect(slotValue(next[0] as BoardRow, 'captain', 0)).toBe('e2');
    // Only the targeted card changed; the co-captain stayed put.
    expect(slotValue(next[0] as BoardRow, 'captain', 1)).toBe('e9');
    expect(slotsHolding(next, 'e1')).toHaveLength(0);
  });

  it('never leaves anyone on two cards, whatever the sequence of drops', () => {
    let rows = [row({ vehicleId: 'v1' }), row({ vehicleId: 'v2' })];
    rows = assignToSlot(rows, 'v1', 'captain', 0, 'e1');
    rows = assignToSlot(rows, 'v2', 'specialist1', 1, 'e1');
    rows = assignToSlot(rows, 'v1', 'specialist2', 0, 'e1');
    expect(slotsHolding(rows, 'e1')).toEqual([
      { vehicleId: 'v1', slot: 'specialist2', position: 0 },
    ]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [row()];
    assignToSlot(rows, 'v1', 'captain', 0, 'e1');
    expect(slotOccupants(rows[0] as BoardRow, 'captain')).toEqual([]);
  });
});

describe('clearSlot', () => {
  it('empties one card and leaves the others alone', () => {
    const rows = [
      row({ captainEmployeeIds: cells('e1'), specialist1EmployeeIds: cells('e2') }),
    ];
    const next = clearSlot(rows, 'v1', 'captain', 0);
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual([]);
    expect(slotOccupants(next[0] as BoardRow, 'specialist1')).toEqual(['e2']);
  });

  it('removes only the named card of a two-occupant slot', () => {
    const rows = [row({ captainEmployeeIds: cells('e1', 'e2') })];
    const next = clearSlot(rows, 'v1', 'captain', 1);
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual(['e1']);
  });

  it('leaves other vehicles untouched', () => {
    const rows = [
      row({ vehicleId: 'v1', captainEmployeeIds: cells('e1') }),
      row({ vehicleId: 'v2', captainEmployeeIds: cells('e2') }),
    ];
    const next = clearSlot(rows, 'v1', 'captain', 0);
    expect(slotOccupants(next[1] as BoardRow, 'captain')).toEqual(['e2']);
  });
});

describe('removeFromBoard — dropping a member back on the pool', () => {
  it('takes them off every card they held', () => {
    const rows = [
      row({ vehicleId: 'v1', captainEmployeeIds: cells('e1', 'e2') }),
      row({ vehicleId: 'v2', specialist1EmployeeIds: cells('e3') }),
    ];
    const next = removeFromBoard(rows, 'e2');
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual(['e1']);
    expect(slotsHolding(next, 'e2')).toEqual([]);
  });

  it('leaves the board alone when the member was never on it', () => {
    const rows = [row({ captainEmployeeIds: cells('e1') })];
    expect(changedRows(removeFromBoard(rows, 'e9'), rows)).toEqual([]);
  });
});

describe('setRowField — direction, time and notes', () => {
  it('stores a value and turns a cleared field into null, not an empty string', () => {
    let rows = [row()];
    rows = setRowField(rows, 'v1', 'direction', 'الجيزة');
    expect(rows[0]?.direction).toBe('الجيزة');
    rows = setRowField(rows, 'v1', 'direction', '');
    expect(rows[0]?.direction).toBeNull();
  });
});

describe('availablePool', () => {
  it('excludes everyone currently on a card', () => {
    const members = [member('e1'), member('e2'), member('e3')];
    const rows = [row({ captainEmployeeIds: cells('e1'), specialist2EmployeeIds: cells('e3') })];
    expect(availablePool(members, rows).map((m) => m.employeeId)).toEqual(['e2']);
  });

  it('excludes BOTH occupants of a full slot', () => {
    const members = [member('e1'), member('e2'), member('e3')];
    const rows = [row({ captainEmployeeIds: cells('e1', 'e2') })];
    expect(availablePool(members, rows).map((m) => m.employeeId)).toEqual(['e3']);
  });

  it('returns everyone when nothing is assigned', () => {
    expect(availablePool([member('e1')], [row()])).toHaveLength(1);
  });
});

describe('filterPool — the legacy icon filters', () => {
  const members = [
    member('e1', { requirements: flags({ hasWeapon: true, isCaptain: true }) }),
    member('e2', { requirements: flags({ hasWeapon: true }) }),
    member('e3', { requirements: null }),
  ];

  it('returns everyone when no filter is active', () => {
    expect(filterPool(members, [], '')).toHaveLength(3);
  });

  it('narrows by a single flag', () => {
    expect(filterPool(members, ['hasWeapon'], '').map((m) => m.employeeId)).toEqual(['e1', 'e2']);
  });

  it('combines active flags with AND, as the legacy buttons did', () => {
    expect(filterPool(members, ['hasWeapon', 'isCaptain'], '').map((m) => m.employeeId)).toEqual([
      'e1',
    ]);
  });

  it('treats a member with no requirements row as matching no flag', () => {
    expect(filterPool(members, ['hasWeapon'], '').some((m) => m.employeeId === 'e3')).toBe(false);
  });

  it('searches name and code together', () => {
    expect(filterPool(members, [], 'E-e2').map((m) => m.employeeId)).toEqual(['e2']);
    expect(filterPool(members, [], 'موظف e3').map((m) => m.employeeId)).toEqual(['e3']);
  });
});

describe('changedRows — only what moved is sent', () => {
  const original = [
    row({ vehicleId: 'v1', captainEmployeeIds: cells('e1') }),
    row({ vehicleId: 'v2' }),
  ];

  it('is empty when nothing changed', () => {
    expect(changedRows(original, original)).toEqual([]);
  });

  it('reports a slot change', () => {
    const next = assignToSlot(original, 'v2', 'captain', 0, 'e2');
    expect(changedRows(next, original).map((r) => r.vehicleId)).toEqual(['v2']);
  });

  it('reports adding a second captain to a slot that already had one', () => {
    const next = assignToSlot(original, 'v1', 'captain', 1, 'e2');
    expect(changedRows(next, original).map((r) => r.vehicleId)).toEqual(['v1']);
  });

  it('reports BOTH rows when a move vacates one and fills another', () => {
    const next = assignToSlot(original, 'v2', 'captain', 0, 'e1');
    expect(changedRows(next, original).map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
  });

  it('does NOT report a member merely sliding to the other card of the same slot', () => {
    // The crew is identical; only the empty cell above them moved. Sending that row would take a
    // version bump for a write the server would correctly recognise as nothing.
    const next = assignToSlot(original, 'v1', 'captain', 1, 'e1');
    expect(changedRows(next, original)).toEqual([]);
  });

  it('reports a direction or notes change, not only crew changes', () => {
    const next = setRowField(original, 'v1', 'notes', 'ملاحظة');
    expect(changedRows(next, original).map((r) => r.vehicleId)).toEqual(['v1']);
  });

  it('treats a row the server did not send as new', () => {
    const next = [...original, row({ vehicleId: 'v3' })];
    expect(changedRows(next, original).map((r) => r.vehicleId)).toEqual(['v3']);
  });
});

describe('toPlanRows', () => {
  it('sends empty lists rather than omitting a cleared slot — absence means "leave alone"', () => {
    const [payload] = toPlanRows([row({ captainEmployeeIds: cells('e1') })]);
    expect(payload?.captainEmployeeIds).toEqual(['e1']);
    expect(payload?.specialist1EmployeeIds).toEqual([]);
    expect(payload).not.toHaveProperty('vehicleCode');
  });

  it('compacts the empty cell out of a slot rather than sending a hole', () => {
    // The wire carries a slot's OCCUPANTS; card positions are a board-editing concept.
    const [payload] = toPlanRows([row({ captainEmployeeIds: cells(null, 'e1') })]);
    expect(payload?.captainEmployeeIds).toEqual(['e1']);
  });

  it('sends both occupants of a full slot in card order', () => {
    const [payload] = toPlanRows([row({ captainEmployeeIds: cells('e1', 'e2') })]);
    expect(payload?.captainEmployeeIds).toEqual(['e1', 'e2']);
  });
});

describe('slot vocabulary', () => {
  it('is the legacy three: one captain slot and two specialist slots', () => {
    // The slot STRUCTURE is unchanged; only each slot's arity moved. A captain is not an
    // interchangeable head-count, which is why capacity did not collapse these into one list.
    expect([...CREW_SLOTS]).toEqual(['captain', 'specialist1', 'specialist2']);
  });

  it('offers CREW_SLOT_CAPACITY cards per slot — six people on a vehicle', () => {
    expect(SLOT_POSITIONS).toHaveLength(CREW_SLOT_CAPACITY);
    expect(CREW_SLOTS.length * CREW_SLOT_CAPACITY).toBe(6);
  });

  it('slotValue reads each card of each slot', () => {
    const r = row({
      captainEmployeeIds: cells('a', 'b'),
      specialist1EmployeeIds: cells('c'),
      specialist2EmployeeIds: cells(null, 'd'),
    });
    expect(CREW_SLOTS.map((s) => slotValue(r, s, 0))).toEqual(['a', 'c', null]);
    expect(CREW_SLOTS.map((s) => slotValue(r, s, 1))).toEqual(['b', null, 'd']);
  });
});


describe('assignCaptainWithCrew — a captain brings his crew with him', () => {
  /** v1 carries a full crew at card position 0; v2 is empty. */
  const loaded = (): BoardRow[] => [
    row({
      vehicleId: 'v1',
      captainEmployeeIds: cells('cap'),
      specialist1EmployeeIds: cells('s1'),
      specialist2EmployeeIds: cells('s2'),
    }),
    row({ vehicleId: 'v2' }),
  ];

  it('takes the two specialists to the new vehicle', () => {
    const next = assignCaptainWithCrew(loaded(), 'v2', 0, 'cap');
    expect(slotOccupants(next[1] as BoardRow, 'captain')).toEqual(['cap']);
    expect(slotOccupants(next[1] as BoardRow, 'specialist1')).toEqual(['s1']);
    expect(slotOccupants(next[1] as BoardRow, 'specialist2')).toEqual(['s2']);
  });

  it('MOVES them — the old vehicle is left empty, not duplicated', () => {
    const next = assignCaptainWithCrew(loaded(), 'v2', 0, 'cap');
    expect(rowCrew(next[0] as BoardRow)).toEqual([]);
    for (const id of ['cap', 's1', 's2']) expect(slotsHolding(next, id)).toHaveLength(1);
  });

  it('takes only HIS pair when the vehicle carries two captains', () => {
    // The board draws the three slots as columns of stacked cards, so the top cards line up as one
    // crew and the bottom cards as the other. Taking every specialist on the vehicle would drag
    // the OTHER captain's two along with him.
    const rows = [
      row({
        vehicleId: 'v1',
        captainEmployeeIds: cells('capA', 'capB'),
        specialist1EmployeeIds: cells('a1', 'b1'),
        specialist2EmployeeIds: cells('a2', 'b2'),
      }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 0, 'capB');
    expect(rowCrew(next[1] as BoardRow)).toEqual(['capB', 'b1', 'b2']);
    // capA keeps his own two, exactly where they were.
    expect(slotOccupants(next[0] as BoardRow, 'captain')).toEqual(['capA']);
    expect(slotOccupants(next[0] as BoardRow, 'specialist1')).toEqual(['a1']);
    expect(slotOccupants(next[0] as BoardRow, 'specialist2')).toEqual(['a2']);
  });

  it('takes EVERY specialist when he is the vehicle\u2019s only captain', () => {
    // There is no other captain they could belong to, so a whole van moves as a whole van.
    const rows = [
      row({
        vehicleId: 'v1',
        captainEmployeeIds: cells('cap'),
        specialist1EmployeeIds: cells('a1', 'a2'),
        specialist2EmployeeIds: cells('b1', 'b2'),
      }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 0, 'cap');
    expect(rowCrew(next[1] as BoardRow)).toEqual(['cap', 'a1', 'a2', 'b1', 'b2']);
    expect(rowCrew(next[0] as BoardRow)).toEqual([]);
  });

  it('takes a lone captain\u2019s specialist from the OTHER card too', () => {
    // He sits on the top card and his specialist on the bottom one. With one captain aboard there
    // is no pairing to respect, so position must not decide who is his.
    const rows = [
      row({
        vehicleId: 'v1',
        captainEmployeeIds: cells('cap'),
        specialist1EmployeeIds: cells(null, 'late'),
      }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 0, 'cap');
    expect(rowCrew(next[1] as BoardRow)).toEqual(['cap', 'late']);
  });

  it('lands a single companion on the captain\u2019s own card, keeping the crew aligned', () => {
    const rows = [
      row({ vehicleId: 'v1', captainEmployeeIds: cells('cap'), specialist1EmployeeIds: cells('s1') }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 1, 'cap');
    expect(slotValue(next[1] as BoardRow, 'captain', 1)).toBe('cap');
    expect(slotValue(next[1] as BoardRow, 'specialist1', 1)).toBe('s1');
  });

  it('brings whoever is there when the crew is short of a full three', () => {
    const rows = [
      row({ vehicleId: 'v1', captainEmployeeIds: cells('cap'), specialist2EmployeeIds: cells('s2') }),
      row({ vehicleId: 'v2' }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 0, 'cap');
    expect(rowCrew(next[1] as BoardRow)).toEqual(['cap', 's2']);
  });

  it('arrives ALONE from the pool — nobody is with him yet', () => {
    // Dragging one card must not silently move people who were never placed together.
    const next = assignCaptainWithCrew([row({ vehicleId: 'v1' })], 'v1', 0, 'stranger');
    expect(rowCrew(next[0] as BoardRow)).toEqual(['stranger']);
  });

  it('displaces whoever held the target cards, as any drop does', () => {
    const rows = [
      row({
        vehicleId: 'v1',
        captainEmployeeIds: cells('cap'),
        specialist1EmployeeIds: cells('s1'),
      }),
      row({ vehicleId: 'v2', specialist1EmployeeIds: cells('sitting') }),
    ];
    const next = assignCaptainWithCrew(rows, 'v2', 0, 'cap');
    expect(slotOccupants(next[1] as BoardRow, 'specialist1')).toEqual(['s1']);
    expect(slotsHolding(next, 'sitting')).toEqual([]);
  });

  it('moves a crew between card positions on the SAME vehicle', () => {
    const rows = [
      row({
        vehicleId: 'v1',
        captainEmployeeIds: cells('cap'),
        specialist1EmployeeIds: cells('s1'),
        specialist2EmployeeIds: cells('s2'),
      }),
    ];
    const next = assignCaptainWithCrew(rows, 'v1', 1, 'cap');
    expect(slotValue(next[0] as BoardRow, 'captain', 1)).toBe('cap');
    expect(slotValue(next[0] as BoardRow, 'specialist1', 1)).toBe('s1');
    expect(slotValue(next[0] as BoardRow, 'specialist2', 1)).toBe('s2');
    expect(slotValue(next[0] as BoardRow, 'captain', 0)).toBeNull();
  });

  it('does not mutate the rows it was given', () => {
    const rows = loaded();
    assignCaptainWithCrew(rows, 'v2', 0, 'cap');
    expect(rowCrew(rows[0] as BoardRow)).toEqual(['cap', 's1', 's2']);
  });
});
