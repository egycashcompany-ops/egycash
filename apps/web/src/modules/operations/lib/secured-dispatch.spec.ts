// «صرف الخزينة»'s rules, asserted directly — «كله يبقى موجود فى تاريخ يتفلتر»: every محصنة in the
// vault, a delivery day as an optional filter, the late ones marked; a crew from the row's OWN
// delivery day; a release split one vehicle per call. What reaches the screen is pinned in
// pages/secured-dispatch.spec.tsx.
import { describe, expect, it } from 'vitest';
import { type OperationsSecuredDispatchRowDto } from '@ecms/contracts';
import { dispatchCrewOptions } from './dispatch-crew';
import {
  deliveryAssignVersion,
  deliveryDayOf,
  dispatchDue,
  dispatchDueCounts,
  dispatchLoads,
  heldCrewKey,
  offersDeliveryAssign,
  offersDispatch,
  readDispatchDate,
  tickedForDispatch,
} from './secured-dispatch';

type Row = Pick<
  OperationsSecuredDispatchRowDto,
  'id' | 'status' | 'crew' | 'deliveryDate' | 'overdue' | 'deliveryLegVersion'
>;

const crew = (crewAssignmentId: string, captainEmployeeId: string, captainName: string | null) => ({
  crewAssignmentId,
  vehicleId: `v-${crewAssignmentId}`,
  vehicleCode: crewAssignmentId === 'ca-1' ? '150' : '210',
  captainEmployeeId,
  captainName,
  captainCode: null,
  captainPhone: null,
  captainBranchId: null,
});

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  status: 'inVault',
  crew: null,
  deliveryDate: '2026-11-12T00:00:00.000Z',
  overdue: false,
  deliveryLegVersion: null,
  ...over,
});

describe('readDispatchDate — the URL’s delivery day, or every day', () => {
  it('keeps a real calendar day', () => {
    expect(readDispatchDate('2026-11-20')).toBe('2026-11-20');
  });

  it('is null when absent — the screen opens on every shipment in the vault', () => {
    expect(readDispatchDate(null)).toBeNull();
  });

  // The endpoint refuses an empty or malformed `date=` (a 400): never sent, read as every day.
  it('is null for anything that is not a real day', () => {
    for (const bad of ['', 'today', '2026-02-30', '2026-11-20T00:00:00Z', '20-11-2026']) {
      expect(readDispatchDate(bad)).toBeNull();
    }
  });
});

describe('dispatchDue — late, or due out today, on the server’s day', () => {
  const today = '2026-11-12';

  it('is overdue when its delivery day has passed — the server’s flag or the day itself', () => {
    expect(
      dispatchDue(row('a', { deliveryDate: '2026-11-10T00:00:00.000Z', overdue: true }), today),
    ).toBe('overdue');
    // The two agree; either alone is enough (a row read just before midnight, a flag just after).
    expect(dispatchDue(row('b', { deliveryDate: '2026-11-11T00:00:00.000Z' }), today)).toBe(
      'overdue',
    );
    expect(dispatchDue(row('c', { overdue: true }), today)).toBe('overdue');
  });

  it('is today when it is due out today', () => {
    expect(dispatchDue(row('a'), today)).toBe('today');
  });

  it('is nothing for a later day, or with no delivery day at all', () => {
    expect(dispatchDue(row('a', { deliveryDate: '2026-11-13T00:00:00.000Z' }), today)).toBeNull();
    expect(dispatchDue(row('b', { deliveryDate: null }), today)).toBeNull();
  });

  it('counts the late rows and today’s, for the toolbar', () => {
    expect(
      dispatchDueCounts(
        [
          row('a', { deliveryDate: '2026-11-09T00:00:00.000Z', overdue: true }),
          row('b', { deliveryDate: '2026-11-10T00:00:00.000Z', overdue: true }),
          row('c'),
          row('d', { deliveryDate: '2026-11-14T00:00:00.000Z' }),
          row('e', { deliveryDate: null }),
        ],
        today,
      ),
    ).toEqual({ overdue: 2, today: 1 });
  });
});

describe('the delivery crew — from the row’s OWN delivery day, on its leg’s version', () => {
  it('is offered on a row in the vault with a delivery day — whatever the screen is filtered on', () => {
    expect(offersDeliveryAssign(row('a'))).toBe(true);
    expect(offersDeliveryAssign(row('b', { crew: crew('ca-1', 'e-1', 'محمود') }))).toBe(true);
  });

  // The server refuses a shipment with no delivery day (OPERATIONS_INVALID_SHIPMENT_TRANSITION):
  // its crew is planned on that day, and there is none.
  it('is not offered with no delivery day, nor on a row no longer in the vault', () => {
    expect(offersDeliveryAssign(row('a', { deliveryDate: null }))).toBe(false);
    expect(offersDeliveryAssign(row('b', { status: 'dispatched' }))).toBe(false);
    expect(offersDeliveryAssign(row('c', { status: 'draft' }))).toBe(false);
  });

  it('reads the crew from the row’s delivery day', () => {
    expect(deliveryDayOf(row('a', { deliveryDate: '2026-11-09T00:00:00.000Z' }))).toBe(
      '2026-11-09',
    );
    expect(deliveryDayOf(row('b', { deliveryDate: null }))).toBeNull();
  });

  // The leg is what an assignment writes: its version — 0 before it exists — never the shipment's.
  it('sends the delivery leg’s version, 0 for a first assignment', () => {
    expect(deliveryAssignVersion(row('a'))).toBe(0);
    expect(deliveryAssignVersion(row('b', { deliveryLegVersion: 4 }))).toBe(4);
  });

  it('opens on the crew already assigned, keyed as the crew choices are', () => {
    expect(heldCrewKey(row('a'))).toBe('');
    const held = heldCrewKey(row('b', { crew: crew('ca-1', 'e-1', 'محمود') }));
    expect(held).toBe('ca-1:e-1');
    const options = dispatchCrewOptions([
      {
        vehicleId: 'v-ca-1',
        vehicleCode: '150',
        fleetDutyAssignmentId: 'fd-1',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        missionTypeId: null,
        crew: {
          id: 'ca-1',
          captainEmployeeIds: ['e-1', 'e-2'],
          specialist1EmployeeIds: [],
          specialist2EmployeeIds: [],
          direction: null,
          plannedTime: null,
          notes: null,
        },
      },
    ]);
    expect(options.map((option) => option.key)).toContain(held);
  });
});

describe('the release — rows with a crew, one call per vehicle', () => {
  const A1 = row('a1', { crew: crew('ca-1', 'e-1', 'محمود حسن') });
  const B1 = row('b1', { crew: crew('ca-2', 'e-3', 'سيد علي') });
  // The co-captain of the first vehicle: the same crew row, another captain.
  const A2 = row('a2', { crew: crew('ca-1', 'e-2', 'كريم سمير') });
  const NONE = row('n1');

  it('is offered on a row in the vault with its delivery crew', () => {
    expect(offersDispatch(A1)).toBe(true);
  });

  // The server refuses one with no crew (OPERATIONS_DELIVERY_LEG_REQUIRED): it is assigned first.
  it('is not offered without a crew, nor on a row no longer in the vault', () => {
    expect(offersDispatch(NONE)).toBe(false);
    expect(offersDispatch({ ...A1, status: 'dispatched' })).toBe(false);
  });

  it('acts on the ticks among the rows SHOWN that may still go out — never a hidden one', () => {
    const selected = new Set(['a1', 'n1', 'b1', 'gone']);
    // b1 is ticked but filtered out of view; n1 is ticked but has no crew.
    expect(tickedForDispatch([A1, A2, NONE], selected).map((r) => r.id)).toEqual(['a1']);
  });

  it('splits one load per crew ROW, in the rows’ order — both captains of a van in one', () => {
    const loads = dispatchLoads([A1, B1, A2, NONE]);
    expect(loads.map((load) => load.crewAssignmentId)).toEqual(['ca-1', 'ca-2']);
    expect(loads[0]?.rows.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(loads[0]?.captainNames).toEqual(['محمود حسن', 'كريم سمير']);
    expect(loads[0]?.vehicleCode).toBe('150');
    expect(loads[1]?.rows.map((r) => r.id)).toEqual(['b1']);
  });

  it('names a captain once, and leaves out one the directory cannot name', () => {
    const loads = dispatchLoads([
      A1,
      row('a3', { crew: crew('ca-1', 'e-1', 'محمود حسن') }),
      row('a4', { crew: crew('ca-1', 'e-9', null) }),
    ]);
    expect(loads[0]?.captainNames).toEqual(['محمود حسن']);
    expect(loads[0]?.rows).toHaveLength(3);
  });
});
