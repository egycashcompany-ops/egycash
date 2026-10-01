// The 1 October accidents book — «وضيف الداتا دى بتاعت الحوادث» — read with the first import's
// rules, written after the screen was emptied, and matched only against what came after that.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAccidents, planAccidentsImport } from './accidents-import';
import { ACCIDENTS_RELOAD_FILE } from './accidents-reload';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', '..', 'assets', 'fleet-go-live');
const code = (name: string): string => readFileSync(join(HERE, name), 'utf8');

describe('the 1 October book', () => {
  const parsed = parseAccidents(
    JSON.parse(readFileSync(join(ASSETS, ACCIDENTS_RELOAD_FILE), 'utf8')),
  );
  const plan = planAccidentsImport(parsed.accidents, new Map(), new Map());
  const files = plan.vehicles.flatMap((vehicle) => vehicle.rows);

  it('lands every row — 199, the 12 the old system deleted landing deleted', () => {
    expect(parsed.accidents).toHaveLength(199);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.keptDeleted).toBe(12);
    expect(files).toHaveLength(199);
    expect(files.filter((row) => row.doc.isDeleted === false).length).toBeGreaterThanOrEqual(
      187 - parsed.unreadable.length,
    );
  });

  it('keeps the files with no readable date with none — 17 with none, one dated in year 26', () => {
    expect(plan.noDate).toHaveLength(18);
  });
});

describe('the step', () => {
  const step = code('accidents-reload.ts');

  it('waits for the screen to be emptied, and refuses before the claim', () => {
    const wait = step.indexOf('waitForGoLiveRuns([ACCIDENTS_CLEAR_GO_LIVE_MARK])');
    const claim = step.indexOf('claimGoLiveRun(ACCIDENTS_RELOAD_GO_LIVE_MARK');
    expect(wait).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(wait);
  });

  it('counts as «already there» only what was written after the clearing', () => {
    expect(step).toContain('applyAccidentsImport(plan, String(admin._id), since)');
    expect(code('accidents-import.ts')).toContain(
      'fleetAccidentRepository.existingByKey(vehicle.ref, accidentKey, since)',
    );
    expect(code('../accidents/accident.repository.ts')).toContain(
      '...(since === undefined ? {} : { createdAt: { $gte: since } }),',
    );
  });
});
