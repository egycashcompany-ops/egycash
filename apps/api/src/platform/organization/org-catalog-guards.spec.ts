// P-ORG-2 — the properties that make a company-wide catalog safe to add to a live org chart.
//
// Three pressures act on this feature, and each has a guard below:
//
//   1. THE DATA SCOPE. The obvious version of "one department, not seven" is to collapse the seven
//      rows into one. That would silently widen every department-scoped reader from their own
//      branch to the whole company: `departments.branchId` being required is the ONLY thing
//      confining a department scope today (`BaseRepository.scopeFilter` emits one clause, and for
//      the `department` scope that clause is the department id alone). Twenty-odd collections
//      filter that way. So the rows stay, and these guards hold them in place.
//   2. THE UNIQUE INDEX. `{branchId, catalogId}` is what stops the duplication returning through
//      the create form, and it is only correct while it is PARTIAL on a linked `catalogId` — a
//      full index would refuse the second unlinked department in a branch.
//   3. THE PERMISSION SURFACE. A catalog is a new screen, and a new screen invites new permission
//      keys. None were added: administering the company's departments is the authority that already
//      exists, and splitting it would let somebody add a department to a branch while being
//      forbidden to say what that department is.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { platformPermissions } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const DEPARTMENT_MODEL = read('./departments/department.model.ts');
const SECTION_MODEL = read('./sections/section.model.ts');
const DEPARTMENT_REPO = stripComments(read('./departments/department.repository.ts'));
const SECTION_REPO = stripComments(read('./sections/section.repository.ts'));
const CATALOG_MODEL = stripComments(read('./department-catalog/department-catalog.model.ts'));
const SECTION_CATALOG_MODEL = stripComments(read('./section-catalog/section-catalog.model.ts'));
const CATALOG_REPO = stripComments(read('./department-catalog/department-catalog.repository.ts'));
const SECTION_CATALOG_REPO = stripComments(read('./section-catalog/section-catalog.repository.ts'));
const CATALOG_HTTP = stripComments(read('./shared/org-catalog.http.ts'));
const CATALOG_SERVICE = stripComments(read('./shared/org-catalog.service.ts'));
const DEPARTMENT_SERVICE = stripComments(read('./departments/department.service.ts'));
const SECTION_SERVICE = stripComments(read('./sections/section.service.ts'));
const CLI = stripComments(read('../../migrate-org-catalog.cli.ts'));
const APPLY = stripComments(read('../../org-catalog-migration/apply.ts'));

describe('nobody moves — the branch rows keep every scope axis they had', () => {
  /** Pressure 1. The day `branchId` stops being required is the day department scopes go company-wide. */
  it('keeps branchId required on both units', () => {
    expect(DEPARTMENT_MODEL).toMatch(/branchId:\s*\{[^}]*required:\s*true/);
    expect(SECTION_MODEL).toMatch(/branchId:\s*\{[^}]*required:\s*true/);
    expect(SECTION_MODEL).toMatch(/departmentId:\s*\{[^}]*required:\s*true/);
  });

  it('keeps the branch data-scope wiring on both repositories', () => {
    expect(DEPARTMENT_REPO).toContain("branchField: 'branchId'");
    expect(SECTION_REPO).toContain("branchField: 'branchId'");
  });

  /** A link, not an identity: a row with no catalog entry is a department only that branch has. */
  it('adds catalogId as nullable, on both', () => {
    expect(DEPARTMENT_MODEL).toMatch(/catalogId:\s*\{[^}]*default:\s*null/);
    expect(SECTION_MODEL).toMatch(/catalogId:\s*\{[^}]*default:\s*null/);
    expect(DEPARTMENT_MODEL).not.toMatch(/catalogId:\s*\{[^}]*required:\s*true/);
    expect(SECTION_MODEL).not.toMatch(/catalogId:\s*\{[^}]*required:\s*true/);
  });
});

describe('the unique index that stops the duplication coming back', () => {
  /**
   * Pressure 2. `$type: 'objectId'` is what excludes unlinked rows. Without it, two departments in
   * one branch that name no catalog entry both key on `(branchId, null)` and the second is refused
   * — on a deployment that has no catalog at all.
   */
  it('is unique, partial, and excludes rows that name no entry', () => {
    for (const [model, name, parent] of [
      [DEPARTMENT_MODEL, 'ux_branch_catalog', 'branchId'],
      [SECTION_MODEL, 'ux_department_catalog', 'departmentId'],
    ] as const) {
      const index = model.slice(model.indexOf(`{ ${parent}: 1, catalogId: 1 }`));
      expect(index, name).toContain('unique: true');
      expect(index, name).toContain(name);
      expect(index, name).toContain("catalogId: { $type: 'objectId' }");
      expect(index, name).toContain('isDeleted: false');
    }
  });

  /** `autoIndex` is off in production, so the index needs a deploy step or it never exists there. */
  it('is built at boot rather than left to autoIndex', () => {
    const bootstrap = read('../kernel/bootstrap.ts');
    expect(bootstrap).toContain('migrateOrgCatalogIndexes');
    const migration = read('./org-catalog-indexes.ts');
    expect(migration).toContain('ux_branch_catalog');
    expect(migration).toContain('ux_department_catalog');
  });
});

describe('a catalog entry is not an org unit', () => {
  /** No branch, no manager, no path: it is the company's word for a kind of department. */
  it('carries no branch, no manager and no materialized path', () => {
    for (const model of [CATALOG_MODEL, SECTION_CATALOG_MODEL]) {
      for (const forbidden of ['branchId', 'managerId', 'actingManager', 'path:']) {
        expect(model, forbidden).not.toContain(forbidden);
      }
    }
  });

  /** Organization-wide, exactly as the cost-centre and job-title catalogs are. */
  it('is scoped to the organization, not to a branch', () => {
    expect(CATALOG_REPO).toContain('super(DepartmentCatalogModel, {})');
    expect(SECTION_CATALOG_REPO).toContain('super(SectionCatalogModel, {})');
    expect(CATALOG_REPO).not.toContain('branchField');
    expect(SECTION_CATALOG_REPO).not.toContain('branchField');
  });

  /** A section entry belongs to a company-wide department, never to one branch's copy of it. */
  it('hangs a section entry off a department ENTRY', () => {
    expect(SECTION_CATALOG_MODEL).toMatch(/departmentCatalogId:\s*\{[^}]*required:\s*true/);
    expect(SECTION_CATALOG_MODEL).not.toMatch(/\bdepartmentId\b/);
  });
});

describe('no new permission was invented', () => {
  /** Pressure 3. The catalog routes authorize the UNIT's keys. */
  it('gates the catalogs on the same keys the units already use', () => {
    expect(CATALOG_HTTP).toContain('`${r}.view`');
    expect(CATALOG_HTTP).toContain('`${r}.create`');
    expect(read('./department-catalog/department-catalog.controller.ts')).toContain(
      "resource: 'department'",
    );
    expect(read('./section-catalog/section-catalog.controller.ts')).toContain(
      "resource: 'section'",
    );
  });

  it('adds no departmentCatalog or sectionCatalog permission to the registry', () => {
    const keys = platformPermissions.map((p) => p.key);
    expect(keys.filter((key) => key.toLowerCase().includes('catalog'))).toEqual([]);
  });
});

describe('one name, kept true everywhere it appears', () => {
  /** A rename that stopped at the catalog would put the screens back to disagreeing. */
  it('carries a rename down to the rows that copied it', () => {
    expect(CATALOG_SERVICE).toContain('renameLinked');
    expect(DEPARTMENT_REPO).toContain('renameByCatalog');
    expect(SECTION_REPO).toContain('renameByCatalog');
  });

  /** Deleting the definition under the rows citing it would leave them meaning nothing. */
  it('refuses to delete an entry a branch still declares', () => {
    expect(CATALOG_SERVICE).toContain('hasDependents');
    expect(DEPARTMENT_REPO).toContain('existsWithCatalog');
    expect(SECTION_REPO).toContain('existsWithCatalog');
    expect(read('./index.ts')).toContain('hasDependents');
  });

  /** A row created against an entry takes the entry's spelling rather than re-typing it. */
  it('copies the name from the entry on create', () => {
    expect(DEPARTMENT_SERVICE).toContain('name: catalog.name');
    expect(SECTION_SERVICE).toContain('name: catalog.name');
  });

  /** A section may only declare an entry belonging to its own department's entry. */
  it('refuses a section entry from another company-wide department', () => {
    expect(SECTION_SERVICE).toContain('departmentCatalogId');
    expect(SECTION_SERVICE).toContain('different company-wide department');
  });
});

describe('the migration reads before it writes', () => {
  /** A migration that wrote by default is one an operator runs against the wrong database once. */
  it('is a dry run unless --write is typed', () => {
    expect(CLI).toContain("process.argv.includes('--write')");
    expect(APPLY).toContain('if (!options.write || plan.problems.length > 0) return report;');
  });

  /** Refusal is total: one problem anywhere and nothing is written. There is no partial mode. */
  it('writes nothing at all when anything is wrong', () => {
    expect(APPLY).toContain('plan.problems.length > 0');
    expect(APPLY).not.toContain('skipProblems');
    expect(APPLY).not.toContain('--force');
  });

  /** Booting sends setup links to every employee without a login. Guarded before the boot. */
  it('refuses to run while the boot would message the workforce', () => {
    expect(CLI).toContain("assertLoginProvisioningDisabled('migrate:org-catalog')");
    expect(CLI.indexOf('assertLoginProvisioningDisabled')).toBeLessThan(
      CLI.indexOf('bootPlatform('),
    );
  });

  /** A merge only ever happens because a human typed it — nothing is inferred. */
  it('merges nothing unless asked', () => {
    expect(CLI).toContain('--merge');
    expect(read('../../org-catalog-migration/plan.ts')).toContain(
      'requests: readonly MergeRequest[] = []',
    );
  });
});
