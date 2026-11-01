// «لوحة تحكم الحركة» — tabs 1–5, the «الآن» tabs (plan §8.1–§8.5, unified.md W-SHELL).
//
// What this file pins is that each figure reads the field it is about, opens the screen that shows
// the same number (through the one link builder), says what the approved sample says, and draws
// nothing the owner ruled out: no Q marker, no receipt-audit part, no export or print, no custody
// ceiling, no Phase-2 piece. A null section renders nothing; a failed one shows its error.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addDaysYmd } from '@ecms/contracts';
import {
  ALL_KEYS,
  B1,
  DRIVER,
  NOW_DTO,
  T1,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = join(HERE, 'components/fleet-dashboard');

const tab = (
  key: string,
  seed: Parameters<typeof dashboardClient>[0] = {},
  permissions = ALL_KEYS,
): string =>
  renderDashboard({ url: `/fleet?tab=${key}`, client: dashboardClient(seed), permissions });
const text = (html: string): string => html.replace(/<[^>]+>/gu, '').replace(/&amp;/gu, '&');
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
/** The markup of one element, from its marker to the next sibling marker of the same kind. */
const part = (html: string, marker: string, next: RegExp): string => {
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const rest = html.slice(start + marker.length);
  const end = rest.search(next);
  return marker + (end < 0 ? rest : rest.slice(0, end));
};

// ── Tab 1 «التنبيهات» ──────────────────────────────────────────────────────────────────────────

describe('tab 1 — the alerts', () => {
  const html = tab('alerts');
  const line = (id: string): string => part(html, `data-alert="${id}"`, /data-alert="/u);

  it('puts the red lines first, then the orange ones, in the contracts’ order with custody after the notices', () => {
    const ids = [...html.matchAll(/data-alert="([a-zA-Z]+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual([
      'maintenanceRed',
      'vehicleLicenceExpired',
      'driverLicenceExpired',
      'fuelCardExpired',
      'crewAbsent',
      'fuelRequests',
      'fuelLow',
      'dealershipPending',
      'noticesMissing',
      'custody',
      'noReading',
    ]);
    expect(html.indexOf('data-alert-section="red"')).toBeLessThan(
      html.indexOf('data-alert-section="orange"'),
    );
  });

  it('says how many lines fired, and how many of them are urgent', () => {
    expect(html).toContain('data-alert-total="11"');
    expect(text(line('maintenanceRed'))).toContain(
      '3 سيارات بلغت حد الصيانة، منها 1 تجاوزته؛ و6 تقترب منه',
    );
  });

  it('opens each line’s screen from its figure and from its buttons', () => {
    expect(hrefOf(html, 'maintenanceAlarm.red')).toContain('/fleet/maintenance-alarms?level=red');
    expect(hrefOf(html, 'maintenanceAlarm.yellow')).toContain(
      '/fleet/maintenance-alarms?level=yellow',
    );
    expect(hrefOf(html, 'licenceVehicles.expired')).toContain(
      `/fleet/vehicles?status=active&licExpBefore=${TODAY}`,
    );
    expect(hrefOf(html, 'licenceDrivers.expired')).toContain(
      `/fleet/drivers?licExpBefore=${TODAY}`,
    );
    expect(hrefOf(html, 'fuelCards.expired')).toContain(`/fleet/fuel-cards?expiresBefore=${TODAY}`);
    expect(hrefOf(html, 'roster.crewGap')).toContain(`/fleet/roster?date=${TODAY}&view=crewGap`);
    expect(hrefOf(html, 'fuelCharging.requested')).toContain(
      '/fleet/fuel-cards/charging?state=requested',
    );
    expect(hrefOf(html, 'fuelCharging.low')).toContain('/fleet/fuel-cards/charging?state=low');
    expect(hrefOf(html, 'dealershipPending.rows')).toContain('/fleet/dealership?state=pending');
  });

  it('names the expired cars with how long ago, the oldest first, and keeps them out of «ready»', () => {
    const body = text(line('vehicleLicenceExpired'));
    expect(body).toContain('2 سيارات ترخيصها منتهٍ');
    expect(body.indexOf('249')).toBeLessThan(body.indexOf('118'));
    expect(body).toContain('منذ 18 يومًا');
    expect(body).toContain(ar('fleet.dash.alerts.vehicleLicenceExpired.sub'));
  });

  it('counts a notice missing both attachments ONCE: the union headline, its two parts as sub-lines (T1.10)', () => {
    const body = text(line('noticesMissing'));
    expect(body).toContain('3 إخطارات مفتوحة ينقصها مرفق واحد على الأقل');
    expect(body).toContain('صور الرخص 2');
    expect(body).toContain('صورة الشيك 2');
    expect(body).toContain(ar('fleet.dash.alerts.noticesMissing.once'));
    expect(hrefOf(line('noticesMissing'), 'notices.missingCheckImage')).toContain(
      '/fleet/notices?status=open&checkImage=missing',
    );
  });

  it('counts EXACTLY the custody dashboard’s banner lines, and links to it — no receipt audit (D3)', () => {
    const body = line('custody');
    expect(text(body)).toContain('العهدة: 1 تنبيه في لوحة تحكم العهدة');
    expect(hrefOf(body, 'custodyFund.lines')).toEqual([
      '/fleet/custody/dashboard',
      '/fleet/custody/dashboard',
    ]);
    expect(text(html)).not.toContain('تدقيق الإيصالات');
    expect(text(html)).not.toContain('تفويل مرتين');
  });

  it('names the cars without a reading, the never-read car on its own line (T1.12)', () => {
    const body = line('noReading');
    expect(text(body)).toContain('2 سيارات نشطة بلا قراءة عداد في آخر 3 أيام');
    expect(text(body)).toContain('منذ 2026/10/22');
    expect(text(body)).toContain(ar('fleet.dash.alerts.noReading.neverRead'));
    expect(hrefOf(body, 'noReading.stale')).toContain(
      '/fleet/odometer?vehicleCodes=304,112&period=all',
    );
    expect(hrefOf(body, 'noReading.neverRead')).toContain('/fleet/vehicles?vehicleCodes=318');
  });

  it('wears «الشركة كلها» on the company-wide lines only while a branch is chosen', () => {
    expect(html).not.toContain('data-company-wide');
    const branched = tab('alerts', { now: { ...NOW_DTO, branchId: B1 } });
    const fuel = part(branched, 'data-alert="fuelRequests"', /data-alert="/u);
    expect(fuel).toContain('data-company-wide="true"');
    expect(part(branched, 'data-alert="maintenanceRed"', /data-alert="/u)).not.toContain(
      'data-company-wide',
    );
  });

  it('shows one calm line when nothing fired', () => {
    const calm = renderDashboard({
      url: '/fleet?tab=alerts',
      client: dashboardClient({ now: { ...NOW_DTO, alerts: [] }, custody: false }),
      permissions: ALL_KEYS.filter((k) => k !== 'fleetCustody.view'),
    });
    expect(calm).toContain('data-alerts-none="true"');
    expect(calm).not.toContain('data-alert="');
  });
});

// ── Tab 2 «الحركة الآن» ────────────────────────────────────────────────────────────────────────

describe('tab 2 — the movement now', () => {
  const html = tab('now');
  const card = (key: string): string => part(html, `data-now-card="${key}"`, /data-now-card="/u);

  it('reads the badge as the ready cars that have a driver: readyManned ÷ ready (D5-1)', () => {
    expect(html).toMatch(/data-now-badge="true"[^>]*>84\.8%</u);
    expect(text(card('summary'))).toContain(
      '28 من 33 سيارة جاهزة لها سائق متاح اليوم، و5 بلا سائق.',
    );
  });

  it('counts ready as active − in the workshop − licence expired, and opens the roster’s view of it', () => {
    expect(text(card('ready'))).toContain('استُبعدت 7 سيارات من النشطة:');
    expect(hrefOf(card('ready'), 'roster.ready')).toEqual([
      `/fleet/roster?date=${TODAY}&view=ready`,
    ]);
    expect(hrefOf(card('unmanned'), 'roster.unmanned')).toEqual([
      `/fleet/roster?date=${TODAY}&view=unmanned`,
    ]);
  });

  it('writes the out-of-service reasons as recorded, and says so when there is none', () => {
    const body = text(card('vehicles'));
    expect(body).toContain('حادث');
    expect(body).toContain(ar('fleet.dash.now.noReason'));
    expect(hrefOf(card('vehicles'), 'vehicles.outOfService')).toContain(
      '/fleet/vehicles?status=outOfService',
    );
  });

  it('dates the oldest workshop stay with no ceiling, and opens the open visits (D5-3, R-09)', () => {
    const body = text(card('workshop'));
    expect(body).toContain('منذ 9 أيام');
    expect(body).not.toContain('سقف');
    expect(hrefOf(card('workshop'), 'workshop.open')).toEqual(['/fleet/maintenance?state=open']);
  });

  it('splits the absent by reason, each part opening its own list, the attendance sheet only with its grant', () => {
    const body = card('absent');
    expect(hrefOf(body, 'roster.absent.attendance')).toEqual([
      `/fleet/roster?date=${TODAY}&unavailable=fleetUnavailability`,
    ]);
    expect(hrefOf(body, 'roster.absent.leave')).toEqual([
      `/fleet/roster?date=${TODAY}&unavailable=hrLeave`,
    ]);
    expect(hrefOf(body, 'roster.absent.attendanceSheet')).toEqual([
      `/fleet/attendance?date=${TODAY}`,
    ]);
    const without = tab(
      'now',
      {},
      ALL_KEYS.filter((k) => k !== 'fleetAvailability.view'),
    );
    expect(hrefOf(without, 'roster.absent.attendanceSheet')).toEqual([]);
  });

  it('keeps the suggestions to links that OPEN existing screens — no button acts (D5-2)', () => {
    const suggestions = card('suggestions');
    expect(suggestions).not.toContain('<button');
    expect(links(suggestions).length).toBeGreaterThan(0);
  });

  it('renders nothing for a section the reader may not see', () => {
    const none = tab('now', { now: { ...NOW_DTO, vehicles: null } });
    expect(none).not.toContain('data-now-card="vehicles"');
    expect(none).toContain('data-now-card="ready"');
  });
});

// ── Tab 3 «توزيع السيارات» ─────────────────────────────────────────────────────────────────────

describe('tab 3 — the distribution', () => {
  const html = tab('distribution');
  const matrix = part(html, 'data-fleet-matrix="true"', /data-quick-read="/u);

  it('lays the reader’s branches out as columns, «بلا فرع» only when a car has none — and unlinked', () => {
    expect(text(matrix)).toMatch(/القاهرة\s*الجيزة\s*بلا فرع\s*الإجمالي/u);
    const plain = tab('distribution', {
      now: {
        ...NOW_DTO,
        distributionVehicles: {
          ...(NOW_DTO.distributionVehicles as NonNullable<typeof NOW_DTO.distributionVehicles>),
          rows: [
            {
              typeId: T1,
              name: { ar: 'مصفحة', en: 'Armoured' },
              counts: { [B1]: 2 },
              noBranch: 0,
              total: 2,
            },
          ],
          totals: { counts: { [B1]: 2 }, noBranch: 0, total: 2 },
        },
      },
    });
    expect(text(part(plain, '<thead', /<\/thead>/u))).not.toContain('بلا فرع');
    expect(text(part(html, '<thead', /<\/thead>/u))).toContain('بلا فرع');
    // The «بلا فرع» figures open nothing: the vehicles screen has no such parameter.
    expect(links(matrix).filter((l) => l.href.includes('branch=none'))).toEqual([]);
  });

  it('opens every cell on its type and branch, a row on its type, a column on its branch', () => {
    expect(hrefOf(matrix, 'distributionVehicles.cell')).toContain(
      `/fleet/vehicles?status=active&type=${T1}&branch=${B1}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.typeTotal')).toContain(
      `/fleet/vehicles?status=active&type=${T1}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.branch')).toContain(
      `/fleet/vehicles?status=active&branch=${B1}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.total')).toEqual(['/fleet/vehicles?status=active']);
  });

  it('writes drivers per vehicle as a plain ratio, with no target and no export (D5-4, D5-5)', () => {
    expect(text(html)).toContain('1.3');
    expect(text(html)).not.toContain('توازن مثالي');
    expect(text(html)).not.toContain('تصدير');
  });

  it('opens the cash drivers on their specialisation and says how many hold only the old one (R-08)', () => {
    expect(hrefOf(html, 'distributionDrivers.cash')[0]).toMatch(/^\/fleet\/drivers\?spec=/u);
    expect(text(html)).toContain('منهم 2 بتصنيف قديم');
    expect(hrefOf(html, 'distributionDrivers.total')).toEqual([
      '/fleet/drivers?sort=employeeCode:asc',
    ]);
  });

  it('shows no driver tile at all without the drivers’ section — absent, not 0', () => {
    const none = tab('distribution', { now: { ...NOW_DTO, distributionDrivers: null } });
    expect(links(none).filter((l) => l.metric.startsWith('distributionDrivers.'))).toEqual([]);
    expect(text(none)).not.toContain(ar('fleet.dash.distribution.perVehicle'));
  });
});

// ── Tab 4 «التراخيص وآخر ما سُجّل» ────────────────────────────────────────────────────────────

describe('tab 4 — licences and the latest records', () => {
  const html = tab('licences');
  const vehicles = part(html, 'data-licences-card="vehicle-licences"', /data-licences-card="/u);
  const latest = part(html, 'data-licences-card="latest"', /data-licences-card="/u);

  it('links the three disjoint licence windows, each to its exact days (R-10)', () => {
    expect(hrefOf(vehicles, 'licenceVehicles.expired')).toEqual([
      `/fleet/vehicles?status=active&licExpBefore=${TODAY}`,
    ]);
    expect(hrefOf(vehicles, 'licenceVehicles.expiring')).toEqual([
      `/fleet/vehicles?status=active&licExpFrom=${addDaysYmd(TODAY, 1)}&licExpBefore=${addDaysYmd(TODAY, 30)}`,
    ]);
    expect(hrefOf(vehicles, 'licenceVehicles.soon')).toEqual([
      `/fleet/vehicles?status=active&licExpFrom=${addDaysYmd(TODAY, 31)}&licExpBefore=${addDaysYmd(TODAY, 60)}`,
    ]);
  });

  it('lists the nearest first with how long ago or how soon, then «+N»', () => {
    const body = text(vehicles);
    expect(body).toContain('منتهٍ منذ 18 يومًا');
    expect(body).toContain('بعد 4 أيام');
    expect(body.indexOf('249')).toBeLessThan(body.indexOf('176'));
    expect(body).toContain('+2');
    expect(hrefOf(vehicles, 'licenceVehicles.row')).toContain('/fleet/vehicles/v249');
  });

  it('writes a workshop row’s day and when it was written, in Cairo time', () => {
    expect(text(latest)).toContain('سُجّلت 09:12');
    expect(text(latest)).toContain('سُجّلت 15:47');
    expect(hrefOf(latest, 'recentWorkshop.row')).toContain(
      `/fleet/maintenance?vehicleCodes=231&from=${TODAY}&to=${TODAY}`,
    );
  });

  it('writes an accident row’s DATE ONLY — no time at all — and opens its day', () => {
    const accident = part(latest, 'data-recent-accident="a1"', /data-recent-(?:accident|visit)="/u);
    expect(text(accident)).toContain('2026/11/01');
    expect(text(accident)).not.toMatch(/\d{2}:\d{2}/u);
    expect(hrefOf(accident, 'recentAccidents.row')).toEqual([
      `/fleet/accidents?vehicleCodes=154&from=${TODAY}&to=${TODAY}`,
    ]);
  });

  it('opens the driver card on a culprit who is one of ours, and only then', () => {
    const client = dashboardClient();
    client.setQueryData(
      ['fleet', 'people'],
      [
        {
          employeeId: DRIVER,
          code: 'HR-D1',
          fullNameAr: 'محمود عبد العزيز سالم',
          status: 'active',
          branchId: null,
          address: null,
          governorate: null,
          phone: null,
          hiredAt: null,
        },
      ],
    );
    const withCard = renderDashboard({ url: '/fleet?tab=licences', client });
    const ours = part(withCard, 'data-recent-accident="a2"', /data-recent-(?:accident|visit)="/u);
    expect(ours).toContain('data-driver-hover="true"');
    const third = part(withCard, 'data-recent-accident="a1"', /data-recent-(?:accident|visit)="/u);
    expect(third).not.toContain('data-driver-hover');
  });

  it('keeps the drivers’ licences apart, with «بلا تاريخ» linked and «بلا ملف سائق» shown as it is', () => {
    const drivers = part(html, 'data-licences-card="driver-licences"', /data-licences-card="/u);
    expect(hrefOf(drivers, 'licenceDrivers.notRecorded')).toEqual(['/fleet/drivers?licExp=none']);
    expect(text(drivers)).toContain(ar('fleet.dash.licences.unregistered'));
  });

  it('opens the open papers on the licensing board, never the bare page (D17), and the expiring cards on both bounds', () => {
    const papers = part(html, 'data-licences-card="papers-cards"', /data-licences-card="/u);
    expect(hrefOf(papers, 'papers.insurance')).toContain('/fleet/licensing?sort=asc');
    expect(hrefOf(papers, 'fuelCards.expiring')).toContain(
      `/fleet/fuel-cards?expiresFrom=${addDaysYmd(TODAY, 1)}&expiresBefore=${addDaysYmd(TODAY, 30)}`,
    );
  });
});

// ── Tab 5 «ملخصات» ─────────────────────────────────────────────────────────────────────────────

describe('tab 5 — the summaries', () => {
  const html = tab('summaries');

  it('opens each fuel company’s balance on the charging screen; the sum of the two opens none', () => {
    expect(text(html)).toContain('115,950.00');
    expect(hrefOf(html, 'fuelCharging.wataniya')[0]).toBe(
      '/fleet/fuel-cards/charging?company=wataniya',
    );
    expect(text(html)).toContain(ar('fleet.dash.summaries.charged24h'));
  });

  it('reads the custody figures from the custody screen’s own functions, linked to its dashboard', () => {
    const custody = part(html, 'data-summary-column="custody"', /data-summary-column="/u);
    expect(text(custody)).toContain('159,974.54');
    expect(text(custody)).toContain('15,886.00'); // custodyWaiting: 9,566.00 in memos + 6,320.00 outside
    expect(hrefOf(custody, 'custodyFund.total')).toEqual(['/fleet/custody/dashboard']);
    expect(hrefOf(custody, 'custodyFund.expenses')).toEqual([
      `/fleet/custody-expenses?from=${addDaysYmd(TODAY, -29)}&to=${TODAY}`,
    ]);
  });

  it('shows the open obligations’ total WITH its two parts, and no ceiling or print (D5-6/7/8)', () => {
    const open = part(html, 'data-summary-card="open"', /data-summary-card="/u);
    expect(text(open)).toContain('29,850.00');
    expect(hrefOf(open, 'accidentsOpen.count')).toContain('/fleet/accidents?status=open');
    expect(text(html)).not.toContain('طباعة');
    expect(text(html)).not.toContain('250,000');
  });

  it('splits the drivers’ unpaid fines into known, «مجهول» and «اسم غير مربوط», the unknown ones linked', () => {
    const column = text(part(html, 'data-summary-column="open"', /data-summary-column="/u));
    expect(column).toContain('2,250.00');
    expect(column).toContain('1,650.00');
    expect(column).toContain('450.00');
    expect(column).toContain('150.00');
    expect(hrefOf(html, 'violationsYear.unknown')).toContain(
      '/fleet/violations?year=2026&dunknown=true&dset=false',
    );
    expect(column).toContain(ar('fleet.dash.summaries.annualNote'));
  });
});

// ── The source: nothing counted, nothing ruled out ────────────────────────────────────────────

describe('tabs 1–5 count nothing in the browser and draw no ruled-out piece', () => {
  const files = readdirSync(DASH).filter((name) => /^(tab-|dash-|custody-|period-)/u.test(name));
  const source = (name: string): string =>
    readFileSync(join(DASH, name), 'utf8')
      .replace(/^\s*\/\/.*$/gmu, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '');

  it('adds no figure up: no `.reduce(`, no `.filter(…).length`, no rendered `.length`', () => {
    for (const name of files) {
      const src = source(name);
      expect(src, name).not.toMatch(/\.reduce\(/u);
      expect(src, name).not.toMatch(/\.filter\([^)]*\)\.length/u);
      expect(src, name).not.toMatch(/count\([\w.?]+\.length\)/u);
      expect(src, name).not.toMatch(/\{[\w.?]+\.length\}/u);
    }
  });

  it('counts the custody lines in ONE place, from the custody screen’s own hook (D3)', () => {
    const callers = files.filter((name) => source(name).includes('useCustodyFundAlerts('));
    expect(callers).toEqual(['custody-fund-line.tsx']);
  });

  it('imports no sample and draws no Q marker', () => {
    for (const name of files) {
      const src = readFileSync(join(DASH, name), 'utf8');
      expect(src, name).not.toMatch(/from '[^']*zz-/u);
      expect(src, name).not.toMatch(/\bQ n=|data-zz-/u);
    }
  });

  it('draws no Phase-2 piece on any of the ten tabs', () => {
    for (const key of [
      'alerts',
      'now',
      'distribution',
      'licences',
      'summaries',
      'period',
      'km',
      'ranking',
      'maintenance',
      'accidents',
    ]) {
      const body = text(tab(key));
      for (const word of [
        'عقود التوريد',
        'عقد توريد',
        'ترتيب السائقين',
        'تكلفة التشغيل',
        'تدقيق الإيصالات',
      ]) {
        expect(body, `${key}: ${word}`).not.toContain(word);
      }
      expect(links(tab(key)).filter((l) => l.href.startsWith('/fleet/vehicle-contracts'))).toEqual(
        [],
      );
    }
  });
});
