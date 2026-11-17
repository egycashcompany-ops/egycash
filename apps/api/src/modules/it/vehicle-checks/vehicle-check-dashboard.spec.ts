// The vehicle checks dashboard's rules, pinned on the rules themselves — «تمام نفذا الـ Dashboard
// بتاعت الفحص» (2026-11-10).
//
// What is pinned: the window (today in Cairo by default, never after it, seven days back); which
// active cars a reader's scope reaches, by the car's current branch, and the branch filter only
// narrowing that; what each filter of the reports list means (the car code in any digit set,
// everything else literal); each car's latest report kept in Fleet's order and only for listed
// cars; the faults counted over those latest reports; the overdue cars, their days and their
// order; and the whole dashboard put together from its reads.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_OVERDUE_DAYS,
  ListItVehicleChecksQuerySchema,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { type ItVehicleOnBoard } from '../fleet-boundary';
import {
  buildVehicleCheckDashboard,
  carReachOf,
  carsCheckedOf,
  carsVisibleTo,
  dashboardWindow,
  faultFigures,
  latestOfCars,
  latestReportsFilter,
  overdueCars,
  vehicleCheckListFilter,
} from './vehicle-check-dashboard';

const oid = (): string => String(new Types.ObjectId());

const BRANCH_A = oid();
const BRANCH_B = oid();
const BRANCH_C = oid();

/** A selector as `scopeSelector` builds one — home in branch A unless said otherwise. */
const selector = (
  scope: ScopeSelector['scope'],
  extra: Partial<ScopeSelector> = {},
): ScopeSelector => ({
  scope,
  userId: oid(),
  branchId: BRANCH_A,
  departmentId: null,
  sectionId: null,
  ...extra,
});

const car = (code: string, branchId: string | null): ItVehicleOnBoard => ({
  id: oid(),
  code,
  branchId,
});

/** The fleet in Fleet's code order: two on A, one on B, one on C, one with no branch. */
const FLEET: readonly ItVehicleOnBoard[] = [
  car('150', BRANCH_A),
  car('152', BRANCH_B),
  car('1003', null),
  car('كورولا 1', BRANCH_C),
  car('61', BRANCH_A),
];
const codes = (cars: readonly ItVehicleOnBoard[]): string[] => cars.map((c) => c.code);

const allWorking = (): Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null> =>
  Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])) as Record<
    ItVehicleCheckItem,
    ItVehicleCheckAnswer | null
  >;

const latestOf = (
  onCar: ItVehicleOnBoard,
  checkDate: string,
  faults: readonly ItVehicleCheckItem[] = [],
): ItVehicleCheckLatestDto => ({
  reportId: oid(),
  vehicleId: onCar.id,
  vehicleCode: onCar.code,
  branchId: onCar.branchId,
  checkDate,
  createdAt: `${checkDate}T08:00:00.000Z`,
  items: {
    ...allWorking(),
    ...(Object.fromEntries(faults.map((item) => [item, 'notWorking'])) as Partial<
      Record<ItVehicleCheckItem, ItVehicleCheckAnswer>
    >),
  },
  photoCount: 1,
  hasNotes: faults.length > 0,
  reportedByName: 'سامح نبيل',
});

const at = (index: number): ItVehicleOnBoard => {
  const found = FLEET[index];
  if (found === undefined) throw new Error(`no car ${String(index)}`);
  return found;
};

describe('the window', () => {
  const TODAY = '2026-11-10';

  it('is the last seven Cairo days, today included, when nothing is asked', () => {
    expect(IT_VEHICLE_CHECK_OVERDUE_DAYS).toBe(7);
    expect(dashboardWindow({}, TODAY)).toEqual({ from: '2026-11-04', to: '2026-11-10' });
  });

  it('clamps an end after today to today, and counts the default start back from the end', () => {
    expect(dashboardWindow({ to: '2026-12-31' }, TODAY)).toEqual({
      from: '2026-11-04',
      to: '2026-11-10',
    });
    // An earlier end moves the default start with it: seven days ending there.
    expect(dashboardWindow({ to: '2026-11-02' }, TODAY)).toEqual({
      from: '2026-10-27',
      to: '2026-11-02',
    });
  });

  it('keeps a start that is asked — «اليوم» is one day, «آخر ٣٠ يومًا» thirty', () => {
    expect(dashboardWindow({ from: TODAY }, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(dashboardWindow({ from: '2026-10-12', to: TODAY }, TODAY)).toEqual({
      from: '2026-10-12',
      to: TODAY,
    });
    // Across a month and a year end, by calendar days.
    expect(dashboardWindow({}, '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('the cars a reader sees', () => {
  it('shows an organization-wide reader every active car, the one with no branch included', () => {
    expect(carReachOf(selector('organization'))).toBe('all');
    expect(codes(carsVisibleTo(FLEET, selector('organization')))).toEqual(codes(FLEET));
  });

  it('shows a branch reader the cars now in their branch, never a car with no branch', () => {
    expect(codes(carsVisibleTo(FLEET, selector('branch')))).toEqual(['150', '61']);
    // A reach of several whole branches.
    expect(
      codes(carsVisibleTo(FLEET, selector('branch', { branchIds: [BRANCH_B, BRANCH_C] }))),
    ).toEqual(['152', 'كورولا 1']);
  });

  it('reads a department copy as the branch it sits in, and a home department or section as the home branch', () => {
    expect(
      codes(
        carsVisibleTo(
          FLEET,
          selector('department', {
            departmentIds: [oid()],
            departmentBranchIds: [BRANCH_B],
          }),
        ),
      ),
    ).toEqual(['152']);
    expect(codes(carsVisibleTo(FLEET, selector('department', { departmentId: oid() })))).toEqual([
      '150',
      '61',
    ]);
    expect(codes(carsVisibleTo(FLEET, selector('section', { sectionId: oid() })))).toEqual([
      '150',
      '61',
    ]);
  });

  it('shows no car to `own`, nor to a reader placed in no branch', () => {
    expect(carsVisibleTo(FLEET, selector('own'))).toEqual([]);
    expect(carsVisibleTo(FLEET, selector('branch', { branchId: null }))).toEqual([]);
    expect(carsVisibleTo(FLEET, selector('section', { branchId: null }))).toEqual([]);
  });

  it('narrows to the branch filter, which never widens past the scope', () => {
    expect(codes(carsVisibleTo(FLEET, selector('organization'), BRANCH_A))).toEqual(['150', '61']);
    expect(codes(carsVisibleTo(FLEET, selector('organization'), BRANCH_B))).toEqual(['152']);
    // A branch reader asking for another branch gets none of its cars.
    expect(carsVisibleTo(FLEET, selector('branch'), BRANCH_B)).toEqual([]);
    expect(codes(carsVisibleTo(FLEET, selector('branch'), BRANCH_A))).toEqual(['150', '61']);
  });

  it("keeps Fleet's code order", () => {
    const reversed = [...FLEET].reverse();
    expect(codes(carsVisibleTo(reversed, selector('organization')))).toEqual(codes(reversed));
  });
});

describe('the reports list filters', () => {
  /** The query as the address bar sends it, read the way the route reads it. */
  const fromWire = (raw: Record<string, string>) =>
    vehicleCheckListFilter(ListItVehicleChecksQuerySchema.parse(raw));

  it('asks nothing when no filter is set', () => {
    expect(fromWire({})).toEqual({});
    expect(fromWire({ faultsOnly: 'false' })).toEqual({});
    // A code of spaces, or only direction marks, is nothing to match.
    expect(fromWire({ carCode: '   ' })).toEqual({});
    expect(fromWire({ carCode: '‏' })).toEqual({});
  });

  it('reads the window as the Cairo days themselves, stored as UTC midnights', () => {
    expect(fromWire({ from: '2026-11-04', to: '2026-11-10' })).toEqual({
      checkDate: {
        $gte: new Date('2026-11-04T00:00:00.000Z'),
        $lte: new Date('2026-11-10T00:00:00.000Z'),
      },
    });
    expect(fromWire({ to: '2026-11-10' })).toEqual({
      checkDate: { $lte: new Date('2026-11-10T00:00:00.000Z') },
    });
  });

  it("filters on the report's branch and on one car, by id", () => {
    const vehicleId = oid();
    expect(fromWire({ branchId: BRANCH_A, vehicleId })).toEqual({
      branchId: new Types.ObjectId(BRANCH_A),
      vehicleId: new Types.ObjectId(vehicleId),
    });
  });

  it('matches a typed car code anywhere, in any digit set, letter case ignored', () => {
    const pattern = fromWire({ carCode: '١٥' }).vehicleCode as RegExp;
    expect(pattern).toBeInstanceOf(RegExp);
    for (const code of ['150', '152', '1500', '٣١٥٠', 'X15']) expect(pattern.test(code)).toBe(true);
    for (const code of ['105', '61', 'كورولا 1']) expect(pattern.test(code)).toBe(false);
    // Western digits typed find a code written in Arabic-Indic, too.
    expect((fromWire({ carCode: '61' }).vehicleCode as RegExp).test('٦١')).toBe(true);
    // Letters, any case; a code with a space is one code.
    expect((fromWire({ carCode: 'abc' }).vehicleCode as RegExp).test('ABC 7')).toBe(true);
    expect((fromWire({ carCode: 'كورولا 1' }).vehicleCode as RegExp).test('كورولا 1')).toBe(true);
  });

  it('takes every other character of a car code literally', () => {
    const dot = fromWire({ carCode: '1.5' }).vehicleCode as RegExp;
    expect(dot.test('1.5')).toBe(true);
    expect(dot.test('105')).toBe(false);
    const star = fromWire({ carCode: '.*' }).vehicleCode as RegExp;
    expect(star.test('150')).toBe(false);
    expect(star.test('a.*b')).toBe(true);
  });

  it('asks for any device «لا يعمل» for faultsOnly, and for THAT device when one is chosen', () => {
    expect(fromWire({ faultsOnly: 'true' })).toEqual({
      $or: IT_VEHICLE_CHECK_ITEMS.map((item) => ({ [`items.${item}`]: 'notWorking' })),
    });
    expect(fromWire({ device: 'camera7' })).toEqual({ 'items.camera7': 'notWorking' });
  });

  it('ANDs every filter together', () => {
    const filter = fromWire({
      from: '2026-11-01',
      branchId: BRANCH_B,
      carCode: '15',
      faultsOnly: 'true',
      device: 'dvr',
    });
    expect(Object.keys(filter).sort()).toEqual(
      ['$or', 'branchId', 'checkDate', 'items.dvr', 'vehicleCode'].sort(),
    );
  });

  it("reads the latest reports of the listed cars, under the branch filter on the report's branch", () => {
    const listed = [at(0), at(4)];
    expect(latestReportsFilter(listed)).toEqual({
      vehicleId: { $in: listed.map((c) => new Types.ObjectId(c.id)) },
    });
    expect(latestReportsFilter(listed, BRANCH_A)).toEqual({
      branchId: new Types.ObjectId(BRANCH_A),
      vehicleId: { $in: listed.map((c) => new Types.ObjectId(c.id)) },
    });
  });
});

describe("each car's latest report", () => {
  it("keeps a report only for a listed car, in the list's order", () => {
    const onA = latestOf(at(0), '2026-11-09');
    const on61 = latestOf(at(4), '2026-11-10');
    const unlisted = latestOf(car('160', BRANCH_A), '2026-11-10');
    expect(latestOfCars([at(0), at(1), at(4)], [on61, unlisted, onA])).toEqual([onA, on61]);
    expect(latestOfCars([], [onA])).toEqual([]);
  });

  it('counts the faults over the latest reports: per device, the cars with any, the devices summed', () => {
    const figures = faultFigures([
      latestOf(at(0), '2026-11-10', ['camera7']),
      latestOf(at(1), '2026-11-10'),
      latestOf(at(3), '2026-11-09', ['dvr', 'radio']),
      latestOf(at(4), '2026-11-08', ['camera7', 'screen']),
    ]);
    expect(figures.carsWithFaults).toBe(3);
    expect(figures.devicesNotWorking).toBe(5);
    expect(figures.faultsByDevice).toEqual({
      ...Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 0])),
      camera7: 2,
      dvr: 1,
      radio: 1,
      screen: 1,
    });
    // An unanswered device is no fault.
    const unanswered = latestOf(at(0), '2026-11-10');
    unanswered.items.camera8 = null;
    expect(faultFigures([unanswered]).carsWithFaults).toBe(0);
  });
});

describe('the cars not checked for seven days', () => {
  const TODAY = '2026-11-10';

  it('counts a car checked on the seventh day back as checked, and one a day earlier as overdue', () => {
    const rows = overdueCars(
      [at(0), at(1), at(4)],
      [latestOf(at(0), '2026-11-04'), latestOf(at(1), '2026-11-03'), latestOf(at(4), TODAY)],
      TODAY,
    );
    expect(rows).toEqual([
      {
        vehicleId: at(1).id,
        vehicleCode: '152',
        branchId: BRANCH_B,
        lastCheckDate: '2026-11-03',
        daysSince: 7,
      },
    ]);
  });

  it("lists the never-checked first, then the longest unchecked, then Fleet's order — under the car's branch now", () => {
    const rows = overdueCars(
      FLEET,
      [
        latestOf(at(0), '2026-10-30'),
        latestOf({ ...at(1), branchId: BRANCH_C }, '2026-10-20'),
        latestOf(at(4), '2026-10-30'),
      ],
      TODAY,
    );
    expect(rows.map((row) => [row.vehicleCode, row.daysSince])).toEqual([
      ['1003', null],
      ['كورولا 1', null],
      ['152', 21],
      ['150', 11],
      ['61', 11],
    ]);
    // The car's branch as Fleet holds it, not the branch its last report was filed under.
    expect(rows.find((row) => row.vehicleCode === '152')?.branchId).toBe(BRANCH_B);
    expect(rows[0]).toMatchObject({ lastCheckDate: null, branchId: null });
  });
});

describe('the dashboard put together', () => {
  it('derives every figure from the visible cars, their latest reports and the period', () => {
    const TODAY = '2026-11-10';
    const cars = [at(0), at(1), at(3), at(4)];
    const dashboard = buildVehicleCheckDashboard({
      window: dashboardWindow({}, TODAY),
      today: TODAY,
      cars,
      latest: [
        latestOf(at(4), TODAY),
        latestOf(at(0), '2026-11-09', ['camera7']),
        // A car outside the visible list: not a row, not a fault.
        latestOf(at(2), TODAY, ['screen']),
        latestOf(at(3), '2026-10-01', ['dvr', 'radio']),
      ],
      // The window's reports are on three cars, one of them not among the visible ones.
      period: {
        reports: 9,
        reporters: 3,
        vehicleIds: [at(0).id, at(2).id, at(4).id],
        reportsWithoutPhoto: 1,
      },
    });
    expect(dashboard.from).toBe('2026-11-04');
    expect(dashboard.to).toBe(TODAY);
    expect(dashboard.overdueDays).toBe(7);
    expect(dashboard.totals).toEqual({
      reports: 9,
      reporters: 3,
      carsChecked: 2,
      reportsWithoutPhoto: 1,
      activeCars: 4,
      carsWithFaults: 2,
      devicesNotWorking: 3,
      overdueCars: 2,
    });
    expect(dashboard.latest.map((row) => row.vehicleCode)).toEqual(['150', 'كورولا 1', '61']);
    expect(dashboard.faultsByDevice.camera7).toBe(1);
    expect(dashboard.faultsByDevice.screen).toBe(0);
    expect(dashboard.overdue.map((row) => [row.vehicleCode, row.daysSince])).toEqual([
      ['152', null],
      ['كورولا 1', 40],
    ]);
  });

  // «X من Y سيارة نشطة»: X is counted among Y's cars — a car checked in the window but out of
  // service now, or beyond the reader's cars, is not one of them; every report still counts.
  it('counts the cars checked among the visible active cars only, the reports all the same', () => {
    const TODAY = '2026-11-10';
    const board = (cars: readonly ItVehicleOnBoard[], vehicleIds: readonly string[]) =>
      buildVehicleCheckDashboard({
        window: dashboardWindow({}, TODAY),
        today: TODAY,
        cars,
        latest: [],
        period: { reports: 4, reporters: 2, vehicleIds, reportsWithoutPhoto: 3 },
      }).totals;
    // A car out of service now was the only one checked today: «٠ من ٤», not «١ من ٤».
    const outOfService = oid();
    expect(board(FLEET.slice(0, 4), [outOfService])).toMatchObject({
      reports: 4,
      reporters: 2,
      carsChecked: 0,
      activeCars: 4,
      reportsWithoutPhoto: 3,
    });
    // A reader who sees two cars of a fleet whose every car was checked counts two, never five.
    const all = FLEET.map((c) => c.id);
    const visible = carsVisibleTo(FLEET, selector('branch'));
    expect(codes(visible)).toEqual(['150', '61']);
    expect(board(visible, all)).toMatchObject({ carsChecked: 2, activeCars: 2, reports: 4 });
    // A car checked twice is one car; no report on a visible car is none.
    expect(carsCheckedOf(FLEET, [at(1).id, at(1).id, at(3).id])).toBe(2);
    expect(carsCheckedOf(FLEET, [])).toBe(0);
    expect(carsCheckedOf([], all)).toBe(0);
  });
});
