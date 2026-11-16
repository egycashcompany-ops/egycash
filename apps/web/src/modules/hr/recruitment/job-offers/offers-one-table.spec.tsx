// «عروض العمل» as one table (A28): «هنشيل الجزء اللي فوق دا خالص و هنخلي الجزء اللي تحت هو البيدج … اي حد
// يخلص كشف الطبي يظهر فيه الحاله ك جاهزون لعرض العمل»; and its filters, «واحده للاداره و واحده للوظيفه و
// واحده للفرع». Read from source where the screen needs a live client.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale, type OrgUnitOptionDto } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { SEARCH_FITS_TEXT, departmentChoices, departmentIdsOf } from './components/OfferFilters';
import { offerPlacement, placementName } from './components/OfferPlacement';
import { writeOfferPath } from './pages/JobOffersListPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '');
const PAGE = strip(readFileSync(resolve(HERE, 'pages/JobOffersListPage.tsx'), 'utf8'));
const FILTERS = strip(readFileSync(resolve(HERE, 'components/OfferFilters.tsx'), 'utf8'));
const READY_PAGE = strip(
  readFileSync(resolve(HERE, '../../employee-management/employees/pages/EmployeesReadyPage.tsx'), 'utf8'),
);
const READY_FILTERS = strip(
  readFileSync(resolve(HERE, '../../employee-management/employees/components/EmployeesReadyFilters.tsx'), 'utf8'),
);

const unit = (id: string, ar: string, parentId: string | null, catalogId: string | null): OrgUnitOptionDto => ({
  id,
  code: id,
  name: { ar, en: ar },
  parentId,
  catalogId,
});
// «الأمن» in two branches (one catalog entry), «الخزينة» in one, and an old unlinked «الأمن».
const DEPARTMENTS = [
  unit('d1', 'الأمن', 'b1', 'c-security'),
  unit('d2', 'الأمن', 'b2', 'c-security'),
  unit('d3', 'الخزينة', 'b1', 'c-treasury'),
  unit('d4', 'الحركة', 'b2', null),
];

describe('«عروض العمل» — one table', () => {
  it('has no queue above the table any more', () => {
    expect(PAGE).not.toContain('AwaitingOfferQueue');
    expect(existsSync(resolve(HERE, 'components/AwaitingOfferQueue.tsx'))).toBe(false);
  });

  it('reads a `waiting` offer as «جاهز لعرض العمل», with «اكتب العرض» on its row', () => {
    expect(translate('ar', 'offers.status.waiting')).toBe('جاهز لعرض العمل');
    expect(PAGE).toContain("o.status === 'waiting' && canCreate");
    expect(PAGE).toContain("t('offers.awaiting.write')");
    expect(PAGE).toContain('e.stopPropagation()');
    expect(writeOfferPath('a1')).toBe('/job-offers/new?applicantId=a1&from=queue');
  });

  it('shows «—» for the number of an offer nobody has written yet', () => {
    expect(PAGE).toMatch(/o\.code === null \? <span className="text-slate-400">—<\/span>/);
  });
});

describe('«عروض العمل» filters — department, job, branch', () => {
  it('lists each company department once, by name', () => {
    expect(departmentChoices(DEPARTMENTS).map((d) => d.name.ar)).toEqual(['الأمن', 'الحركة', 'الخزينة']);
  });

  it('stands a department for every branch copy of it — in the chosen branches when any are', () => {
    const security = departmentChoices(DEPARTMENTS).find((d) => d.name.ar === 'الأمن')?.key ?? '';
    expect(departmentIdsOf([security], DEPARTMENTS, [])).toEqual(['d1', 'd2']);
    expect(departmentIdsOf([security], DEPARTMENTS, ['b2'])).toEqual(['d2']);
    expect(departmentIdsOf([], DEPARTMENTS, [])).toEqual([]);
  });

  it('puts the three beside the status, remembered as the others are, and sends them to the server', () => {
    expect(FILTERS).toContain("t('offers.filters.department')");
    expect(FILTERS).toContain("t('offers.filters.job')");
    expect(FILTERS).toContain('<BranchFilterSelect');
    for (const param of ["'branch'", "'department'", "'job'"]) expect(PAGE).toContain(param);
    expect(PAGE).toContain('branchId: filters.branch');
    expect(PAGE).toContain('jobTitleId: filters.job');
    // A department whose branch copies are not known yet matches nothing, never everything.
    expect(PAGE).toContain('[NO_MATCH]');
  });

  it('names the filters in both languages', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of ['offers.filters.department', 'offers.filters.job', 'recruitment.filters.branch']) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
    expect(translate('ar', 'offers.filters.department')).toBe('الإدارة');
    expect(translate('ar', 'offers.filters.job')).toBe('الوظيفة');
  });
});

// «هنحط الاداره و الوظيفه و الفرع في الجزء اللي تحت … جمب المتقدم و الحالة و الراتب … عشان لازقه في
// تاريخ الانشاء»; and on «جاهزون للتعيين», «الفلتر بتاع الاداره و الوظيفه … تحت جمب العرض و تاريخ القبول».
describe('where an offer places the person', () => {
  const terms = { branchId: 'b-terms', departmentId: 'd-terms', jobTitleId: 'j-terms' };
  const placement = { branchId: 'b-queue', departmentId: 'd-queue', jobTitleId: 'j-queue', sectionId: null };
  const row = (over: Record<string, unknown>) =>
    ({ acceptedSnapshot: null, terms: null, placement, ...over }) as unknown as Parameters<typeof offerPlacement>[0];

  it('reads the accepted terms, else the written terms, else the placement it was queued with', () => {
    const accepted = { terms: { branchId: 'b-acc', departmentId: 'd-acc', jobTitleId: 'j-acc' } };
    expect(offerPlacement(row({ acceptedSnapshot: accepted, terms })).jobTitleId).toBe('j-acc');
    expect(offerPlacement(row({ terms })).departmentId).toBe('d-terms');
    expect(offerPlacement(row({})).branchId).toBe('b-queue');
  });

  it('names a unit, and says what it is when it cannot', () => {
    const list = [{ id: 'd1', name: { ar: 'الأمن', en: 'Security' } }];
    expect(placementName(list, 'd1', 'ar')).toBe('الأمن');
    expect(placementName(list, 'd1', 'en')).toBe('Security');
    expect(placementName(list, null, 'ar')).toBe('—');
    expect(placementName(undefined, 'd1', 'ar')).toBe('…');
    expect(placementName(list, '64a1f0c2e4b0a1b2c3d4e5f6', 'ar')).toBe('#d4e5f6');
  });
});

describe('«عروض العمل» — the table', () => {
  const order = (keys: string[]): number[] => keys.map((k) => PAGE.indexOf(`key: '${k}'`));

  it('shows the branch, department and job after the applicant, under the filters\' own names', () => {
    const [applicant, branch, department, job, status] = order(['applicant', 'branch', 'department', 'job', 'status']);
    expect(applicant).toBeLessThan(branch);
    expect(branch).toBeLessThan(department);
    expect(department).toBeLessThan(job);
    expect(job).toBeLessThan(status);
    expect(PAGE).toContain("header: t('recruitment.filters.branch')");
    expect(PAGE).toContain("header: t('offers.filters.department')");
    expect(PAGE).toContain("header: t('offers.filters.job')");
  });

  it('keeps the salary off the created date: last of the data, beside the row\'s action', () => {
    const [created, salary, write] = order(['createdAt', 'salary', 'write']);
    expect(created).toBeLessThan(salary);
    expect(salary).toBeLessThan(write);
  });

  it('keeps every cell and header on one line', () => {
    expect(PAGE).toContain("className: c.className ?? 'whitespace-nowrap'");
    expect(PAGE).toContain("headerClassName: 'whitespace-nowrap'");
    expect(PAGE).toContain('columns={oneLineColumns}');
  });

  it('sizes the search box to its words', () => {
    expect(SEARCH_FITS_TEXT).toContain('[field-sizing:content]');
    expect(FILTERS).toContain('className={SEARCH_FITS_TEXT}');
    expect(FILTERS).not.toContain('sm:w-72');
  });
});

describe('«جاهزون للتعيين» — department and job', () => {
  it('filters by them as «عروض العمل» does, remembered, and sends them to the server', () => {
    expect(READY_FILTERS).toContain("t('offers.filters.department')");
    expect(READY_FILTERS).toContain("t('offers.filters.job')");
    expect(READY_FILTERS).toContain('departmentChoices(departments)');
    for (const param of ["'department'", "'job'"]) expect(READY_PAGE).toContain(param);
    expect(READY_PAGE).toContain('departmentIdsOf(filters.department, departmentOptions, filters.branchId)');
    expect(READY_PAGE).toContain('[NO_MATCH]');
    expect(READY_PAGE).toContain('jobTitleId: filters.job');
  });

  it('shows them after the offer and before the accepted date, one line each', () => {
    const at = (k: string): number => READY_PAGE.indexOf(`key: '${k}'`);
    expect(at('offer')).toBeLessThan(at('department'));
    expect(at('department')).toBeLessThan(at('job'));
    expect(at('job')).toBeLessThan(at('acceptedAt'));
    expect(READY_PAGE).toContain('columns={oneLineColumns}');
    expect(READY_FILTERS).toContain('className={SEARCH_FITS_TEXT}');
  });
});
