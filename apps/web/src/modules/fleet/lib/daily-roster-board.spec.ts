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
  hasEdits,
  isDirty,
  rowsToSave,
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
  planned: false,
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
    // …except into slot 2 of a vehicle with no first driver, which is the one state a day may
    // not be in: `operations/crew-board` reads slot 1 as "the driver".
    expect(crews(assignDriver(BOARD, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([
      '150:e1/-',
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
    expect(hasEdits(before, after), 'nothing was edited').toBe(false);
    expect(changedRows(before, after)).toEqual([]);
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
    expect(
      hasEdits(withWorkshop, assignDriver(withWorkshop, 'v1', 'driver1EmployeeId', 'e1')),
    ).toBe(false);
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
  it('reports NO EDITS when nothing moved', () => {
    const derived = [row('v1', '150', 'e1'), row('v2', '151', 'e2')];
    expect(changedRows(derived, derived)).toEqual([]);
    expect(hasEdits(derived, derived)).toBe(false);
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

// ── التشغيله reaches Operations whether or not it was touched ──────────────
//
// The defect this block exists for. A row's operation can arrive two ways: read back from a
// stored `fleet_duty_assignment` (`planned: true`), or PROJECTED from the standing crew because
// no such row exists (`planned: false`). `operations/crew-board` builds its day by iterating the
// duty documents — so a vehicle whose operation was only ever projected is not on that board at
// all. Sending only what CHANGED therefore made "the dispatcher agreed with the standing crew"
// indistinguishable from "there is nothing to plan", and the operation never arrived.
//
// Not changing a value is not the same as not wanting it saved.
describe('rowsToSave — the operation is committed either way', () => {
  const derived = (vehicleId: string, code: string, mission: string | null, d1: string | null) =>
    row(vehicleId, code, d1, null, { planned: false, missionTypeId: mission });
  const stored = (vehicleId: string, code: string, mission: string | null, d1: string | null) =>
    row(vehicleId, code, d1, null, { planned: true, missionTypeId: mission });

  it('CASE 1 — inherited from the fixed roster and UNTOUCHED: still saved', () => {
    const baseline = [derived('v1', '150', 'm1', 'e1')];
    expect(rowsToSave(baseline, baseline)).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: 'm1',
        driver1EmployeeId: 'e1',
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
    expect(isDirty(baseline, baseline), 'so the Save button is live').toBe(true);
    expect(hasEdits(baseline, baseline), 'even though nothing was edited').toBe(false);
  });

  it('CASE 2 — CHANGED by the dispatcher: the new value is what travels', () => {
    const baseline = [derived('v1', '150', 'm1', 'e1')];
    const draft = setMission(baseline, 'v1', 'm2');
    expect(rowsToSave(baseline, draft)[0]?.missionTypeId).toBe('m2');
    expect(hasEdits(baseline, draft)).toBe(true);
  });

  it('an operation with no crew still travels — a vehicle can be given work before a driver', () => {
    const baseline = [derived('v1', '150', 'm1', null)];
    expect(rowsToSave(baseline, baseline)).toHaveLength(1);
  });

  it('a row that is ALREADY stored and untouched is not sent again', () => {
    // Once materialised the row comes back `planned: true`, so a second save is not a rewrite
    // of the whole fleet — and the audit trail does not fill with no-op entries.
    const baseline = [stored('v1', '150', 'm1', 'e1')];
    expect(rowsToSave(baseline, baseline)).toEqual([]);
    expect(isDirty(baseline, baseline)).toBe(false);
  });

  it('an idle vehicle is NOT materialised — the whole fleet does not land on the crew board', () => {
    const baseline = [derived('v1', '150', null, null)];
    expect(rowsToSave(baseline, baseline)).toEqual([]);
    expect(isDirty(baseline, baseline)).toBe(false);
  });

  it('EMPTYING a stored row is still saved, so "runs nobody today" stays expressible', () => {
    const baseline = [stored('v1', '150', 'm1', 'e1')];
    let draft = clearSlot(baseline, 'v1', 'driver1EmployeeId');
    draft = setMission(draft, 'v1', null);
    expect(rowsToSave(baseline, draft)).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('mixes both kinds in ONE payload', () => {
    const baseline = [derived('v1', '150', 'm1', 'e1'), stored('v2', '151', 'm1', 'e2')];
    const draft = setMission(baseline, 'v2', 'm2');
    const sent = rowsToSave(baseline, draft);
    expect(sent.map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
    expect(sent.find((r) => r.vehicleId === 'v1')?.missionTypeId, 'the untouched one').toBe('m1');
    expect(sent.find((r) => r.vehicleId === 'v2')?.missionTypeId, 'the changed one').toBe('m2');
  });

  it('does not send a row twice when it is both changed and unplanned', () => {
    const baseline = [derived('v1', '150', 'm1', 'e1')];
    const draft = setMission(baseline, 'v1', 'm2');
    expect(rowsToSave(baseline, draft)).toHaveLength(1);
  });
});

// ── a second driver needs a first, on the DAY ──────────────────────────────
describe('the day cannot hold a second driver with no first', () => {
  const lonely = (rows: readonly FleetRosterRowDto[]) =>
    rows.filter((r) => r.driver1EmployeeId === null && r.driver2EmployeeId !== null);

  it('cannot be produced by dropping onto slot 2 of an empty vehicle', () => {
    expect(lonely(assignDriver(BOARD, 'v1', 'driver2EmployeeId', 'e1'))).toEqual([]);
  });

  it('cannot be produced by clearing slot 1 — the second driver is promoted', () => {
    const before = [row('v1', '150', 'e1', 'e2')];
    const after = clearSlot(before, 'v1', 'driver1EmployeeId');
    expect(lonely(after)).toEqual([]);
    expect(crews(after)).toEqual(['150:e2/-']);
  });

  it('cannot be produced by dragging the FIRST driver away to another vehicle', () => {
    const before = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    const after = assignDriver(before, 'v2', 'driver1EmployeeId', 'e1');
    expect(lonely(after)).toEqual([]);
    expect(crews(after)).toEqual(['150:e2/-', '151:e1/-']);
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
        for (const slot of DUTY_SLOTS) {
          for (const who of ['e1', 'e2', 'e3', 'e4']) {
            expect(lonely(assignDriver(start, vehicleId, slot, who))).toEqual([]);
          }
          expect(lonely(clearSlot(start, vehicleId, slot))).toEqual([]);
        }
      }
    }
  });

  it('never sends such a pair to the server', () => {
    const baseline = [row('v1', '150', 'e1', 'e2', { planned: true })];
    const draft = clearSlot(baseline, 'v1', 'driver1EmployeeId');
    for (const sent of rowsToSave(baseline, draft)) {
      expect(
        sent.driver1EmployeeId === null && sent.driver2EmployeeId !== null,
        'the payload cannot carry the refused pair',
      ).toBe(false);
    }
  });
});

// ── FR-5 governs materialisation, not just drops ───────────────────────────
//
// A real bug, and the shape of it is worth keeping in front of whoever reads this next.
//
// `board()` PROJECTS the standing mission onto a vehicle the workshop holds — the mission is a
// fact about the vehicle's standing work, so it is shown — while withdrawing its crew. The
// server, though, counts a mission-only row as an ASSIGNMENT (`assigns()` is
// `missionTypeId != null || drivers.length > 0`), and FR-5 refuses to store an assignment for a
// vehicle with an open visit covering the date. So offering to materialise that projection was
// proposing precisely the write the rule exists to reject — and since `plan()` throws before its
// transaction, ONE car in the workshop failed the whole day's save:
//
//   vehicle 213 has an open maintenance visit covering this date and is unassignable (FR-5)
//
// The rule is untouched and nothing is swallowed. The board simply stops proposing an illegal
// write, exactly as its slot cell already refuses to be a drop target for the same vehicle.
describe('a vehicle the workshop holds is not materialised', () => {
  const inShop = (vehicleId: string, code: string, mission: string | null) =>
    row(vehicleId, code, null, null, {
      planned: false,
      inMaintenance: true,
      missionTypeId: mission,
    });
  const free = (vehicleId: string, code: string, mission: string | null, d1: string | null = null) =>
    row(vehicleId, code, d1, null, { planned: false, missionTypeId: mission });

  it('CASE 1 — an in-workshop vehicle with an INHERITED operation is not sent', () => {
    const baseline = [inShop('v213', '213', 'm1')];
    expect(rowsToSave(baseline, baseline), 'the save proposes nothing for it').toEqual([]);
    expect(isDirty(baseline, baseline), 'and it alone does not arm the button').toBe(false);
  });

  it('CASE 2 — an ASSIGNABLE vehicle with an inherited operation is still materialised', () => {
    const baseline = [free('v1', '150', 'm1', 'e1')];
    expect(rowsToSave(baseline, baseline)).toEqual([
      {
        vehicleId: 'v1',
        missionTypeId: 'm1',
        driver1EmployeeId: 'e1',
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('CASE 3 — an EXPLICIT attempt on an in-workshop vehicle still travels, and FR-5 refuses it', () => {
    // The rule must stay reachable. Changing the mission of an in-workshop vehicle is a genuine
    // edit, so it goes through the `changed` branch, reaches the server, and is rejected there —
    // which is where FR-5 belongs. Silently dropping it here would be the bypass we must not add.
    const baseline = [inShop('v213', '213', 'm1')];
    const draft = setMission(baseline, 'v213', 'm2');
    expect(rowsToSave(baseline, draft), 'the illegal write is still proposed, and refused').toEqual(
      [
        {
          vehicleId: 'v213',
          missionTypeId: 'm2',
          driver1EmployeeId: null,
          driver2EmployeeId: null,
          notes: null,
        },
      ],
    );
  });

  it('CASE 4 — one unassignable vehicle does not cost the rest of the roster its save', () => {
    // The failure this fixes: `plan()` throws on the first offending row, before its transaction,
    // so a single in-workshop car took every other vehicle's day down with it.
    const baseline = [
      free('v1', '150', 'm1', 'e1'),
      inShop('v213', '213', 'm1'),
      free('v2', '151', 'm2', 'e2'),
    ];
    const sent = rowsToSave(baseline, baseline);
    expect(sent.map((r) => r.vehicleId).sort(), 'the assignable two, and only those').toEqual([
      'v1',
      'v2',
    ]);
    expect(isDirty(baseline, baseline), 'and the day is still worth saving').toBe(true);
  });

  it('CLEARING a stored in-workshop row is still sent — FR-5 allows a clear', () => {
    // `assigns()` is false for a row that only clears, so the server accepts it. A car that goes
    // into the workshop mid-plan must still be emptiable for that day.
    const baseline = [
      row('v213', '213', 'e1', null, { planned: true, inMaintenance: true, missionTypeId: 'm1' }),
    ];
    let draft = clearSlot(baseline, 'v213', 'driver1EmployeeId');
    draft = setMission(draft, 'v213', null);
    expect(rowsToSave(baseline, draft)).toEqual([
      {
        vehicleId: 'v213',
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
  });

  it('an in-workshop vehicle ALREADY stored and untouched is not re-sent', () => {
    const baseline = [
      row('v213', '213', null, null, { planned: true, inMaintenance: true, missionTypeId: 'm1' }),
    ];
    expect(rowsToSave(baseline, baseline)).toEqual([]);
  });

  it('the same vehicle IS materialised on a day it is not in the workshop', () => {
    // The exclusion is about the DAY, not the vehicle: `inMaintenance` is derived per date, so
    // the projection is committed as soon as the visit no longer covers the date being planned.
    const baseline = [free('v213', '213', 'm1')];
    expect(rowsToSave(baseline, baseline)).toHaveLength(1);
  });

  it('never proposes a write for a vehicle the board itself marks undroppable', () => {
    // The two must agree. The cell refuses the drop when `inMaintenance`; the save must refuse
    // the materialisation on exactly the same condition, or the screen contradicts itself.
    const baseline = [inShop('a', '1', 'm1'), inShop('b', '2', 'm2'), free('c', '3', 'm3')];
    for (const sent of rowsToSave(baseline, baseline)) {
      const source = baseline.find((r) => r.vehicleId === sent.vehicleId);
      expect(source?.inMaintenance, `${sent.vehicleId} is in the workshop`).toBe(false);
    }
  });
});

// ── a drag edits what it touches, and nothing else ─────────────────────────
//
// The same defect the fixed board carried, and worse here. `seatOrder` is a normalisation, and
// applied to EVERY row it silently promotes the second driver of any row stored before that rule
// existed — rows nobody touched. Those rows then differ from the baseline, so `rowsToSave` sends
// them; and because this board also MATERIALISES unplanned rows, a stray promotion would become a
// stored `fleet_duty_assignment` for a vehicle the dispatcher never looked at.
describe('a drag leaves untouched vehicles alone', () => {
  const legacy = (vehicleId: string, code: string, d2: string) =>
    row(vehicleId, code, null, d2, { planned: true, missionTypeId: 'm1' });

  it('returns an unrelated row exactly as it came in', () => {
    // By VALUE: `rowsToSave` measures rows by value, so an unchanged row is not sent whether the
    // implementation returns the same object or an equal copy.
    const baseline = [legacy('v1', '150', 'e9'), row('v2', '151'), row('v3', '152', 'e3')];
    const after = assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e3');
    expect(after[0]).toEqual(baseline[0]);
  });

  it('does not drag an untouched legacy row into the payload', () => {
    const baseline = [legacy('v1', '150', 'e9'), row('v2', '151'), row('v3', '152', 'e3')];
    const sent = rowsToSave(baseline, assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e3'));
    expect(sent.map((r) => r.vehicleId).sort(), 'only the two sides of the move').toEqual([
      'v2',
      'v3',
    ]);
  });

  it('does not count an untouched legacy row as an EDIT', () => {
    // `rowsToSave` has two doors, and the one above only closes the second. This is the first:
    // `changedRows` is the edit path, and a stray normalisation makes an untouched row differ
    // from the baseline — which is an edit the dispatcher never made, sent under their name.
    const baseline = [legacy('v1', '150', 'e9'), row('v2', '151'), row('v3', '152', 'e3')];
    const edited = changedRows(baseline, assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e3'));
    expect(edited.map((r) => r.vehicleId)).not.toContain('v1');
  });

  it('materialises an untouched projection with the crew it was GIVEN, unpromoted', () => {
    // An unplanned row that holds something IS sent — that is the projection being made real,
    // and it happens whether or not anybody dragged anything. What must not happen is the drag
    // CHANGING what gets written: a stray promotion would store this car with e9 as its first
    // driver, a crew nobody entered, on a date nobody opened.
    const baseline = [
      row('v1', '150', null, 'e9', { planned: false, missionTypeId: 'm1' }),
      row('v2', '151'),
      row('v3', '152', 'e3'),
    ];
    const sent = rowsToSave(baseline, assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e3'));
    expect(sent.find((r) => r.vehicleId === 'v1')).toEqual({
      vehicleId: 'v1',
      missionTypeId: 'm1',
      driver1EmployeeId: null,
      driver2EmployeeId: 'e9',
      notes: null,
    });
  });

  it('STILL normalises the vehicle the drag actually empties', () => {
    const baseline = [row('v1', '150', 'e1', 'e2'), row('v2', '151')];
    const after = assignDriver(baseline, 'v2', 'driver1EmployeeId', 'e1');
    expect(crews(after)).toEqual(['150:e2/-', '151:e1/-']);
  });
});
