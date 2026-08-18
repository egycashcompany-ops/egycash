// What the vault screen may dispatch to, and why a two-captain vehicle appears twice.
import { describe, expect, it } from 'vitest';
import { type OperationsCrewBoardRowDto } from '@ecms/contracts';
import { dispatchCrewOptions, findDispatchOption } from './dispatch-crew';

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
