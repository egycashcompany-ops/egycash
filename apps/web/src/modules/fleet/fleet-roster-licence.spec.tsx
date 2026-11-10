// The roster page after R-03…R-06 and Q-01: the day's rules as views, badges and panels.
//
// The board arrives MARKED — `assignable`, `manned`, `crewGaps`, `stalePlan`, `licenceExpired` on
// every row, a `licence` on every available driver — and this page only reads those marks. So what
// is asserted here is what the reader sees for each mark, where the dashboard's links land, and the
// list the owner checks before switching the refusal on.
//
// The web suite renders without a DOM (`renderToStaticMarkup` over seeded caches), as every other
// roster spec does.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { RosterPage } from './pages/RosterPage';
import { FleetSettingsPage } from './pages/FleetSettingsPage';
import { rosterSource } from './roster-spec-sources';

/** The desktop page's CODE — its shell, its model, the computer's board and the shared parts. */
const SOURCE = rosterSource(['shell', 'model', 'desk', 'shared']);

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** A day well ahead of any clock this suite runs at, so the board is a plannable day. */
const DATE = '2099-03-10';

const id = (n: number): string => `65000000000000000000${String(n).padStart(4, '0')}`;
const V = {
  ready: id(1),
  gap: id(2),
  licGap: id(3),
  workshop: id(4),
  expired: id(5),
  stale: id(6),
};
const E = {
  seated: id(11), // available, on the ready car
  free: id(12), // available, on no car
  expiredFree: id(13), // licence expired, on no car — flagged, still draggable
  expiredSeated: id(14), // licence expired, on the licence-gap car
  absent: id(15), // التمامات
  leave: id(16), // HR leave
  leave2: id(17), // HR leave
  stale: id(18), // planned on the stale car, then absent
};

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetRosterRowDto> = {},
): FleetRosterRowDto => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  planned: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  assignable: true,
  licenceExpired: false,
  manned: false,
  crewGaps: [],
  crewCovered: 0,
  stalePlan: false,
  ...over,
});

const FLAG_BOARD: FleetRosterDayDto = {
  date: `${DATE}T00:00:00.000Z`,
  licenceRule: 'flag',
  rows: [
    row(V.ready, '150', { driver1EmployeeId: E.seated, manned: true }),
    row(V.gap, '151', {
      crewGaps: [{ seat: 1, employeeId: E.absent, reason: 'fleetUnavailability' }],
    }),
    row(V.licGap, '152', {
      driver1EmployeeId: E.expiredSeated,
      crewGaps: [{ seat: 1, employeeId: E.expiredSeated, reason: 'licenceExpired' }],
    }),
    row(V.workshop, '153', { inMaintenance: true, assignable: false }),
    row(V.expired, '154', { licenceExpired: true, assignable: false }),
    row(V.stale, '155', { planned: true, driver1EmployeeId: E.stale, stalePlan: true }),
  ],
  availableDrivers: [
    { employeeId: E.seated, assignedVehicleId: V.ready, licence: 'valid' },
    { employeeId: E.free, assignedVehicleId: null, licence: 'notRecorded' },
    { employeeId: E.expiredFree, assignedVehicleId: null, licence: 'expired' },
    { employeeId: E.expiredSeated, assignedVehicleId: V.licGap, licence: 'expired' },
  ],
  unavailableDrivers: [
    { employeeId: E.absent, reason: 'fleetUnavailability' },
    { employeeId: E.leave, reason: 'hrLeave' },
    { employeeId: E.leave2, reason: 'hrLeave' },
    { employeeId: E.stale, reason: 'fleetUnavailability' },
  ],
};

const REFUSE_BOARD: FleetRosterDayDto = {
  ...FLAG_BOARD,
  licenceRule: 'refuse',
  availableDrivers: FLAG_BOARD.availableDrivers.filter((d) => d.licence !== 'expired'),
  unavailableDrivers: [
    ...FLAG_BOARD.unavailableDrivers,
    { employeeId: E.expiredFree, reason: 'licenceExpired' },
    { employeeId: E.expiredSeated, reason: 'licenceExpired' },
  ],
};

const NAMES: Record<string, string> = {
  [E.seated]: 'سائق على سيارة',
  [E.free]: 'سائق متاح',
  [E.expiredFree]: 'سائق رخصته منتهية',
  [E.expiredSeated]: 'سائق مقيد برخصة منتهية',
  [E.absent]: 'سائق في التمامات',
  [E.leave]: 'سائق في إجازة',
  [E.leave2]: 'سائق في إجازة أخرى',
  [E.stale]: 'سائق مخطط غائب',
};

const client = (board: FleetRosterDayDto, date = DATE): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', date], board);
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [],
    meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
  });
  qc.setQueryData(
    ['fleet', 'people'],
    Object.entries(NAMES).map(([employeeId, fullNameAr]) => ({
      employeeId,
      code: 'HR-1',
      fullNameAr,
      status: 'active' as const,
      branchId: null,
      address: null,
      governorate: null,
      phone: null,
      hiredAt: null,
    })),
  );
  return qc;
};

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  query = '',
  board: FleetRosterDayDto = FLAG_BOARD,
  {
    url = `/fleet/roster?date=${DATE}${query}`,
    date = DATE,
    permissions = ['fleetRoster.view', 'fleetRoster.plan'],
  } = {},
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={client(board, date)}>
        <MemoryRouter initialEntries={[url]}>
          <RosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));

/** The markup of the table row whose code cell reads `code`. */
const rowMarkup = (markup: string, code: string): string => {
  const body = tbody(markup);
  const at = body.indexOf(`>${code}<`);
  if (at === -1) return '';
  return body.slice(body.lastIndexOf('<tr', at), body.indexOf('</tr>', at));
};

const chip = (markup: string, key: string): string => {
  const at = markup.indexOf(`data-counter="${key}"`);
  if (at === -1) throw new Error(`no counter ${key}`);
  return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('</button>', at));
};

const section = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<div', at), markup.length);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the day it opens on is CAIRO’s day', () => {
  it('at 23:30 UTC on 31 October it opens on 1 November', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T23:30:00.000Z'));
    const board = { ...FLAG_BOARD, date: '2026-11-01T00:00:00.000Z' };
    const markup = render('', board, { url: '/fleet/roster', date: '2026-11-01' });
    expect(markup).toContain('value="2026-11-01"');
    expect(tbody(markup), 'and shows that day’s board').toContain('>150<');
  });

  it('reads the day through the Cairo helper, not the UTC slice', () => {
    expect(SOURCE).toContain('const today = (): string => cairoYmd(new Date());');
  });
});

describe('the three rule views — where the dashboard’s links land', () => {
  it('offers each as a chip with the day’s count', () => {
    const markup = render();
    expect(chip(markup, 'ready')).toContain(t('fleet.roster.counter.ready'));
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    expect(chip(markup, 'ready'), '150, 151, 152 and 155').toContain('4');
    expect(chip(markup, 'unmanned'), '151, 152, 155').toContain('3');
    expect(chip(markup, 'crewGap'), 'only the absence').toContain('1');
  });

  it('view=ready shows the cars the server marked assignable', () => {
    const body = tbody(render('&view=ready'));
    for (const code of ['150', '151', '152', '155']) expect(body, code).toContain(`>${code}<`);
    for (const code of ['153', '154']) expect(body, code).not.toContain(`>${code}<`);
  });

  it('view=unmanned shows ready cars nobody available is on — a stale plan included', () => {
    const body = tbody(render('&view=unmanned'));
    for (const code of ['151', '152', '155']) expect(body, code).toContain(`>${code}<`);
    expect(body).not.toContain('>150<');
  });

  it('view=crewGap shows the absence gaps only', () => {
    const body = tbody(render('&view=crewGap'));
    expect(body).toContain('>151<');
    expect(body, 'a licence gap is not an absence').not.toContain('>152<');
  });

  it('marks the applied view’s chip as pressed', () => {
    expect(chip(render('&view=crewGap'), 'crewGap')).toContain('aria-pressed="true"');
    expect(chip(render('&view=crewGap'), 'total')).toContain('aria-pressed="false"');
  });
});

describe('the badges', () => {
  it('«رخصة منتهية» on a car whose own licence expired', () => {
    const tr = rowMarkup(render(), '154');
    expect(tr).toContain('data-roster-flag="licenceExpired"');
    expect(tr).toContain(t('fleet.roster.licenceExpired'));
    expect(rowMarkup(render(), '150')).not.toContain('data-roster-flag="licenceExpired"');
  });

  it('«غائب من الطاقم الثابت» on a car whose standing driver is absent', () => {
    const tr = rowMarkup(render(), '151');
    expect(tr).toContain('data-roster-flag="crewGap"');
    expect(tr).toContain(t('fleet.roster.crewAbsent'));
  });

  it('a gap for another reason says so on its own, not as an absence', () => {
    const tr = rowMarkup(render(), '152');
    expect(tr).toContain('data-roster-flag="crewUnavailable"');
    expect(tr).not.toContain('data-roster-flag="crewGap"');
  });

  it('a stale plan is named', () => {
    expect(rowMarkup(render(), '155')).toContain('data-roster-flag="stalePlan"');
  });

  it('«رخصة منتهية» on the DRIVER in the seat, too', () => {
    const tr = rowMarkup(render(), '152');
    expect(tr).toContain('data-driver-licence="expired"');
    expect(rowMarkup(render(), '150')).not.toContain('data-driver-licence="expired"');
  });
});

describe('the available panel — «منهم رخصة منتهية N»', () => {
  it('lists the licensed drivers only, and counts them', () => {
    const markup = render();
    expect(markup, 'the free driver is in the list').toContain(`data-driver-card="${E.free}"`);
    expect(markup, 'the flagged one is not').not.toContain(`data-driver-card="${E.expiredFree}"`);
    // «اعتمد» on D1: the count sits in the «السائقون المتاحون» TAB of the one drivers panel, in a
    // Latin digit.
    const at = markup.indexOf('data-driver-tab="available"');
    const tab = markup.slice(at, markup.indexOf('</button>', at));
    expect(tab).toContain(t('fleet.roster.availableTitle'));
    expect(tab, 'one unseated licensed driver').toContain('>1<');
  });

  it('lists every licence-expired driver of the day under it, seated or not', () => {
    const panel = section(render(), 'data-licence-expired-panel="true"');
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    expect(panel).toContain(t('fleet.roster.expiredLicence.title', { count: '2' }));
    expect(panel).toContain(`data-licence-expired-driver="${E.expiredFree}"`);
    expect(panel).toContain(`data-licence-expired-driver="${E.expiredSeated}"`);
    expect(panel, 'the seated one says where').toContain(
      t('fleet.roster.expiredLicence.seatedOn', { code: '152' }),
    );
  });

  it('keeps an unseated flagged driver draggable — planning accepts him while the rule flags', () => {
    const panel = section(render(), 'data-licence-expired-panel="true"');
    const at = panel.indexOf(`data-licence-expired-driver="${E.expiredFree}"`);
    expect(panel.slice(at, panel.indexOf('</li>', at))).toContain('draggable="true"');
  });

  it('links the owner’s list for the board’s day — drivers and active vehicles', () => {
    const panel = section(
      render('', FLAG_BOARD, {
        permissions: [
          'fleetRoster.view',
          'fleetRoster.plan',
          'fleetDriver.view',
          'fleetVehicle.view',
        ],
      }),
      'data-licence-expired-panel="true"',
    );
    expect(panel).toContain(`href="/fleet/drivers?licExpBefore=${DATE}"`);
    expect(panel).toContain(`href="/fleet/vehicles?status=active&amp;licExpBefore=${DATE}"`);
    expect(panel).toContain(t('fleet.roster.expiredLicence.vehiclesLink', { count: '1' }));
  });

  it('offers each check only with its own screen’s guard — the roster’s opens neither', () => {
    const rosterOnly = section(render(), 'data-licence-expired-panel="true"');
    expect(rosterOnly).not.toContain('data-licence-check=');
    const drivers = section(
      render('', FLAG_BOARD, {
        permissions: ['fleetRoster.view', 'fleetRoster.plan', 'fleetDriver.view'],
      }),
      'data-licence-expired-panel="true"',
    );
    expect(drivers).toContain('data-licence-check="drivers"');
    expect(drivers).not.toContain('data-licence-check="vehicles"');
  });

  it('is gone once the rule REFUSES — those drivers are unavailable, with the reason', () => {
    const markup = render('', REFUSE_BOARD);
    expect(markup).not.toContain('data-licence-expired-panel="true"');
    expect(markup).toContain(`data-unavailable-driver="${E.expiredFree}"`);
    expect(markup).toContain(`data-reason-filter="licenceExpired"`);
    expect(t('fleet.roster.reason.licenceExpired')).not.toBe('fleet.roster.reason.licenceExpired');
  });

  it('stays gone after «حفظ» — the saved day keeps the rule it was derived under', () => {
    // The save writes the server's answer into the day's cache. Written without `licenceRule`,
    // the board read the rule as «not refuse» and drew the block again until the next refetch.
    const queries = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'api/fleet-queries.ts'),
      'utf8',
    );
    const save = queries.slice(
      queries.indexOf('export const usePlanRoster'),
      queries.indexOf('onError:', queries.indexOf('export const usePlanRoster')),
    );
    expect(save).toContain('licenceRule: board.licenceRule');
    expect(render('', REFUSE_BOARD)).not.toContain('data-licence-expired-panel="true"');
  });
});

describe('the unavailable panel — per-reason subtotals and the reason filter', () => {
  it('subtotals each reason present, in the seam’s order', () => {
    const markup = render();
    const tam = markup.indexOf('data-reason-filter="fleetUnavailability"');
    const leave = markup.indexOf('data-reason-filter="hrLeave"');
    expect(tam).toBeGreaterThan(-1);
    expect(leave).toBeGreaterThan(tam);
    const leaveChip = markup.slice(leave, markup.indexOf('</button>', leave));
    expect(leaveChip).toContain(t('fleet.roster.reason.hrLeave'));
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    expect(leaveChip).toContain('>2<');
  });

  it('unavailable=hrLeave shows the leave only, and presses its chip', () => {
    const markup = render('&unavailable=hrLeave');
    expect(markup).toContain(`data-unavailable-driver="${E.leave}"`);
    expect(markup).toContain(`data-unavailable-driver="${E.leave2}"`);
    expect(markup).not.toContain(`data-unavailable-driver="${E.absent}"`);
    const at = markup.indexOf('data-reason-filter="hrLeave"');
    expect(markup.slice(at, markup.indexOf('>', at))).toContain('aria-pressed="true"');
  });

  it('takes several reasons at once', () => {
    const markup = render('&unavailable=hrLeave,fleetUnavailability');
    for (const e of [E.leave, E.leave2, E.absent, E.stale]) {
      expect(markup).toContain(`data-unavailable-driver="${e}"`);
    }
  });

  it('a reason nobody has today still shows its chip, pressed at 0, and says why the list is empty', () => {
    // The dashboard links its zeros too: «إجازة 0» opens `unavailable=hrLeave` on a day without leave.
    const board = {
      ...FLAG_BOARD,
      unavailableDrivers: FLAG_BOARD.unavailableDrivers.filter((d) => d.reason !== 'hrLeave'),
    };
    const markup = render('&unavailable=hrLeave', board);
    const at = markup.indexOf('data-reason-filter="hrLeave"');
    expect(at, 'the asked reason has its chip').toBeGreaterThan(-1);
    const chip = markup.slice(at, markup.indexOf('</button>', at));
    expect(chip).toContain('aria-pressed="true"');
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    expect(chip).toContain('>0<');
    expect(markup).not.toContain(`data-unavailable-driver="${E.absent}"`);
    expect(markup).toContain(t('fleet.roster.reasonFilterEmpty'));
    expect(markup).not.toContain(t('fleet.fixedRoster.driverSearchEmpty'));
    // «إعادة ضبط» is offered, and takes the reasons off with the other filters — the new boards'
    // own reset, the FilterBar's, at the end of the dark bar.
    const reset = `aria-label="${t('common.filters.clear')}"`;
    expect(markup).toContain(reset);
    expect(SOURCE).toContain('patch({ q: null, mission: null, view: null, unavailable: null })');
    expect(render('', board)).not.toContain(reset);
  });

  it('is a REMEMBERED filter, written through the URL', () => {
    expect(SOURCE).toContain(
      "const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view', 'unavailable'] as const;",
    );
    expect(SOURCE).toContain("readList(sp, 'unavailable')");
    expect(SOURCE).toContain('patch({ unavailable: writeList(toggleValue(reasons, reason)) })');
  });
});

describe('/fleet/settings offers the refusal and the reading days', () => {
  const settings = (permissions: string[]): string => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      ['platform', 'settings', 'me'],
      [
        { key: FleetSettingKeys.RosterRefuseExpiredLicence, value: false, resolvedFrom: 'default' },
        { key: FleetSettingKeys.OdometerMissingReadingDays, value: 3, resolvedFrom: 'default' },
        { key: FleetSettingKeys.UseHrLeave, value: true, resolvedFrom: 'default' },
      ],
    );
    return renderToStaticMarkup(
      <Provider store={store(permissions)}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/fleet/settings']}>
            <FleetSettingsPage />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('labels the refusal and sends the administrator to the roster’s list first', () => {
    const markup = settings(['setting.edit']);
    const box = section(
      markup,
      `data-fleet-setting="${FleetSettingKeys.RosterRefuseExpiredLicence}"`,
    );
    expect(box).toContain('type="checkbox"');
    expect(box).toContain(t('fleet.settings.keys.refuseExpiredLicence'));
    expect(box).toContain(t('fleet.settings.keys.refuseExpiredLicenceHint'));
    expect(t('fleet.settings.keys.refuseExpiredLicenceHint')).toContain('منهم رخصة منتهية');
  });

  it('offers the reading days as a number with its hint', () => {
    const markup = settings(['setting.edit']);
    expect(markup).toContain(t('fleet.settings.keys.odometerMissingReadingDays'));
    expect(markup).toContain(t('fleet.settings.keys.odometerMissingReadingDaysHint'));
  });

  it('keeps HR leave where it was — the refusal is a second switch, not a replacement', () => {
    const markup = settings(['setting.edit']);
    expect(markup).toContain(`data-fleet-setting="${FleetSettingKeys.UseHrLeave}"`);
    expect(markup).toContain(t('fleet.settings.keys.useHrLeave'));
  });
});
