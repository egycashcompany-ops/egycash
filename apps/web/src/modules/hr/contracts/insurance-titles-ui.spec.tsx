// «مسميات الوظائف لدى التأمينات» (A28) — a tab of «الإعدادات» beside «نموذج التقديم»: every job of the
// company is a row, and «تعديل» beside it opens a small popup — our title fixed, its title at social
// insurance and its occupation code typed. What the popup sends and what it refuses; read from source
// where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HR_SETTINGS_HUB, type InsuranceJobTitleRowDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { SETTINGS_SCREENS } from '../settings/routes';
import { InsuranceJobTitlesPage, isChanged, isOccupationCode, matchesSearch, requestOf } from './pages/InsuranceJobTitlesPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(HERE, 'pages/InsuranceJobTitlesPage.tsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const row: InsuranceJobTitleRowDto = { jobTitleId: 'j1', jobTitle: 'أمين خزينة', insuranceTitle: 'أمين خزينة', occupationCode: '412/101' };

describe('«مسميات الوظائف لدى التأمينات»', () => {
  it('is a tab of «الإعدادات» right after «نموذج التقديم», on its own permission', () => {
    const keys = HR_SETTINGS_HUB.tabs.map((tab) => tab.key);
    expect(keys.indexOf('insurance-job-titles')).toBe(keys.indexOf('recruitment-form') + 1);
    expect(HR_SETTINGS_HUB.tabs.find((tab) => tab.key === 'insurance-job-titles')?.permission).toBe('insuranceJobTitle.manage');
    expect(SETTINGS_SCREENS['insurance-job-titles']).toBe(InsuranceJobTitlesPage);
    expect(translate('ar', 'hr.settings.tab.insurance-job-titles')).toBe('مسميات الوظائف لدى التأمينات');
  });

  it('lists every job as it comes — no row is added or taken off here', () => {
    expect(PAGE).toContain('rows.map((row) => (');
    expect(PAGE).not.toContain('data-insurance-add');
    expect(PAGE).not.toContain('ghost-danger');
    expect(PAGE).toContain('onClick={() => setEditing(row)}');
  });

  it('opens a small popup on «تعديل»: our title fixed, the insurance title and the code typed', () => {
    expect(PAGE).toContain('size="sm"');
    // Our title is shown, never an input.
    expect(PAGE).toMatch(/<p[^>]*data-insurance-ours\s*>\s*\{row\.jobTitle\}/);
    expect(PAGE).toContain('data-insurance-theirs');
    expect(PAGE).toContain('data-insurance-code');
    expect(PAGE).toMatch(/save\.mutateAsync\(\{\s*jobTitleId: row\.jobTitleId,\s*body: requestOf\(insuranceTitle, occupationCode\),?\s*\}\)/);
    expect(PAGE).toContain('disabled={!changed || !codeOk}');
  });

  it('finds a job by our title, its insurance title or its code — «لو عاوز اعمل سيرش علي وظيفه»', () => {
    const driver: InsuranceJobTitleRowDto = { jobTitleId: 'j2', jobTitle: 'سائق', insuranceTitle: '', occupationCode: '' };
    expect(matchesSearch(row, '')).toBe(true);
    expect(matchesSearch(row, 'امين')).toBe(true);
    expect(matchesSearch(row, 'خزينه')).toBe(true);
    expect(matchesSearch(row, '412')).toBe(true);
    expect(matchesSearch(row, 'أمين 101')).toBe(true);
    expect(matchesSearch(driver, 'امين')).toBe(false);
    // The search is remembered as the other lists' are, and shown above the table.
    expect(PAGE).toContain("useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)");
    expect(PAGE).toContain('<SearchInput');
    expect(PAGE).toContain("t('contracts.insuranceTitles.noMatch')");
  });

  it('shows the code under its heading, away from «تعديل», reading left to right', () => {
    expect(PAGE).toMatch(/<td className="px-3 py-2 text-start[^"]*">\s*\{row\.occupationCode === ''/);
    expect(PAGE).toContain('<span dir="ltr" className="tabular-nums" data-insurance-code-cell>');
  });

  it('refuses a code form 1 cannot box — empty is allowed', () => {
    expect(isOccupationCode('412/101')).toBe(true);
    expect(isOccupationCode(' 123456 ')).toBe(true);
    expect(isOccupationCode('')).toBe(true);
    expect(isOccupationCode('12a')).toBe(false);
    expect(isOccupationCode('1234/5')).toBe(false);
  });

  it('sends the two values trimmed, and only once something changed', () => {
    expect(requestOf(' أمين خزينة ', ' 412/101 ')).toEqual({ insuranceTitle: 'أمين خزينة', occupationCode: '412/101' });
    expect(isChanged(row, 'أمين خزينة ', '412/101')).toBe(false);
    expect(isChanged(row, 'أمين صندوق', '412/101')).toBe(true);
    expect(isChanged(row, 'أمين خزينة', '')).toBe(true);
  });

  it('names everything in both languages', () => {
    const used = [...PAGE.matchAll(/\bt\('([a-zA-Z.-]+)'/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(10);
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
