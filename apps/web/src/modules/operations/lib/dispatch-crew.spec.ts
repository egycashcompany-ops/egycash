// What the vault screen may dispatch to, and why a two-captain vehicle appears twice.
import { describe, expect, it } from 'vitest';
import { type OperationsCrewBoardRowDto } from '@ecms/contracts';
import {
  chooseVehicle,
  dispatchCrewOptions,
  findDispatchOption,
  vehicleOfCaptain,
  vehiclesOf,
} from './dispatch-crew';

const boardRow = (
  vehicleId: string,
  crew: OperationsCrewBoardRowDto['crew'],
): OperationsCrewBoardRowDto => ({
  vehicleId,
  vehicleCode: `C-${vehicleId}`,
  fleetDutyAssignmentId: `duty-${vehicleId}`,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  missionTypeId: null,
  crew,
});

const crewOf = (id: string, captains: string[]): OperationsCrewBoardRowDto['crew'] => ({
  id,
  captainEmployeeIds: captains,
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  notes: null,
});

describe('dispatchCrewOptions', () => {
  it('offers one option per captain — a two-captain vehicle appears twice', () => {
    // A crew has two captains; a LEG has one. Offering the vehicle once would have made the screen
    // silently pick which of two people is answerable for a van full of cash.
    const options = dispatchCrewOptions([boardRow('v1', crewOf('c1', ['e1', 'e2']))]);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.captainEmployeeId)).toEqual(['e1', 'e2']);
    expect(options.every((o) => o.crewAssignmentId === 'c1')).toBe(true);
    expect(options.every((o) => o.vehicleCode === 'C-v1')).toBe(true);
  });

  it('drops a vehicle with no crew row at all', () => {
    expect(dispatchCrewOptions([boardRow('v1', null)])).toEqual([]);
  });

  it('drops a captainless crew — a delivery leg needs a captain', () => {
    expect(dispatchCrewOptions([boardRow('v1', crewOf('c1', []))])).toEqual([]);
  });

  it('carries the crew ROW id, never the Fleet duty id', () => {
    // The defect this screen shipped with: it sent `fleetDutyAssignmentId`, an id from a different
    // collection, so both of its actions 404'd at the crew repository.
    const [option] = dispatchCrewOptions([boardRow('v1', crewOf('c1', ['e1']))]);
    expect(option?.crewAssignmentId).toBe('c1');
    expect(option?.crewAssignmentId).not.toBe('duty-v1');
  });

  it('gives every option a distinct key across vehicles and captains', () => {
    const options = dispatchCrewOptions([
      boardRow('v1', crewOf('c1', ['e1', 'e2'])),
      boardRow('v2', crewOf('c2', ['e3'])),
    ]);
    expect(new Set(options.map((o) => o.key)).size).toBe(3);
  });
});

describe('findDispatchOption', () => {
  const options = dispatchCrewOptions([boardRow('v1', crewOf('c1', ['e1', 'e2']))]);

  it('resolves both halves of the choice from the key alone', () => {
    const chosen = findDispatchOption(options, options[1]?.key ?? '');
    expect(chosen?.crewAssignmentId).toBe('c1');
    expect(chosen?.captainEmployeeId).toBe('e2');
  });

  it('answers undefined for an empty or stale key, so the caller can refuse to act', () => {
    expect(findDispatchOption(options, '')).toBeUndefined();
    expect(findDispatchOption(options, 'c9:e9')).toBeUndefined();
  });
});


describe('choosing a crew by captain, with the vehicle following', () => {
  // v1 carries two captains, v2 one — the shape that makes captain and vehicle NOT symmetric.
  const options = dispatchCrewOptions([
    boardRow('v1', crewOf('c1', ['e1', 'e2'])),
    boardRow('v2', crewOf('c2', ['e3'])),
  ]);

  it('answers which vehicle a captain is on — Q11 makes it at most one', () => {
    expect(vehicleOfCaptain(options, 'e3')?.vehicleId).toBe('v2');
    expect(vehicleOfCaptain(options, 'e1')?.vehicleId).toBe('v1');
  });

  it('has no vehicle for a captain who is not planned today', () => {
    expect(vehicleOfCaptain(options, 'nobody')).toBeUndefined();
  });

  it('lists each vehicle ONCE even when it carries two captains', () => {
    expect(vehiclesOf(options).map((v) => v.vehicleId)).toEqual(['v1', 'v2']);
    expect(vehiclesOf(options).map((v) => v.vehicleCode)).toEqual(['C-v1', 'C-v2']);
  });

  it('keeps the chosen captain when he is on the newly picked vehicle', () => {
    // Picking v1 while e2 is already chosen must not silently demote him to his co-captain.
    expect(chooseVehicle(options, 'v1', 'e2')?.captainEmployeeId).toBe('e2');
  });

  it('falls to the vehicle\u2019s first captain when the chosen one is not on it', () => {
    expect(chooseVehicle(options, 'v1', 'e3')?.captainEmployeeId).toBe('e1');
  });

  it('picks the only captain when the vehicle has one', () => {
    expect(chooseVehicle(options, 'v2', 'e1')?.captainEmployeeId).toBe('e3');
  });

  it('answers undefined for a vehicle nobody crews, so the caller clears the choice', () => {
    // Inventing a captain for a van nobody is planned onto is exactly what the server refuses.
    expect(chooseVehicle(options, 'v9', 'e1')).toBeUndefined();
  });

  it('round-trips: pick a captain, read his vehicle, re-pick it, get him back', () => {
    const chosen = vehicleOfCaptain(options, 'e2');
    expect(chooseVehicle(options, chosen?.vehicleId ?? '', 'e2')?.key).toBe(chosen?.key);
  });
});
