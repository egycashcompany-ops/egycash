// «عايزك تسمحلى أغير كود الفرع» — the branch code is corrected behind its own key, from the list and
// from the branch's page, and a code no employee code could name is warned about (ADR-017, amended
// 2026-11-03). Read from source: the dialog needs a live client and a portal to render.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { EMPLOYEE_CODE_BRANCH } from './components/ChangeBranchCodeDialog';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const LIST = code('pages/BranchesListPage.tsx');
const DETAIL = code('pages/BranchDetailPage.tsx');
const DIALOG = code('components/ChangeBranchCodeDialog.tsx');

describe('who may change a branch code', () => {
  it('is whoever holds branch.changeCode — on the list and on the branch page', () => {
    expect(LIST).toContain('<Can permission="branch.changeCode">');
    expect(LIST).toContain('<ChangeBranchCodeDialog branch={recoding}');
    expect(DETAIL).toContain('<Can permission="branch.changeCode">');
    expect(DETAIL).toContain('<ChangeBranchCodeDialog branch={branch}');
  });

  it('is no longer decided by being a super-admin', () => {
    expect(DETAIL).not.toContain('isPrivileged');
  });
});

describe('the dialog', () => {
  it('warns, without refusing, about a code that is not three digits', () => {
    expect(EMPLOYEE_CODE_BRANCH.test('010')).toBe(true);
    expect(EMPLOYEE_CODE_BRANCH.test('BR1')).toBe(false);
    expect(EMPLOYEE_CODE_BRANCH.test('0100')).toBe(false);
    expect(DIALOG).toContain("t('organization.branch.codeNotThreeDigits')");
    expect(DIALOG).toContain('warning={');
  });

  it('says a code another branch holds is taken', () => {
    expect(DIALOG).toContain("e.code === 'DUPLICATE'");
    expect(DIALOG).toContain("t('organization.branch.codeTaken')");
  });

  it('speaks of the code, says employee codes stay, in both languages', () => {
    expect(translate('ar', 'organization.branch.changeCode')).toBe('تغيير كود الفرع');
    expect(translate('ar', 'organization.branch.changeCodeHint')).toContain('أكواد الموظفين المسجَّلين لا تتغير');
    for (const locale of ['en', 'ar'] as Locale[]) {
      for (const key of [
        'organization.branch.changeCodeShort',
        'organization.branch.codeCurrent',
        'organization.branch.codeNotThreeDigits',
        'organization.branch.codeTaken',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
