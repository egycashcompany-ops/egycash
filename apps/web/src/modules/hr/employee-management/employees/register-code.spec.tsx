// «تسجيل موظف» — the code first, the branch from the code, the department from the job title.
//
// «عايز أول حاجة قبل الاسم الكامل (عربي) تبقي كود الموظف وتكتب تحته أخر كود موجود … وأول لما أكتب
// الكود تعرف على طول الفرع بتاعه … ولما الفرع يتحدد تفلتر … وأنا لو أخترت المسمي الوظيفي يختار على
// طول الإدارة والقسم التابع ليها». The rules are pure and tested as such; where they sit on the form
// is read from the page's source, since the page needs a live client to render.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskEmployeeCodeBranch, type JobTitlePlacementDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { branchOfCode, orderTitlesForBranch, placementForTitle } from './lib/register-code';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'pages/DirectRegisterPage.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const BRANCHES = [
  { id: 'b-010', code: '010' },
  { id: 'b-070', code: '070' },
];

describe('the code names its branch', () => {
  it('reads the branch off the first three digits, as soon as there are three', () => {
    expect(branchOfCode('010', BRANCHES)?.id).toBe('b-010');
    expect(branchOfCode('0702863', BRANCHES)?.id).toBe('b-070');
    expect(branchOfCode('01', BRANCHES)).toBeUndefined();
    expect(branchOfCode('7772863', BRANCHES)).toBeUndefined();
  });

  it('states the last code by its number alone — «xxx2862», not the next one', () => {
    expect(maskEmployeeCodeBranch('0702862')).toBe('xxx2862');
    expect(translate('ar', 'employees.register.lastCode', { code: 'xxx2862' })).toBe('آخر كود مسجَّل: xxx2862');
  });
});

describe('the job title fills in the department and section', () => {
  const placements: JobTitlePlacementDto[] = [
    { jobTitleId: 'driver', departmentId: 'd-move', sectionId: 's-cars', employees: 40 },
    { jobTitleId: 'guard', departmentId: 'd-sec', sectionId: null, employees: 12 },
    { jobTitleId: 'gone', departmentId: 'd-closed', sectionId: null, employees: 3 },
  ];
  const departments = [{ id: 'd-move' }, { id: 'd-sec' }];

  it('picks where most of the branch\'s people with that title sit', () => {
    expect(placementForTitle('driver', placements, departments)).toEqual({
      departmentId: 'd-move',
      sectionId: 's-cars',
    });
    expect(placementForTitle('guard', placements, departments)).toEqual({ departmentId: 'd-sec', sectionId: '' });
  });

  it('fills in nothing for a title nobody holds there, or a department the branch no longer offers', () => {
    expect(placementForTitle('clerk', placements, departments)).toBeNull();
    expect(placementForTitle('gone', placements, departments)).toBeNull();
  });

  it('offers the branch\'s own titles first, most-held first, and hides none', () => {
    const titles = [{ id: 'clerk' }, { id: 'guard' }, { id: 'driver' }];
    const { here, elsewhere } = orderTitlesForBranch(titles, placements);
    expect(here.map((t) => t.id)).toEqual(['driver', 'guard']);
    expect(elsewhere.map((t) => t.id)).toEqual(['clerk']);
  });
});

describe('the form', () => {
  it('asks for the code first, before the Arabic full name', () => {
    const identity = PAGE.slice(PAGE.indexOf("t('employees.personal.identity')"));
    const codeAt = identity.indexOf("label={t('employees.register.code')}");
    expect(codeAt).toBeGreaterThan(-1);
    expect(codeAt).toBeLessThan(identity.indexOf("t('applicants.form.fullNameAr')"));
    expect(identity.slice(codeAt, identity.indexOf('</Field>', codeAt))).toContain('rule="integer"');
  });

  it('takes the branch from the code and never lets it be picked apart from it', () => {
    expect(PAGE).toContain('const codeBranch = branchOfCode(code, branches);');
    expect(PAGE).toContain("const branchId = codeBranch?.id ?? '';");
    expect(PAGE).toContain('<Select value={branchId} disabled>');
    expect(PAGE).not.toContain('setBranchId');
  });

  it('narrows the lists to the branch, and fills them from the job title', () => {
    expect(PAGE).toContain("useDepartmentOptions(branchId === '' ? undefined : branchId)");
    expect(PAGE).toContain('useJobTitlePlacements(branchId)');
    expect(PAGE).toContain('onChange={(e) => pickJobTitle(e.target.value)}');
    expect(PAGE).toContain('placementForTitle(id, placements, departments)');
  });

  it('refuses to submit a code that names no branch or whose number is taken, and sends the code', () => {
    expect(PAGE).toContain(
      'if (!codeShaped || codeBranch === undefined || checked === undefined || checked.takenBy !== null) {',
    );
    expect(PAGE).toMatch(/entryStatus,\s*code,\s*\};/);
  });
});

describe('translations', () => {
  it('names every new message in both languages', () => {
    const keys = [
      'employees.register.code',
      'employees.register.lastCode',
      'employees.register.codeBranch',
      'employees.register.codeNoBranch',
      'employees.register.codeTaken',
      'employees.register.codeRequired',
      'employees.register.branchFromCode',
      'employees.register.typeCodeFirst',
      'employees.register.titlesInBranch',
      'employees.register.titlesOther',
    ];
    for (const locale of ['en', 'ar'] as Locale[]) {
      for (const key of keys) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
