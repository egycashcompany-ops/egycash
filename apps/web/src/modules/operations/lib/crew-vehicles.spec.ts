// «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم» (Round 24).
//
// What the «بدون سيارة» cell offers (`vehicleChoices` — the server's `freeVehicles` through the
// draft), what a pick does to the draft (`giveVehicle`), and the body the save then sends — a body
// `PlanOperationsCrewSchema` itself takes, in each of the shapes the contract names.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PlanOperationsCrewSchema,
  type OperationsCrewBoardDto,
  type OperationsCrewBoardFreeVehicleDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import {
  discardRow,
  isRemovableRow,
  looseRowNumber,
  placeMember,
  planChanges,
  planRefusal,
  patchRow,
  rebaseDraft,
  releaseVan,
  restoreRemovedRow,
  rowPeople,
  takeVehicle,
  toPlan,
  toPlanRows,
  vehiclelessRow,
  type PlanRow,
} from './crew-plan';
import { giveVehicle, searchVehicleChoices, vehicleChoices } from './crew-vehicles';

// Real ids, as the wire carries them: the schema checks every id is an ObjectId.
const id = (n: number): string => n.toString(16).padStart(24, 'b');

const free = (
  n: number,
  code: string,
  over: Partial<OperationsCrewBoardFreeVehicleDto> = {},
): OperationsCrewBoardFreeVehicleDto => ({
  vehicleId: id(n),
  vehicleCode: code,
  group: 'other',
  onRoster: false,
  inWorkshop: false,
  drivers: [],
  ...over,
});

const crew = (crewId: string, over: Record<string, unknown> = {}) => ({
  id: crewId,
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  notes: null,
  shiftTypeId: null,
  rowColour: null,
  ...over,
});

/** A day: roster vans 249 (crewed) and 250 (blank), an off-roster van row 777, two loose rows. */
const BOARD: OperationsCrewBoardDto = {
  date: '2026-11-17T00:00:00.000Z',
  day: null,
  rows: [
    {
      vehicleId: id(1),
      vehicleCode: '249',
      fleetDutyAssignmentId: id(91),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      drivers: [{ employeeId: id(81), fullNameAr: 'سائق أول' }],
      missionTypeId: null,
      crew: crew(id(11), { captainEmployeeIds: [id(61)] }),
    },
    {
      vehicleId: id(2),
      vehicleCode: '250',
      fleetDutyAssignmentId: id(92),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      drivers: [{ employeeId: id(82), fullNameAr: 'سائق ثان' }],
      missionTypeId: null,
      crew: null,
    },
    {
      vehicleId: id(7),
      vehicleCode: '777',
      fleetDutyAssignmentId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      drivers: [],
      missionTypeId: null,
      crew: crew(id(17), { captainEmployeeIds: [id(67)] }),
    },
  ],
  vehiclelessRows: [
    crew(id(21), { captainEmployeeIds: [id(62)], specialist1EmployeeIds: [id(63)] }),
    crew(id(22), { notes: 'انتظار' }),
  ],
  workshopVehicles: [{ vehicleId: id(5), vehicleCode: '310' }],
  freeVehicles: [
    free(2, '250', {
      group: 'roster',
      onRoster: true,
      drivers: [{ employeeId: id(82), fullNameAr: 'سائق ثان' }],
    }),
    free(3, 'P10', { group: 'cashTransfer' }),
    free(4, 'P9', { group: 'cashTransfer' }),
    free(5, '310', { group: 'standing', inWorkshop: true }),
    free(6, '150', { group: 'other' }),
  ],
};

const ORIGINAL = toPlanRows(BOARD);
const LOOSE = `loose:${id(21)}`;
const choicesFor = (rows: readonly PlanRow[], key: string) =>
  vehicleChoices(rows, ORIGINAL, BOARD.freeVehicles, key, new Set([id(5)]));

describe('the board reads which vans the roster has (`onRoster`)', () => {
  it('a van off the Fleet roster is listed with its code, no drivers, and may be deleted', () => {
    const off = ORIGINAL.find((row) => row.vehicleCode === '777');
    expect(off).toMatchObject({ onRoster: false, drivers: [], crewId: id(17) });
    expect(isRemovableRow(off as PlanRow)).toBe(true);
    expect(isRemovableRow(ORIGINAL[0] as PlanRow)).toBe(false);
    // The bin deletes it — and the save says so; a roster van's row is only emptied.
    const next = discardRow(ORIGINAL, `van:${id(7)}`);
    expect(next.map((row) => row.key)).not.toContain(`van:${id(7)}`);
    expect(planChanges(next, ORIGINAL).removedCrewIds).toEqual([id(17)]);
    expect(planChanges(discardRow(ORIGINAL, `van:${id(1)}`), ORIGINAL).removedCrewIds).toEqual([]);
  });

  it('its «إضافية» tag sits UNDER the code, never beside it — the column keeps its width at 1440', () => {
    // Beside the code (and the «short of» mark) it widened the van column from 65px to 95px at
    // 1440: the table ran 31px past its frame, the row's bin and colour out of sight.
    const page = readFileSync(
      fileURLToPath(new URL('../pages/CrewBoardPage.tsx', import.meta.url)),
      'utf8',
    );
    expect(page).toMatch(
      /<span className="flex flex-col items-start gap-0\.5" data-van-code-stack="true">\s*<CrewVehicleHoverCode[\s\S]*?\{releasable \? \([\s\S]*?data-van-release=[\s\S]*?<\/button>\s*\) : \(\s*!row\.onRoster && \([\s\S]*?data-off-roster="true"[\s\S]*?<\/span>\s*\)\s*\)\}\s*<\/span>\s*\{warn\}/,
    );
  });
});

describe('vehicleChoices — every car with no crew, through the draft', () => {
  it('the roster’s blank vans first with their drivers, then the server’s groups by code — a workshop car marked and closed', () => {
    const choices = choicesFor(ORIGINAL, LOOSE);
    expect(choices.map((choice) => choice.vehicleCode)).toEqual(['250', 'P9', 'P10', '310', '150']);
    expect(choices[0]).toMatchObject({
      group: 'roster',
      onRoster: true,
      vanKey: `van:${id(2)}`,
      pickable: true,
      drivers: [{ employeeId: id(82), fullNameAr: 'سائق ثان' }],
    });
    expect(choices.find((choice) => choice.vehicleCode === '310')).toMatchObject({
      inWorkshop: true,
      pickable: false,
      group: 'standing',
    });
    // A crewed roster van and an off-roster van another row holds are never offered.
    expect(choices.map((choice) => choice.vehicleCode)).not.toContain('249');
    expect(choices.map((choice) => choice.vehicleCode)).not.toContain('777');
  });

  it('a car another row of the draft was given a moment ago is not offered again', () => {
    const p9 = choicesFor(ORIGINAL, LOOSE).find((choice) => choice.vehicleCode === 'P9');
    const given = giveVehicle(ORIGINAL, LOOSE, p9!);
    const other = `loose:${id(22)}`;
    expect(choicesFor(given, other).map((choice) => choice.vehicleCode)).not.toContain('P9');
  });

  it('a van whose off-roster row was deleted here is free again; a row with a van asks nothing', () => {
    const deleted = discardRow(ORIGINAL, `van:${id(7)}`);
    expect(choicesFor(deleted, LOOSE).map((choice) => choice.vehicleCode)).toContain('777');
    expect(choicesFor(ORIGINAL, `van:${id(1)}`)).toEqual([]);
  });

  it('a roster van emptied HERE is offered to a row added here, not to a saved one (the server still holds it)', () => {
    const emptied = discardRow(ORIGINAL, `van:${id(1)}`);
    const added = [...emptied, vehiclelessRow(1)];
    expect(choicesFor(added, 'new:1').map((choice) => choice.vehicleCode)).toContain('249');
    expect(choicesFor(added, LOOSE).map((choice) => choice.vehicleCode)).not.toContain('249');
  });

  it('searches by code, in either keyboard’s digits, or by a roster van’s driver', () => {
    const choices = choicesFor(ORIGINAL, LOOSE);
    expect(searchVehicleChoices(choices, '١٥٠').map((choice) => choice.vehicleCode)).toEqual([
      '150',
    ]);
    expect(searchVehicleChoices(choices, 'p9 - 310').map((choice) => choice.vehicleCode)).toEqual([
      'P9',
      '310',
    ]);
    expect(searchVehicleChoices(choices, 'سائق').map((choice) => choice.vehicleCode)).toEqual([
      '250',
    ]);
    expect(searchVehicleChoices(choices, '')).toHaveLength(choices.length);
  });
});

describe('giveVehicle → the save — the contract’s shapes', () => {
  const parse = (body: unknown): void => {
    const parsed = PlanOperationsCrewSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  };

  it('a SAVED row given a van off the roster: it takes it where it stands — «row X takes van V»', () => {
    const p9 = choicesFor(ORIGINAL, LOOSE).find((choice) => choice.vehicleCode === 'P9');
    const next = giveVehicle(ORIGINAL, LOOSE, p9!);
    const row = next.find((candidate) => candidate.key === LOOSE);
    expect(row).toMatchObject({
      vehicleId: id(4),
      vehicleCode: 'P9',
      onRoster: false,
      crewId: id(21),
    });
    // Still where it stood; now removable (off the roster) — and nothing is removed by the save.
    expect(next.map((candidate) => candidate.key)).toEqual(
      ORIGINAL.map((candidate) => candidate.key),
    );
    const body = toPlan('2026-11-17', planChanges(next, ORIGINAL));
    expect(body).not.toHaveProperty('removeCrewAssignmentIds');
    expect(body.rows).toEqual([
      expect.objectContaining({
        vehicleId: id(4),
        crewAssignmentId: id(21),
        captainEmployeeIds: [id(62)],
        specialist1EmployeeIds: [id(63)],
      }),
    ]);
    parse(body);
  });

  it('a SAVED row given a blank ROSTER van: merged into the van’s row, keeping its own id', () => {
    const roster = choicesFor(ORIGINAL, LOOSE)[0];
    const next = giveVehicle(ORIGINAL, LOOSE, roster!);
    expect(next.map((row) => row.key)).not.toContain(LOOSE);
    expect(next[1]).toMatchObject({ key: `van:${id(2)}`, crewId: id(21), onRoster: true });
    const body = toPlan('2026-11-17', planChanges(next, ORIGINAL));
    expect(body).not.toHaveProperty('removeCrewAssignmentIds');
    expect(body.rows).toEqual([
      expect.objectContaining({ vehicleId: id(2), crewAssignmentId: id(21) }),
    ]);
    parse(body);
  });

  it('a row ADDED here given a van off the roster: a new van row — saved even with nothing else on it', () => {
    const added = [...ORIGINAL, vehiclelessRow(1)];
    const car = choicesFor(added, 'new:1').find((choice) => choice.vehicleCode === '150');
    const next = giveVehicle(added, 'new:1', car!);
    const body = toPlan('2026-11-17', planChanges(next, ORIGINAL));
    expect(body.rows).toEqual([
      expect.objectContaining({ vehicleId: id(6), captainEmployeeIds: [] }),
    ]);
    expect(body.rows[0]).not.toHaveProperty('crewAssignmentId');
    parse(body);
  });

  it('a car the save would refuse, or one already taken, changes nothing', () => {
    const workshop = choicesFor(ORIGINAL, LOOSE).find((choice) => choice.vehicleCode === '310');
    expect(giveVehicle(ORIGINAL, LOOSE, workshop!)).toBe(ORIGINAL);
    const taken = { vehicleId: id(7), vehicleCode: '777', onRoster: false, drivers: [] };
    expect(takeVehicle(ORIGINAL, LOOSE, taken)).toBe(ORIGINAL);
  });

  it('another desk’s save under a row given a van here keeps the van this desk gave it', () => {
    const p9 = choicesFor(ORIGINAL, LOOSE).find((choice) => choice.vehicleCode === 'P9');
    const draft = giveVehicle(ORIGINAL, LOOSE, p9!);
    const next = ORIGINAL.map((row) =>
      row.key === `van:${id(1)}` ? { ...row, notes: 'desk 2' } : row,
    );
    const rebased = rebaseDraft(draft, ORIGINAL, next);
    expect(rebased.find((row) => row.key === LOOSE)).toMatchObject({
      vehicleId: id(4),
      vehicleCode: 'P9',
      crewId: id(21),
    });
    expect(rebased.find((row) => row.key === `van:${id(1)}`)?.notes).toBe('desk 2');
  });
});

describe('the save refuses the van, or the removal (Round 24)', () => {
  it('names the row whose van was refused, and why — in both languages', () => {
    const p9 = choicesFor(ORIGINAL, LOOSE).find((choice) => choice.vehicleCode === 'P9');
    const sent = planChanges(giveVehicle(ORIGINAL, LOOSE, p9!), ORIGINAL).changed;
    for (const [code, reason] of [
      ['OPERATIONS_CREW_VEHICLE_TAKEN', 'taken'],
      ['OPERATIONS_CREW_VEHICLE_IN_WORKSHOP', 'inWorkshop'],
      ['OPERATIONS_CREW_VEHICLE_NOT_ACTIVE', 'notActive'],
    ] as const) {
      const failure = new ApiError(code, 'refused', code.endsWith('TAKEN') ? 409 : 422, [
        { field: 'vehicleId', code: 'X', message: id(4) },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ]);
      expect(planRefusal(failure, sent)).toMatchObject({
        key: LOOSE,
        field: 'vehicle',
        vehicle: { vehicleId: id(4), reason },
      });
      expect(errorMessage(failure, 'ar')).not.toBe(errorMessage(failure, 'en'));
      expect(errorMessage(failure, 'ar')).toContain('للصف المُعلَّم');
    }
  });

  it('a deleted row holding محصنات: named by its id, and put back where it was', () => {
    const failure = new ApiError('OPERATIONS_CREW_ROW_HAS_SHIPMENTS', 'held', 409, [
      { field: 'crewAssignmentId', code: 'CREW_ROW', message: id(21) },
      { field: 'shipments', code: 'COUNT', message: '3' },
      { field: 'removeCrewAssignmentIds', code: 'REMOVAL_INDEX', message: '0' },
    ]);
    expect(planRefusal(failure, [])).toMatchObject({
      field: 'remove',
      removed: { crewId: id(21), shipments: 3 },
    });
    const deleted = discardRow(ORIGINAL, LOOSE);
    const back = restoreRemovedRow(deleted, ORIGINAL, id(21));
    expect(back.map((row) => row.key)).toEqual(ORIGINAL.map((row) => row.key));
    expect(restoreRemovedRow(back, ORIGINAL, id(21))).toBe(back);
    // Named by its place once it is back («بدون سيارة (n)», the step «تراجع» then offers) — never by
    // the draft it was missing from, where it has no place.
    expect(looseRowNumber(deleted, LOOSE)).toBeNull();
    const looseKeys = ORIGINAL.filter((row) => row.vehicleId === null).map((row) => row.key);
    expect(looseRowNumber(back, LOOSE)).toBe(looseKeys.indexOf(LOOSE) + 1);
    expect(looseRowNumber(back, LOOSE)).toBeGreaterThan(0);
    expect(errorMessage(failure, 'ar')).toContain('توزيع المحصنات');
  });

  it('a row whose محصنات have left the vault: the refusal says it stays, and what can be done with it', () => {
    // The server counts every live leg — handed over, delivered — and «توزيع المحصنات» moves none
    // that has left the vault: «take them off» alone is advice nobody could follow for such a row.
    const failure = new ApiError('OPERATIONS_CREW_ROW_HAS_SHIPMENTS', 'held', 409, []);
    const board = (locale: 'ar' | 'en') =>
      translate(locale, 'operations.crewPlan.refused.remove', { count: '3' });
    for (const said of [errorMessage(failure, 'ar'), board('ar')]) {
      expect(said).toContain('توزيع المحصنات');
      expect(said).toContain('في الخزينة');
      expect(said).toContain('خرجت من الخزينة');
      expect(said).toContain('يبقى الصف');
    }
    for (const said of [errorMessage(failure, 'en'), board('en')]) {
      expect(said).toContain('Secured distribution');
      expect(said).toContain('in the vault');
      expect(said).toContain('left the vault');
      expect(said).toContain('the row stays');
    }
    expect(board('ar')).toContain('3');
  });
  it('a deleted row put back leaves its people where the draft has seated them since — one row each (Q11)', () => {
    // The saved row without a van (id 21) holds captain 62 and specialist 63. Deleted, both go back
    // to the pools; the planner then drops 62 on van 250 and presses «حفظ», which refuses the
    // deletion (the row holds محصنات).
    const deleted = discardRow(ORIGINAL, LOOSE);
    const moved = placeMember(deleted, `van:${id(2)}`, 'captain', id(62));
    const back = restoreRemovedRow(moved, ORIGINAL, id(21));
    // Back in its place — without 62, who stays on 250 where the planner put him; 63, still in the
    // pool, is back on it.
    expect(back.map((row) => row.key)).toEqual(ORIGINAL.map((row) => row.key));
    expect(back.find((row) => row.key === LOOSE)?.slots).toEqual({
      captain: [],
      specialist1: [id(63)],
      specialist2: [],
    });
    expect(back.find((row) => row.key === `van:${id(2)}`)?.slots.captain).toEqual([id(62)]);
    // Nobody on two rows: the next «حفظ» sends 250 with 62 AND the row put back without him, so
    // the server's Q11 never finds him on a row the save left untouched.
    const seats = back.flatMap(rowPeople);
    expect(new Set(seats).size).toBe(seats.length);
    const body = toPlan('2026-11-17', planChanges(back, ORIGINAL));
    expect(PlanOperationsCrewSchema.safeParse(body).success).toBe(true);
    expect(body.removeCrewAssignmentIds).toBeUndefined();
    expect(body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vehicleId: id(2), captainEmployeeIds: [id(62)] }),
        expect.objectContaining({
          vehicleId: null,
          crewAssignmentId: id(21),
          captainEmployeeIds: [],
          specialist1EmployeeIds: [id(63)],
        }),
      ]),
    );
  });
});

describe('a van the save refused, taken off its row (`releaseVan`, Round 24)', () => {
  // «تراجع» takes back only the LAST operation: once the planner did anything after giving the van,
  // it no longer reaches the van. The refused row's cell takes the van off instead, in one press.
  const pick = (rows: readonly PlanRow[], key: string, code: string) => {
    const choice = vehicleChoices(rows, ORIGINAL, BOARD.freeVehicles, key, new Set([id(5)])).find(
      (one) => one.vehicleCode === code,
    );
    expect(choice, code).toBeDefined();
    return giveVehicle(rows, key, choice!);
  };

  it('a row that took a car where it stands: the same row, in place, without the car — whatever came after', () => {
    const given = pick(ORIGINAL, LOOSE, 'P9');
    const later = patchRow(given, LOOSE, { notes: 'بعد السيارة' });
    const released = releaseVan(later, ORIGINAL, LOOSE);
    expect(released.map((row) => row.key)).toEqual(ORIGINAL.map((row) => row.key));
    expect(released.find((row) => row.key === LOOSE)).toMatchObject({
      vehicleId: null,
      vehicleCode: null,
      onRoster: false,
      drivers: [],
      crewId: id(21),
      notes: 'بعد السيارة',
      slots: { captain: [id(62)], specialist1: [id(63)], specialist2: [] },
    });
    // Its cell offers the car again; the save sends only what came after (the notes), van-less.
    expect(choicesFor(released, LOOSE).map((choice) => choice.vehicleCode)).toContain('P9');
    const body = toPlan('2026-11-17', planChanges(released, ORIGINAL));
    expect(body.rows).toEqual([
      expect.objectContaining({ vehicleId: null, crewAssignmentId: id(21), notes: 'بعد السيارة' }),
    ]);
    // A row added here keeps its people too.
    const added = placeMember([...ORIGINAL, vehiclelessRow(1)], 'new:1', 'captain', id(64));
    const back = releaseVan(pick(added, 'new:1', 'P10'), ORIGINAL, 'new:1');
    expect(back.find((row) => row.key === 'new:1')).toMatchObject({
      vehicleId: null,
      slots: { captain: [id(64)], specialist1: [], specialist2: [] },
    });
  });

  it('a saved row merged into a roster van: back as its own row in its place, the van’s row blank again', () => {
    const merged = pick(ORIGINAL, LOOSE, '250');
    expect(merged.map((row) => row.key)).not.toContain(LOOSE);
    const later = patchRow(merged, `van:${id(2)}`, { plannedTime: '07:30' });
    const released = releaseVan(later, ORIGINAL, `van:${id(2)}`);
    expect(released.map((row) => row.key)).toEqual(ORIGINAL.map((row) => row.key));
    expect(released.find((row) => row.key === `van:${id(2)}`)).toEqual(
      ORIGINAL.find((row) => row.key === `van:${id(2)}`),
    );
    expect(released.find((row) => row.key === LOOSE)).toMatchObject({
      vehicleId: null,
      crewId: id(21),
      plannedTime: '07:30',
      slots: { captain: [id(62)], specialist1: [id(63)], specialist2: [] },
    });
    expect(planChanges(released, ORIGINAL).changed.map((row) => row.key)).toEqual([LOOSE]);
  });

  it('nothing to take off — a van the row held at the read, or a row added here merged into a roster van', () => {
    expect(releaseVan(ORIGINAL, ORIGINAL, `van:${id(1)}`)).toBe(ORIGINAL);
    expect(releaseVan(ORIGINAL, ORIGINAL, `van:${id(7)}`)).toBe(ORIGINAL);
    expect(releaseVan(ORIGINAL, ORIGINAL, LOOSE)).toBe(ORIGINAL);
    const added = placeMember([...ORIGINAL, vehiclelessRow(1)], 'new:1', 'captain', id(64));
    const merged = pick(added, 'new:1', '250');
    expect(releaseVan(merged, ORIGINAL, `van:${id(2)}`)).toBe(merged);
  });

  it('the refusal says what works — the cell’s button, never «تراجع», which may take back something else', () => {
    for (const reason of ['notActive', 'inWorkshop', 'taken']) {
      for (const locale of ['ar', 'en'] as const) {
        const said = translate(locale, `operations.crewPlan.refused.vehicle.${reason}`, {
          code: 'P9',
        });
        expect(said, `${locale} ${reason}`).toContain('P9');
        expect(said, `${locale} ${reason}`).not.toMatch(/تراجع|undo/i);
      }
      expect(
        translate('ar', `operations.crewPlan.refused.vehicle.${reason}`, { code: 'P9' }),
      ).toContain(translate('ar', 'operations.crewPlan.releaseVanName'));
    }
    const page = readFileSync(
      fileURLToPath(new URL('../pages/CrewBoardPage.tsx', import.meta.url)),
      'utf8',
    );
    // The button: on the refused row's van cell, one operation «تراجع» can take back.
    expect(page).toContain('data-van-release={row.key}');
    expect(page).toMatch(
      /applyRows\(\{ kind: 'dropVan', vars: \{ code: row\.vehicleCode \?\? '', row: named \} \}, \(current\) =>\s*releaseVan\(current, serverRows, row\.key\),/,
    );
    // Shown only on a refused row whose van was given here, for someone who may plan.
    expect(page).toContain(
      'vanRefused !== null && canPlan && releaseVan(rows, serverRows, row.key) !== rows;',
    );
    expect(page).toMatch(/\{releasable \? \(\s*<button[\s\S]*?onClick=\{\(\) => dropVan\(row\)\}/);
  });
});
