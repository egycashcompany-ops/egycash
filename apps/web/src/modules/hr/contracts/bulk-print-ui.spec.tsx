// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — ticking people, the popup with their papers, and
// what each person is printed. Read from source where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { type BulkPerson } from './components/BulkPrintDialog';
import { translate } from '../../../platform/localization/i18n';
import { candidatePerson, employeePerson, employeePrintRequest, printRequest, startingChoice } from './components/BulkPrintDialog';

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
): BulkPerson => candidatePerson({
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
  // Their own papers only; the weapon declaration offered to every job, ticked for the crew leader.
  const leader = person('leader', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'everyJob'], ['card.leader', 'thisJob']]);
  const coder = person('coder', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'everyJob']], ['weapon']);
  const cit = person('cit', [['contract', 'contract'], ['sheet', 'everyJob'], ['weapon', 'everyJob'], ['card.cit', 'thisJob']], ['weapon']);

  it('starts each line with that person\'s papers ticked — but one only offered', () => {
    const start = startingChoice([leader, coder, cit]);
    expect([...(start.get('leader') ?? [])]).toEqual(['contract', 'sheet', 'weapon', 'card.leader']);
    expect([...(start.get('coder') ?? [])]).toEqual(['contract', 'sheet']);
    // «لكلو بس مطفيه وللقائد معموله mark»: on every line, ticked on the crew leader's only.
    expect(start.get('cit')?.has('weapon')).toBe(false);
  });

  it('prints for each person what is ticked on their own line, and nothing of another job', () => {
    const chosen = new Map([
      ['leader', new Set(['card.leader', 'contract'])],
      ['coder', new Set<string>()],
      // A key of another job's paper is never on this line, so never sent for this person.
      ['cit', new Set(['sheet', 'card.leader', 'weapon'])],
    ]);
    expect(printRequest([leader, coder, cit], chosen)).toEqual({
      people: [
        { offerId: 'leader', keys: ['contract', 'card.leader'] },
        { offerId: 'cit', keys: ['sheet', 'weapon'] },
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
    expect(READY).toContain('ids={selection.ids}');
    expect(READY).toContain('source="candidates"');
    expect(READY).toContain('onPrinted={selection.clear}');
  });
});

describe('the popup', () => {
  it('gives each person a line with their own paper tiles, with all / none per line and for everyone', () => {
    expect(DIALOG).toContain('data-bulk-person={person.id}');
    expect(DIALOG).toContain('{person.papers.map((paper) => (');
    expect(DIALOG).toContain('<PaperTile');
    expect(DIALOG).toContain('onToggle={(on) => toggle(person.id, paper.key, on)}');
    expect(DIALOG).toContain("t('contracts.candidate.selectAll')");
    expect(DIALOG).toContain("t('contracts.bulk.everyoneAll')");
    expect(DIALOG).toContain('setChosen(startingChoice(loaded))');
    expect(DIALOG).toContain('renderCandidates.mutateAsync(printRequest(people, chosen))');
  });

  it('prints on «تأكيد الطباعة», the tab opened on the click itself', () => {
    expect(DIALOG).toContain("t('contracts.bulk.confirm')");
    expect(DIALOG.indexOf('openPrintWindow(')).toBeLessThan(DIALOG.indexOf('renderEmployees.mutateAsync('));
    expect(DIALOG.indexOf('openPrintWindow(')).toBeLessThan(DIALOG.indexOf('renderCandidates.mutateAsync('));
    expect(translate('ar', 'contracts.bulk.confirm')).toBe('تأكيد الطباعة');
  });

  it('names everything in both languages', () => {
    const used = [...DIALOG.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});

/**
 * «المعينون» — the same popup for people already employed: «هتجبلي كل اللي موجودين من موظفين فالشركه
 * و بردو checkbox عشان لو هطبع لناس كتير فنفس الوقت».
 */
describe('«المعينون»', () => {
  const employee = employeePerson({
    employeeId: 'e1',
    employeeName: 'أحمد محمود',
    employeeCode: '0102951',
    jobTitle: { ar: 'سائق', en: 'Driver' },
    papers: [
      { key: 'contract', name: { ar: 'عقد', en: 'Contract' }, kind: 'contract', group: 'contract', optional: false },
      { key: 'sheet', name: { ar: 'استمارة', en: 'Sheet' }, kind: 'form', group: 'everyJob', optional: false },
    ],
    error: null,
  });

  it('lines an employee up by their employee id, their code shown, and prints by employee', () => {
    expect(employee).toMatchObject({ id: 'e1', name: 'أحمد محمود', code: '0102951' });
    const chosen = new Map([['e1', new Set(['sheet'])]]);
    expect(employeePrintRequest([employee], chosen)).toEqual({ people: [{ employeeId: 'e1', keys: ['sheet'] }] });
  });

  it('opens and prints through the employees\' own calls when the source is employees', () => {
    expect(DIALOG).toContain("source: 'candidates' | 'employees'");
    expect(DIALOG).toContain('openEmployees.mutateAsync(ids).then((rows) => rows.map(employeePerson))');
    expect(DIALOG).toContain('renderEmployees.mutateAsync(employeePrintRequest(people, chosen))');
  });
});
