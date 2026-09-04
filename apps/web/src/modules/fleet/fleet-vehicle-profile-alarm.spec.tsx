// The vehicle profile's two maintenance tiles, against the projection they sit beside.
//
// The profile is the fourth reader of `computeAlarms()` and the only one that also runs a query of
// its OWN about services — "the last closed visit", which is not the same question as "the visit
// the alarm counts from". Two tiles, side by side, describing one car: if they answer from
// different sources they can disagree in public, and one of them is arithmetic the other one's
// remaining-km figure contradicts.
//
// The web suite has no DOM, so these render `Indicators` to static markup with the projection
// seeded under the ONE key the shared hook reads — the same harness the three screens use.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { Indicators } from './pages/VehicleDetailPage';

const VEHICLE_ID = 'v-200';
const BASELINE_VISIT = 'visit-periodic';
const LATER_VISIT = 'visit-bodywork';

const vehicle = {
  id: VEHICLE_ID,
  code: '200',
  typeId: 'type-1',
  plateNumber: 'س ص 200',
  chassisNumber: 'CH-200',
  motorNumber: 'MO-200',
  joinedAt: '2024-01-01T00:00:00.000Z',
  licenseExpiresAt: '2027-01-01T00:00:00.000Z',
  licenseClassId: null,
  operationId: null,
  insuranceCompanyId: null,
  branchId: null,
  departmentId: null,
  radio: { issi: null, motorolaSn: null },
  status: 'active',
  statusReason: null,
  licenseImage: null,
  inWorkshop: false,
  version: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as unknown as FleetVehicleDto;

const alarm = (over: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: VEHICLE_ID,
  code: '200',
  level: 'yellow',
  remainingKm: 500,
  sinceServiceKm: 9500,
  lastServiceAt: '2026-08-10T00:00:00.000Z',
  lastServiceVisitId: BASELINE_VISIT,
  noAlarmReason: null,
  ...over,
});

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto =>
  ({
    id: BASELINE_VISIT,
    vehicleId: VEHICLE_ID,
    vehicleCode: '200',
    inDate: '2026-08-09T00:00:00.000Z',
    outDate: '2026-08-10T00:00:00.000Z',
    workshopId: 'w1',
    workTypeId: 'periodic',
    spareParts: [],
    sparePartIds: [],
    odometerAtService: 49_900,
    exitOdometer: 50_000,
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    version: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...over,
  }) as unknown as FleetMaintenanceVisitDto;

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: {
            'fleetMaintenance.view': 'organization',
            'fleetOdometer.view': 'organization',
          },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  alarms: FleetMaintenanceAlarmDto[] | undefined,
  visits: FleetMaintenanceVisitDto[] | undefined,
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The one key the shared hook reads. A tile that went looking for the projection anywhere else
  // would find nothing here and print no answer at all.
  if (alarms !== undefined) qc.setQueryData(['fleet', 'alarms'], alarms);
  if (visits !== undefined) {
    qc.setQueryData(
      listKey('fleet', 'maintenance', {
        vehicleId: VEHICLE_ID,
        open: false,
        pageSize: 1,
        sortBy: 'outDate',
        sortDir: 'desc',
      }),
      { items: visits, meta: { page: 1, pageSize: 1, totalItems: visits.length, totalPages: 1 } },
    );
  }
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/fleet/vehicles/${VEHICLE_ID}`]}>
          <Indicators vehicle={vehicle} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const t = (key: string): string => translate('ar', key);

describe('«لا يوجد» says WHICH of the two it means', () => {
  it('a car whose cycle could not be measured says the reason the server gave', () => {
    // Four guards can stop the arithmetic and the tile used to print the same word for all of
    // them — the same word a healthy car gets. The board has said which since #383/#384.
    for (const reason of [
      'noInterval',
      'noReading',
      'noService',
      'readingOlderThanService',
      'baselineAboveReading',
      'baselineBelowChain',
    ] as const) {
      const markup = render(
        [alarm({ level: 'none', remainingKm: null, sinceServiceKm: null, noAlarmReason: reason })],
        [],
      );
      expect(markup, `${reason} is named`).toContain(t(`fleet.alarms.noAlarmReason.${reason}`));
      expect(markup).toContain(t('fleet.vehicle.alarmNone'));
    }
  });

  it('a HEALTHY car still reads as one — the word, and the distance left', () => {
    const markup = render(
      [alarm({ level: 'none', remainingKm: 9_600, sinceServiceKm: 400, noAlarmReason: null })],
      [],
    );
    expect(markup).toContain(t('fleet.vehicle.alarmNone'));
    // …and it does NOT borrow one of the reasons: nothing was wrong with this cycle.
    expect(markup).not.toContain(t('fleet.alarms.noAlarmReason.noService'));
  });

  it('an overdue car keeps its overdue sentence, not a reason', () => {
    const markup = render([alarm({ level: 'red', remainingKm: -500, sinceServiceKm: 10_500 })], []);
    expect(markup).toContain(t('fleet.dashboard.level.red'));
    expect(markup).toMatch(/متأخر/);
  });
});

describe('«آخر صيانة» names the service the countdown is measured from', () => {
  it('a later NON-counting visit does not become the last service', () => {
    // The car was serviced on 10/08 (the alarm baseline) and came back for bodywork that closed on
    // 20/08. The alarm still counts from 10/08 — so a tile that named 20/08 would contradict the
    // remaining-km figure printed beside it, and the alarms board, which says 10/08.
    const markup = render(
      [alarm()],
      [
        visit({
          id: LATER_VISIT,
          workTypeId: 'bodywork',
          inDate: '2026-08-19T00:00:00.000Z',
          outDate: '2026-08-20T00:00:00.000Z',
          odometerAtService: 55_000,
          exitOdometer: 55_100,
        }),
      ],
    );
    expect(markup, 'the baseline date, from the projection').toContain('١٠');
    expect(markup, 'not the later visit').not.toContain('٢٠٢٦/٠٨/٢٠');
    // Its counter is not the baseline's, so it is not printed as one.
    expect(markup).not.toContain('٥٥٬١٠٠');
  });

  it('the counter is shown when the loaded visit IS the baseline the server named', () => {
    const markup = render([alarm()], [visit()]);
    expect(markup).toContain('٥٠٬٠٠٠');
  });

  it('no counted service yet reads as none, whatever visits exist', () => {
    const markup = render(
      [
        alarm({
          level: 'none',
          remainingKm: null,
          sinceServiceKm: null,
          lastServiceAt: null,
          lastServiceVisitId: null,
          noAlarmReason: 'noService',
        }),
      ],
      [visit({ id: LATER_VISIT, workTypeId: 'bodywork' })],
    );
    expect(markup).toContain(t('fleet.vehicle.noService'));
  });

  it('a vehicle the projection does not cover keeps the visit-derived answer', () => {
    // `computeAlarms()` reports ACTIVE vehicles. A suspended one has no row, and this tile is
    // still the only place its last visit is shown.
    const markup = render([], [visit()]);
    expect(markup).toContain('٥٠٬٠٠٠');
  });
});
