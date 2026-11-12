// «مسميات الوظائف لدى التأمينات» (A28) — a tab of «الإعدادات» beside «نموذج التقديم»: every job title
// beside its title at social insurance, and what «حفظ» sends. Read from source where the screen
// needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HR_SETTINGS_HUB, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { SETTINGS_SCREENS } from '../settings/routes';
import { InsuranceJobTitlesPage, changedTitles } from './pages/InsuranceJobTitlesPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(HERE, 'pages/InsuranceJobTitlesPage.tsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

describe('«مسميات الوظائف لدى التأمينات»', () => {
  it('is a tab of «الإعدادات» right after «نموذج التقديم», on its own permission', () => {
    const keys = HR_SETTINGS_HUB.tabs.map((tab) => tab.key);
    expect(keys.indexOf('insurance-job-titles')).toBe(keys.indexOf('recruitment-form') + 1);
    expect(HR_SETTINGS_HUB.tabs.find((tab) => tab.key === 'insurance-job-titles')?.permission).toBe('insuranceJobTitle.manage');
    expect(SETTINGS_SCREENS['insurance-job-titles']).toBe(InsuranceJobTitlesPage);
    expect(translate('ar', 'hr.settings.tab.insurance-job-titles')).toBe('مسميات الوظائف لدى التأمينات');
  });

  it('sends only the rows that changed, trimmed — an empty one takes the title off', () => {
    const saved = [
      { jobTitleId: 'leader', insuranceTitle: 'مشرف نقل نقدية' },
      { jobTitleId: 'guard', insuranceTitle: '' },
      { jobTitleId: 'coder', insuranceTitle: 'مبرمج' },
    ];
    expect(changedTitles(saved, new Map())).toEqual([]);
    const typed = new Map([
      ['leader', 'مشرف نقل نقدية '],
      ['guard', ' فرد أمن'],
      ['coder', ''],
    ]);
    expect(changedTitles(saved, typed)).toEqual([
      { jobTitleId: 'guard', insuranceTitle: 'فرد أمن' },
      { jobTitleId: 'coder', insuranceTitle: '' },
    ]);
  });

  it('shows each job beside a box for its title, and saves the changed rows', () => {
    expect(PAGE).toContain('data-insurance-row={job.jobTitleId}');
    expect(PAGE).toContain('onChange={(e) => set(job.jobTitleId, e.target.value)}');
    expect(PAGE).toContain('save.mutateAsync({ titles: changed })');
    expect(PAGE).toContain('disabled={changed.length === 0}');
  });

  it('names everything in both languages', () => {
    const used = [...PAGE.matchAll(/t\('([a-zA-Z.-]+)'/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(8);
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
