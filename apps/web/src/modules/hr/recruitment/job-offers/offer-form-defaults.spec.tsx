// «اكتب العرض» opens filled in (A28): «عاوزو يجيب المسمي الوظيفي و الاداره و الفرع و المدير المباشر
// اوتوماتيك … المسمي الوظيفي input data list … المدير المباشر … ولو مش باين مين المدير اقدر اكتبو انا
// مانيوال … نوع التوظيف هيبقا by default دوام كامل … الراتب … المسميات الوظيفيه». Read from source where
// the form needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale, type OfferDefaultsDto, type OfferTermsDto } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { salaryOfJob, startingManager } from './components/OfferTermsForm';

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '');
const FORM = strip(readFileSync(resolve(HERE, 'components/OfferTermsForm.tsx'), 'utf8'));
const PAGE = strip(readFileSync(resolve(HERE, 'pages/JobOfferFormPage.tsx'), 'utf8'));
const MANAGER = strip(readFileSync(resolve(HERE, 'components/ManagerPicker.tsx'), 'utf8'));
const PICKER = strip(readFileSync(resolve(HERE, '../shared/UserPicker.tsx'), 'utf8'));
const VIEW = strip(readFileSync(resolve(HERE, 'components/TermsView.tsx'), 'utf8'));

const defaults: OfferDefaultsDto = {
  jobTitleId: 'j1',
  departmentId: 'd1',
  branchId: 'b1',
  sectionId: null,
  manager: { id: 'u9', name: { ar: 'هشام عبد العزيز', en: 'Hesham Abdelaziz' } },
  employmentType: 'fullTime',
  salary: { amount: 9500, currency: 'EGP' },
  jobSalaries: [
    { jobTitleId: 'j1', amount: 9500, currency: 'EGP' },
    { jobTitleId: 'j2', amount: 11000, currency: 'EGP' },
  ],
};

describe('«اكتب العرض» starts from the candidate', () => {
  it('takes a job\'s salary from its «الراتب الثابت», and none from a job without one', () => {
    expect(salaryOfJob(defaults.jobSalaries, 'j2')).toEqual({ amount: '11000', currency: 'EGP' });
    expect(salaryOfJob(defaults.jobSalaries, 'j3')).toBeNull();
  });

  it('starts with the direct manager from the chart — or, revising, the offer\'s own manager', () => {
    expect(startingManager(null, defaults, 'ar' as Locale)).toEqual({ id: 'u9', label: 'هشام عبد العزيز' });
    expect(startingManager(null, null, 'ar' as Locale)).toBeNull();
    const offer = { managerId: null, managerName: 'سامح فؤاد' } as OfferTermsDto;
    expect(startingManager(offer, defaults, 'ar' as Locale)).toEqual({ id: '', label: 'سامح فؤاد' });
    expect(startingManager({ ...offer, managerId: 'u2' }, defaults, 'ar' as Locale)).toEqual({ id: 'u2', label: '' });
  });

  it('fills the job, department, branch, «دوام كامل» and the salary, and the page waits for them', () => {
    expect(FORM).toContain("useState(initial?.jobTitleId ?? start?.jobTitleId ?? '')");
    expect(FORM).toContain("useState(initial?.departmentId ?? start?.departmentId ?? '')");
    expect(FORM).toContain("useState(initial?.branchId ?? start?.branchId ?? '')");
    expect(FORM).toContain("initial?.employmentType ?? start?.employmentType ?? 'fullTime'");
    expect(PAGE).toContain('defaults={isCreate ? (defaults.data ?? null) : null}');
    expect(PAGE).toContain("key={isCreate ? (applicant?.id ?? '') : 'revise'}");
  });

  it('types into the job — and the salary follows it until somebody types the salary', () => {
    expect(FORM).toContain('<Combobox');
    expect(FORM).toContain('onChange={chooseJob}');
    expect(FORM).toMatch(/const chooseJob = [\s\S]*?if \(salaryTyped\) return;[\s\S]*?salaryOfJob\(jobSalaries, next\)/);
    expect(FORM).toContain('setSalaryTyped(true)');
  });

  it('lists only the chosen branch\'s departments, and drops another branch\'s department', () => {
    expect(FORM).toContain("d.parentId === branchId");
    expect(FORM).toContain("if (department !== undefined && department.parentId !== next) setDepartmentId('')");
  });

  it('keeps a manager typed by name when nobody on the system matches, and shows it on the offer', () => {
    expect(MANAGER).toContain("typedName={{ use: (typed) => t('offers.form.managerUseName', { name: typed })");
    expect(PICKER).toContain("onChange({ id: '', label: term.trim() })");
    expect(FORM).toContain("managerName: manager !== null && manager.id === '' ? manager.label : null");
    expect(VIEW).toContain("terms.managerName ?? '—'");
  });

  it('words it in both languages, the typed name in its place', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of ['offers.form.jobTitleSearch', 'offers.form.managerNoAccount', 'offers.form.managerSearch']) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
      expect(translate(locale, 'offers.form.managerUseName', { name: 'سامح فؤاد' })).toContain('«سامح فؤاد»');
    }
  });
});
