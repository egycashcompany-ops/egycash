// Guards for the job places' indexes (P-ORG-3 §3). Read as source, as `org-catalog-guards.spec.ts`
// reads the catalogs': the property under guard is that the constraint is DECLARED and BUILT, and a
// model import would not tell a missing boot step from a present one.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), 'utf8');

describe('job places — the constraints behind "once"', () => {
  it('a job sits in one place once, among the living', () => {
    const model = read('./job-place.model.ts');
    const index = model.slice(model.indexOf('{ jobTitleId: 1, departmentCatalogId: 1, sectionCatalogId: 1 }'));
    expect(index).toContain('unique: true');
    expect(index).toContain('ux_jobTitleId_departmentCatalogId_sectionCatalogId');
    expect(index).toContain('isDeleted: false');
  });

  it('a department is filled once — the mark is unique per department entry', () => {
    const model = read('./job-place-fill.model.ts');
    expect(model).toContain("{ departmentCatalogId: 1 }, { unique: true, name: 'ux_departmentCatalogId' }");
  });

  /** `autoIndex` is off in production; the fill's race guard IS this index, so it is built at boot. */
  it('is built at boot, before the module seeds that run the fill', () => {
    const bootstrap = read('../../kernel/bootstrap.ts');
    const built = bootstrap.indexOf('migrateJobPlaceIndexes()');
    expect(built).toBeGreaterThan(-1);
    // The module seeds run after the platform migrations; HR's seed is where the fill runs.
    expect(built).toBeLessThan(bootstrap.indexOf('.seed'));
  });
});
