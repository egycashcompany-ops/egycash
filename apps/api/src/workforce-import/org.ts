// Resolving the sheet's org names to real branches, departments, sections and job titles.
//
// The workbook names places in Arabic prose; the registry needs ObjectIds. Two rules shape this:
//
//   • MATCH LOOSELY, CREATE VERBATIM. `الرقابة والمستهلكات` and `الرقابة و المستهلكات` are one
//     section typed twice (see `orgKey`), so they must meet. But the unit that gets CREATED carries
//     the sheet's own spelling — the company keeps its own words, not this importer's fold.
//   • BRANCHES ARE NEVER INVENTED. A branch code is part of every employee code that will ever be
//     issued from it (ADR-017), and guessing one would mint identities on a mistake. The seven
//     branches come from the CODES in the sheet, which is the company's own numbering, and a site
//     whose name has no code is reported rather than created.
import { branchService, departmentService, jobTitleService, sectionService } from '../platform/organization';
import { orgKey } from './vocabulary';

/** `المهندسين` → `010`, from the prefixes the workbook's own employee codes carry. */
export type BranchCodeByName = ReadonlyMap<string, string>;

/**
 * Derive the branch codes from the data rather than from a hard-coded table.
 *
 * Every employee code begins with the 3-digit code of the branch that hired them, so the mapping
 * site→code is already in the file — and deriving it means the importer cannot disagree with the
 * workbook it is reading. A site claimed by more than one prefix is reported: 148 employees carry a
 * prefix from a branch they no longer work at, so the mapping is taken from the MOST COMMON prefix
 * per site, and a site with no clear majority is a question for a human.
 */
export const deriveBranchCodes = (
  rows: readonly { code: string | null; branchName: string | null }[],
): { codes: Map<string, string>; ambiguous: { site: string; counts: Record<string, number> }[] } => {
  const tally = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.code === null || row.branchName === null) continue;
    const key = orgKey(row.branchName);
    if (key === null || row.code.length < 3) continue;
    const prefix = row.code.slice(0, 3);
    const counts = tally.get(key) ?? new Map<string, number>();
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    tally.set(key, counts);
  }

  const codes = new Map<string, string>();
  const ambiguous: { site: string; counts: Record<string, number> }[] = [];
  for (const [site, counts] of tally) {
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    if (top === undefined) continue;
    // A site's own prefix dominates: in the go-live data the winner holds 90%+ of its rows, and the
    // rest are people hired elsewhere and transferred in. A near-tie means the site does not have
    // one code, which is not something to average over.
    if (second !== undefined && second[1] >= top[1]) {
      ambiguous.push({ site, counts: Object.fromEntries(counts) });
      continue;
    }
    codes.set(site, top[0]);
  }
  return { codes, ambiguous };
};

export interface OrgResolution {
  branchId: string;
  departmentId: string;
  sectionId: string | null;
  jobTitleId: string;
}

export interface OrgProblem {
  what: string;
  detail: string;
}

/**
 * A resolver that remembers, so 2,699 rows do not become 2,699 lookups of the same seven branches.
 *
 * `dryRun` decides whether a missing unit is CREATED or merely counted: a dry run must be able to
 * say "this would create 40 sections" without creating any of them.
 */
export class OrgResolver {
  private readonly branches = new Map<string, string>();
  private readonly departments = new Map<string, string>();
  private readonly sections = new Map<string, string>();
  private readonly jobTitles = new Map<string, string>();
  readonly created = { branches: 0, departments: 0, sections: 0, jobTitles: 0 };
  /**
   * Codes minted during THIS run, across all three catalogs.
   *
   * The listing a creation allocates against is fetched before the creation, so two units made in
   * quick succession would both see the same highest existing code and pick the same next one. This
   * is what the listing cannot yet know. One array for all three prefixes is deliberate — the codes
   * are prefixed, so they cannot collide across catalogs, and one list cannot fall out of step with
   * itself the way three would.
   */
  private readonly mintedCodes: string[] = [];
  readonly problems: OrgProblem[] = [];

  constructor(
    private readonly branchCodes: BranchCodeByName,
    private readonly actorId: string,
    private readonly dryRun: boolean,
  ) {}

  async resolve(row: {
    branchName: string | null;
    departmentName: string | null;
    sectionName: string | null;
    jobTitleName: string | null;
  }): Promise<OrgResolution | null> {
    const branch = await this.branch(row.branchName);
    if (branch === null) return null;
    const department = await this.department(branch, row.departmentName);
    if (department === null) return null;
    const section = await this.section(department, row.sectionName);
    const jobTitle = await this.jobTitle(row.jobTitleName);
    if (jobTitle === null) return null;
    return {
      branchId: branch,
      departmentId: department,
      sectionId: section,
      jobTitleId: jobTitle,
    };
  }

  private async branch(name: string | null): Promise<string | null> {
    const key = orgKey(name);
    if (key === null || name === null) return null;
    const cached = this.branches.get(key);
    if (cached !== undefined) return cached;

    const code = this.branchCodes.get(key);
    if (code === undefined) {
      this.note('branch', `site "${name}" has no employee-code prefix of its own — cannot place it`);
      return null;
    }

    const existing = await this.findBranch(code, key);
    if (existing !== null) {
      this.branches.set(key, existing);
      return existing;
    }
    if (this.dryRun) {
      this.created.branches += 1;
      this.branches.set(key, `dry-run:branch:${code}`);
      return this.branches.get(key) as string;
    }
    // Created with the SHEET's spelling, not the folded key.
    const made = await branchService.create({ code, name: { ar: name, en: name } }, this.actorId);
    this.created.branches += 1;
    const id = String(made._id);
    this.branches.set(key, id);
    return id;
  }

  /**
   * Find the branch by its CODE, and failing that by its NAME.
   *
   * The name half is not belt-and-braces, it is the difference between an import that runs and one
   * that does not. `branchService.create` rejects a duplicate NAME, so a database that already
   * holds "المهندسين" under some other code — every deployment that was used before the import —
   * makes the create throw `A branch with this name already exists`. The branch is then never
   * cached, so the SAME failure repeats for every single person at that site: one stale branch
   * costs the whole branch's workforce.
   *
   * A dry run cannot see any of this, because it never calls `create`. That is why the check is
   * here and not in the plan.
   *
   * When the two disagree the EXISTING branch wins and its code is left alone — the Branch Code is
   * an identity a super-admin owns (ADR-017), not something an import may rewrite underneath the
   * people already filed against it. The mismatch is reported instead, so a human decides.
   */
  private async findBranch(code: string, key: string): Promise<string | null> {
    const page = await branchService.list(
      { page: 1, pageSize: 500, sortDir: 'asc' },
      { scope: 'organization', userId: this.actorId, branchId: null, departmentId: null, sectionId: null },
    );
    const match = matchBranch(page.items, code, key);
    if (match === null) return null;
    if (match.mismatch !== null) {
      this.note(
        'branch',
        `"${match.mismatch.name}" already exists with code ${match.mismatch.existingCode}, but the ` +
          `sheet places it at ${code}. The existing branch is used as it is and its code is NOT ` +
          'changed; employee codes come from the sheet either way. Correct the branch code by hand ' +
          'if the sheet is right.',
      );
    }
    return match.id;
  }

  private async department(branchId: string, name: string | null): Promise<string | null> {
    const key = orgKey(name);
    if (key === null || name === null) return null;
    const cacheKey = `${branchId}|${key}`;
    const cached = this.departments.get(cacheKey);
    if (cached !== undefined) return cached;

    const scope = this.scope();
    const page = await departmentService.list({ page: 1, pageSize: 500, sortDir: 'asc' }, scope);
    const hit = page.items.find(
      (d) => String(d.branchId) === branchId && orgKey(d.name.ar) === key,
    );
    if (hit !== undefined) {
      const id = String(hit._id);
      this.departments.set(cacheKey, id);
      return id;
    }
    if (this.dryRun) {
      this.created.departments += 1;
      this.departments.set(cacheKey, `dry-run:department:${cacheKey}`);
      return this.departments.get(cacheKey) as string;
    }
    const made = await departmentService.create(
      {
        code: nextFreeCode('DEP', [...page.items.map((d) => d.code), ...this.mintedCodes]),
        name: { ar: name, en: name },
        branchId,
      },
      this.actorId,
    );
    this.mintedCodes.push(made.code);
    this.created.departments += 1;
    const id = String(made._id);
    this.departments.set(cacheKey, id);
    return id;
  }

  /** A section is OPTIONAL — 7% of rows have none, and that is a fact, not a failure. */
  private async section(departmentId: string, name: string | null): Promise<string | null> {
    const key = orgKey(name);
    if (key === null || name === null) return null;
    const cacheKey = `${departmentId}|${key}`;
    const cached = this.sections.get(cacheKey);
    if (cached !== undefined) return cached;

    const scope = this.scope();
    const page = await sectionService.list({ page: 1, pageSize: 1000, sortDir: 'asc' }, scope);
    const hit = page.items.find(
      (s) => String(s.departmentId) === departmentId && orgKey(s.name.ar) === key,
    );
    if (hit !== undefined) {
      const id = String(hit._id);
      this.sections.set(cacheKey, id);
      return id;
    }
    if (this.dryRun) {
      this.created.sections += 1;
      this.sections.set(cacheKey, `dry-run:section:${cacheKey}`);
      return this.sections.get(cacheKey) as string;
    }
    const made = await sectionService.create(
      {
        code: nextFreeCode('SEC', [...page.items.map((x) => x.code), ...this.mintedCodes]),
        name: { ar: name, en: name },
        departmentId,
      },
      this.actorId,
    );
    this.mintedCodes.push(made.code);
    this.created.sections += 1;
    const id = String(made._id);
    this.sections.set(cacheKey, id);
    return id;
  }

  private async jobTitle(name: string | null): Promise<string | null> {
    const key = orgKey(name);
    if (key === null || name === null) return null;
    const cached = this.jobTitles.get(key);
    if (cached !== undefined) return cached;

    const scope = this.scope();
    const page = await jobTitleService.list({ page: 1, pageSize: 1000, sortDir: 'asc' }, scope);
    const hit = page.items.find((t) => orgKey(t.name.ar) === key);
    if (hit !== undefined) {
      const id = String(hit._id);
      this.jobTitles.set(key, id);
      return id;
    }
    if (this.dryRun) {
      this.created.jobTitles += 1;
      this.jobTitles.set(key, `dry-run:jobTitle:${key}`);
      return this.jobTitles.get(key) as string;
    }
    const made = await jobTitleService.create(
      {
        code: nextFreeCode('JOB', [...page.items.map((t) => t.code), ...this.mintedCodes]),
        name: { ar: name, en: name },
        // A grade is required and the workbook has no column for one. `IMPORTED` names where the
        // title came from instead of inventing a grade nobody assigned — HR grades them afterwards,
        // and until they do the value says plainly that this one was never graded.
        jobGrade: 'IMPORTED',
      },
      this.actorId,
    );
    this.mintedCodes.push(made.code);
    this.created.jobTitles += 1;
    const id = String(made._id);
    this.jobTitles.set(key, id);
    return id;
  }

  private scope() {
    return {
      scope: 'organization' as const,
      userId: this.actorId,
      branchId: null,
      departmentId: null,
      sectionId: null,
    };
  }

  private note(what: string, detail: string): void {
    if (this.problems.some((p) => p.detail === detail)) return;
    this.problems.push({ what, detail });
  }
}

/**
 * Allocate the next free `PREFIX-0000` code, counting from what the DATABASE already holds.
 *
 * Seeding from this run's own creation count was a real defect, and CI caught it: unit codes are
 * globally unique, so a SECOND run — the re-run after fixing the rejected rows, say — started again
 * at `DEP-0001` and collided with the department the first run had made. The failure surfaced as a
 * person who could not be imported, with the duplicate-key error buried in their rejection reason.
 */
/**
 * Which existing branch, if any, the sheet's site refers to — by CODE first, then by NAME.
 *
 * The name half is the difference between an import that runs and one that does not.
 * `branchService.create` rejects a duplicate NAME, so a database that already holds "المهندسين"
 * under some other code — every deployment used before the import — makes the create throw. The
 * branch is then never cached, and the SAME failure repeats for every person at that site: one
 * stale branch costs its whole workforce. Matching on code alone is what made that possible.
 *
 * A dry run cannot catch it, because it never calls `create`. That is exactly why this is a pure
 * function with tests of its own rather than a line buried in the I/O path.
 *
 * When the two disagree the EXISTING branch wins and its code is left alone: the Branch Code is an
 * identity a super-admin owns (ADR-017), not something an import may rewrite underneath the people
 * already filed against it. The disagreement is returned so the caller can report it.
 */
export const matchBranch = (
  items: readonly { _id: unknown; code: string; name: { ar: string } }[],
  code: string,
  key: string,
): { id: string; mismatch: { name: string; existingCode: string } | null } | null => {
  const byCode = items.find((b) => b.code === code);
  if (byCode !== undefined) return { id: String(byCode._id), mismatch: null };

  const byName = items.find((b) => orgKey(b.name.ar) === key);
  if (byName === undefined) return null;
  return {
    id: String(byName._id),
    mismatch: { name: byName.name.ar, existingCode: byName.code },
  };
};

export const nextFreeCode = (prefix: string, existing: readonly string[]): string => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'u');
  const highest = existing.reduce((max, code) => {
    const m = pattern.exec(code);
    return m === null ? max : Math.max(max, Number(m[1]));
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
};
