// «مستندات التعيين» (A27) on the screens — where «طباعة المستندات» is, what it does first, and the
// template settings that decide what it prints. Read from source: these screens need a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIRING_PACK_CONTRACT_NOTES, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const BUTTON = code('components/PrintHiringPackButton.tsx');
const DOCS_PAGE = code('../recruitment/hiring-documents/pages/HiringDocsDetailPage.tsx');
const HIRE_PAGE = code('../employee-management/employees/pages/EmployeeCreatePage.tsx');
const CONTRACT_PAGE = code('pages/ContractDetailPage.tsx');
const CREATE_PAGE = code('pages/ContractCreatePage.tsx');
const EDITOR = code('pages/TemplateEditorPage.tsx');

describe('the print button', () => {
  it('opens the tab on the click itself, before asking the server — or the popup blocker wins', () => {
    expect(BUTTON.indexOf('openPrintWindow(')).toBeGreaterThan(-1);
    expect(BUTTON.indexOf('openPrintWindow(')).toBeLessThan(BUTTON.indexOf('pack.mutateAsync(employeeId)'));
    expect(BUTTON).toContain('writePrintWindow(win, set.html)');
  });

  it('is offered only to whoever may print contracts', () => {
    expect(BUTTON).toContain('<Can permission="contract.print">');
  });

  it('says why the contract is missing, and still prints the forms', () => {
    expect(BUTTON).toContain('t(`hiringPack.note.${set.contractNote}`)');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const note of HIRING_PACK_CONTRACT_NOTES) {
        expect(translate(locale, `hiringPack.note.${note}`), `${locale} ${note}`).not.toBe(`hiringPack.note.${note}`);
      }
    }
  });
});

describe('where it is', () => {
  it('heads «مستندات التعيين», and greets a fresh hire there', () => {
    expect(DOCS_PAGE).toContain('<PrintHiringPackButton employeeId={h.employeeId}');
    expect(DOCS_PAGE).toContain("sp.get('hired') === '1'");
    expect(DOCS_PAGE).toContain("t('hiringPack.hiredBanner')");
  });

  it('is where «تعيين» lands: the employee\'s set, opened if missing', () => {
    expect(HIRE_PAGE).toContain('openDocs.mutateAsync(employee.id)');
    expect(HIRE_PAGE).toContain('navigate(`/hiring-documents/${docs.id}?hired=1`)');
    // Without the key to open the set, the hire lands where it always did.
    expect(HIRE_PAGE).toContain("can('hiringDocuments.create')");
    expect(HIRE_PAGE).toContain('navigate(`/employees/${employee.id}`)');
  });

  it('follows a generated contract — «بعد إنشاء وتوليد المستند»', () => {
    expect(CONTRACT_PAGE).toContain('{actionable && (');
    expect(CONTRACT_PAGE).toContain('<PrintHiringPackButton employeeId={c.employeeId}');
  });
});

describe('the templates', () => {
  it('never offers a form as the template of a contract, and offers the employee\'s job first', () => {
    expect(CREATE_PAGE).toContain("x.kind !== 'form'");
    expect(CREATE_PAGE).toContain('x.allJobs || x.jobTitleIds.includes(jobTitleId)');
    expect(CREATE_PAGE).toContain('if (own !== undefined) setTemplateKey(own.key);');
  });

  it('are saved with their kind, jobs and print order, and preview as they print', () => {
    expect(EDITOR).toContain('...printFields(),');
    expect(EDITOR).toContain('signatures, kind },');
    expect(EDITOR).toContain("kind === 'form' || contractTypeId === '' ? null : contractTypeId");
    // A form needs no contract type; a form printed for no job is incomplete.
    expect(EDITOR).toContain("if (kind === 'contract' && contractTypeId === '')");
    expect(EDITOR).toContain('if (!allJobs && jobTitleIds.length === 0)');
  });

  it('name every new setting in both languages', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of [
        'contracts.templates.kind',
        'contracts.templates.kinds.contract',
        'contracts.templates.kinds.form',
        'contracts.templates.printOrder',
        'contracts.templates.jobs',
        'contracts.templates.allJobs',
        'contracts.templates.jobsCount',
        'hiringPack.print',
        'hiringPack.printFromContract',
        'hiringPack.preparing',
        'hiringPack.popupBlocked',
        'hiringPack.empty',
        'hiringPack.contractCreated',
        'hiringPack.hiredBanner',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
    expect(translate('ar', 'hiringPack.print')).toBe('طباعة المستندات');
  });
});
