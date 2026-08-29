// D2, D7, D8, D11, D12, D13 — the decisions to record and not act, asserted.
//
// A medical module's characteristic failure is not losing data. It is ACTING on a clinical fact
// through a rule nobody clinical gave it: rostering around a restriction the system parsed,
// flagging somebody unfit because a date passed, counting disabilities against a quota. Each of
// those is a decision about a person's livelihood, made by a schema.
//
// Every one of them would be added in good faith, because each looks like the obvious next feature
// rather than like inventing a rule. This file is what makes «not yet» mechanical.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const sources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
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

/**
 * Case-insensitive SUBSTRING, the shape `performance-absences.spec.ts` arrived at the hard way: a
 * `\bbonus\b` there let `bonusFor` through, because camelCase puts a word character on both sides
 * of the banned word. These words have no innocent use in this feature, so the substring is safe.
 */
const names = (text: string, forbidden: readonly string[]): void => {
  const source = code(text).toLowerCase();
  for (const word of forbidden) {
    expect(source, word).not.toContain(word);
  }
};

const FILES = sources();

describe('the feature exists at all', () => {
  it('reads its own sources', () => {
    expect(FILES.length).toBeGreaterThan(3);
  });
});

/**
 * D2 — MEDICAL INSURANCE, NEVER SOCIAL INSURANCE.
 *
 * The two are one word in the language everybody here speaks, and the second is already deferred
 * by a recorded decision in `hr-payroll.ts` pointing at P-HR-12 and P-HR-14. The confusion would
 * arrive as a helpful addition — an «insurance number» field that a payroll deduction is later
 * calculated from — rather than as a mistake anybody makes deliberately.
 */
describe('D2 — nothing here is social insurance', () => {
  it.each(FILES)('$name carries no contribution or statutory number', ({ text }) => {
    names(text, [
      'socialinsurance',
      'insurancenumber',
      'contributionrate',
      'employershare',
      'employeeshare',
      'taxable',
    ]);
  });
});

/**
 * D7 / D11 — NOTHING IS DERIVED AND NOTHING IS WRITTEN.
 *
 * A fitness verdict comes from whoever examined the person. An unfit verdict suspends nobody and a
 * restriction removes nobody from a roster: those are decisions with legal consequences that a
 * person makes and records as a personnel action, through the module that already exists for it.
 *
 * The way a module accidentally acts on a rule it was never given is by importing the collection
 * that stores the consequence.
 */
describe('D11 — medical writes to nothing', () => {
  it.each(FILES)('$name names no other module’s model', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      'AttendanceDayModel',
      'AttendanceShiftModel',
      'PayslipModel',
      'PayrollRunModel',
      'EmployeePayItemModel',
      'FleetAssignmentModel',
      'EmployeeActionModel',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it.each(FILES)('$name imports from no module it must not reach', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/from '[^']*\/attendance[^']*'/);
    expect(source).not.toMatch(/from '[^']*\/payroll[^']*'/);
    expect(source).not.toMatch(/from '[^']*\/fleet[^']*'/);
  });

  it.each(FILES)('$name derives no verdict', ({ text }) => {
    names(text, ['isfit', 'computefitness', 'derivedverdict', 'autounfit', 'suspendemployee']);
  });
});

/**
 * D8 — A RESTRICTION IS A SENTENCE, NOT A RULE.
 *
 * «No night shifts for six months» is stored as that sentence and a date. Parsing it into something
 * a roster could enforce would mean the system deciding who works nights — from a doctor's note it
 * interpreted, with nobody in the loop and no record of the interpretation.
 */
describe('D8 — no restriction is machine-readable', () => {
  it.each(FILES)('$name encodes no restriction rule', ({ text }) => {
    names(text, [
      'restrictionrule',
      'restrictedshift',
      'nonightshift',
      'maxhours',
      'shiftexclusion',
      'enforcerestriction',
    ]);
  });
});

/**
 * D12 — NO CLINICAL CODING.
 *
 * A coded diagnosis is a medical record proper, and holding one makes the company a custodian of
 * clinical data under a duty nobody here has scoped. Conditions are text because text is what an
 * HR department can honestly hold and what a non-clinician can honestly read.
 */
describe('D12 — no diagnosis is coded', () => {
  it.each(FILES)('$name carries no coding system', ({ text }) => {
    names(text, ['icd10', 'icd11', 'icdcode', 'diagnosiscode', 'snomed', 'clinicalcode']);
  });
});

/**
 * D13 — NO SWEEP, NO COMPLIANCE SCREEN.
 *
 * «Whose medical certificate has lapsed» is a real question and a rule nobody has given: how long a
 * certificate is valid, for which roles, and what follows from a lapse are three unstated
 * decisions. A screen computed from an invented one would be a report the company acts on.
 *
 * The disability quota is the same shape and worse — Egyptian law has a percentage, and counting
 * against it would turn a fact somebody disclosed into a number the company is measured by.
 */
describe('D13 — nothing counts anything', () => {
  it.each(FILES)('$name runs no expiry sweep', ({ text }) => {
    names(text, ['expirysweep', 'expiringsoon', 'lapsedcertificate', 'compliancerate', 'duefor']);
  });

  it.each(FILES)('$name counts no quota', ({ text }) => {
    names(text, ['quota', 'disabilitycount', 'disabilityratio', 'headcountpercent']);
  });
});
