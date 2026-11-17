// «طباعة العقد والمستندات» on the employee's profile (A28) — where the tab is, who sees it, and
// what renewing and printing do. Read from source: the tab needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { EMPLOYEE_READ_ONLY, renewalTerm } from './components/EmployeePapersTab';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const PROFILE = code('../employee-management/employees/pages/EmployeeProfilePage.tsx');
const TAB = code('components/EmployeePapersTab.tsx');

describe('the tab on the employee\'s profile', () => {
  it('sits beside «العقود», for whoever may print contracts', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'contracts', 'papers'/);
    expect(PROFILE).toContain("if (k === 'papers') return prints;");
    expect(PROFILE).toContain("{tab === 'papers' && can('contract.print') && (");
    expect(translate('ar', 'employees.tabs.papers')).toBe('طباعة العقد والمستندات');
  });
});

describe('renewing', () => {
  it('runs one year from the day after the contract ends', () => {
    expect(renewalTerm('2027-11-14', '2026-11-11')).toEqual({ startDate: '2027-11-15', endDate: '2028-11-14' });
    expect(renewalTerm('2028-02-28', '2026-11-11')).toEqual({ startDate: '2028-02-29', endDate: '2029-02-28' });
  });

  it('runs one year from today for a contract with no end', () => {
    expect(renewalTerm(null, '2026-11-11')).toEqual({ startDate: '2026-11-11', endDate: '2027-11-10' });
  });

  it('is the contract\'s own renewal, behind its own key, for a contract in force', () => {
    expect(TAB).toContain('<Can permission="contract.renew">');
    expect(TAB).toContain("const RENEWABLE = new Set(['active', 'signed']);");
    expect(TAB).toContain('<AmendRenewDialog');
    expect(TAB).toContain('mode="renew"');
  });
});

describe('printing', () => {
  it('prints what is ticked, or one paper alone, the tab opened on the click itself', () => {
    expect(TAB).toContain('onPrint={() => void run([p.key])}');
    expect(TAB).toContain('void run(selected.map((p) => p.key))');
    expect(TAB.indexOf('openPrintWindow(')).toBeLessThan(TAB.indexOf('print.mutateAsync('));
  });

  it('starts with every paper ticked but one the job is only offered — and a save leaves the ticks be', () => {
    expect(TAB).toContain('setChosen(new Set(data.papers.filter((p) => !p.optional).map((p) => p.key)))');
    expect(TAB).toContain('}, [papersKey]);');
  });

  it('prints what was just typed as typed', () => {
    expect(TAB.indexOf('await chain.current;')).toBeLessThan(TAB.indexOf('print.mutateAsync('));
  });

  it('names everything in both languages', () => {
    const used = [...TAB.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});

/**
 * «في شاشه الموظفين لما بندخل علي شخص … نخلي في امكانيه للتعديل زي معملنا قبل كدا تحت الtoggle تعديل
 * و طباعه و تحت يظهر البيانات عشان التعديل و النص التاني الفورم».
 */
describe('«تعديل» on the employee\'s papers', () => {
  it('puts «تعديل» and «طباعة» under every paper, the opened one marked', () => {
    expect(TAB).toContain('onEdit={() => setOpened(p.key)}');
    expect(TAB).toContain('active={active?.key === p.key}');
    // The contract opens first.
    expect(TAB).toContain('const active = papers.find((p) => p.key === opened) ?? papers[0] ?? null;');
  });

  it('shows below, side by side, the paper\'s values to change and the paper as it prints', () => {
    expect(TAB).toContain('<div className="grid gap-4 lg:grid-cols-2">');
    expect(TAB.indexOf('<PaperValuesForm')).toBeLessThan(TAB.indexOf('data-employee-preview'));
    expect(TAB).toContain('.mutateAsync(active.key)');
    expect(TAB).toContain('}, [active?.key, shape]);');
  });

  it('saves each change for the employee, one after another, each with the version the last returned', () => {
    expect(TAB).toContain('chain.current = chain.current.then(');
    expect(TAB).toContain('version: current.valuesVersion');
    expect(TAB).toContain('onSave={saveValue}');
  });

  it('shows the contract they hold as issued — its values never typed in here', () => {
    expect(TAB).toContain('values={active.locked ? data.contractValues : data.values}');
    expect(TAB).toContain('disabled={active.locked}');
    expect(TAB).toContain("t('employeePapers.lockedHint', { code: held.code })");
    expect([...EMPLOYEE_READ_ONLY].sort()).toEqual(['contract.code', 'contract.endDate', 'contract.startDate', 'employee.employeeCode']);
  });

  it('marks a value typed in for the employee, not the candidate', () => {
    expect(TAB).toContain("overriddenHint={t('employeePapers.overridden')}");
    expect(translate('ar', 'employeePapers.overridden')).toBe('مُدخلة لهذا الموظف');
  });
});
