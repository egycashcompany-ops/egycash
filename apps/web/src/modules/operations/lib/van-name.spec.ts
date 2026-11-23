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
import { matchesBoardVan, vanSuggestions } from './day-board';
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
import { matchesVehicleCode } from '../../fleet/lib/vehicle-code-match';
import { looseCrewNumbers, looseNumberOf, vanCodeText, vanPhrase } from './van-name';

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
    uncoded: null,
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
      shipments: 0,
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
    shipments: 0,
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

// The critic's round: «صرف الخزينة»'s release dialog titled every crew without a van alike, and the
// day board printed plain «بدون سيارة» on both crews' rows. The server now numbers each such crew on
// every board row (`looseNumber` — its place on «لوحة التشغيلة», whichever crews the rows ride).
describe('a crew without a van is numbered on every board — never two alike', () => {
  const legCrew = (crewAssignmentId: string, looseNumber: number | null) => ({
    crewAssignmentId,
    vehicleId: looseNumber === null ? `v-${crewAssignmentId}` : null,
    vehicleCode: looseNumber === null ? crewAssignmentId : null,
    looseNumber,
    captainEmployeeId: `cap-${crewAssignmentId}`,
    captainName: `قائد ${crewAssignmentId}`,
    captainCode: null,
    captainPhone: null,
    captainBranchId: null,
  });
  const numbered = (n: number): string =>
    vanCodeText(ar, { vehicleId: null, vehicleCode: null }, String(n));

  it('the release carries each load’s number, and names it by it', () => {
    const loads = dispatchLoads([
      { crew: legCrew('l1', 1) },
      { crew: legCrew('l3', 3) },
      { crew: legCrew('249', null) },
    ] as never);
    expect(loads.map((load) => load.looseNumber)).toEqual([1, 3, null]);
    expect(looseNumberOf(loads[0]!, String)).toBe('1');
    expect(looseNumberOf(loads[2]!, String)).toBeNull();
    expect(vanCodeText(ar, loads[1]!, looseNumberOf(loads[1]!, String))).toBe('بدون سيارة (3)');
    expect(vanPhrase(ar, loads[1]!, looseNumberOf(loads[1]!, String))).toBe(
      'الطاقم بدون سيارة (3)',
    );
  });

  it('the day board’s van box offers each by its number, and finds that crew’s rows alone', () => {
    const crews = [legCrew('l2', 2), legCrew('249', null), legCrew('l1', 1), legCrew('l1', 1)];
    expect(vanSuggestions(crews, 'بدون سيارة', numbered)).toEqual([
      '249',
      'بدون سيارة (1)',
      'بدون سيارة (2)',
    ]);
    // Without numbers (an older answer) — one «بدون سيارة», as before.
    expect(vanSuggestions(CREWS, 'بدون سيارة', numbered)).toEqual(['249', 'بدون سيارة']);
    // Chosen from the list, «بدون سيارة (2)» is ONE name — matched as a phrase, never split into
    // words (split, «بدون» alone would find every crew without a van).
    const noVan = 'بدون سيارة';
    expect(matchesBoardVan('بدون سيارة (٢)', 'بدون سيارة (٢)', noVan)).toBe(true);
    expect(matchesBoardVan('بدون سيارة (١)', 'بدون سيارة (٢)', noVan)).toBe(false);
    expect(matchesBoardVan('بدون سيارة (١)', 'بدون سيارة (2)', noVan)).toBe(false);
    expect(matchesBoardVan('بدون سيارة (٢)', 'بدون سيارة (2)', noVan)).toBe(true);
    expect(matchesBoardVan('249', 'بدون سيارة (٢)', noVan)).toBe(false);
    // «بدون سيارة» alone, or a word of it being typed, still finds every crew without a van; a van
    // code is matched as every vehicle-code box matches it («249 - 250» names both).
    expect(matchesBoardVan('بدون سيارة (١)', 'بدون سيارة', noVan)).toBe(true);
    expect(matchesBoardVan('بدون سيارة (١)', 'بدون', noVan)).toBe(true);
    expect(matchesBoardVan('250', '249 - 250', noVan)).toBe(true);
    expect(matchesBoardVan('251', '249 - 250', noVan)).toBe(false);
    expect(matchesBoardVan('249', '', noVan)).toBe(true);
    // Exactly the plain van-code rule when there is nothing of «بدون سيارة» in the box.
    expect(matchesBoardVan('250', '٢٥٠', noVan)).toBe(matchesVehicleCode('250', '٢٥٠'));
  });

  it('the day board and the release dialog print the number the server gave', () => {
    const board = read('../components/ShipmentsBoard.tsx');
    expect(board).toContain('code={vanCodeText(t, row.crew, looseNumberOf(row.crew, numberText))}');
    // The van box matches the very text the cell prints, a crew's numbered name as one phrase.
    expect(board).toMatch(/numberText\)\),\s*t\('operations\.crewPlan\.noVehicle'\),\s*\);/);
    expect(board).toMatch(
      /\(row\) =>\s*row\.crew === null \? '' : vanCodeText\(t, row\.crew, looseNumberOf\(row\.crew, numberText\)\),/,
    );
    const dialog = read('../components/DispatchSecuredDialog.tsx');
    // The load's head and its refusal both name the crew by its number.
    expect(dialog.match(/vanPhrase\(t, load, looseNumberOf\(load, numberText\)\)/g)?.length).toBe(
      2,
    );
    expect(dialog).not.toContain("t('operations.secured.dispatch.looseLoad')");
  });
});
