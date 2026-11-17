// «لوحة تحكم الحركة» — the one old R1 tab still waiting for its redesign: «ملخصات» (plan §8.1–§8.5,
// unified.md W-SHELL). The rebuilt tabs have their own specs: «نظرة عامة» and «الحركة اليوم» — which
// took the retired «التنبيهات» and «الحركة الآن» (fleet-dashboard-tab-overview.spec.tsx,
// fleet-dashboard-tab-today.spec.tsx), «توزيع السيارات» and «الصيانة والورش» — rebuilt under their
// old keys (fleet-dashboard-tab-distribution.spec.tsx, which carries the old tab 3's pins, and
// fleet-dashboard-tab-maintenance.spec.tsx); «العدادات والكيلومترات», «الحوادث ومطالبات التأمين»,
// «المخالفات المرورية والتسويات», «الوقود والمصروفات», «العهدة» and «التراخيص والتجديدات» — which
// replaced the old «التراخيص وآخر ما سُجّل» body under its key — have theirs
// (fleet-dashboard-tab-{km,accidents,violations,fuel,custody,licences}.spec.tsx).
//
// What this file pins is that each figure reads the field it is about, opens the screen that shows
// the same number (through the one link builder), says what the approved sample says, and draws
// nothing the owner ruled out: no Q marker, no receipt-audit part, no export or print, no custody
// ceiling or ranking, no Phase-2 piece — on every tab of the bar (the year's supply contracts,
// approved for «توزيع السيارات», on that tab alone and for their reader alone). A null section
// renders nothing; a failed one shows its error.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_DASHBOARD_TABS, FLEET_DASHBOARD_TAB_READS, addDaysYmd } from '@ecms/contracts';
import {
  ALL_KEYS,
  EVERY_KEY,
  B1,
  B2,
  NOW_DTO,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { PERIOD_FULL } from './fleet-dashboard-period-fixtures';

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

// ── The fuel parts of «ملخصات» follow the car's branch (plan D10, D23) ────────────────────────

describe('«ملخصات» under a branch — the fuel parts are the branch’s, the custody parts the company’s', () => {
  const CAIRO = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };
  const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };
  const narrowed = { now: { ...NOW_DTO, branchId: B1, scopeBranches: [CAIRO] } };
  const mine = { now: { ...NOW_DTO, scopeBranches: [CAIRO, GIZA] } };

  it('«ملخصات»: no «الشركة كلها» on the fuel card or column, still on the custody ones; the fuel links carry the branch', () => {
    for (const seed of [narrowed, mine]) {
      const html = tab('summaries', seed);
      const fuelCard = part(html, 'data-summary-card="fuel"', /data-summary-card="/u);
      const fuelColumn = part(html, 'data-summary-column="fuel"', /data-summary-column="/u);
      const custodyCard = part(html, 'data-summary-card="custody"', /data-summary-card="/u);
      const custodyColumn = part(html, 'data-summary-column="custody"', /data-summary-column="/u);
      expect(fuelCard).not.toBe('');
      expect(fuelColumn).not.toBe('');
      expect(fuelCard).not.toContain('data-company-wide');
      expect(fuelColumn).not.toContain('data-company-wide');
      expect(custodyCard).toContain('data-company-wide="true"');
      expect(custodyColumn).toContain('data-company-wide="true"');
      const branch = seed === narrowed ? B1 : `${B1},${B2}`;
      for (const href of hrefOf(html, 'fuelCharging.wataniya'))
        expect(new URLSearchParams(href.split('?')[1]).get('branch'), href).toBe(branch);
    }
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

  it('draws no Phase-2 piece, and nothing the owner ruled out, on any of the twelve tabs', () => {
    const SUPPLY = ['عقود التوريد', 'عقد توريد'];
    const RULED_OUT = [
      'ترتيب السائقين',
      'تكلفة التشغيل',
      'تدقيق الإيصالات',
      'ج.م/كم',
      'تكلفة الكيلو',
      'أمر حركة',
      // «العهدة» (DECISIONS §9): no ranking of who spent most, no floor or safety line on the fund.
      'أعلى السيارات صرفًا',
      'أعلى السائقين صرفًا',
      'الحد الأدنى',
      'حد الأمان',
    ];
    const contracts = (html: string) =>
      links(html).filter((l) => l.href.startsWith('/fleet/vehicle-contracts'));
    // Every key of the page and the licence memos' (a PAGELESS key: «التراخيص والتجديدات»'s period
    // band) — the contracts' is not one of them — and then with it as well.
    for (const permissions of [EVERY_KEY, [...EVERY_KEY, 'fleetVehicleContract.view']]) {
      const supplyReader = permissions.includes('fleetVehicleContract.view');
      for (const key of FLEET_DASHBOARD_TABS) {
        // A tab that draws the page's R2 is seeded with every period section, so its period part
        // is scanned too.
        const seed = FLEET_DASHBOARD_TAB_READS[key].includes('period')
          ? { page: { url: `/fleet?tab=${key}`, dto: PERIOD_FULL } }
          : {};
        const html = tab(key, seed, permissions);
        const body = text(html);
        for (const word of RULED_OUT) expect(body, `${key}: ${word}`).not.toContain(word);
        // The year's supply contracts: on «توزيع السيارات» alone, and for their reader alone.
        const supplyHere = key === 'distribution' && supplyReader;
        for (const word of SUPPLY) {
          if (!supplyHere) expect(body, `${key}: ${word}`).not.toContain(word);
        }
        if (!supplyHere) {
          expect(contracts(html), key).toEqual([]);
          continue;
        }
        expect(body).toContain(ar('fleet.dash.distribution.sub.supply').replace(/^، /u, ''));
        expect(contracts(html).length).toBeGreaterThan(0);
        for (const { href, metric } of contracts(html)) {
          const params = new URLSearchParams(href.split('?')[1] ?? '');
          expect(metric, href).toMatch(/^supplyContracts\./u);
          expect(params.get('from'), href).toBe(`${TODAY.slice(0, 4)}-01-01`);
          expect(params.get('to'), href).toBe(`${TODAY.slice(0, 4)}-12-31`);
        }
      }
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
