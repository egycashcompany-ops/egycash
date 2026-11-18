// «لوحة تحكم الحركة» — «الحركة اليوم» (plan build-ot §7, the owner's «تمام» on the sample).
//
// What this file pins: each figure reads the field it is about and opens the screen that shows the
// same number (through the one link builder); the readiness share is readyManned ÷ ready; the
// «أسباب عدم التعيين» tiles are parts of the unmanned cars only, stalePlan and the residue only when
// they hold a car; the two lists are the server's rows as sent, «فتح» opening the car on the roster,
// «عرض الكل (N)» counted by the server; the roster's own words name a driver's reason; names only with
// the drivers' view; the branch column only while more than one branch is covered; the drivers wear
// «الشركة كلها» whenever the cars are narrowed, «كل فروعي» included. The audit's fixes (D06, D15,
// D17, D18): the workshop tiles add up to the headline, «المسجّلة» counts «مكهنة» as the vehicles
// screen does, the available drivers split into «على سيارات · بلا سيارة», and «ترخيص منتهٍ» says it
// counts the cars outside the workshop. It also carries the pins of the
// retired «الحركة الآن» tab that still hold (badge share, ready = active − workshop − licence, reasons
// verbatim, the oldest stay with no ceiling, the absent parts each with its own list).
//
// Rendered through the real page over seeded caches (`renderDashboard`), the fleet-dashboard way.
import { describe, expect, it } from 'vitest';
import {
  type FleetDashboardAbsentDriverDto,
  type FleetDashboardNowDto,
  type FleetDashboardUnmannedRowDto,
  type FleetPersonDto,
} from '@ecms/contracts';
import { featureKey } from '../../shared/lib/query-keys';
import { shareText } from './lib/fleet-dashboard-tabs';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

const need = <T,>(value: T | null): T => {
  if (value === null) throw new Error('fixture section is null');
  return value;
};

const ROSTER = need(NOW_DTO.roster);
const CAIRO = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

const E1 = '64b1f0eeeeeeeeeeeeeeee01';
const E2 = '64b1f0eeeeeeeeeeeeeeee02';
const E3 = '64b1f0eeeeeeeeeeeeeeee03';
const E4 = '64b1f0eeeeeeeeeeeeeeee04';
const E5 = '64b1f0eeeeeeeeeeeeeeee05';
const E6 = '64b1f0eeeeeeeeeeeeeeee06';

/** The five unmanned cars of the fixture: crewGap 2 + stalePlan 1 + noCrew 2 + unassigned 0 = 5. */
const ROWS: FleetDashboardUnmannedRowDto[] = [
  {
    vehicleId: 'v214',
    code: '214',
    typeName: { ar: 'مصفحة نقل أموال', en: 'Cash van' },
    branch: CAIRO,
    mission: { ar: 'نقل أموال بنوك', en: 'Bank cash' },
    why: 'crewGap',
    absent: { employeeId: E1, reason: 'hrLeave' },
  },
  {
    vehicleId: 'v305',
    code: '305',
    typeName: { ar: 'مصفحة تغذية ماكينات', en: 'ATM van' },
    branch: GIZA,
    mission: null,
    why: 'crewGap',
    absent: { employeeId: E2, reason: 'fleetUnavailability' },
  },
  {
    vehicleId: 'v410',
    code: '410',
    typeName: null,
    branch: CAIRO,
    mission: { ar: 'تحصيل كبار عملاء', en: 'Key accounts' },
    why: 'stalePlan',
    absent: { employeeId: E3, reason: 'profileInactive' },
  },
  {
    vehicleId: 'v318',
    code: '318',
    typeName: { ar: 'مصفحة نقل خفيف', en: 'Light van' },
    branch: null,
    mission: null,
    why: 'noCrew',
    absent: null,
  },
  {
    vehicleId: 'v322',
    code: '322',
    typeName: { ar: 'مصفحة نقل خفيف', en: 'Light van' },
    branch: GIZA,
    mission: null,
    why: 'noCrew',
    absent: null,
  },
];

/** The five absent drivers of the fixture (attendance 3, leave 2), crew members first. */
const ABSENT: FleetDashboardAbsentDriverDto[] = [
  { employeeId: E1, reason: 'hrLeave', crewVehicle: { vehicleId: 'v214', code: '214' } },
  {
    employeeId: E2,
    reason: 'fleetUnavailability',
    crewVehicle: { vehicleId: 'v305', code: '305' },
  },
  { employeeId: E4, reason: 'fleetUnavailability', crewVehicle: null },
  { employeeId: E6, reason: 'fleetUnavailability', crewVehicle: null },
  { employeeId: E5, reason: 'hrLeave', crewVehicle: null },
];

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  roster: {
    ...ROSTER,
    unmanned: 5,
    unmannedCrewGap: 2,
    unmannedStalePlan: 1,
    unmannedNoCrew: 2,
    unmannedUnassigned: 0,
    absent: { attendance: 3, leave: 2 },
    unmannedRows: ROWS,
    absentDrivers: ABSENT,
  },
  unavailable: [],
};
const NOW_ROSTER = need(NOW.roster);

const person = (employeeId: string, code: string, fullNameAr: string): FleetPersonDto => ({
  employeeId,
  code,
  fullNameAr,
  status: 'active',
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});
/** Fleet's people: E6 is not one of them (the name falls back to a dash). */
const PEOPLE: FleetPersonDto[] = [
  person(E1, '2901', 'أحمد محمد إبراهيم'),
  person(E2, '2880', 'محمود فتحي النجار'),
  person(E3, '2920', 'سعيد عبد الله حسن'),
  person(E4, '2850', 'طارق سيد عثمان'),
  person(E5, '2940', 'هاني جرجس ميخائيل'),
];

const tab = (
  now: FleetDashboardNowDto = NOW,
  permissions: readonly string[] = ALL_KEYS,
): string => {
  const client = dashboardClient({ now });
  client.setQueryData(featureKey('fleet', 'people'), PEOPLE);
  return renderDashboard({ url: '/fleet?tab=today', client, permissions });
};
const withRoster = (patch: Partial<typeof NOW_ROSTER>, rest: Partial<FleetDashboardNowDto> = {}) =>
  tab({ ...NOW, ...rest, roster: { ...NOW_ROSTER, ...patch } });
const without = (key: string): string[] => ALL_KEYS.filter((k) => k !== key);

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;/gu, "'");
/** Every link the markup holds: its target and the figure it carries. */
const links = (html: string): { href: string; metric: string }[] =>
  [...html.matchAll(/<a\b[^>]*>/gu)].map((m) => ({
    href: (/href="([^"]*)"/u.exec(m[0])?.[1] ?? '').replace(/&amp;/gu, '&'),
    metric: /data-metric="([^"]*)"/u.exec(m[0])?.[1] ?? '',
  }));
const hrefOf = (html: string, metric: string): string[] =>
  links(html)
    .filter((l) => l.metric === metric)
    .map((l) => l.href);
const metricsOf = (html: string): string[] => [...new Set(links(html).map((l) => l.metric))];
/** The markup of one element, from its marker to the next sibling marker of the same kind. */
const part = (html: string, marker: string, next: RegExp): string => {
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const rest = html.slice(start + marker.length);
  const end = rest.search(next);
  return marker + (end < 0 ? rest : rest.slice(0, end));
};
const card = (html: string, key: string): string =>
  part(html, `data-today-card="${key}"`, /data-today-card="/u);
const squash = (s: string): string => s.replace(/\s+/gu, '');

const roster = (extra: Record<string, string>): string =>
  `/fleet/roster?date=${TODAY}${Object.entries(extra)
    .map(([k, v]) => `&${k}=${v}`)
    .join('')}`;

const HTML = tab();

// ── The heading and the readiness card ────────────────────────────────────────────────────────

describe('«الحركة اليوم» — the heading and the readiness card', () => {
  it('opens on the approved title, the live chip and the new sub-line', () => {
    expect(HTML).toContain('data-dash-tab-body="today"');
    expect(text(HTML)).toContain(ar('fleet.dash.now.title'));
    expect(text(HTML)).toContain(ar('fleet.dash.now.sub'));
    expect(HTML).toContain('data-live-variant="long"');
  });

  it('reads the share as the ready cars that have a driver: readyManned ÷ ready', () => {
    expect(HTML).toMatch(/data-today-share="true"[^>]*>84\.8%</u);
    expect(text(card(HTML, 'readiness'))).toContain(
      '28 من 33 سيارة جاهزة لها سائق متاح اليوم، و5 بلا سائق.',
    );
    expect(hrefOf(card(HTML, 'readiness'), 'roster.ready')).toEqual([roster({ view: 'ready' })]);
    expect(hrefOf(card(HTML, 'readiness'), 'roster.unmanned.summary')).toEqual([
      roster({ view: 'unmanned' }),
    ]);
  });

  it('counts the left-out as rows − ready, the workshop part linked and the expired licences plain', () => {
    const foot = part(HTML, 'data-today-excluded="true"', /<\/section>/u);
    expect(text(foot)).toContain('استُبعدت 7 من 40 نشطة:');
    expect(squash(text(foot))).toContain(squash(`${ar('fleet.dash.now.inWorkshop')} 5`));
    expect(squash(text(foot))).toContain(squash(`${ar('fleet.dash.now.licenceExpired')} 2`));
    expect(hrefOf(foot, 'roster.inWorkshop')).toEqual([roster({ view: 'workshop' })]);
    expect(metricsOf(foot)).toEqual(['roster.inWorkshop']);
  });

  it('balances the ready cars against the available drivers; «المتاحون» itself is not linked', () => {
    const balance = card(HTML, 'balance');
    expect(balance).toContain('data-today-gap="true"');
    expect(text(balance)).toContain('السائقون المتاحون أكثر بـ 11');
    expect(text(balance)).toContain(
      '5 من السيارات الجاهزة بلا سائق، و6 من السائقين المتاحين بلا سيارة.',
    );
    // The census names: «بلا سيارة» opens the roster's available panel; the headline has no link.
    expect(hrefOf(HTML, 'roster.availableWithoutVehicle.balance')).toEqual([roster({})]);
    expect(hrefOf(HTML, 'roster.availableWithoutVehicle')).toEqual([roster({})]);
    expect(metricsOf(HTML)).not.toContain('roster.available');
    expect(metricsOf(HTML)).not.toContain('roster.available.balance');
  });
});

// ── The five KPI cards ────────────────────────────────────────────────────────────────────────

describe('«الحركة اليوم» — the five cards', () => {
  it('draws the five cards and nothing of the retired tab', () => {
    for (const key of ['vehicles', 'workshop', 'unmanned', 'available', 'absent']) {
      expect(HTML, key).toContain(`data-today-card="${key}"`);
    }
    expect(HTML).not.toContain('data-today-card="ready"');
    expect(HTML).not.toContain('data-now-card=');
    expect(text(HTML)).not.toContain('اقتراحات');
    expect(text(HTML)).not.toContain('تعمل اليوم');
  });

  it('writes the out-of-service reasons as recorded, and says so when there is none', () => {
    const vehicles = card(HTML, 'vehicles');
    expect(text(vehicles)).toContain('حادث');
    expect(text(vehicles)).toContain(ar('fleet.dash.now.noReason'));
    expect(hrefOf(vehicles, 'vehicles.active')).toEqual(['/fleet/vehicles?status=active']);
    expect(hrefOf(vehicles, 'vehicles.outOfService')).toContain(
      '/fleet/vehicles?status=outOfService',
    );
    expect(hrefOf(vehicles, 'vehicles.outOfServiceRow')).toEqual([
      '/fleet/vehicles/v154',
      '/fleet/vehicles/v260',
    ]);
  });

  it('dates the oldest workshop stay with no ceiling, the status parts plain', () => {
    const workshop = card(HTML, 'workshop');
    expect(text(workshop)).toContain('منذ 9 أيام');
    expect(text(workshop)).not.toContain('سقف');
    expect(text(workshop)).toContain(ar('fleet.dash.now.workshopByStatus'));
    // The visits checked in by today (the server's own bound, D07).
    expect(hrefOf(workshop, 'workshop.open')).toEqual([
      `/fleet/maintenance?state=open&to=${TODAY}`,
    ]);
    expect(metricsOf(workshop).sort()).toEqual(['workshop.oldest', 'workshop.open']);
  });

  it('says «منذ اليوم» for a car that entered the workshop today, never «منذ 0 أيام»', () => {
    const workshop = need(NOW.workshop);
    const oldest = need(workshop.oldest);
    const today = text(tab({ ...NOW, workshop: { ...workshop, oldest: { ...oldest, days: 0 } } }));
    expect(today).toContain(ar('fleet.dash.common.sinceToday'));
    expect(today).not.toContain('منذ 0');
  });

  it('links the oldest car’s file only with fleetVehicle.view', () => {
    expect(hrefOf(tab(), 'workshop.oldest')).toEqual(['/fleet/vehicles/v141']);
    const blind = tab(NOW, without('fleetVehicle.view'));
    expect(hrefOf(blind, 'workshop.oldest')).toEqual([]);
    expect(text(card(blind, 'workshop'))).toContain('141');
  });

  it('gives a car deleted since no link to its file — the file is no longer served', () => {
    const workshop = need(NOW.workshop);
    const oldest = need(workshop.oldest);
    const gone = tab({ ...NOW, workshop: { ...workshop, oldest: { ...oldest, deleted: true } } });
    expect(hrefOf(gone, 'workshop.oldest')).toEqual([]);
    // The car is still named (its visit is still open and counted).
    expect(text(card(gone, 'workshop'))).toContain('141');
  });

  it('splits «أسباب عدم التعيين» into parts of the unmanned cars only — never the ready stale plans', () => {
    const html = withRoster({
      unmannedCrewGap: 1,
      unmannedStalePlan: 2,
      unmannedNoCrew: 1,
      unmannedUnassigned: 1,
      crewGap: { ...NOW_ROSTER.crewGap, stalePlan: 9 },
    });
    const unmanned = squash(text(card(html, 'unmanned')));
    expect(unmanned).toContain(squash(`2${ar('fleet.dash.now.unmannedStalePlan')}`));
    expect(unmanned).not.toContain(squash(`9${ar('fleet.dash.now.unmannedStalePlan')}`));
    expect(unmanned).toContain(squash(`1${ar('fleet.dash.now.unmannedUnassigned')}`));
    // Plain parts: the roster's crew-gap view lists manned cars too.
    expect(metricsOf(card(html, 'unmanned'))).toEqual(['roster.unmanned']);
    expect(hrefOf(card(html, 'unmanned'), 'roster.unmanned')).toEqual([
      roster({ view: 'unmanned' }),
    ]);
  });

  it('draws the stale-plan and the unassigned parts only when they hold a car', () => {
    const html = withRoster({ unmannedStalePlan: 0, unmannedUnassigned: 0 });
    const unmanned = text(card(html, 'unmanned'));
    expect(unmanned).toContain(ar('fleet.dash.now.unmannedCrewGap'));
    expect(unmanned).toContain(ar('fleet.dash.now.unmannedNoCrew'));
    expect(unmanned).not.toContain(ar('fleet.dash.now.unmannedStalePlan'));
    expect(unmanned).not.toContain(ar('fleet.dash.now.unmannedUnassigned'));
  });

  it('wears «تحتاج تعيين» while a ready car has no driver, «كلها لها سائق» when none', () => {
    expect(text(card(HTML, 'unmanned'))).toContain(ar('fleet.dash.now.unmannedTag'));
    const clear = withRoster({
      unmanned: 0,
      unmannedCrewGap: 0,
      unmannedStalePlan: 0,
      unmannedNoCrew: 0,
      unmannedRows: [],
    });
    expect(text(card(clear, 'unmanned'))).toContain(ar('fleet.dash.now.unmannedClear'));
  });

  it('names the drivers left out in the roster’s own words, each part opening its list', () => {
    const available = card(HTML, 'available');
    const body = text(available);
    expect(body).toContain('الملف موقوف');
    expect(body).toContain('خارج الخدمة الوظيفية');
    expect(body).not.toContain('ملف غير نشط');
    expect(body).not.toContain('موقوف عن العمل');
    expect(hrefOf(available, 'roster.profileInactive')).toEqual([
      roster({ unavailable: 'profileInactive' }),
    ]);
    expect(hrefOf(available, 'roster.notEmployed')).toEqual([
      roster({ unavailable: 'notEmployed' }),
    ]);
    // «flag»: the expired licences stay in the available panel; «refuse»: they are unavailable.
    expect(hrefOf(available, 'roster.licenceExpiredDrivers')).toEqual([roster({})]);
    expect(
      hrefOf(
        card(withRoster({ licenceRule: 'refuse' }), 'available'),
        'roster.licenceExpiredDrivers',
      ),
    ).toEqual([roster({ unavailable: 'licenceExpired' })]);
    // The headline's two parts (D15): the seated, and the roster's «السائقون المتاحون».
    expect(text(available)).toContain(
      ar('fleet.dash.now.availableSplit', { seated: '38', free: '6' }),
    );
  });

  it('splits the absent by the roster’s reasons, each part opening its own list, the sheet only with its grant', () => {
    const absent = card(HTML, 'absent');
    expect(text(absent)).toContain('تمام: غير متاح');
    expect(text(absent)).toContain('إجازة معتمدة');
    expect(hrefOf(absent, 'roster.absent.attendance')).toEqual([
      roster({ unavailable: 'fleetUnavailability' }),
    ]);
    expect(hrefOf(absent, 'roster.absent.leave')).toEqual([roster({ unavailable: 'hrLeave' })]);
    expect(hrefOf(absent, 'roster.absent.attendanceSheet')).toEqual([
      `/fleet/attendance?date=${TODAY}`,
    ]);
    expect(
      hrefOf(tab(NOW, without('fleetAvailability.view')), 'roster.absent.attendanceSheet'),
    ).toEqual([]);
  });

  it('renders nothing for a section the reader may not see, and the error for one that failed', () => {
    const none = tab({ ...NOW, vehicles: null });
    expect(none).not.toContain('data-today-card="vehicles"');
    expect(none).toContain('data-today-card="workshop"');
    const failed = tab({ ...NOW, roster: null, unavailable: ['roster'] });
    expect(failed).toContain('data-section-error="roster"');
    expect(failed).not.toContain('data-today-card="readiness"');
    expect(failed).not.toContain('data-today-card="unmanned-list"');
    expect(failed).toContain('data-today-card="vehicles"');
  });
});

// ── «سيارات بلا سائق اليوم» ─────────────────────────────────────────────────────────────────────

describe('«الحركة اليوم» — the cars without a driver', () => {
  const list = card(HTML, 'unmanned-list');
  const row = (code: string): string =>
    part(list, `data-today-unmanned="${code}"`, /data-today-unmanned="|<\/tbody>/u);

  it('lists the server’s rows as sent, each class in its own words', () => {
    expect([...list.matchAll(/data-today-unmanned="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '214',
      '305',
      '410',
      '318',
      '322',
    ]);
    expect(text(row('214'))).toContain(ar('fleet.dash.now.unmannedCrewGap'));
    expect(text(row('410'))).toContain(ar('fleet.dash.now.unmannedStalePlan'));
    expect(text(row('318'))).toContain(ar('fleet.dash.now.unmannedNoCrew'));
    expect(text(list)).toContain('5 سيارات بلا سائق');
  });

  it('writes the type, the branch («بلا فرع» when none) and the mission («—» when none)', () => {
    expect(text(row('214'))).toContain('مصفحة نقل أموال');
    expect(text(row('214'))).toContain('القاهرة');
    expect(text(row('214'))).toContain('نقل أموال بنوك');
    expect(text(row('318'))).toContain(ar('fleet.dash.now.table.noBranch'));
    expect(text(row('305'))).toContain('—');
  });

  it('folds the branch and mission under the code on a phone — no column to scroll to', () => {
    // Under 640 px the table is a list of blocks: no head, the code and «فتح» on the first line.
    expect(list).toMatch(/<thead class="[^"]*max-sm:hidden/u);
    const phone = part(row('214'), 'data-today-phone-line="true"', /<\/div>/u);
    expect(phone).toContain('sm:hidden');
    expect(text(phone)).toContain('القاهرة');
    expect(text(phone)).toContain('نقل أموال بنوك');
    // One branch in scope: no branch column, and none under the code either.
    const one = card(tab({ ...NOW, branchId: CAIRO.id, scopeBranches: [CAIRO] }), 'unmanned-list');
    const oneRow = part(one, 'data-today-unmanned="214"', /data-today-unmanned="|<\/tbody>/u);
    expect(text(part(oneRow, 'data-today-phone-line="true"', /<\/div>/u))).not.toContain('القاهرة');
    expect(
      part(one, 'data-today-unmanned="318"', /data-today-unmanned="|<\/tbody>/u),
    ).not.toContain('data-today-phone-line');
  });

  it('names the absent driver and the roster’s reason under the class', () => {
    expect(squash(text(row('214')))).toContain(squash('أحمد محمد إبراهيم · إجازة معتمدة'));
    expect(squash(text(row('305')))).toContain(squash('محمود فتحي النجار · تمام: غير متاح'));
    expect(squash(text(row('410')))).toContain(squash('سعيد عبد الله حسن · الملف موقوف'));
    expect(row('318')).not.toContain('data-today-absent-driver');
  });

  it('opens each car on the roster with «فتح»', () => {
    expect(hrefOf(list, 'roster.unmannedRows')).toEqual(
      ['214', '305', '410', '318', '322'].map((code) => roster({ q: code })),
    );
    expect(text(row('214'))).toContain(ar('fleet.dash.now.table.open'));
    expect(hrefOf(list, 'roster.unmanned.all')).toEqual([roster({ view: 'unmanned' })]);
  });

  it('ends on the ready cars that do have a driver, from the same read', () => {
    expect(text(list)).toContain('بقية السيارات الجاهزة لها سائق اليوم: 28 سيارة.');
  });

  it('offers «عرض الكل (N)» only when the server holds more cars than it sent — N is its count', () => {
    expect(text(list)).not.toContain('عرض الكل (');
    const more = card(
      withRoster({ unmanned: 11, unmannedCrewGap: 8, unmannedNoCrew: 2 }),
      'unmanned-list',
    );
    expect(text(more)).toContain('عرض الكل (11)');
    expect(hrefOf(more, 'roster.unmanned.all')).toEqual([
      roster({ view: 'unmanned' }),
      roster({ view: 'unmanned' }),
    ]);
  });

  it('says every ready car has a driver when none is without one', () => {
    const clear = card(
      withRoster({
        unmanned: 0,
        unmannedCrewGap: 0,
        unmannedStalePlan: 0,
        unmannedNoCrew: 0,
        unmannedRows: [],
      }),
      'unmanned-list',
    );
    expect(clear).toContain('data-today-empty="unmanned"');
    expect(text(clear)).toContain(ar('fleet.dash.now.table.empty'));
    expect(clear).not.toContain('<table');
  });

  it('names nobody without the drivers’ view: the reason alone, and no absent list', () => {
    const blind = tab(NOW, without('fleetDriver.view'));
    const blindRow = part(
      card(blind, 'unmanned-list'),
      'data-today-unmanned="214"',
      /data-today-unmanned="/u,
    );
    expect(text(blindRow)).toContain('إجازة معتمدة');
    expect(text(blindRow)).not.toContain('أحمد محمد إبراهيم');
    expect(blind).not.toContain('data-today-card="absent-list"');
    expect(blind).toContain('data-today-card="absent"');
  });
});

// ── «الغائبون اليوم» ──────────────────────────────────────────────────────────────────────────

describe('«الحركة اليوم» — the absent drivers', () => {
  const list = card(HTML, 'absent-list');
  /** One row's inside (after its own opening tag, which names the employee id). */
  const row = (id: string): string => {
    const li = part(list, `data-today-absent="${id}"`, /data-today-absent="|<\/ul>/u);
    return li.slice(li.indexOf('>') + 1);
  };

  it('lists the server’s drivers as sent, with their code, crew car and the roster’s reason', () => {
    expect([...list.matchAll(/data-today-absent="(\w+)"/gu)].map((m) => m[1])).toEqual([
      E1,
      E2,
      E4,
      E6,
      E5,
    ]);
    expect(text(row(E1))).toContain('أحمد محمد إبراهيم');
    expect(text(row(E1))).toContain('2901');
    expect(text(row(E1))).toContain(ar('fleet.dash.now.absentList.crewCar'));
    expect(text(row(E1))).toContain('214');
    expect(text(row(E1))).toContain('إجازة معتمدة');
    expect(text(row(E2))).toContain('تمام: غير متاح');
    expect(row(E4)).not.toContain('data-today-crew-car');
    // Not one of Fleet's people: a dash, never a raw id.
    expect(text(row(E6))).toContain('—');
    expect(text(row(E6))).not.toContain(E6);
  });

  it('draws at most six of the server’s rows — the two lists end level — and «عرض الكل (N)» opens all', () => {
    const extra = [
      '64b1f0eeeeeeeeeeeeeeee07',
      '64b1f0eeeeeeeeeeeeeeee08',
      '64b1f0eeeeeeeeeeeeeeee09',
    ];
    const eight = card(
      withRoster({
        absent: { attendance: 6, leave: 3 },
        absentDrivers: [
          ...ABSENT,
          ...extra.map((employeeId) => ({
            employeeId,
            reason: 'fleetUnavailability' as const,
            crewVehicle: null,
          })),
        ],
      }),
      'absent-list',
    );
    expect([...eight.matchAll(/data-today-absent="(\w+)"/gu)].map((m) => m[1])).toEqual([
      E1,
      E2,
      E4,
      E6,
      E5,
      extra[0],
    ]);
    expect(text(eight)).toContain('9 سائقين');
    expect(text(eight)).toContain('عرض الكل (9)');
  });

  it('counts the chip and «عرض الكل (N)» from the server’s two parts, never the rows', () => {
    expect(text(list)).toContain('5 سائقين');
    expect(text(list)).toContain('عرض الكل (5)');
    expect(hrefOf(list, 'roster.absent')).toEqual([
      roster({ unavailable: 'fleetUnavailability,hrLeave' }),
    ]);
  });

  it('ends on the attendance sheet (with its grant) and the roster’s unavailable drivers', () => {
    expect(hrefOf(list, 'roster.absent.attendanceSheet')).toEqual([
      `/fleet/attendance?date=${TODAY}`,
    ]);
    expect(hrefOf(list, 'roster.unavailable')).toEqual([
      roster({
        unavailable: 'profileInactive,notEmployed,fleetUnavailability,hrLeave,licenceExpired',
      }),
    ]);
    const noSheet = card(tab(NOW, without('fleetAvailability.view')), 'absent-list');
    expect(hrefOf(noSheet, 'roster.absent.attendanceSheet')).toEqual([]);
    expect(hrefOf(noSheet, 'roster.unavailable')).toHaveLength(1);
  });
});

// ── What the figures cover ────────────────────────────────────────────────────────────────────

describe('«الحركة اليوم» — the company, one branch, «كل فروعي»', () => {
  const branchHead = (html: string): boolean =>
    text(part(card(html, 'unmanned-list'), '<thead', /<\/thead>/u)).includes(
      ar('fleet.dash.now.table.branch'),
    );
  const companyWide = (html: string, key: string): boolean =>
    card(html, key).includes('data-company-wide="true"');

  it('the company: the branch column, no «الشركة كلها», the difference offered', () => {
    expect(branchHead(HTML)).toBe(true);
    for (const key of ['balance', 'available', 'absent', 'absent-list']) {
      expect(companyWide(HTML, key), key).toBe(false);
    }
  });

  it('one branch: no branch column, the cars «في الفرع», the drivers the company’s', () => {
    const one = tab({ ...NOW, branchId: B1, scopeBranches: [CAIRO] });
    expect(branchHead(one)).toBe(false);
    expect(text(card(one, 'unmanned-list'))).toContain(
      'بقية السيارات الجاهزة في الفرع لها سائق اليوم: 28 سيارة.',
    );
    expect(text(card(one, 'balance'))).toContain(
      '5 من السيارات الجاهزة في الفرع بلا سائق، و6 من السائقين المتاحين في الشركة كلها بلا سيارة.',
    );
    expect(card(one, 'balance')).not.toContain('data-today-gap="true"');
    for (const key of ['balance', 'available', 'absent', 'absent-list']) {
      expect(companyWide(one, key), key).toBe(true);
    }
  });

  it('a single-branch reader with no switcher is a branch view too', () => {
    const home = tab({ ...NOW, branchId: null, scopeBranches: [GIZA] });
    expect(branchHead(home)).toBe(false);
    expect(companyWide(home, 'available')).toBe(true);
  });

  it('«كل فروعي»: the branch column, the cars «في فروعك», the drivers wear «الشركة كلها»', () => {
    const mine = tab({ ...NOW, branchId: null, scopeBranches: [CAIRO, GIZA] });
    expect(branchHead(mine)).toBe(true);
    expect(text(card(mine, 'unmanned-list'))).toContain(
      'بقية السيارات الجاهزة في فروعك لها سائق اليوم: 28 سيارة.',
    );
    expect(text(card(mine, 'balance'))).toContain(
      '5 من السيارات الجاهزة في فروعك بلا سائق، و6 من السائقين المتاحين في الشركة كلها بلا سيارة.',
    );
    expect(card(mine, 'balance')).not.toContain('data-today-gap="true"');
    for (const key of ['balance', 'available', 'absent', 'absent-list']) {
      expect(companyWide(mine, key), key).toBe(true);
    }
  });
});

// ── The audit's fixes: one figure, one meaning, the parts adding up ──────────────────────────

describe('«الحركة اليوم» — the parts add up and each word means one number (D06, D15, D17, D18)', () => {
  const WORKSHOP = need(NOW.workshop);
  const VEHICLES = need(NOW.vehicles);
  const tilesOf = (html: string): string[] =>
    [...html.matchAll(/data-today-tile="(\w+)"/gu)].map((m) => m[1] ?? '');

  it('D06: «مكهنة» and «بلا سيارة في السجل» join the status tiles when they hold a visit — the four add up to the headline, which is unchanged', () => {
    const parts = { open: 9, openActive: 5, openOutOfService: 1, openDisposed: 1, openNoCar: 2 };
    expect(parts.openActive + parts.openOutOfService + parts.openDisposed + parts.openNoCar).toBe(
      parts.open,
    );
    const html = card(tab({ ...NOW, workshop: { ...WORKSHOP, ...parts } }), 'workshop');
    expect(tilesOf(html)).toEqual(['active', 'out', 'disposed', 'noCar']);
    const body = squash(text(html));
    expect(body).toContain(squash(`5${ar('fleet.dash.now.statusActive')}`));
    expect(body).toContain(squash(`1${ar('fleet.dash.now.statusOut')}`));
    expect(body).toContain(squash(`1${ar('fleet.dash.now.statusDisposed')}`));
    expect(body).toContain(squash(`2${ar('fleet.dash.now.statusNoCar')}`));
    // The headline is the open visits, still the one linked figure; the parts are plain.
    expect(body).toContain(
      squash(
        `9${ar('fleet.dash.now.workshopUnit', { noun: ar('fleet.dash.common.noun.car.few') })}`,
      ),
    );
    expect(hrefOf(html, 'workshop.open')).toEqual([`/fleet/maintenance?state=open&to=${TODAY}`]);
    expect(metricsOf(html).sort()).toEqual(['workshop.oldest', 'workshop.open']);
    // The share stays «نشطة» of the active cars.
    expect(text(html)).toContain(`${shareText(5, VEHICLES.active)}`);
  });

  it('D06: no «مكهنة» / «بلا سيارة في السجل» tile while it holds no visit', () => {
    const none = card(
      tab({ ...NOW, workshop: { ...WORKSHOP, openDisposed: 0, openNoCar: 0 } }),
      'workshop',
    );
    expect(tilesOf(none)).toEqual(['active', 'out']);
    expect(text(none)).not.toContain(ar('fleet.dash.now.statusDisposed'));
    expect(text(none)).not.toContain(ar('fleet.dash.now.statusNoCar'));
    const onlyBook = card(
      tab({ ...NOW, workshop: { ...WORKSHOP, openDisposed: 0, openNoCar: 1 } }),
      'workshop',
    );
    expect(tilesOf(onlyBook)).toEqual(['active', 'out', 'noCar']);
  });

  it('D15: the available drivers in two parts — on vehicles (plain) and without one (the roster’s «السائقون المتاحون», linked)', () => {
    const available = card(HTML, 'available');
    const split = part(available, 'data-today-available-split="true"', /data-dash-box=/u);
    // 44 available today = 38 seated + 6 without a vehicle.
    expect(text(split)).toContain(ar('fleet.dash.now.availableSplit', { seated: '38', free: '6' }));
    expect(hrefOf(split, 'roster.availableWithoutVehicle')).toEqual([roster({})]);
    expect(metricsOf(split)).toEqual(['roster.availableWithoutVehicle']);
    // The approved title stays; the headline (seated included) is still plain.
    expect(text(available)).toContain(ar('fleet.dash.now.availableTitle'));
    expect(metricsOf(available)).not.toContain('roster.available');
    // The balance tile says what it counts: the seated too.
    const tile = part(card(HTML, 'balance'), 'data-today-figure="available"', /<\/section>/u);
    expect(text(tile)).toContain(ar('fleet.dash.now.balanceDrivers'));
    expect(text(tile)).toContain('44');
    const none = card(withRoster({ available: 6, availableWithoutVehicle: 6 }), 'available');
    expect(text(none)).toContain(ar('fleet.dash.now.availableSplit', { seated: '0', free: '6' }));
  });

  it('D17: «من المسجّلة» counts every status the vehicles screen’s «إجمالي السيارات» counts — «مكهنة» included', () => {
    // 40 active + 2 out of service + 1 disposed = 43, as the vehicles screen.
    const vehicles = card(HTML, 'vehicles');
    expect(text(vehicles)).toContain(ar('fleet.dash.now.activeOf', { count: '43' }));
    expect(text(vehicles)).toContain(shareText(40, 43));
    const noDisposed = card(tab({ ...NOW, vehicles: { ...VEHICLES, disposed: 0 } }), 'vehicles');
    expect(text(noDisposed)).toContain(ar('fleet.dash.now.activeOf', { count: '42' }));
    const many = card(tab({ ...NOW, vehicles: { ...VEHICLES, disposed: 7 } }), 'vehicles');
    expect(text(many)).toContain(ar('fleet.dash.now.activeOf', { count: '49' }));
    expect(text(many)).toContain(shareText(40, 49));
  });

  it('D18: the readiness foot’s expired licences say they are the cars outside the workshop — the split stays disjoint', () => {
    const foot = part(HTML, 'data-today-excluded="true"', /<\/section>/u);
    // 7 left out = 5 in the workshop + 2 expired outside it (each car counted once).
    expect(squash(text(foot))).toContain(squash(`${ar('fleet.dash.now.inWorkshop')} 5`));
    expect(squash(text(foot))).toContain(squash(`${ar('fleet.dash.now.licenceExpired')} 2`));
  });
});

// ── The words the owner was told (i18n/W3.json; green once the HUB merges it) ────────────────

describe('«الحركة اليوم» — the words the owner was told', () => {
  it('D15: «منهم N على سيارات · N بلا سيارة» under the approved title; the balance tile «المتاحون اليوم (مع المعيَّنين)»', () => {
    expect(text(card(HTML, 'available'))).toContain('منهم 38 على سيارات · 6 بلا سيارة');
    expect(text(card(HTML, 'available'))).toContain('السائقون المتاحون اليوم');
    expect(text(card(HTML, 'balance'))).toContain('المتاحون اليوم (مع المعيَّنين)');
  });

  it('D18: «ترخيص منتهٍ (خارج الورشة)»', () => {
    const foot = part(HTML, 'data-today-excluded="true"', /<\/section>/u);
    expect(text(foot)).toContain('ترخيص منتهٍ (خارج الورشة) 2');
  });

  it('D06: «مكهنة» and «بلا سيارة في السجل»', () => {
    const html = card(
      tab({ ...NOW, workshop: { ...need(NOW.workshop), openDisposed: 1, openNoCar: 2 } }),
      'workshop',
    );
    expect(text(html)).toContain('1مكهنة');
    expect(text(html)).toContain('2بلا سيارة في السجل');
  });
});
