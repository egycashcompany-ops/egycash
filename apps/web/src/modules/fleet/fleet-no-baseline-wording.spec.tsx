// One car, one finding — said once.
//
// `fleet.alarms.noBaseline` and `fleet.alarms.noAlarmReason.noService` were byte-identical in BOTH
// languages, and both rendered for the same car on the same row: the reason in the LEVEL column,
// and the identical sentence again in the «آخر صيانة» column beside it. A row about one car read
// as two findings about it, and the existing suite had already had to work around the collision
// ("`noService`'s wording is shared with the «آخر صيانة» column").
//
// «آخر صيانة» is a DATE column. The honest answer to "when" is nothing, drawn the way every other
// absent value on those rows is drawn. WHY there is no service belongs to the level column, and
// PR #383/#384 already decided how each screen says it — full text on the board, a tooltip on
// maintenance, silence on the odometer. None of that moves here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type FleetMaintenanceAlarmDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { listKey } from '../../shared/lib/query-keys';
import { translate } from '../../platform/localization/i18n';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { MaintenancePage } from './pages/MaintenancePage';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const VEHICLE = '650000000000000000000001';
const REASON = translate('ar', 'fleet.alarms.noAlarmReason.noService');

/** A car with no counted service at all — the state that used to print twice. */
const NO_SERVICE: FleetMaintenanceAlarmDto = {
  vehicleId: VEHICLE,
  code: '150',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: null,
  lastServiceVisitId: null,
  noAlarmReason: 'noService',
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(
            [
              'fleetMaintenance.view',
              'fleetOdometer.view',
              'fleetVehicle.view',
              'employee.view',
            ].map((p) => [p, 'organization']),
          ),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const draw = (node: JSX.Element, path: string, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const client = (): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'alarms'], [NO_SERVICE]);
  return qc;
};

const maintenanceMarkup = (): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'maintenance', { page: 1, pageSize: 25, sortBy: 'inDate', sortDir: 'desc' }),
    {
      items: [
        {
          id: '650000000000000000000091',
          vehicleId: VEHICLE,
          vehicleCode: '150',
          driverInEmployeeId: null,
          driverOutEmployeeId: null,
          inDate: '2026-06-01T00:00:00.000Z',
          outDate: null,
          workshopId: 'w1',
          workTypeId: 'wt1',
          spareParts: [],
          sparePartIds: [],
          odometerAtService: 275_000,
          exitOdometer: null,
          takenInByEmployeeId: null,
          takenOutByEmployeeId: null,
          notes: null,
          version: 0,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    },
  );
  return draw(<MaintenancePage />, '/fleet/maintenance', qc);
};

describe('the sentence appears once per car, not twice', () => {
  it('the alarms board says it exactly once', () => {
    // Once as VISIBLE text, in the level column — which is where PR #383 put it.
    const markup = draw(<MaintenanceAlarmsPage />, '/fleet/maintenance-alarms', client());
    expect(markup.split(`>${REASON}<`).length - 1, 'printed once').toBe(1);
    expect(markup.split(REASON).length - 1, 'and appears nowhere else at all').toBe(1);
  });

  it('the maintenance screen says it once, as a tooltip — PR #384 unchanged', () => {
    const markup = maintenanceMarkup();
    expect(markup.split(`title="${REASON}"`).length - 1, 'one tooltip').toBe(1);
    expect(markup, 'and never as visible text here').not.toContain(`>${REASON}<`);
    expect(markup.split(REASON).length - 1, 'so exactly one occurrence in total').toBe(1);
  });
});

describe('«آخر صيانة» is a date column, and answers like one', () => {
  it('neither screen prints a sentence in it', () => {
    for (const source of ['pages/MaintenanceAlarmsPage.tsx', 'pages/MaintenancePage.tsx']) {
      const body = read(source);
      const column = body.slice(body.indexOf("key: 'lastServiceAt'"));
      const render = column.slice(0, column.indexOf('\n    },'));
      expect(render, `${source} names no reason string`).not.toContain('noAlarmReason');
      expect(render, `${source} names no sentence key`).not.toContain('noBaseline');
      expect(render, `${source} draws an absent date as a dash`).toMatch(/—|dash/);
    }
  });

  it('and the dead key is gone from both languages', () => {
    // A translation nothing renders is a sentence waiting to be reintroduced somewhere new.
    for (const locale of ['ar', 'en'] as const) {
      const key = 'fleet.alarms.noBaseline';
      expect(translate(locale, key), `${locale} no longer defines it`).toBe(key);
    }
  });
});

describe('nothing else about the reason moved', () => {
  it('the reason string itself is unchanged, and still distinct from the catch-all', () => {
    expect(REASON).not.toBe(translate('ar', 'fleet.vehicle.alarmNone'));
    expect(translate('en', 'fleet.alarms.noAlarmReason.noService')).not.toBe(
      'fleet.alarms.noAlarmReason.noService',
    );
  });

  it('a car WITH a service still shows its date, not a dash', () => {
    // The control: the column still does its job.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      ['fleet', 'alarms'],
      [
        {
          ...NO_SERVICE,
          lastServiceAt: '2026-06-01T00:00:00.000Z',
          lastServiceVisitId: '650000000000000000000091',
          noAlarmReason: null,
          sinceServiceKm: 2000,
          remainingKm: 8000,
        },
      ],
    );
    const markup = draw(<MaintenanceAlarmsPage />, '/fleet/maintenance-alarms', qc);
    expect(markup).toContain('٢٠٢٦');
    expect(markup).not.toContain(REASON);
  });
});
