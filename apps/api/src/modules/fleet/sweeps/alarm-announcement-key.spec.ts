// What re-arms a maintenance-alarm announcement.
//
// The sweep announces a threshold CROSSING once per (vehicle, level, baseline), and `markOnce`
// makes "once" true by refusing a duplicate key. So the key IS the rule: whatever it names is what
// counts as "a different situation worth telling somebody about".
//
// It named the baseline by its DATE. Every write path stores `outDate` at midnight UTC, so two
// counting visits closed on the same day are one key — the second service moved the baseline, the
// cycle restarted, and the crossing that followed was never announced because a mark for that day
// already existed. A workshop finishing two jobs on one car in one day is ordinary work.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'fleet-sweeps.ts'), 'utf8');

import { alarmMarkKey } from './fleet-sweeps';

const sweepBody = (name: string): string => {
  const start = source.indexOf(`export const ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n};', start));
};

/**
 * The REAL key builder, not a restatement of it.
 *
 * A restatement cannot see a component going missing from the implementation — drop `level` from
 * the template and every "these two keys differ" assertion still passes, because the test is
 * comparing its own strings. So the exported function is what these cases call, and a separate
 * case pins that the sweep uses it rather than building a key of its own.
 */
const keyFor = alarmMarkKey;

describe('the baseline is named by the VISIT, not by its date', () => {
  const body = sweepBody('maintenanceAlarmSweep');

  it('the key is built from lastServiceVisitId', () => {
    expect(body).toContain('alarm.lastServiceVisitId');
  });

  it('and the sweep uses the shared builder rather than a template of its own', () => {
    // The single source. A private template here would be free to lose a component silently.
    expect(body).toContain('markOnce(alarmMarkKey(');
    expect(body, 'no hand-built key survives').not.toMatch(/`alarm:/);
  });

  it('every component actually reaches the key', () => {
    // Component-by-component, through the real builder: change any one input and the key changes.
    const base = keyFor('v1', 'red', 'visit-a');
    expect(keyFor('v2', 'red', 'visit-a'), 'vehicle').not.toBe(base);
    expect(keyFor('v1', 'yellow', 'visit-a'), 'level').not.toBe(base);
    expect(keyFor('v1', 'red', 'visit-b'), 'baseline').not.toBe(base);
    expect(base).toContain('v1');
    expect(base).toContain('red');
    expect(base).toContain('visit-a');
  });

  it('a missing baseline is named, not silently blank', () => {
    expect(keyFor('v1', 'red', null)).toBe('alarm:v1:red:none');
  });

  it('and no longer from the date', () => {
    // `lastServiceAt` is `outDate` at midnight UTC — the whole collision.
    expect(body, 'the date does not enter the key').not.toContain('lastServiceAt');
  });

  it('two visits closed on the SAME DAY are two different announcements', () => {
    // The case the date could not tell apart. Two ids, one day.
    const a = keyFor('v1', 'red', 'visit-a');
    const b = keyFor('v1', 'red', 'visit-b');
    expect(a).not.toBe(b);
  });

  it('but the same visit is still announced only once per level', () => {
    // The guarantee that must survive: a sweep run twice, or overlapping itself, emits nothing
    // the second time.
    expect(keyFor('v1', 'red', 'visit-a')).toBe(keyFor('v1', 'red', 'visit-a'));
  });

  it('and crossing from yellow to red is a NEW announcement', () => {
    expect(keyFor('v1', 'yellow', 'visit-a')).not.toBe(keyFor('v1', 'red', 'visit-a'));
  });

  it('as is the same level on a different vehicle', () => {
    expect(keyFor('v1', 'red', 'visit-a')).not.toBe(keyFor('v2', 'red', 'visit-a'));
  });
});

describe('the sweep is still an announcer and nothing more', () => {
  const body = sweepBody('maintenanceAlarmSweep');

  it('it derives at run time and stores no alarm state', () => {
    expect(body).toContain('await computeAlarms()');
    expect(body, 'nothing is written back').not.toMatch(
      /updateOne|updateMany|insertOne|save\(|deleteOne/,
    );
  });

  it('and only flagged vehicles are announced at all', () => {
    expect(body).toContain("alarm.level !== 'none'");
  });

  it('`markOnce` is what makes it once — and it is still the only gate', () => {
    expect(body).toContain('await markOnce(');
    const mark = readFileSync(join(HERE, 'sweep-mark.model.ts'), 'utf8');
    expect(mark, 'and that gate is the unique index').toContain('isDuplicateKey');
  });

  it('the licence sweep keeps its own key shape — this change did not touch it', () => {
    // Its facts re-arm on a new expiry date, which is a real change of fact and not a collision.
    const licence = sweepBody('licenseExpirySweep');
    expect(licence).toContain('dayKey(vehicle.licenseExpiresAt)');
    expect(licence).toContain('dayKey(profile.licenseExpiresAt)');
  });
});
