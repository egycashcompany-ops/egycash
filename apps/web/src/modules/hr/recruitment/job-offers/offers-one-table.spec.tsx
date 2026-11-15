// «عروض العمل» as one table (A28): «هنشيل الجزء اللي فوق دا خالص و هنخلي الجزء اللي تحت هو البيدج … اي حد
// يخلص كشف الطبي يظهر فيه الحاله ك جاهزون لعرض العمل»; and its filters, «واحده للاداره و واحده للوظيفه و
// واحده للفرع». Read from source where the screen needs a live client.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale, type OrgUnitOptionDto } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { departmentChoices, departmentIdsOf } from './components/OfferFilters';
import { writeOfferPath } from './pages/JobOffersListPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '');
const PAGE = strip(readFileSync(resolve(HERE, 'pages/JobOffersListPage.tsx'), 'utf8'));
const FILTERS = strip(readFileSync(resolve(HERE, 'components/OfferFilters.tsx'), 'utf8'));

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
