// «فى الإجراءات (نقل) على الموظف إمكانية تعديل المسمي الوظيفي أيضاً» — the transfer dialog's job
// title. The dialog needs a live client to render, so where things sit is read from its source, as
// the register screen's spec does.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'components/actions/CareerDialogs.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const TRANSFER = SOURCE.slice(
  SOURCE.indexOf('export const TransferDialog'),
  SOURCE.indexOf('export const SalaryChangeDialog'),
);

describe('the transfer dialog names the job held in the new placement', () => {
  it('offers the job title after the section, starting from the current one', () => {
    expect(TRANSFER).not.toHaveLength(0);
    expect(TRANSFER).toContain('useState(employee.employment.jobTitleId)');
    const sectionAt = TRANSFER.indexOf("t('employees.actions.transfer.section')");
    const jobAt = TRANSFER.indexOf("label={t('offers.form.jobTitle')}");
    expect(sectionAt).toBeGreaterThan(-1);
    expect(jobAt).toBeGreaterThan(sectionAt);
  });

  it('sends the job only when it changed, and counts it as a change', () => {
    expect(TRANSFER).toContain('const changedJob = jobTitleId !== employee.employment.jobTitleId;');
    expect(TRANSFER).toContain('!changedBranch && !changedDept && !changedSection && !changedJob');
    expect(TRANSFER).toContain('...(changedJob ? { jobTitleId } : {}),');
  });

  // A promotion made in between must not be sent back undone, nor last opening's note and document.
  it('starts every opening again from the employee as they are now — mounted only while open', () => {
    const MENU = readFileSync(join(HERE, 'components/actions/ActionsMenu.tsx'), 'utf8');
    expect(MENU).toMatch(/\{dialog === 'transfer' && \(\s*<TransferDialog employee=\{employee\} open /);
  });

  // The catalog is active titles only; a retired one the employee holds stays theirs on the list.
  it('keeps a retired title the employee holds on the list, by the name on their record', () => {
    expect(TRANSFER).toContain('!jobTitles.some((jt) => jt.id === employee.employment.jobTitleId)');
    expect(TRANSFER).toContain('localized(employee.placement.jobTitle.name, locale)');
  });

  it('says how to keep the job, in both languages, with the job named as the label names it', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      const hint = translate(locale, 'employees.actions.transfer.jobTitleHint');
      expect(hint, locale).not.toBe('employees.actions.transfer.jobTitleHint');
    }
    expect(translate('ar', 'employees.actions.transfer.jobTitleHint')).toContain(
      translate('ar', 'offers.form.jobTitle'),
    );
  });
});
