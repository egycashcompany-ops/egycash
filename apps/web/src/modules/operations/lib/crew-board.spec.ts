// The crew board's interaction, asserted as state transitions.
//
// The legacy board enforced its one rule — a crew member holds one vehicle per day — in browser
// JavaScript (tashghela.ejs:1332) while the server blind-upserted whatever it was sent (:2413).
// The rule now lives in the domain; what is tested here is that a DROP produces the end state the
// domain will accept, so the operator is never shown a plan the save then rejects.
import { describe, expect, it } from 'vitest';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import {
  CREW_SLOTS,
  assignToSlot,
  availablePool,
  changedRows,
  clearSlot,
  filterPool,
  setRowField,
  slotValue,
  slotsHolding,
  toBoardRows,
  toPlanRows,
  type BoardRow,
} from './crew-board';

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  vehicleId: 'v1',
  vehicleCode: 'C-1',
  captainEmployeeId: null,
  specialist1EmployeeId: null,
  specialist2EmployeeId: null,
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
    expect(built?.captainEmployeeId).toBeNull();
    expect(built?.specialist1EmployeeId).toBeNull();
    expect(built?.specialist2EmployeeId).toBeNull();
  });
});

describe('assignToSlot — a drop', () => {
  it('fills the target slot', () => {
    const next = assignToSlot([row()], 'v1', 'captain', 'e1');
    expect(next[0]?.captainEmployeeId).toBe('e1');
  });

  it('MOVES a member already crewed on another vehicle (Q11 — one vehicle per day)', () => {
    const rows = [row({ vehicleId: 'v1', captainEmployeeId: 'e1' }), row({ vehicleId: 'v2' })];
    const next = assignToSlot(rows, 'v2', 'captain', 'e1');
    // The old slot is vacated, so the end state is one the server accepts.
    expect(next[0]?.captainEmployeeId).toBeNull();
    expect(next[1]?.captainEmployeeId).toBe('e1');
    expect(slotsHolding(next, 'e1')).toHaveLength(1);
  });

  it('moves a member between slots on the SAME vehicle without cloning them', () => {
    const rows = [row({ specialist1EmployeeId: 'e1' })];
    const next = assignToSlot(rows, 'v1', 'specialist2', 'e1');
    expect(next[0]?.specialist1EmployeeId).toBeNull();
    expect(next[0]?.specialist2EmployeeId).toBe('e1');
  });

  it('displaces whoever held the target slot — a slot holds one person', () => {
    const rows = [row({ captainEmployeeId: 'e1' })];
    const next = assignToSlot(rows, 'v1', 'captain', 'e2');
    expect(next[0]?.captainEmployeeId).toBe('e2');
    expect(slotsHolding(next, 'e1')).toHaveLength(0);
  });

  it('never leaves anyone in two slots, whatever the sequence of drops', () => {
    let rows = [row({ vehicleId: 'v1' }), row({ vehicleId: 'v2' })];
    rows = assignToSlot(rows, 'v1', 'captain', 'e1');
    rows = assignToSlot(rows, 'v2', 'specialist1', 'e1');
    rows = assignToSlot(rows, 'v1', 'specialist2', 'e1');
    expect(slotsHolding(rows, 'e1')).toEqual([{ vehicleId: 'v1', slot: 'specialist2' }]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [row()];
    assignToSlot(rows, 'v1', 'captain', 'e1');
    expect(rows[0]?.captainEmployeeId).toBeNull();
  });
});

describe('clearSlot', () => {
  it('empties one slot and leaves the others alone', () => {
    const rows = [row({ captainEmployeeId: 'e1', specialist1EmployeeId: 'e2' })];
    const next = clearSlot(rows, 'v1', 'captain');
    expect(next[0]?.captainEmployeeId).toBeNull();
    expect(next[0]?.specialist1EmployeeId).toBe('e2');
  });

  it('leaves other vehicles untouched', () => {
    const rows = [row({ vehicleId: 'v1', captainEmployeeId: 'e1' }), row({ vehicleId: 'v2', captainEmployeeId: 'e2' })];
    const next = clearSlot(rows, 'v1', 'captain');
    expect(next[1]?.captainEmployeeId).toBe('e2');
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
  it('excludes everyone currently in a slot', () => {
    const members = [member('e1'), member('e2'), member('e3')];
    const rows = [row({ captainEmployeeId: 'e1', specialist2EmployeeId: 'e3' })];
    expect(availablePool(members, rows).map((m) => m.employeeId)).toEqual(['e2']);
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
  const original = [row({ vehicleId: 'v1', captainEmployeeId: 'e1' }), row({ vehicleId: 'v2' })];

  it('is empty when nothing changed', () => {
    expect(changedRows(original, original)).toEqual([]);
  });

  it('reports a slot change', () => {
    const next = assignToSlot(original, 'v2', 'captain', 'e2');
    expect(changedRows(next, original).map((r) => r.vehicleId)).toEqual(['v2']);
  });

  it('reports BOTH rows when a move vacates one and fills another', () => {
    const next = assignToSlot(original, 'v2', 'captain', 'e1');
    expect(changedRows(next, original).map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
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
  it('sends nulls rather than omitting a cleared slot — absence means "leave alone"', () => {
    const [payload] = toPlanRows([row({ captainEmployeeId: 'e1' })]);
    expect(payload?.captainEmployeeId).toBe('e1');
    expect(payload?.specialist1EmployeeId).toBeNull();
    expect(payload).not.toHaveProperty('vehicleCode');
  });
});

describe('slot vocabulary', () => {
  it('is the legacy three: one captain and two specialists', () => {
    expect([...CREW_SLOTS]).toEqual(['captain', 'specialist1', 'specialist2']);
  });

  it('slotValue reads each slot', () => {
    const r = row({ captainEmployeeId: 'a', specialist1EmployeeId: 'b', specialist2EmployeeId: 'c' });
    expect(CREW_SLOTS.map((s) => slotValue(r, s))).toEqual(['a', 'b', 'c']);
  });
});
