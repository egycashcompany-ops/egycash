// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — ticking people, the popup with their papers, and
// what each person is printed. Read from source where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CandidateBulkPersonDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { papersOfPeople, startingChoice } from './components/BulkPrintDialog';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const READY = code('../employee-management/employees/pages/EmployeesReadyPage.tsx');
const DIALOG = code('components/BulkPrintDialog.tsx');

const person = (
  offerId: string,
  keys: [string, 'contract' | 'everyJob' | 'thisJob'][],
  optional: readonly string[] = [],
): CandidateBulkPersonDto => ({
  offerId,
  applicantName: offerId,
  offerCode: null,
  jobTitle: null,
  papers: keys.map(([key, group]) => ({
    key,
    name: { ar: key, en: key },
    kind: group === 'contract' ? 'contract' : 'form',
    group,
    optional: optional.includes(key),
  })),
  error: null,
});

describe('the papers of the ticked people', () => {
  const leader = person('leader', [['card.leader', 'thisJob'], ['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'thisJob']]);
  const guard = person('guard', [['contract', 'contract'], ['sheet', 'everyJob'], ['card.guard', 'thisJob']]);

  it('lists every paper once, in print order, with whom it is for', () => {
    const papers = papersOfPeople([leader, guard]);
    expect(papers.map((p) => p.key)).toEqual(['contract', 'sheet', 'card.leader', 'weapon', 'card.guard']);
    expect(papers.find((p) => p.key === 'contract')?.for).toEqual(['leader', 'guard']);
    // Each job's card, and the weapon declaration, for that job's people only.
    expect(papers.find((p) => p.key === 'weapon')?.for).toEqual(['leader']);
    expect(papers.find((p) => p.key === 'card.guard')?.for).toEqual(['guard']);
  });

  it('starts unticked a paper their jobs are only offered — unless it is usual for one of them', () => {
    const specialist = person('cit', [['contract', 'contract'], ['weapon', 'thisJob']], ['weapon']);
    expect([...startingChoice([specialist, guard])].sort()).toEqual(['card.guard', 'contract', 'sheet']);
    expect(startingChoice([specialist, leader]).has('weapon')).toBe(true);
    expect(DIALOG).toContain('setChosen(startingChoice(loaded))');
  });
});

describe('«جاهزون للتعيين»', () => {
  it('ticks people — one by one or all — and offers «طباعة لكل المحدد» for them', () => {
    expect(READY).toContain('useTableSelection(rows.map((o) => o.id))');
    expect(READY).toContain("{...(can('contract.print') ? { selection } : {})}");
    expect(READY).toContain('<BulkActionBar count={selection.count} onClear={selection.clear}>');
    expect(READY).toContain("t('employees.ready.printSelected')");
    expect(translate('ar', 'employees.ready.printSelected')).toBe('طباعة لكل المحدد');
  });

  it('opens the popup with the ticked people, and clears them once printed', () => {
    expect(READY).toContain('<BulkPrintDialog');
    expect(READY).toContain('offerIds={selection.ids}');
    expect(READY).toContain('onPrinted={selection.clear}');
  });
});

describe('the popup', () => {
  it('shows the people beside the paper tiles, with all / none', () => {
    expect(DIALOG).toContain('data-bulk-people');
    expect(DIALOG).toContain('data-bulk-papers');
    expect(DIALOG).toContain('<PaperTile');
    expect(DIALOG).toContain("t('contracts.candidate.selectAll')");
  });

  it('prints on «تأكيد الطباعة», the tab opened on the click itself', () => {
    expect(DIALOG).toContain("t('contracts.bulk.confirm')");
    expect(DIALOG.indexOf('openPrintWindow(')).toBeLessThan(DIALOG.indexOf('render.mutateAsync('));
    expect(translate('ar', 'contracts.bulk.confirm')).toBe('تأكيد الطباعة');
  });

  it('names everything in both languages', () => {
    const used = [...DIALOG.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
