// The wall between Payroll and Attendance, asserted over the source (PY-4).
//
// The lint rule makes crossing it a build error; this makes crossing it a FAILING TEST, with a
// message that says why. Two guards rather than one because they fail differently: a lint rule
// can be disabled inline on the line that breaks the seam, and a test cannot.
//
// What the seam protects: the frozen feed is complete-or-nothing, so reading a day row directly
// would let Payroll price a month whose truth was still moving — the exact failure the freeze
// exists to prevent (attendance design §15.1, D-PR-07 Option A).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');
const PORT = 'attendance-quantity.port.ts';

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

const payrollFiles = sources(PAYROLL);

/**
 * Code only — the prose is stripped first.
 *
 * These files EXPLAIN the seam, so their comments name the very things the assertions forbid.
 * Scanning the comments too would make the wall fail on the sentence describing it.
 */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('Payroll reaches Attendance through exactly one door', () => {
  it('finds the payroll sources to check', () => {
    expect(payrollFiles.length).toBeGreaterThan(10);
  });

  it('imports attendance from the port file and nowhere else', () => {
    const importers = payrollFiles.filter((file) =>
      /from '[^']*\/attendance(\/[^']*)?'/.test(code(file)),
    );
    expect(importers.map((f) => f.slice(PAYROLL.length + 1))).toEqual([
      `compensation/${PORT}`,
    ]);
  });

  it('never names the day model, the collection or the punches', () => {
    for (const file of payrollFiles) {
      const source = code(file);
      for (const forbidden of [
        'AttendanceDayModel',
        'hr_attendance_days',
        'AttendancePunchModel',
        'dayRecordRepository',
        'deriveDay',
      ]) {
        expect(source, `${file.slice(PAYROLL.length + 1)} names ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  // Freezing is a decision the payroll RUN makes when it starts calculating (PY-6). PY-4 reads a
  // frozen period and never creates one — which is why it ships ready and dark.
  it('never calls freezePeriod — PY-4 reads, PY-6 will freeze', () => {
    for (const file of payrollFiles) {
      expect(code(file), file).not.toMatch(/freezePeriod\s*\(/);
    }
  });

  it('uses only the one reader, and only inside the port', () => {
    expect(code(resolve(HERE, PORT))).toContain('readFrozenFeed');
    const others = payrollFiles.filter(
      (file) => !file.endsWith(PORT) && code(file).includes('readFrozenFeed'),
    );
    expect(others).toEqual([]);
  });

  it('keeps the port small enough to review in one sitting', () => {
    const lines = readFileSync(resolve(HERE, PORT), 'utf8').split('\n').length;
    expect(lines).toBeLessThan(60);
  });
});
