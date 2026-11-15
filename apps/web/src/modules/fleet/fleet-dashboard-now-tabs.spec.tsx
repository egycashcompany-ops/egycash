// «لوحة تحكم الحركة» — the old R1 tabs still waiting for their redesign: «توزيع السيارات»,
// «التراخيص وآخر ما سُجّل» and «ملخصات» (plan §8.1–§8.5, unified.md W-SHELL). «نظرة عامة» and
// «الحركة اليوم» — which took the retired «التنبيهات» and «الحركة الآن» — have their own specs
// (fleet-dashboard-tab-overview.spec.tsx, fleet-dashboard-tab-today.spec.tsx).
//
// What this file pins is that each figure reads the field it is about, opens the screen that shows
// the same number (through the one link builder), says what the approved sample says, and draws
// nothing the owner ruled out: no Q marker, no receipt-audit part, no export or print, no custody
// ceiling, no Phase-2 piece — on every tab of the bar. A null section renders nothing; a failed one
// shows its error.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_DASHBOARD_TABS, addDaysYmd } from '@ecms/contracts';
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

  it('colours a row amber up to the warn-days SETTING, as the bucket above counts it', () => {
    const toneOf = (html: string, id: string): string | undefined =>
      new RegExp(`data-licence-row="${id}"[\\s\\S]*?data-licence-tone="(\\w+)"`, 'u').exec(
        html,
      )?.[1];
    expect(toneOf(vehicles, 'v297')).toBe('amber'); // 16 days, warnDays 30
    const lic = NOW_DTO.licenceVehicles as NonNullable<typeof NOW_DTO.licenceVehicles>;
    const short = tab('licences', {
      now: { ...NOW_DTO, licenceVehicles: { ...lic, warnDays: 10 } },
    });
    expect(toneOf(short, 'v152')).toBe('amber'); // 4 days
    expect(toneOf(short, 'v297')).toBe('grey'); // 16 days: past 10, counted in the grey bucket
    expect(toneOf(short, 'v249')).toBe('red');
  });

  it('writes a workshop row’s day and when it was written, in Cairo time', () => {
    expect(text(latest)).toContain('سُجّلت 09:12');
    expect(text(latest)).toContain('سُجّلت 15:47');
    expect(hrefOf(latest, 'recentWorkshop.row')).toContain(
      `/fleet/maintenance?vehicleCodes=231&from=${TODAY}&to=${TODAY}`,
    );
    // A closed visit's business day is its check-out day (R-12): it opens on `outFrom`/`outTo`.
    expect(hrefOf(latest, 'recentWorkshop.row')).toContain(
      '/fleet/maintenance?vehicleCodes=295&outFrom=2026-10-31&outTo=2026-10-31',
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
    // T5.5 carries the charging screen's «شُحن اليوم» — the Cairo day (batch 3, D5) — and its caption.
    expect(text(html)).toContain(ar('fleet.fuelCards.totals.chargedOnCairoDay'));
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
      '/fleet/violations?year=2026&dyear=2026&dunknown=true&dset=false',
    );
    expect(column).toContain(ar('fleet.dash.summaries.annualNote'));
  });
});

// ── The source: nothing counted, nothing ruled out ────────────────────────────────────────────

describe('the dashboard’s tabs count nothing in the browser and draw no ruled-out piece', () => {
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

  it('draws no Phase-2 piece, and nothing the owner ruled out, on any of the ten tabs', () => {
    for (const key of FLEET_DASHBOARD_TABS) {
      const html = tab(key);
      const body = text(html);
      for (const word of [
        'عقود التوريد',
        'عقد توريد',
        'ترتيب السائقين',
        'تكلفة التشغيل',
        'تدقيق الإيصالات',
        'ج.م/كم',
        'تكلفة الكيلو',
        'أمر حركة',
      ]) {
        expect(body, `${key}: ${word}`).not.toContain(word);
      }
      expect(links(html).filter((l) => l.href.startsWith('/fleet/vehicle-contracts'))).toEqual([]);
    }
  });
});

// ── The final-fix pins of the old tabs (tabs 1 and 2 moved to the overview and «الحركة اليوم» specs) ──

describe('the final fixes kept on tab 5', () => {
  it('tab 5’s open total links nowhere when it is the fines alone (company + drivers, no one list)', () => {
    const open = part(
      tab('summaries', { now: { ...NOW_DTO, accidentsOpen: null } }),
      'data-summary-card="open"',
      /data-summary-(?:card|column)="/u,
    );
    expect(open).not.toBe('');
    expect(links(open).filter((l) => l.metric === 'violationsYear.drivers')).toEqual([]);
  });
});
