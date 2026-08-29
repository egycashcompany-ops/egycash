// D3 and D4 — who may read the clinical record, asserted.
//
// THIS SPEC IS THE INVERSE OF EVERY OTHER SCOPE GUARD IN THIS CODEBASE, and that is why it says so
// at the top. `payroll-`, `recruitment-`, `training-` and `performance-scope-guards` each REQUIRE a
// `departmentField`, because an undeclared scope field silently serves a department-scoped reader
// the whole organization — a defect that has now been caught four times.
//
// Here the requirement runs the other way. A clinical row must declare NO scope fields, because
// declaring them would make a WIDER scope mean WIDER READING: a branch-scoped HR officer would gain
// their whole branch's blood types by holding a key that was meant to gate, not to grant. The key
// is the gate (D3); the axis is not (D4).
//
// Somebody will read the four other guards, notice this collection is «missing» its declaration,
// and add it in good faith. This file is what that person hits first, and it is written to be read
// by them rather than by a machine.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const REPOSITORY = strip(read('medical.repository.ts'));

/**
 * One class's body, bounded by the NEXT class rather than by the end of the file.
 *
 * An open-ended slice is a guard that grows a false failure the day somebody appends a class — and
 * it did: M4's `InsuranceCardRepository` declares both axes on purpose, and an unbounded clinical
 * slice read them as the clinical repository's own. A boundary that is «the next class» is the only
 * one that stays correct as the file grows.
 */
const classBody = (name: string): string => {
  const from = REPOSITORY.indexOf(`class ${name}`);
  expect(from, `${name} exists`).toBeGreaterThan(-1);
  const next = REPOSITORY.indexOf('\nclass ', from + 1);
  return next === -1 ? REPOSITORY.slice(from) : REPOSITORY.slice(from, next);
};

/** The clinical repositories — the ones D4 exempts. The insurance repository is NOT one of them. */
const clinicalSlice = (): string =>
  `${classBody('MedicalProfileRepository')}\n${classBody('MedicalEventRepository')}`;

describe('D4 — the clinical record is not widened by an organizational scope', () => {
  it('declares neither axis', () => {
    const clinical = clinicalSlice();
    expect(clinical).not.toContain('branchField');
    expect(clinical).not.toContain('departmentField');
  });

  /**
   * And the model carries no placement either. A `departmentId` on the row would be a field
   * somebody could later declare — the absence has to go all the way down, or the guard above is
   * one line away from being satisfiable.
   */
  it('stores no placement to scope by', () => {
    const model = strip(read('profiles/medical-profile.model.ts'));
    expect(model).not.toMatch(/^\s*branchId:/m);
    expect(model).not.toMatch(/^\s*departmentId:/m);
  });
});

/**
 * D4, THE OTHER HALF — the INSURANCE card declares BOTH axes, and must.
 *
 * The asymmetry is the design, not an inconsistency: a card number is an administrative fact an HR
 * officer legitimately administers by branch, and a blood type is not. Asserting only the clinical
 * absence would leave the card free to drift into the clinical shape — at which point benefits
 * administration stops being delegable, and somebody "fixes" it by widening the clinical rows
 * instead.
 *
 * So both halves are pinned, and each names the other.
 */
describe('D4 — the card is administrative, and IS scoped', () => {
  it('declares both axes', () => {
    const insurance = classBody('InsuranceCardRepository');
    expect(insurance).toContain("branchField: 'branchId'");
    expect(insurance).toContain("departmentField: 'departmentId'");
  });

  it('stores the placement to scope by', () => {
    const model = strip(read('insurance/insurance-card.model.ts'));
    expect(model).toContain('branchId: Types.ObjectId | null;');
    expect(model).toContain('departmentId: Types.ObjectId | null;');
  });
});

describe('D3 — no other permission opens this door', () => {
  const sources = (): { name: string; text: string }[] => {
    const out: { name: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
          out.push({ name: full.slice(HERE.length + 1), text: strip(readFileSync(full, 'utf8')) });
        }
      }
    };
    walk(HERE);
    return out;
  };

  /**
   * The clinical routes are gated by `medicalRecord.*` and by nothing else. `employee.view` here
   * would be the whole of D3 undone in one line, and it is the most natural line in the world to
   * write — the screen lives on an employee's profile, after all.
   */
  it.each(sources())('$name gates nothing on an employee key', ({ text }) => {
    for (const forbidden of ["'employee.view'", "'employee.edit'", "'employee.manage'"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  /** And `medicalCheck.*` is RECRUITMENT's key, about an applicant (D1). Different door. */
  it.each(sources())('$name does not borrow the recruitment key', ({ text }) => {
    expect(text).not.toContain('medicalCheck.');
  });

  /**
   * D3-b — and the CLINICAL routes do not accept the INSURANCE key either.
   *
   * This is the direction the first draft got wrong in reverse: the card was going to ride the
   * clinical key, which would have made delegating benefits administration hand out clinical
   * access. Now that they are two keys, the guard has to hold the boundary from BOTH sides —
   * `medicalInsurance.view` appearing on a profile or event route would reopen the same hole.
   */
  it('no clinical route accepts the insurance key', () => {
    const routes = strip(read('medical.routes.ts'));
    const insuranceAt = routes.indexOf('buildMedicalInsuranceRouter');
    expect(insuranceAt, 'the insurance router exists').toBeGreaterThan(-1);
    // Everything BEFORE the insurance router is the clinical half of the file.
    expect(routes.slice(0, insuranceAt)).not.toContain('medicalInsurance.');
  });
});

/**
 * D14 — the read is audited.
 *
 * The only read-auditing in HR, and it exists because the harm from a leak is not recoverable: «who
 * looked» has to be answerable afterwards, not only «who changed». Asserted on the service rather
 * than by running it, because what would fail silently is the CALL never being written — and a
 * missing audit row looks exactly like a read that never happened.
 */
describe('D14 — reading the clinical record leaves a trace', () => {
  it('audits the read path', () => {
    const service = strip(read('profiles/medical-profile.service.ts'));
    const from = service.indexOf('async getByEmployee');
    expect(from, 'the read exists').toBeGreaterThan(-1);
    const method = service.slice(from, service.indexOf('async ', from + 10));
    expect(method).toContain('auditService.record');
  });
});
