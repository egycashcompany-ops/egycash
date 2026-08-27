// D14 — the two axes across Performance, held in place by source.
//
// THE FOURTH COPY OF A SPEC THAT HAS NOW CAUGHT THE SAME DEFECT THREE TIMES. Payroll wrote it after
// F-B1-1 survived four phases of review; Recruitment wrote it after F-REQ-1 did the same; Training
// wrote it before the defect could happen a third time. Every occurrence was invisible:
// `BaseRepository.scopeFilter` answers a scope whose field is undeclared with an EMPTY filter,
// `baseFilter` drops the empty clause, and a department-scoped reader is served the whole
// organization without anything failing, warning or looking wrong in review.
//
// Nothing in the type system can require the field — it is optional by design (ADR-017), so finer
// scopes stay opt-in per collection. So it is required HERE, for the collection that carries a
// PERSON, and explicitly NOT required for the one that does not.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const REVIEW_MODEL = 'reviews/performance-review.model.ts';
const CYCLE_MODEL = 'cycles/performance-cycle.model.ts';
const REPOSITORY = 'performance.repository.ts';

describe('the review carries both axes', () => {
  it('stores them', () => {
    const source = read(REVIEW_MODEL);
    expect(source).toContain('branchId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: { type: Schema.Types.ObjectId, default: null }');
  });

  it('indexes the department axis', () => {
    expect(code(REVIEW_MODEL)).toContain('index({ departmentId: 1, status: 1 }');
  });

  /**
   * The declaration itself, which is the thing that was missing all three times.
   *
   * Asserted on the SOURCE rather than by constructing the repository, because what failed before
   * was never the behaviour of a declared field — it was the field never being declared, which no
   * runtime assertion can distinguish from an organization-scoped caller getting everything.
   */
  it('declares both scope fields on the repository', () => {
    const source = code(REPOSITORY);
    expect(source).toContain("branchField: 'branchId'");
    expect(source).toContain("departmentField: 'departmentId'");
  });
});

/**
 * The cycle is EXEMPT, and the exemption is stated rather than assumed.
 *
 * A round is a company object that NAMES branches and departments in its scope; it is not a row
 * PLACED in one. Declaring `departmentField` on it would scope a cycle by a field that means
 * something else entirely — «the departments this round is addressed to» is not «the department
 * this row belongs to», and filtering one by the other would hide rounds from the very managers
 * whose people are in them.
 *
 * An exemption written down is a decision. An exemption assumed is F-B1-1 again.
 */
describe('the cycle is not a row about a person', () => {
  it('declares no scope fields', () => {
    const source = code(REPOSITORY);
    const cycleRepo = source.slice(
      source.indexOf('class PerformanceCycleRepository'),
      source.indexOf('class PerformanceReviewRepository'),
    );
    expect(cycleRepo).not.toContain('branchField');
    expect(cycleRepo).not.toContain('departmentField');
  });

  it('carries no placement of its own', () => {
    const source = code(CYCLE_MODEL);
    expect(source).not.toMatch(/^\s*branchId:/m);
    expect(source).not.toMatch(/^\s*departmentId:/m);
  });
});
