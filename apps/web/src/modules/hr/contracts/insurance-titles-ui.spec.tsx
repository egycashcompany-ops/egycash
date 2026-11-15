// «مسميات الوظائف لدى التأمينات» (A28) — a tab of «الإعدادات» beside «نموذج التقديم»: a table typed by
// hand, our job title, its title at social insurance, its occupation code; what «حفظ» sends and what
// it refuses. Read from source where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HR_SETTINGS_HUB, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { SETTINGS_SCREENS } from '../settings/routes';
import { InsuranceJobTitlesPage, foldTitle, isChanged, problemsOf, requestOf, type TypedRow } from './pages/InsuranceJobTitlesPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(HERE, 'pages/InsuranceJobTitlesPage.tsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const row = (key: string, jobTitle: string, insuranceTitle = '', occupationCode = ''): TypedRow => ({ key, jobTitle, insuranceTitle, occupationCode });

describe('«مسميات الوظائف لدى التأمينات»', () => {
  it('is a tab of «الإعدادات» right after «نموذج التقديم», on its own permission', () => {
    const keys = HR_SETTINGS_HUB.tabs.map((tab) => tab.key);
    expect(keys.indexOf('insurance-job-titles')).toBe(keys.indexOf('recruitment-form') + 1);
    expect(HR_SETTINGS_HUB.tabs.find((tab) => tab.key === 'insurance-job-titles')?.permission).toBe('insuranceJobTitle.manage');
    expect(SETTINGS_SCREENS['insurance-job-titles']).toBe(InsuranceJobTitlesPage);
    expect(translate('ar', 'hr.settings.tab.insurance-job-titles')).toBe('مسميات الوظائف لدى التأمينات');
  });

  it('folds a job title as the server matches it', () => {
    expect(foldTitle(' أخصائى عد و فرز ')).toBe(foldTitle('اخصائي عد وفرز'));
    expect(foldTitle('ســائق')).toBe(foldTitle('سائق'));
  });

  it('refuses a row with no title, a title listed twice, and a code form 1 cannot box', () => {
    const problems = problemsOf([
      row('a', 'أمين خزينة', '', '412/101'),
      row('b', 'امين خزينه'),
      row('c', '  '),
      row('d', 'سائق', '', '12a'),
      row('e', 'محاسب', '', '123456'),
    ]);
    expect([...problems]).toEqual([
      ['b', 'twice'],
      ['c', 'title'],
      ['d', 'code'],
    ]);
  });

  it('sends the whole table, trimmed — a row left out is taken off', () => {
    const saved = [row('1', 'أمين خزينة', 'أمين خزينة', '412/101')];
    const typed = [row('1', ' أمين خزينة ', ' أمين خزينة', '412/101 '), row('2', 'سائق', 'سائق مهني', '832/101')];
    expect(isChanged(saved, saved)).toBe(false);
    expect(isChanged(saved, [row('1', 'أمين خزينة ', 'أمين خزينة', '412/101')])).toBe(false);
    expect(requestOf(typed)).toEqual({
      rows: [
        { jobTitle: 'أمين خزينة', insuranceTitle: 'أمين خزينة', occupationCode: '412/101' },
        { jobTitle: 'سائق', insuranceTitle: 'سائق مهني', occupationCode: '832/101' },
      ],
    });
    expect(isChanged(saved, [])).toBe(true);
  });

  it('types each row by hand — our title offered from the system — adds and removes rows, and saves', () => {
    expect(PAGE).toContain('list="insurance-job-names"');
    expect(PAGE).toContain("t('contracts.insuranceTitles.unknown')");
    expect(PAGE).toContain('data-insurance-add');
    expect(PAGE).toContain('onClick={() => remove(row.key)}');
    expect(PAGE).toContain('save.mutateAsync(requestOf(rows))');
    expect(PAGE).toContain('disabled={!changed || problems.size > 0}');
  });

  it('names everything in both languages', () => {
    const used = [...PAGE.matchAll(/t\('([a-zA-Z.-]+)'/g)].map((m) => m[1] ?? '');
    for (const problem of ['title', 'twice', 'code']) used.push(`contracts.insuranceTitles.problem.${problem}`);
    expect(used.length).toBeGreaterThan(10);
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
