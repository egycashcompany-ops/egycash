// «عقد جديد» for a candidate (A28) on the screens — where the hire moved, what holds it back, and
// how the papers are chosen. Read from source: the page needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { oneYearFromIso } from './pages/CandidateContractPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const READY = code('../employee-management/employees/pages/EmployeesReadyPage.tsx');
const PAGE = code('pages/CandidateContractPage.tsx');
const TILE = code('components/PaperTile.tsx');
const ROUTES = code('routes.tsx');

describe('«جاهزون للتعيين»', () => {
  it('prints the papers first: «طباعة العقد والمستندات» in place of «تعيين»', () => {
    expect(READY).toContain("t('employees.ready.printPapers')");
    expect(READY).toContain('navigate(`/contracts/new?offerId=${o.id}`)');
    expect(READY).not.toContain('/employees/new?offerId=');
    expect(translate('ar', 'employees.ready.printPapers')).toBe('طباعة العقد والمستندات');
  });

  it('opens «عقد جديد» in the candidate\'s mode, under the key to print', () => {
    expect(ROUTES).toContain("sp.get('offerId')");
    expect(ROUTES).toContain('<RequirePermission permission="contract.print">');
    expect(ROUTES).toContain('<CandidateContractPage offerId={offerId} />');
  });
});

describe('the candidate\'s page', () => {
  it('keeps «تعيين» off until something was printed', () => {
    expect(PAGE).toContain('disabled={!printed}');
    expect(PAGE).toContain('const printed = draft.printedAt !== null;');
    expect(PAGE).toContain('<Can permission="employee.create">');
  });

  it('prints what is ticked, or one paper alone, the tab opened on the click itself', () => {
    expect(PAGE).toContain('void print(selected.map((p) => p.key))');
    expect(PAGE).toContain('onPrint={() => void print([p.key])}');
    expect(PAGE.indexOf('openPrintWindow(')).toBeLessThan(PAGE.indexOf('render.mutateAsync({ keys, print: true })'));
  });

  it('groups the papers — the contract, every job\'s, this job\'s — with select all', () => {
    expect(PAGE).toContain("const GROUPS: CandidatePaperGroup[] = ['contract', 'everyJob', 'thisJob'];");
    expect(PAGE).toContain("t('contracts.candidate.selectAll')");
  });

  it('saves every change to the server as it is made, one after another', () => {
    expect(PAGE).toContain('chain.current = chain.current.then(');
    expect(PAGE).toContain('version: current.version');
  });

  it('moves the contract\'s end with its start: one year, to the day before', () => {
    expect(oneYearFromIso('2026-11-15')).toBe('2027-11-14');
    expect(oneYearFromIso('2028-02-29')).toBe('2029-02-28');
    expect(oneYearFromIso('2027-01-01')).toBe('2027-12-31');
  });
});

describe('the paper tiles — the owner\'s own pattern', () => {
  it('is a hidden checkbox the card answers to, blue with a check when ticked', () => {
    expect(TILE).toContain('type="checkbox"');
    expect(TILE).toContain('peer absolute h-px w-px overflow-hidden whitespace-nowrap opacity-0');
    expect(TILE).toContain('peer-checked:border-blue-400');
    expect(TILE).toContain("peer-checked:before:content-['✓']");
  });

  it('keeps «تعديل» and «طباعة» outside the label, so they never tick it', () => {
    expect(TILE.indexOf('</label>')).toBeLessThan(TILE.indexOf('onClick={onEdit}'));
  });
});

describe('the words', () => {
  it('names everything on the page in both languages', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of [
        'contracts.candidate.subtitle',
        'contracts.candidate.details',
        'contracts.candidate.papers',
        'contracts.candidate.groups.contract',
        'contracts.candidate.groups.everyJob',
        'contracts.candidate.groups.thisJob',
        'contracts.candidate.edit',
        'contracts.candidate.printOne',
        'contracts.candidate.printSelected',
        'contracts.candidate.printFirst',
        'contracts.candidate.hired',
        'contracts.candidate.savedAuto',
        'contracts.candidate.codeAtPrint',
        'contracts.candidate.editTitle',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('labels the page\'s fields with words that exist, never with a key', () => {
    const used = [...PAGE.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
