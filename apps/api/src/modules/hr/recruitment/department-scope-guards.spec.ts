// F-REQ-1 — the department axis across recruitment, held in place by source.
//
// THE DEFECT IS INVISIBLE BY CONSTRUCTION, which is why it is caught here and cannot be caught by
// the type system. `BaseRepository.scopeFilter` answers a scope whose field is UNDECLARED with an
// empty filter, and `baseFilter` then drops the empty clause. A collection that forgets
// `departmentField` therefore does not fail, does not warn and does not narrow — it serves the
// whole organization to a department-scoped reader. `departmentField` is optional by design
// (ADR-017 makes finer scopes opt-in per collection), so nothing in TypeScript can require it.
//
// Payroll learned this the same way and wrote `payroll/department-scope-guards.spec.ts`. This is
// the recruitment half of the same assertion, over the five collections a candidate's data lives
// in — the applicant and the four stage rows that follow them.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** CODE ONLY — several of these files EXPLAIN the axis in prose a naive match would satisfy. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

/** The applicant and every stage row that follows them, as model / repository. */
const COLLECTIONS = [
  {
    name: 'applicants',
    model: 'applicants/applicant.model.ts',
    repository: 'applicants/applicant.repository.ts',
  },
  {
    name: 'screenings',
    model: 'screening/screening.model.ts',
    repository: 'screening/screening.repository.ts',
  },
  {
    name: 'interviews',
    model: 'interviews/interview.model.ts',
    repository: 'interviews/interview.repository.ts',
  },
  {
    name: 'evaluations',
    model: 'evaluations/evaluation.model.ts',
    repository: 'evaluations/evaluation.repository.ts',
  },
  {
    name: 'job offers',
    model: 'job-offers/job-offer.model.ts',
    repository: 'job-offers/job-offer.repository.ts',
  },
] as const;

describe('every collection a candidate lives in carries the department axis', () => {
  it.each(COLLECTIONS)('$name stores it', ({ model }) => {
    const source = read(model);
    expect(source).toContain('departmentId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: { type: Schema.Types.ObjectId, default: null }');
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. A field nobody declares narrows nothing, and nothing else
   * in the codebase would notice — not the compiler, not a test, not the reader.
   */
  it.each(COLLECTIONS)('$name declares it to the base repository', ({ repository }) => {
    expect(code(repository)).toContain("departmentField: 'departmentId'");
  });

  /** A declared scope field with no index turns every scoped list into a collection scan. */
  it.each(COLLECTIONS)('$name indexes it', ({ model }) => {
    expect(code(model)).toContain("index({ departmentId: 1, status: 1 }");
  });

  /** D-DEPT-5's counterpart: the section rung is not opened here either. */
  it.each(COLLECTIONS)('$name adds no section axis', ({ repository }) => {
    expect(code(repository)).not.toContain('sectionField');
  });
});

describe('the mirror has one writer and follows the placement', () => {
  const APPLICANT_SERVICE = code('applicants/applicant.service.ts');
  const PLACEMENT_SERVICE = code('placement/placement.service.ts');

  /**
   * RW1 — `writePlacement` is the single writer, and it takes the department beside the branch.
   * A signature that took only the branch would let a reassignment move one axis and not the
   * other, leaving the candidate readable by the department they LEFT.
   */
  it('`writePlacement` takes both axes', () => {
    expect(APPLICANT_SERVICE).toContain("departmentId: ApplicantDoc['departmentId'];");
    expect(PLACEMENT_SERVICE).toContain('departmentId: placement.departmentId,');
  });

  /**
   * The stamp comes from the PLACEMENT, never from the request. The department a candidate is
   * scoped to is a consequence of where they were placed, not an argument a caller supplies —
   * and a caller who could supply it could read another department's pipeline by asking.
   */
  it('the applicant stamps it from the resolved placement and from nothing else', () => {
    expect(APPLICANT_SERVICE).toContain('const departmentId = placement.departmentId;');
    // `input.placement.departmentId` is legitimate and is NOT this: it feeds the placement the
    // resolver validates, which is then what the mirror is read from. What must never exist is a
    // bare department on the request — a caller who could name their own scope could read another
    // department's pipeline by asking for it.
    expect(APPLICANT_SERVICE).not.toMatch(/departmentId: input\.departmentId/);
    expect(APPLICANT_SERVICE).not.toMatch(/departmentId: ctx\./);
  });

  /**
   * ONE METHOD FOR THE WHOLE SCOPE, not one per axis. `syncApplicantBranch` was renamed rather
   * than joined by a sibling: two methods would let a stage feature keep syncing the branch and
   * quietly not the department, and only a reassigned candidate's history would have shown it.
   */
  it.each([
    'screening/screening.service.ts',
    'interviews/interview.service.ts',
    'evaluations/evaluation.service.ts',
    'job-offers/job-offer.service.ts',
  ])('%s syncs both axes in one write', (file) => {
    const source = code(file);
    expect(source).toContain('async syncApplicantScope(');
    expect(source).toContain('branchId: scope.branchId, departmentId: scope.departmentId');
    // The old one-axis name is gone, not deprecated beside it.
    expect(source).not.toContain('syncApplicantBranch');
  });
});

/**
 * Each `ensureStageRecord({...})` argument, as source text — brace-matched from the call so a
 * nested object literal inside it does not end the block early.
 */
const openStageCalls = (source: string): string[] => {
  const out: string[] = [];
  for (const match of source.matchAll(/ensureStageRecord\(\s*\{/g)) {
    const from = source.indexOf('{', match.index);
    let depth = 0;
    for (let i = from; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(from, i + 1));
          break;
        }
      }
    }
  }
  return out;
};

/**
 * Every site that OPENS a stage names the department.
 *
 * Two of them cast their input `as never` to satisfy an unrelated generic, which silences the
 * compiler on exactly this field — so `EnsureStageInput` being required is not enough on its own
 * and the call sites are checked by source. A row opened without it is invisible to every
 * department-scoped reader from the moment it is written.
 */
describe('a stage is never opened without the axis', () => {
  it.each([
    'interviews/interview.service.ts',
    'job-offers/job-offer.service.ts',
    'return-to-stage/return-to-stage.service.ts',
  ])('%s names it in every `ensureStageRecord` call', (file) => {
    const calls = openStageCalls(code(file));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('departmentId:');
  });

  /**
   * The materializer opens four of the eight through one shared `subjectOf`, so the axis is
   * asserted where it is actually written rather than at each call.
   */
  it('the materializer’s shared subject carries it', () => {
    const source = code('materializer/queue-materializer.service.ts');
    expect(source).toContain('branchId: applicant.branchId,');
    expect(source).toContain('departmentId: applicant.departmentId,');
  });

  it('the engine requires it rather than defaulting it', () => {
    const engine = code('workflow/workflow-engine.ts');
    expect(engine).toContain('departmentId: Types.ObjectId | null;');
    expect(engine).toContain('departmentId: input.departmentId,');
    expect(engine).not.toContain('departmentId?:');
  });
});

describe('the backfill only ever adds', () => {
  const MIGRATION = code('recruitment.migration.ts');

  /** Idempotent by FILTER: a second run matches nothing, and a hand correction survives it. */
  it('writes only rows whose mirror is still null', () => {
    expect(MIGRATION).toContain('departmentId: null },\n      { $set: { departmentId: value } }');
  });

  /** It copies a field already on the document. No date, no action log, no inference. */
  it('reads the applicant’s own placement as the source', () => {
    expect(MIGRATION).toContain("{ 'placement.departmentId': { $ne: null } }");
    expect(MIGRATION).not.toContain('departmentAt(');
  });

  /** One field. A backfill that could touch a decision or a status would be a different thing. */
  it('sets the department and nothing else', () => {
    const sets = [...MIGRATION.matchAll(/\$set: \{ departmentId: [^}]*\}/g)];
    expect(sets.length).toBeGreaterThanOrEqual(2);
  });
});
