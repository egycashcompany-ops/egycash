// D10–D13 — the four decisions to build NOTHING, asserted.
//
// These are the load-bearing half of the training design, and they are the half nothing else can
// hold. A rule that EXISTS is held by the code that implements it and the test that exercises it;
// a rule that was deliberately not given has no code to point at, so the only way to keep it out is
// to say so here.
//
// Each of the four names something a training module is EXPECTED to have. Somebody adding one in
// good faith — a `price` on a course, a sweep over expiring certificates — would be inventing a
// business rule the owner has not given, which is the exact failure this codebase keeps refusing.
// The design doc lists all four in §8 as questions to ask; until they are answered, this file is
// what makes «not yet» mechanical rather than remembered.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every source in the feature, excluding this file — which must name the forbidden words. */
const sources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('training-absences.spec.ts')) {
        out.push({ name: full.slice(HERE.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(HERE);
  return out;
};

/** CODE ONLY — every file here explains in prose what it deliberately does not do. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FILES = sources();

describe('the feature exists at all', () => {
  it('reads its own sources', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });
});

/**
 * D11 — TRAINING WRITES INTO NEITHER ATTENDANCE NOR PAYROLL.
 *
 * Whether a training day is a work day, whether it is paid, and whether it displaces a rostered
 * shift are three business rules with no recorded answer. This module does not settle them by
 * writing rows into the modules that would then act on them — and the way a module accidentally
 * settles a rule it was never given is by importing the collection that stores the consequence.
 */
describe('D11 — nothing here reaches into Attendance or Payroll', () => {
  it.each(FILES)('$name names no attendance or payroll model', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      'AttendanceDayModel',
      'AttendancePunchModel',
      'PayslipModel',
      'PayrollRunModel',
      'PayrollAdjustmentModel',
      'EmployeePayItemModel',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it.each(FILES)('$name imports from neither module', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/from '[^']*\/attendance[^']*'/);
    expect(source).not.toMatch(/from '[^']*\/payroll[^']*'/);
  });
});

/**
 * D12 — NO COST, NO BUDGET, NO VENDOR ACCOUNTING.
 *
 * Money is what pulls in the accounting boundary that PY-12, P-HR-12 and P-HR-14 are each
 * deliberately stopped at. A price on a course looks harmless and is the first half of a ledger.
 */
describe('D12 — no money anywhere in the feature', () => {
  it.each(FILES)('$name carries no price, cost or budget field', ({ text }) => {
    const source = code(text);
    for (const forbidden of [/\bprice\b/i, /\bcostMinor\b/, /\bbudget\b/i, /\bamountMinor\b/]) {
      expect(source, String(forbidden)).not.toMatch(forbidden);
    }
  });

  /** `costCenterId` is how money would arrive without the word «cost» appearing on its own. */
  it.each(FILES)('$name names no cost centre', ({ text }) => {
    expect(code(text)).not.toContain('costCenter');
  });
});

/**
 * D13 — NO REQUIRED-TRAINING MATRIX.
 *
 * «Every driver must hold defensive driving» is a real rule, and it is a rule about JOB TITLES that
 * nobody has stated. Without it there is nothing to compute compliance against, and a compliance
 * screen computed from an invented rule would be worse than no screen — it would be a report the
 * company acts on, saying something nobody decided.
 */
describe('D13 — nothing requires a course of anybody', () => {
  /**
   * NOT a ban on the word «required». Mongoose spells «this field must be present» as
   * `required: true`, and forbidding that would forbid ordinary schemas — the first version of
   * this assertion did, and failed on three models that have nothing to do with D13.
   *
   * What D13 forbids is a course being required OF SOMEBODY, which needs a field naming who.
   */
  it.each(FILES)('$name names no population a course is required of', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      /\brequiredFor\b/,
      /\brequiredBy\b/,
      /\brequiredCourses?\b/,
      /\bmandatory\b/i,
      /\bcompliance\b/i,
    ]) {
      expect(source, String(forbidden)).not.toMatch(forbidden);
    }
  });

  /** The rule would have to reach the job title to exist. It does not reach it. */
  it.each(FILES)('$name does not read a job title', ({ text }) => {
    const source = code(text);
    expect(source).not.toContain('jobTitleService');
    expect(source).not.toContain('requiresDrivingTest');
  });
});

/**
 * D10 — AN EXPIRY IS RECORDED AND GATES NOTHING.
 *
 * The record collection is T4's, so there is no expiry field here yet; what this phase must not
 * grow is the machinery that would ACT on one. A sweep, a scheduled job or a notification over
 * expiring certificates would be enforcing a safety rule nobody has given.
 */
describe('D10 — nothing sweeps, schedules or warns', () => {
  it.each(FILES)('$name registers no scheduled job', ({ text }) => {
    const source = code(text);
    for (const forbidden of ['registerJob', 'scheduleJob', 'cron', 'sweep']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
