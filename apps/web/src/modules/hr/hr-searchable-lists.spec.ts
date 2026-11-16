// «عاوز اعمل سيرش فكل حاجه موجوده فال hr … بحرف او اتنين و هي تجبلي الباقي منها». Every long list in
// HR is typed into (`SearchableSelect`); a short one stays a plain list, as a short filter of ticks
// does. Read from source: a guard that a long list does not go back to a native one.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEARCH_FROM, valuesMatching } from '../../shared/ui/SearchableSelect';

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.tsx') && !name.endsWith('.spec.tsx') ? [full] : [];
  });
const HR = sources(HERE).map((file) => ({ file: relative(HERE, file), src: readFileSync(file, 'utf8') }));

/** The native lists of a file, each from `<Select` to its `</Select>`. */
const nativeLists = (src: string): string[] => src.match(/<Select\b[\s\S]*?<\/Select>/g) ?? [];
/** Options that are the organization's — branches, departments, sections, jobs. */
const ORG_OPTIONS = /\{\(?\s*(branches|branchOptions|departments|departmentsInBranch|sections|jobTitles|jobTitleOptions|titles)\b/;

describe('HR lists are typed into', () => {
  it('matches what was typed against the name only, Arabic spelling folded', () => {
    const options = [
      { value: '64b1f0cccccccccccccccc01', label: 'أمين خزينة' },
      { value: '64b1f0cccccccccccccccc02', label: 'أخصائي نقل أموال' },
      { value: '64b1f0cccccccccccccccc03', label: 'سائق' },
    ];
    expect(valuesMatching(options, '')).toHaveLength(3);
    expect(valuesMatching(options, 'امين')).toEqual(['64b1f0cccccccccccccccc01']);
    expect(valuesMatching(options, 'اخص')).toEqual(['64b1f0cccccccccccccccc02']);
    // A digit of the id finds nothing: the id is never searched.
    expect(valuesMatching(options, '1')).toEqual([]);
  });

  it('leaves no list of branches, departments, sections or jobs as a native list', () => {
    // A list shown but never picked from (`disabled`: the register page's branch, read from the code)
    // is not one to search.
    const native = HR.filter(({ src }) =>
      nativeLists(src).some((list) => ORG_OPTIONS.test(list) && !/<Select[^>]*\bdisabled\b/.test(list)),
    ).map(({ file }) => file);
    expect(native).toEqual([]);
  });

  it('types into the lists the owner works through', () => {
    const typed = [
      'employee-management/employees/components/actions/CareerDialogs.tsx',
      'employee-management/employees/components/actions/ExitRehireDialogs.tsx',
      'employee-management/employees/components/ExternalEmployeeDialog.tsx',
      'employee-management/employees/components/EmployeeCostCenterCard.tsx',
      'recruitment/applicants/components/ReassignDialog.tsx',
      'recruitment/applicants/components/BulkReassignDialog.tsx',
      'recruitment/applicants/components/ApplicantForm.tsx',
      'recruitment/job-offers/components/OfferTermsForm.tsx',
      'contracts/components/JobPapersDialog.tsx',
      'contracts/pages/ContractCreatePage.tsx',
      'contracts/pages/ContractsListPage.tsx',
      'leave-management/components/RequestLeaveDialog.tsx',
      'leave-management/components/EmployeeLeaveTab.tsx',
      'leave-management/pages/AllRequestsPage.tsx',
      'attendance/pages/DailySheetPage.tsx',
      'attendance/pages/AssignmentsPage.tsx',
      'training/pages/TrainingSessionsPage.tsx',
      'training/components/NominateDialog.tsx',
      'payroll/components/EmployeePayItemsTab.tsx',
    ];
    for (const file of typed) {
      expect(HR.find((s) => s.file === file)?.src, file).toContain('<SearchableSelect');
    }
  });

  // «هنخلي كل الفلترز multi زي checkbox»: a FILTER bar's long lists are ticks to pick several from
  // (`MultiSelect`), typed into from seven options exactly as a single list is — the next test.
  it('types into the filter bars\' lists, several picks at a time', () => {
    const filterBars = ['employee-management/employees/pages/EmployeesListPage.tsx'];
    for (const file of filterBars) {
      const src = HR.find((s) => s.file === file)?.src;
      expect(src, file).toContain('<MultiSelect');
      expect(src, file).not.toContain('<SearchableSelect');
    }
  });

  // «اي خانات صغيره عدد محدود فالسيرش لا لو سيرش علي حجات كتير ماشي»: one rule for both kinds of list.
  it('searches a list of seven or more only — the filters of ticks and the lists alike', () => {
    expect(SEARCH_FROM).toBe(7);
    const box = readFileSync(join(HERE, '../../shared/ui/SearchableSelect.tsx'), 'utf8');
    expect(box).toContain('if (options.length < SEARCH_FROM) {');
    const ticks = readFileSync(join(HERE, '../../shared/ui/MultiSelect.tsx'), 'utf8');
    expect(ticks).toContain('searchThreshold = 7,');
    // No HR filter forces a search box onto a short list.
    for (const { file, src } of HR) expect(src, file).not.toContain('searchThreshold={0}');
  });
});
