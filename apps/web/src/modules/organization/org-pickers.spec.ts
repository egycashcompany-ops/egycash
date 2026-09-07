// An org-unit picker must be able to show EVERY unit, and each row must be identifiable.
//
// WHY THIS EXISTS. Both halves failed at once on a live deployment, and each hid the other.
//
// `useDepartmentOptions` and `useSectionOptions` were fed by the PAGINATED list endpoint with a
// hardcoded `pageSize: 100`, and `MAX_PAGE_SIZE` is 100 — so exactly one page was ever fetched.
// On a company with 139 sections the 101st onwards were dropped with no error and no indication:
// a picker simply missing entries, and `SectionsListPage`'s department-name lookup falling through
// to printing a raw ObjectId in the table. `/options` exists precisely for this and pages to
// exhaustion server-side; the two hooks were the only org readers not using it.
//
// The second half is that every picker rendered the NAME alone. Two branches each hold a
// department called «الحركة» and a section called «التشغيل», so distinct rows read as one name
// repeated — which is what made the truncation look like duplication rather than data loss.
//
// This guard is deliberately crude. It cannot prove a dropdown renders correctly; it holds the two
// lines that were actually crossed: no picker is fed by a capped page, and no picker labels an org
// unit by name alone.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgUnitLabel } from '../../shared/lib/format';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = resolve(HERE, '../..');
const references = readFileSync(join(HERE, 'shared/references.ts'), 'utf8');

/** Every file that renders a department or section option, and the variable it maps over. */
const PICKERS: readonly (readonly [string, readonly string[]])[] = [
  ['modules/hr/attendance/pages/DailySheetPage.tsx', ['s']],
  ['modules/hr/employee-management/employees/components/actions/CareerDialogs.tsx', ['d', 'sec']],
  ['modules/hr/employee-management/employees/components/actions/ExitRehireDialogs.tsx', ['d', 'sec']],
  ['modules/hr/employee-management/employees/pages/DirectRegisterPage.tsx', ['d', 'sec']],
  ['modules/organization/shared/UnitFormPage.tsx', ['d']],
  ['modules/organization/sections/pages/SectionsListPage.tsx', ['d']],
];

describe('org-unit pickers', () => {
  it('are fed by the options endpoints, never by a capped page of the list', () => {
    // The list endpoint caps at MAX_PAGE_SIZE and these hooks fetch a single page, so asking it
    // for a picker's contents is asking for "the first hundred, silently".
    expect(references).not.toMatch(/\/platform\/departments\$\{buildQuery/);
    expect(references).not.toMatch(/\/platform\/sections\$\{buildQuery/);
    expect(references).not.toMatch(/pageSize: 100/);

    for (const hook of ['useDepartmentOptions', 'useSectionOptions']) {
      const body = references.slice(references.indexOf(`export const ${hook}`));
      const decl = body.slice(0, body.indexOf('});'));
      expect(decl, `${hook} must read the exhaustive options endpoint`).toMatch(
        /queryFn: list(Department|Section)Options/,
      );
      // It narrows in the browser off `parentId`, which is the contract the options DTO promises.
      expect(decl, `${hook} must narrow on parentId`).toContain('parentId');
    }
  });

  it('label every department and section with its code, not its name alone', () => {
    for (const [file, vars] of PICKERS) {
      const source = readFileSync(join(WEB_SRC, file), 'utf8');
      for (const v of vars) {
        expect(source, `${file} still labels ${v} by name alone`).not.toContain(
          `localized(${v}.name, locale)`,
        );
        expect(source, `${file} must label ${v} with orgUnitLabel`).toContain(
          `orgUnitLabel(${v}, locale)`,
        );
      }
    }
  });

  it('show the code as a column on the two lists where names repeat', () => {
    for (const page of [
      'modules/organization/departments/pages/DepartmentsListPage.tsx',
      'modules/organization/sections/pages/SectionsListPage.tsx',
    ]) {
      expect(readFileSync(join(WEB_SRC, page), 'utf8'), `${page} needs a code column`).toContain(
        "key: 'code'",
      );
    }
  });
});

describe('orgUnitLabel', () => {
  const unit = { code: 'DEP-0007', name: { ar: 'الحركة', en: 'Fleet' } };

  it('carries the code, so two units sharing a name are still distinguishable', () => {
    const a = orgUnitLabel(unit, 'ar');
    const b = orgUnitLabel({ ...unit, code: 'DEP-0012' }, 'ar');
    expect(a).toContain('الحركة');
    expect(a).toContain('DEP-0007');
    expect(a).not.toEqual(b);
  });

  it('renders the reader’s language', () => {
    expect(orgUnitLabel(unit, 'en')).toBe('Fleet — DEP-0007');
    expect(orgUnitLabel(unit, 'ar')).toBe('الحركة — DEP-0007');
  });
});
