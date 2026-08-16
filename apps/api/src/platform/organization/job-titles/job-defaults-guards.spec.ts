// P-HR-22 Phase 1 — the Job carries defaults, and a default is not an override.
//
// Everything this phase adds is small. What makes it worth guarding is that two of the additions
// are SAFETY properties rather than features, and safety properties are the kind that get tidied
// away by a later refactor that means no harm:
//
//   1. `manual` is the stored default for provenance. That single choice is what makes D-JOB-4
//      true for the existing population without a backfill — every row written before this phase
//      reads as an override, so a re-apply written later cannot reach one. Flip the default to
//      `jobDefault` and the whole company silently becomes re-appliable.
//   2. Provenance is DERIVED, never accepted from the caller. A request that could declare its
//      own `source` could declare a departure from the job to be compliance with it, and the
//      field would be worth nothing precisely when it mattered.
//
// The third group is scope: this phase does NOT re-apply anything to anybody, and the salary band
// stays advisory. Both were owner rulings, and both are one careless commit away from reversal.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOB_VALUE_SOURCES } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const JOB_MODEL = read('./job-title.model.ts');
const JOB_SERVICE = stripComments(read('./job-title.service.ts'));
const EMPLOYEE_MODEL = read('../../../modules/hr/employee-management/employees/employee.model.ts');
const EMPLOYEE_SERVICE = stripComments(
  read('../../../modules/hr/employee-management/employees/employee.service.ts'),
);
const ACTIONS = stripComments(
  read('../../../modules/hr/employee-management/employee-actions/employee-action.service.ts'),
);
const ASSIGNMENT_MODEL = read(
  '../../../modules/hr/attendance/assignments/shift-assignment.model.ts',
);
const ASSIGNMENT_SERVICE = stripComments(
  read('../../../modules/hr/attendance/assignments/shift-assignment.service.ts'),
);

describe('the provenance vocabulary', () => {
  it('is exactly two values, and neither is a third state in disguise', () => {
    expect([...JOB_VALUE_SOURCES]).toEqual(['jobDefault', 'manual']);
  });

  /**
   * The safety property, stated where it is set rather than where it is read.
   *
   * Both models must default to `manual`. Anything else — including "no default" — would leave
   * rows that a future re-apply reads as its own, and those rows belong to people whose salary
   * was decided before this field existed.
   */
  it('defaults to `manual` on the employee and on the shift assignment', () => {
    expect(EMPLOYEE_MODEL).toMatch(/salarySource:\s*\{[^}]*default:\s*'manual'/s);
    expect(ASSIGNMENT_MODEL).toMatch(/source:\s*\{[^}]*default:\s*'manual'/s);
  });
});

describe('a default is applied only where nothing was decided', () => {
  /**
   * An explicitly supplied figure is always somebody's decision. The helper reads the job ONLY
   * after establishing that none was given, which is the whole of D-JOB-2's "snapshot" rule.
   */
  it('the hire helper reaches for the job only when no salary was supplied', () => {
    const helper = EMPLOYEE_SERVICE.slice(
      EMPLOYEE_SERVICE.indexOf('const salaryForAssignment'),
      EMPLOYEE_SERVICE.indexOf('class EmployeeService'),
    );
    expect(helper).toContain("if (given !== null) return { salary: given, salarySource: 'manual' }");
    // …and the job is only consulted after that early return.
    expect(helper.indexOf('given !== null')).toBeLessThan(helper.indexOf('jobTitleService.getById'));
    expect(helper).toContain("salarySource: 'jobDefault'");
  });

  /** A stated salary, and a salary change, are both overrides — by definition, not by policy. */
  it('an explicit salary always records `manual`', () => {
    const promotion = ACTIONS.slice(ACTIONS.indexOf("case 'promotion'"), ACTIONS.indexOf("case 'transfer'"));
    expect(promotion).toContain("employee.employment.salarySource = 'manual'");
    // The brace matters: a bare `case 'probationConfirm':` appears in an earlier switch, and
    // slicing to THAT one yields an empty string that quietly passes every assertion.
    const change = ACTIONS.slice(
      ACTIONS.indexOf("case 'salaryChange'"),
      ACTIONS.indexOf("case 'probationConfirm': {"),
    );
    expect(change).not.toHaveLength(0);
    expect(change).toContain("employee.employment.salarySource = 'manual'");
  });

  /**
   * D-JOB-4 at the moment of promotion: a promotion that states no salary carries the new job's
   * default ONLY to somebody who was still following one. The `!== 'manual'` test is the whole
   * protection, so it is asserted by name.
   */
  it('a promotion never overwrites an employee who holds an override', () => {
    const promotion = ACTIONS.slice(ACTIONS.indexOf("case 'promotion'"), ACTIONS.indexOf("case 'transfer'"));
    expect(promotion).toContain("employee.employment.salarySource !== 'manual'");
    expect(promotion).toContain("employee.employment.salarySource = 'jobDefault'");
  });
});

describe('provenance is derived, never declared', () => {
  it('the shift assignment computes its own source from the job’s candidate list', () => {
    expect(ASSIGNMENT_SERVICE).toContain('const sourceOfChoice');
    expect(ASSIGNMENT_SERVICE).toContain('source: await sourceOfChoice(');
    // The caller cannot state it: the create contract carries no such field.
    const CONTRACT = read('../../../../../../packages/contracts/src/modules/hr-attendance.ts');
    const create = CONTRACT.slice(
      CONTRACT.indexOf('export const CreateShiftAssignmentSchema'),
      CONTRACT.indexOf('export type CreateShiftAssignment'),
    );
    expect(create).not.toContain('source');
  });

  it('and an employee’s source is never read from a request body', () => {
    expect(EMPLOYEE_SERVICE).not.toMatch(/input\.[\w.]*salarySource/);
    expect(ACTIONS).not.toMatch(/p\['salarySource'\]/);
  });
});

describe('what this phase deliberately did NOT do', () => {
  /**
   * Re-apply to incumbents is a later phase with its own approval and audit (owner's D-JOB-3).
   * Nothing here may quietly become one — a bulk write over current holders is exactly the shape
   * that arrives by accident inside a helper called "sync".
   */
  it('re-applies nothing to anybody', () => {
    for (const source of [JOB_SERVICE, EMPLOYEE_SERVICE, ACTIONS, ASSIGNMENT_SERVICE]) {
      for (const forbidden of ['reapply', 'reApply', 'incumbent', 'updateMany', 'bulkWrite']) {
        expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  /** The band advises. Turning it into a constraint would be a business rule nobody granted. */
  it('never refuses a fixed salary for being outside the band', () => {
    expect(JOB_SERVICE).toContain('const outsideBand');
    const fn = JOB_SERVICE.slice(JOB_SERVICE.indexOf('const outsideBand'), JOB_SERVICE.indexOf('class JobTitleService'));
    expect(fn).not.toContain('throw');
    // The only refusal in this service stays the one that predates the phase: min ≤ max.
    expect([...JOB_SERVICE.matchAll(/throw new BusinessRuleError\('([^']+)'\)/g)].map((m) => m[1])).toEqual([
      'salaryMax must be ≥ salaryMin',
    ]);
  });

  /** A job's shifts are candidates, not a second open assignment (D-JOB-5 A). */
  it('adds no second open shift assignment and no primary/alternative concept', () => {
    expect(ASSIGNMENT_MODEL).toContain('ux_open_interval');
    for (const forbidden of ['primaryShift', 'alternativeShift', 'primaryShiftId']) {
      expect(`${JOB_MODEL}${ASSIGNMENT_SERVICE}`, forbidden).not.toContain(forbidden);
    }
  });

  /** No migration: both additions carry schema defaults, so nothing is rewritten to add them. */
  it('needs no backfill — every new field declares a default', () => {
    expect(JOB_MODEL).toMatch(/fixedSalary:\s*\{[\s\S]*?default:\s*null/);
    expect(JOB_MODEL).toMatch(/defaultShiftIds:\s*\{[^}]*default:\s*\[\]/);
  });

  /** Recruitment's placement dimension is untouched — it was never the employee's job. */
  it('leaves the job position alone', () => {
    expect(JOB_MODEL).not.toContain('jobPositionId');
    expect(JOB_SERVICE).not.toContain('jobPosition');
  });
});

// ── D-JOB-6 option C — names cross the boundary, authority does not ─────────

describe('the Job screen reads shift NAMES without an attendance grant', () => {
  const SEAM = stripComments(read('../shift-label-seams.ts'));
  const HR_SIDE = stripComments(
    read('../../../modules/hr/attendance/shifts/shift-label-seams.ts'),
  );
  const CONTROLLER = stripComments(read('./job-title.controller.ts'));

  /**
   * The boundary this seam exists for: `{ from: 'platform', allow: ['platform', 'shared',
   * 'infrastructure'] }`. Platform may not import a module, so the arrow is inverted — HR calls
   * INTO platform at load. An import the other way would fail lint, and asserting it here says
   * why rather than leaving the next reader to rediscover the rule.
   */
  it('platform declares the seam and imports nothing from a module', () => {
    expect(SEAM).not.toMatch(/from '.*\/modules\//);
    expect(SEAM).toContain('export const registerShiftLabelReader');
    expect(SEAM).toContain('export const resolveShiftLabels');
    // HR is the one that reaches across, which is the direction the rule permits.
    expect(HR_SIDE).toContain("from '../../../../platform/organization/shift-label-seams'");
  });

  /** A name, and nothing else. Times, grace minutes and `active` stay behind manageShifts. */
  it('carries only the name across', () => {
    expect(HR_SIDE).toContain('.select({ name: 1 })');
    for (const forbidden of ['startTime', 'endTime', 'graceIn', 'breakMinutes', 'active']) {
      expect(HR_SIDE, forbidden).not.toContain(forbidden);
    }
  });

  /** No permission was added, widened, or borrowed to make this work. */
  it('adds no permission and borrows none', () => {
    for (const source of [SEAM, HR_SIDE, CONTROLLER, JOB_SERVICE]) {
      for (const forbidden of ['attendance.manageShifts', 'shift.view', 'attendance.viewShifts']) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
    // The route's own gate is still the one it shipped with.
    expect(read('./job-title.routes.ts')).toContain("authorize('jobTitle.view')");
  });

  /** One seam call per page, not one per row — labels must not become a query multiplier. */
  it('resolves the whole page in a single call', () => {
    expect(JOB_SERVICE).toContain('const labels = await resolveShiftLabels(ids)');
    expect(CONTROLLER).toContain('await jobTitleService.toDtos(page.items)');
    expect(CONTROLLER).not.toContain('okPage');
  });

  /** Unregistered or unreadable answers `null`, never a fabricated label. */
  it('degrades to null rather than inventing a name', () => {
    expect(SEAM).toContain('shiftLabelReader === null');
    expect(JOB_SERVICE).toContain('labels.get(id) ?? null');
  });
});
