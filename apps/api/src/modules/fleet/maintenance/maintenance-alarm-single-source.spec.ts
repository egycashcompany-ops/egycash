// The alarm has ONE implementation, and it is stored NOWHERE.
//
// `computeAlarm` is the rule (fleet design §4.4, FR-3). Everything else — the odometer log's
// `alerts` filter, the alarms board, the maintenance screen, the dashboard — is a reader of the
// projection built from it. Two things would quietly end that, and neither shows up in a
// behavioural test of any single screen:
//
//   • a second copy of the arithmetic somewhere in the API, which drifts on the first change;
//   • a column holding a level, a remainder or a "since service" distance, which goes stale the
//     moment a reading lands and turns a derived answer into a maintained one.
//
// So both are asserted against the source itself.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLEET = join(HERE, '..');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sources = walk(FLEET).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const read = (file: string): string => readFileSync(file, 'utf8');

describe('one alarm rule', () => {
  it('is implemented exactly once in the fleet module', () => {
    const implementations = sources.filter((file) => /export const computeAlarm\b/.test(read(file)));
    expect(implementations.map((f) => f.slice(FLEET.length + 1))).toEqual([
      'maintenance/maintenance-alarm.ts',
    ]);
  });

  it('and nothing else re-derives a level from a threshold', () => {
    // The yellow/red comparison — `remaining <= redKm ? 'red' : …` — belongs to that one file.
    const offenders = sources.filter(
      (file) =>
        !file.endsWith('maintenance-alarm.ts') &&
        /(?:redKm|yellowKm)\s*(?:\?|<=|>=|<|>)/.test(read(file)),
    );
    expect(offenders.map((f) => f.slice(FLEET.length + 1))).toEqual([]);
  });

  it('reads its thresholds from settings, never from a literal in the code', () => {
    const source = read(join(FLEET, 'maintenance/maintenance-alarm.ts'));
    expect(source).toContain('FleetSettingKeys.AlarmYellowKm');
    expect(source).toContain('FleetSettingKeys.AlarmRedKm');
    expect(source, 'no hard-coded threshold').not.toMatch(/yellowKm\s*=\s*\d|redKm\s*=\s*\d/);
  });
});

describe('two doors, one handler', () => {
  const ROUTES = join(FLEET, 'maintenance/maintenance.routes.ts');
  const ODOMETER_ROUTES = join(FLEET, 'odometer/odometer.routes.ts');

  it('the projection is exposed twice, under two DIFFERENT permissions', () => {
    // Two audiences want one fact. The workshop should see the state of the cycle without also
    // being handed the odometer log, and the odometer log keeps the door it always had.
    expect(read(ROUTES)).toMatch(/'\/alarms',\s*\n\s*authenticate,\s*\n\s*authorize\('fleetMaintenance\.view'\)/);
    expect(read(ODOMETER_ROUTES)).toMatch(/'\/alarms',\s*\n\s*authenticate,\s*\n\s*authorize\('fleetOdometer\.view'\)/);
  });

  it('by the SAME handler — the second route is not a second implementation', () => {
    // Both routers reference one function, and it is defined once, next to the rule it serves.
    const owner = read(join(FLEET, 'maintenance/maintenance.controller.ts'));
    expect((owner.match(/export const listMaintenanceAlarms\b/g) ?? []).length).toBe(1);
    expect(read(ODOMETER_ROUTES), 'the odometer router imports it rather than defining one').toContain(
      "import { listMaintenanceAlarms } from '../maintenance/maintenance.controller'",
    );
    expect(read(join(FLEET, 'odometer/odometer.controller.ts')), 'and no copy is left behind')
      .not.toContain('listMaintenanceAlarms');

    // Exactly one definition in the whole module, wherever it might have been re-declared.
    const defined = sources.filter((f) => /export const listMaintenanceAlarms\b/.test(read(f)));
    expect(defined.map((f) => f.slice(FLEET.length + 1))).toEqual([
      'maintenance/maintenance.controller.ts',
    ]);
  });

  it('and that handler holds no projection of its own', () => {
    // It is a two-line HTTP boundary over `computeAlarms()`. A filter, a map or a second query
    // here would make one door answer differently from the other.
    const owner = read(join(FLEET, 'maintenance/maintenance.controller.ts'));
    const body = owner.slice(owner.indexOf('export const listMaintenanceAlarms'));
    const handler = body.slice(0, body.indexOf('};') + 2);
    expect(handler).toContain('await computeAlarms()');
    expect(handler, 'nothing is filtered').not.toMatch(/\.filter\(|\.map\(|\.slice\(/);
    expect(handler, 'no second query').not.toMatch(/Repository\.|\.aggregate\(|\.find\(/);
  });

  it('nothing else calls the projection over HTTP', () => {
    // `computeAlarms` has other legitimate callers inside the API (the odometer `alerts` filter
    // and the sweep). What must not exist is a SECOND controller answering with it, because that
    // is where a third, subtly different alarm endpoint would begin.
    const controllers = sources.filter((f) => f.endsWith('.controller.ts'));
    const answering = controllers.filter((f) => /ok\(res, await computeAlarms\(\)\)/.test(read(f)));
    expect(answering.map((f) => f.slice(FLEET.length + 1))).toEqual([
      'maintenance/maintenance.controller.ts',
    ]);
  });
});

describe('the alarm is derived on read, never stored', () => {
  const schemas = sources.filter((f) => f.endsWith('.model.ts'));

  it('no fleet collection holds a level, a remainder or a since-service distance', () => {
    expect(schemas.length).toBeGreaterThan(0);
    for (const file of schemas) {
      const source = read(file);
      const name = file.slice(FLEET.length + 1);
      expect(source, `${name} stores no level`).not.toMatch(/\balarmLevel\b|\blevel:\s*\{/);
      expect(source, `${name} stores no remainder`).not.toContain('remainingKm');
      expect(source, `${name} stores no since-service distance`).not.toContain('sinceServiceKm');
      // Nor a due date or a next-service marker: the rule is distance since the last counting
      // service, and a stored due point would be a second, ageing answer to the same question.
      expect(source, `${name} stores no due point`).not.toMatch(/nextService|dueAt|dueKm/i);
    }
  });

  it('the baseline is the visit itself — the alarm keeps no baseline column of its own', () => {
    const visit = read(join(FLEET, 'maintenance/maintenance.model.ts'));
    // What the baseline is MADE of is stored (the counters and the dates); which visit is the
    // current baseline is not — that is decided per request by the aggregate.
    expect(visit).toContain('odometerAtService');
    expect(visit).toContain('exitOdometer');
    expect(visit, 'no stored baseline flag').not.toMatch(/isBaseline|baselineFor|lastServiceVisit/);
  });
});
