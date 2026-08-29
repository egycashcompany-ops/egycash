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

/** The clinical repositories — the ones D4 exempts. The insurance repository is NOT one of them. */
const clinicalSlice = (): string => {
  const from = REPOSITORY.indexOf('class MedicalProfileRepository');
  const to = REPOSITORY.indexOf('class MedicalInsuranceRepository');
  expect(from, 'the profile repository exists').toBeGreaterThan(-1);
  return to === -1 ? REPOSITORY.slice(from) : REPOSITORY.slice(from, to);
};

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
