// `dashboard/` is COMPOSITION ONLY (plan §5.2, §5.8) — read off the sources, so the rule cannot
// erode one convenient line at a time:
//   · ONE clock — `new Date(` appears in the controller alone; no `Date.now(` anywhere. Every other
//     file gets the instant it is handed (R-01: one Cairo `today` per request);
//   · NO FILTER OF ITS OWN — no query operator (`$match`, `$in`, `$gte` …), no model, no mongoose,
//     no `FilterQuery`, and none of the field names the owning modules filter on written as a key.
//     A figure counted here with its own spelling of a filter would drift from the screen it links to;
//   · THE OLD LANDING READ IS GONE — its service, repository and `'/'` route (P1-13).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = import.meta.dirname;
const sources = readdirSync(DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));

/** The source without its comments, so the explanations may name what the code must not do. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('dashboard/ hygiene', () => {
  it('has the composition files and nothing of the old landing read', () => {
    expect(sources.map((s) => s.name).sort()).toEqual([
      'dashboard-context.ts',
      'dashboard-kinds.ts',
      'dashboard-sections.ts',
      'dashboard.controller.ts',
      'dashboard.routes.ts',
      'now-alerts.ts',
      'now.service.ts',
      'period.service.ts',
    ]);
    expect(existsSync(join(DIR, 'dashboard.service.ts'))).toBe(false);
    expect(existsSync(join(DIR, 'dashboard.repository.ts'))).toBe(false);
  });

  it('reads the clock in the controller only', () => {
    for (const { name, text } of sources) {
      const body = code(text);
      expect(body.includes('Date.now('), name).toBe(false);
      const clocks = body.match(/new Date\(/g)?.length ?? 0;
      expect(clocks, name).toBe(name === 'dashboard.controller.ts' ? 2 : 0);
    }
  });

  it('spells no filter of its own', () => {
    for (const { name, text } of sources) {
      const body = code(text);
      expect(body, name).not.toMatch(/['"`]?\$[a-zA-Z]+['"`]?\s*:/);
      expect(body, name).not.toMatch(/['"`]\$(match|in|gte|lte|lt|gt|ne|and|or|group|facet)['"`]/);
      expect(body, name).not.toMatch(
        /\b(isDeleted|licenseExpiresAt|outDate|inDate|occurredAt)\s*:/,
      );
      expect(body, name).not.toMatch(/from 'mongoose'|FilterQuery|\.model'/);
      expect(body, name).not.toMatch(/\.aggregate\(|\.find\(\{|countDocuments/);
    }
  });

  it('serves /now and /period only — the old `/` route is retired', () => {
    const routes = code(sources.find((s) => s.name === 'dashboard.routes.ts')?.text ?? '');
    const paths = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map(
      (m) => `${m[1] ?? ''} ${m[2] ?? ''}`,
    );
    expect(paths).toEqual(['get /now', 'get /period']);
    expect(routes).toContain('FLEET_DASHBOARD_NOW_KEYS');
    expect(routes).toContain('FLEET_DASHBOARD_PERIOD_KEYS');
    expect(routes).toContain('validate({ query: FleetDashboardPeriodQuerySchema })');
  });
});
