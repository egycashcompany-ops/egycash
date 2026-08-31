// ONE projection, TWO permission doors, ONE cache entry.
//
// The maintenance alarm is a maintenance fact derived from odometer readings, so two audiences
// legitimately ask the server for it: `GET /fleet/maintenance/alarms` (`fleetMaintenance.view`)
// and `GET /fleet/odometer/alarms` (`fleetOdometer.view`). Both routes are the SAME handler over
// the SAME `computeAlarms()`, so the answer cannot differ; only the permission does.
//
// That leaves exactly one thing for the client to get wrong, and it is the thing this file
// guards: a reader must go through ONE door and fill ONE cache entry. Two entries would be two
// copies of a projection that is supposed to be a single source of truth — the defect the whole
// design exists to prevent — and the choice must live in the hook, because five screens read it
// and a rule five screens have to remember is a rule one of them will forget. One of them already
// did: `/fleet/maintenance` gated the alarms on the ODOMETER permission.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { useCanReadAlarms, useMaintenanceAlarms } from './api/fleet-queries';
import * as api from './api/fleet-api';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const MAINTENANCE = 'fleetMaintenance.view';
const ODOMETER = 'fleetOdometer.view';

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/** What the hook actually did, read off the cache the render left behind. */
interface Outcome {
  entries: string[];
  door: 'maintenance' | 'odometer' | 'unknown';
  enabled: unknown;
  canRead: boolean;
}

const observe = (permissions: string[]): Outcome => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let canRead = false;
  const Probe = (): JSX.Element => {
    canRead = useCanReadAlarms();
    useMaintenanceAlarms();
    return <i />;
  };
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    </Provider>,
  );
  const all = qc.getQueryCache().findAll();
  const query = all[0] as
    | { queryKey: unknown; options: { queryFn?: unknown; enabled?: unknown } }
    | undefined;
  const fn = query?.options.queryFn;
  return {
    entries: all.map((q) => JSON.stringify(q.queryKey)),
    door:
      fn === api.listMaintenanceAlarmsForMaintenance
        ? 'maintenance'
        : fn === api.listMaintenanceAlarms
          ? 'odometer'
          : 'unknown',
    enabled: query?.options.enabled,
    canRead,
  };
};

describe('the reader goes through the door their permission opens', () => {
  it('maintenance only ⇒ the maintenance endpoint', () => {
    const seen = observe([MAINTENANCE]);
    expect(seen.door).toBe('maintenance');
    expect(seen.enabled, 'and the query runs').toBe(true);
    expect(seen.canRead).toBe(true);
  });

  it('odometer only ⇒ the odometer endpoint', () => {
    const seen = observe([ODOMETER]);
    expect(seen.door).toBe('odometer');
    expect(seen.enabled).toBe(true);
    expect(seen.canRead).toBe(true);
  });

  it('both ⇒ the MAINTENANCE endpoint, and only that one', () => {
    // The narrower audience for a maintenance fact wins. What matters more than which one wins is
    // that a choice is made at all: holding both permissions must not mean holding both answers.
    const seen = observe([MAINTENANCE, ODOMETER]);
    expect(seen.door).toBe('maintenance');
    expect(seen.entries, 'one entry, not one per permission').toEqual(['["fleet","alarms"]']);
  });

  it('neither ⇒ no query runs at all', () => {
    // Not "runs and gets a 403" — a reader with no claim on the projection asks for nothing.
    const seen = observe([]);
    expect(seen.enabled).toBe(false);
    expect(seen.canRead).toBe(false);
  });
});

describe('one cache entry, whichever door', () => {
  it('every permission combination fills exactly ONE, under a source-independent key', () => {
    for (const permissions of [[MAINTENANCE], [ODOMETER], [MAINTENANCE, ODOMETER], []]) {
      const seen = observe(permissions);
      expect(seen.entries, `for ${JSON.stringify(permissions)}`).toEqual(['["fleet","alarms"]']);
    }
  });

  it('and the key names no source, so no second key can exist to fill', () => {
    // A key like ['fleet','odometer','alarms'] would have to gain a sibling the moment a second
    // door appeared. This one cannot: there is nothing in it that varies with the door.
    const queries = read('api/fleet-queries.ts');
    expect((queries.match(/\[MODULE, 'alarms'\]/g) ?? []).length).toBe(1);
    expect(queries).not.toMatch(/\[MODULE, '(?:odometer|maintenance)', 'alarms'\]/);
  });

  it('the choice is made in the hook — no screen picks a door', () => {
    const queries = read('api/fleet-queries.ts');
    expect(queries).toMatch(/queryFn:\s*viaMaintenance\s*\?/);
    for (const page of [
      'MaintenancePage',
      'MaintenanceAlarmsPage',
      'OdometerPage',
      'FleetDashboardPage',
      'VehicleDetailPage',
    ]) {
      const source = read(`pages/${page}.tsx`);
      expect(source, `${page} names no endpoint`).not.toMatch(/['"`]\/fleet\/\w+\/alarms['"`]/);
      expect(source, `${page} picks no fetcher`).not.toContain(
        'listMaintenanceAlarmsForMaintenance',
      );
      // …and passes no permission of its own: the argument that used to be here is what got the
      // maintenance screen gated on the odometer permission.
      expect(source, `${page} gates on nothing of its own`).not.toMatch(
        /useMaintenanceAlarms\(\s*[^)\s]/,
      );
    }
  });
});

describe('showing a panel and answering for it are the same permission', () => {
  it('the dashboard and the vehicle profile gate on `useCanReadAlarms`, not on one door', () => {
    // Gating a panel on `fleetOdometer.view` while the hook answers for maintenance readers too
    // would hide a fact from somebody the query would happily have served.
    for (const page of ['FleetDashboardPage', 'VehicleDetailPage']) {
      const source = read(`pages/${page}.tsx`);
      expect(source, `${page} uses the shared predicate`).toContain('useCanReadAlarms()');
    }
  });

  it('and that predicate is exactly the hook’s own condition', () => {
    // Two spellings of "may read the alarms" is two things to keep in step. There is one.
    for (const permissions of [[MAINTENANCE], [ODOMETER], [MAINTENANCE, ODOMETER], []]) {
      const seen = observe(permissions);
      expect(seen.canRead, `for ${JSON.stringify(permissions)}`).toBe(seen.enabled);
    }
  });
});
