// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — ticking people, the popup with their papers, and
// what each person is printed. Read from source where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CandidateBulkPersonDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { printRequest, startingChoice } from './components/BulkPrintDialog';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const READY = code('../employee-management/employees/pages/EmployeesReadyPage.tsx');
const DIALOG = code('components/BulkPrintDialog.tsx');

const person = (
  offerId: string,
  keys: [string, 'contract' | 'everyJob' | 'thisJob' | 'other'][],
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

describe('each ticked person on a line of their own', () => {
  const leader = person('leader', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'thisJob'], ['card.leader', 'thisJob'], ['card.cit', 'other']]);
  const coder = person('coder', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'other'], ['card.leader', 'other'], ['card.cit', 'other']]);
  const cit = person('cit', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'thisJob'], ['card.leader', 'other'], ['card.cit', 'thisJob']], ['weapon']);

  it('starts each line with the papers of that person\'s job ticked — but one only offered — and the rest off', () => {
    const start = startingChoice([leader, coder, cit]);
    expect([...(start.get('leader') ?? [])]).toEqual(['contract', 'sheet', 'weapon', 'card.leader']);
    expect([...(start.get('coder') ?? [])]).toEqual(['contract', 'sheet']);
    // The cash-in-transit specialist's weapon declaration starts unticked; the crew leader's does not.
    expect(start.get('cit')?.has('weapon')).toBe(false);
    expect(start.get('cit')?.has('card.leader')).toBe(false);
  });

  it('prints for each person what is ticked on their own line — another job\'s paper too — and no key off it', () => {
    const chosen = new Map([
      ['leader', new Set(['card.leader', 'contract'])],
      ['coder', new Set<string>()],
      // Another job's card ticked on this line prints for this person; a key not on it never does.
      ['cit', new Set(['sheet', 'card.leader', 'not.a.paper'])],
    ]);
    expect(printRequest([leader, coder, cit], chosen)).toEqual({
      people: [
        { offerId: 'leader', keys: ['contract', 'card.leader'] },
        { offerId: 'cit', keys: ['sheet', 'card.leader'] },
      ],
    });
  });

  it('leaves out a person who cannot be printed for', () => {
    const gone = { ...person('gone', [['contract', 'contract']]), error: 'no longer accepted' };
    expect(printRequest([gone], startingChoice([gone]))).toEqual({ people: [] });
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
  it('gives each person a line with their own paper tiles, with all / none per line and for everyone', () => {
    expect(DIALOG).toContain('data-bulk-person={person.offerId}');
    expect(DIALOG).toContain('{person.papers.map((paper) => (');
    expect(DIALOG).toContain('<PaperTile');
    expect(DIALOG).toContain('onToggle={(on) => toggle(person.offerId, paper.key, on)}');
    expect(DIALOG).toContain("t('contracts.candidate.selectAll')");
    // «حسب الوظيفة» puts a line back to the papers of that person's job.
    expect(DIALOG).toContain('setLine(person.offerId, startingChoice([person]).get(person.offerId) ?? [])');
    expect(DIALOG).toContain("t('contracts.bulk.everyoneAll')");
    expect(DIALOG).toContain('setChosen(startingChoice(loaded))');
    expect(DIALOG).toContain('render.mutateAsync(request)');
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
