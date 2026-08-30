// The four punch sources, and the one that may not be claimed (D12.3, D12.4 — AT-D2).
//
// WHY THIS SPEC EXISTS. Before AT-D2 an approved two-step correction and an HR hand-entry both
// wrote `manual`. They are not the same act: one travelled request → manager → HR before a minute
// was written, the other is somebody typing a time. Under a device-first model (D12.1) the
// distinction is load-bearing, because the only legitimate non-device punch IS an approved
// correction — so «not a device punch» stopped being a useful category the moment it had to carry
// both.
//
// The guard that matters most is the negative one: `regularization` is written by the service
// that owns the approval and CANNOT be supplied by a request. Without it, a hand-entry could wear
// the authority of a decision nobody took, and no reviewer looking at the row would know.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_DAY_FLAGS, ATTENDANCE_PUNCH_SOURCES, RecordPunchSchema } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

describe('the source vocabulary', () => {
  it('carries regularization as its own value', () => {
    expect([...ATTENDANCE_PUNCH_SOURCES]).toEqual(['device', 'manual', 'regularization', 'web']);
  });

  /**
   * THE NEGATIVE GUARD. A request may say `manual` or `web` and nothing else — the approved
   * source is written by the approval, never asked for.
   */
  it('refuses a request that claims the approved-correction source', () => {
    const claim = RecordPunchSchema.safeParse({
      employeeId: '0123456789abcdef01234567',
      at: new Date().toISOString(),
      source: 'regularization',
    });
    expect(claim.success, 'a caller must not be able to claim it').toBe(false);
  });

  it('still accepts the two a request may legitimately send', () => {
    for (const source of ['manual', 'web'] as const) {
      const parsed = RecordPunchSchema.safeParse({
        employeeId: '0123456789abcdef01234567',
        at: new Date().toISOString(),
        source,
      });
      expect(parsed.success, source).toBe(true);
    }
  });
});

describe('only the approval writes the approved source', () => {
  it('the regularization service writes it', () => {
    const service = strip(read('regularizations/regularization.service.ts'));
    expect(service).toContain("source: 'regularization'");
    expect(service, 'and no longer borrows manual').not.toContain("source: 'manual'");
  });

  /** Nothing else in attendance may write it — the punch service included. */
  it('the punch service does not', () => {
    const punch = strip(read('punches/punch.service.ts'));
    expect(punch).not.toContain("source: 'regularization'");
  });
});

describe('the day says which of the two it saw', () => {
  it('declares a flag for the approved correction', () => {
    expect([...ATTENDANCE_DAY_FLAGS]).toContain('regularizedPunch');
    expect([...ATTENDANCE_DAY_FLAGS]).toContain('manualPunch');
  });

  it('raises them from different sources, not from one another', () => {
    const derive = strip(read('day-records/derive-day.ts'));
    expect(derive).toContain("p.source === 'manual'");
    expect(derive).toContain("p.source === 'regularization'");
    expect(derive).toContain("flags.push('regularizedPunch')");
  });
});

/**
 * The reclassification is identified by the marker the regularization service itself stamps, so
 * it touches exactly the rows that service wrote — never a shape, a window or a guess.
 */
describe('the migration reclassifies exactly what the approval wrote', () => {
  const migration = () => strip(read('attendance.migration.ts'));

  it('matches on the regularization note marker', () => {
    expect(migration()).toContain("note: { $regex: '^regularization ' }");
  });

  it('moves only rows currently labelled manual', () => {
    expect(migration()).toContain("source: 'manual'");
  });

  /** D9 — it relabels provenance; it never restates what the punch says happened. */
  it('touches no fact of the punch itself', () => {
    const body = migration();
    for (const field of ['at:', 'employeeId:', 'direction:', 'branchIdAtPunch:']) {
      expect(body.includes(`$set: { ${field}`), field).toBe(false);
    }
  });
});
