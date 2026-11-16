// Round 24 — a crew WITHOUT A VAN on every screen after «لوحة التشغيلة»: «عاوز لو عربيه من غير كود
// عادى تظهر ان اوزع عليها محصنات». Named «بدون سيارة» (never "null", an id, or the «…» of a van Fleet
// cannot name), placed and proposed on «توزيع المحصنات» like a van, offered in «صرف الخزينة»'s
// assign dialog as its own choice, and found by the day board's van box.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardRowDto,
  type OperationsDayBoardVehicleCrewDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { lastStep, record, startHistory, undo } from './crew-undo';
import { vanSuggestions } from './day-board';
import { chooseVehicle, dispatchCrewOptions, vehiclesOf } from './dispatch-crew';
import { dispatchLoads } from './secured-dispatch';
import {
  EMPTY_DRAFT,
  distributionColumns,
  distributionSaveBody,
  moveToVan,
  proposeByDirection,
  sameDistributionDraft,
  type DistributionRowFacts,
} from './secured-distribution';
import { looseCrewNumbers, vanCodeText, vanPhrase } from './van-name';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const person = (employeeId: string) => ({
  employeeId,
  code: null,
  fullNameAr: `قائد ${employeeId}`,
});

const crew = (
  crewAssignmentId: string,
  vehicleId: string | null,
  vehicleCode: string | null,
  over: Partial<OperationsDayBoardVehicleCrewDto> = {},
): OperationsDayBoardVehicleCrewDto => ({
  crewAssignmentId,
  vehicleId,
  vehicleCode,
  drivers: [],
  captains: [person(`cap-${crewAssignmentId}`)],
  specialist1: [],
  specialist2: [],
  direction: null,
  plannedTime: null,
  ...over,
});

/** The distribution's crews as the server orders them: the vans, then the rows without a van. */
const CREWS = [
  crew('c-249', 'v-249', '249', { direction: 'المعادي' }),
  crew('c-x', 'v-x', null),
  crew('c-l1', null, null, { direction: 'حلوان' }),
  crew('c-l2', null, null),
];

describe('naming — «بدون سيارة», numbered as the board numbers it', () => {
  it('a van by its code; a van Fleet cannot name «…»; a crew without one «بدون سيارة (n)»', () => {
    const numbers = looseCrewNumbers(CREWS);
    expect([...numbers]).toEqual([
      ['c-l1', 1],
      ['c-l2', 2],
    ]);
    const t = ar;
    expect(vanCodeText(t, CREWS[0]!)).toBe('249');
    expect(vanCodeText(t, CREWS[1]!)).toBe('…');
    expect(vanCodeText(t, CREWS[2]!, '1')).toBe('بدون سيارة (1)');
    expect(vanCodeText(t, CREWS[3]!)).toBe('بدون سيارة');
    expect(vanPhrase(t, CREWS[0]!)).toBe('السيارة 249');
    expect(vanPhrase(t, CREWS[3]!, '2')).toBe('الطاقم بدون سيارة (2)');
    for (const one of CREWS) expect(vanCodeText(t, one, '1')).not.toMatch(/null|undefined|v-/);
  });
});

describe('«توزيع المحصنات» — a crew without a van takes محصنات like a van', () => {
  const row = (id: string, directionCrewAssignmentIds: string[] = []): DistributionRowFacts => ({
    id,
    status: 'inVault',
    overdue: false,
    delivery: null,
    deliveryLegVersion: null,
    placedCrewAssignmentId: null,
    directionCrewAssignmentIds,
  });

  it('is a column of its own, takes a drop, a direction proposal, and is saved by its crew row', () => {
    const rows = [row('s1'), row('s2', ['c-l1'])];
    let draft = moveToVan(EMPTY_DRAFT, rows[0]!, CREWS[3]!);
    draft = proposeByDirection(rows, CREWS, draft);
    const columns = distributionColumns(rows, CREWS, draft);
    expect(
      columns.vans.map((load) => [load.van.crewAssignmentId, load.rows.map((r) => r.id)]),
    ).toEqual([
      ['c-249', []],
      ['c-x', []],
      ['c-l1', ['s2']],
      ['c-l2', ['s1']],
    ]);
    expect(distributionSaveBody('2026-11-17', rows, draft)?.changes).toEqual([
      { shipmentId: 's1', crewAssignmentId: 'c-l2', captainEmployeeId: 'cap-c-l2', version: null },
      { shipmentId: 's2', crewAssignmentId: 'c-l1', captainEmployeeId: 'cap-c-l1', version: null },
    ]);
  });

  it('«تراجع» takes back one move a press, as on the board', () => {
    const rows = [row('s1'), row('s2')];
    let history = startHistory(EMPTY_DRAFT);
    const same = { same: sameDistributionDraft };
    history = record(history, moveToVan(history.now, rows[0]!, CREWS[0]!), { kind: 'move' }, same);
    history = record(history, moveToVan(history.now, rows[1]!, CREWS[2]!), { kind: 'move' }, same);
    // A drop back where it is changes nothing — no operation.
    history = record(history, moveToVan(history.now, rows[1]!, CREWS[2]!), { kind: 'move' }, same);
    expect(history.past).toHaveLength(2);
    history = undo(history);
    expect([...history.now.keys()]).toEqual(['s1']);
    history = undo(history);
    expect(history.now.size).toBe(0);
    expect(lastStep(history)).toBeNull();
    const page = read('../pages/SecuredDistributionPage.tsx');
    expect(page).toContain('onClick={undoLast}');
    expect(page).not.toContain('setDraft(EMPTY_DRAFT)');
    expect(ar('operations.distribution.discard')).toBe('تراجع');
  });

  it('the vault hands its load over and prints its sheet under the crew’s name', () => {
    const page = read('../pages/VaultHandoverPage.tsx');
    expect(page).toContain('looseNumber={looseNumberOf(van.crewAssignmentId)}');
    expect(page).toContain("t('operations.handover.confirmTitle', { van: vanName(confirmVan) })");
    expect(ar('operations.handover.confirmTitle', { van: vanPhrase(ar, CREWS[2]!, '1') })).toBe(
      'تسليم محصنات الطاقم بدون سيارة (1)',
    );
  });
});

describe('«صرف الخزينة» — the assign dialog and the release', () => {
  const boardRow = (
    vehicleId: string,
    crewId: string,
    captains: string[],
  ): OperationsCrewBoardRowDto => ({
    vehicleId,
    vehicleCode: `C-${vehicleId}`,
    fleetDutyAssignmentId: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    drivers: [],
    missionTypeId: null,
    crew: {
      id: crewId,
      captainEmployeeIds: captains,
      specialist1EmployeeIds: [],
      specialist2EmployeeIds: [],
      direction: null,
      plannedTime: null,
      notes: null,
      shiftTypeId: null,
      rowColour: null,
    },
  });
  const loose = (id: string, captains: string[]): OperationsCrewBoardCrewDto => ({
    id,
    captainEmployeeIds: captains,
    specialist1EmployeeIds: [],
    specialist2EmployeeIds: [],
    direction: null,
    plannedTime: null,
    notes: null,
    shiftTypeId: null,
    rowColour: null,
  });

  it('offers each row without a van as its own vehicle — never merged under a missing van', () => {
    const options = dispatchCrewOptions(
      [boardRow('v1', 'c1', ['e1'])],
      [loose('l1', ['e2']), loose('l2', ['e3', 'e4']), loose('l3', [])],
    );
    expect(options.map((option) => option.key)).toEqual(['c1:e1', 'l1:e2', 'l2:e3', 'l2:e4']);
    expect(vehiclesOf(options).map((vehicle) => [vehicle.vanKey, vehicle.looseNumber])).toEqual([
      ['v1', null],
      ['crew:l1', 1],
      ['crew:l2', 2],
    ]);
    expect(chooseVehicle(options, 'crew:l2', 'e4')?.key).toBe('l2:e4');
    expect(chooseVehicle(options, 'crew:l2', 'e1')?.key).toBe('l2:e3');
    // The pickup leg (the shipment form) passes the vans alone, as before.
    expect(
      dispatchCrewOptions([boardRow('v1', 'c1', ['e1'])]).every((o) => o.vehicleId !== null),
    ).toBe(true);
  });

  it('a release names a crew without a van «بدون سيارة»', () => {
    const loads = dispatchLoads([
      {
        crew: {
          crewAssignmentId: 'l1',
          vehicleId: null,
          vehicleCode: null,
          captainEmployeeId: 'e2',
          captainName: 'قائد',
        },
      },
    ] as never);
    expect(loads[0]).toMatchObject({ crewAssignmentId: 'l1', vehicleId: null });
    expect(vanCodeText(ar, loads[0]!)).toBe('بدون سيارة');
  });
});

describe('the day board’s van box offers «بدون سيارة»', () => {
  it('the day’s codes in number order, then «بدون سيارة» when a crew without a van rides a leg', () => {
    expect(vanSuggestions(CREWS, 'بدون سيارة')).toEqual(['249', 'بدون سيارة']);
    expect(vanSuggestions(CREWS.slice(0, 1), 'بدون سيارة')).toEqual(['249']);
  });
});
