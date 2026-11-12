// «مستندات الوظائف» on «جاهزون للتعيين» (A28) — every department, the jobs in it, and beside each job
// every paper: what a line holds as it is ticked, a department's line for all its jobs, a job added,
// and what «حفظ» sends. Read from source where the screen needs a live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type JobPapersDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { changedLines, choiceOf, everyPaper, jobsOf, lineKey, toggled } from './components/JobPapersDialog';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const READY = code('../employee-management/employees/pages/EmployeesReadyPage.tsx');
const DIALOG = code('components/JobPapersDialog.tsx');

const paper = (key: string, kind: 'contract' | 'form' = 'form') => ({ key, name: { ar: key, en: key }, kind });
const job = (jobTitleId: string, keys: string[]) => ({ jobTitleId, name: { ar: jobTitleId, en: jobTitleId }, keys });
const DATA: JobPapersDto = {
  papers: [paper('contract', 'contract'), paper('old-contract', 'contract'), paper('sheet'), paper('weapon'), paper('card.leader'), paper('card.guard')],
  departments: [
    { departmentId: 'ops', name: { ar: 'العمليات', en: 'Ops' }, jobs: [job('leader', ['contract', 'sheet', 'weapon', 'card.leader']), job('guard', ['contract', 'sheet', 'card.guard'])] },
    { departmentId: 'it', name: { ar: 'تكنولوجيا المعلومات', en: 'IT' }, jobs: [] },
  ],
  jobs: [job('leader', ['contract', 'sheet', 'weapon', 'card.leader']), job('guard', ['contract', 'sheet', 'card.guard']), job('coder', ['contract', 'sheet'])],
};

describe('a job\'s line in a department', () => {
  it('starts with the papers the job prints there ticked', () => {
    const start = choiceOf(DATA);
    expect([...(start.get(lineKey('ops', 'leader')) ?? [])]).toEqual(['contract', 'sheet', 'weapon', 'card.leader']);
    expect(start.get(lineKey('ops', 'guard'))?.has('weapon')).toBe(false);
  });

  it('adds and takes off a paper; ticking a contract unticks the other — a job prints one', () => {
    const line = new Set(['contract', 'sheet']);
    expect([...toggled(DATA.papers, line, 'card.guard', true)]).toEqual(['contract', 'sheet', 'card.guard']);
    expect([...toggled(DATA.papers, line, 'sheet', false)]).toEqual(['contract']);
    expect([...toggled(DATA.papers, line, 'old-contract', true)]).toEqual(['sheet', 'old-contract']);
  });

  it('ticks every form and one contract on «تحديد الكل»', () => {
    expect(everyPaper(DATA.papers, new Set(['old-contract']))).toEqual(['old-contract', 'sheet', 'weapon', 'card.leader', 'card.guard']);
    expect(everyPaper(DATA.papers, new Set())).toEqual(['contract', 'sheet', 'weapon', 'card.leader', 'card.guard']);
  });
});

describe('«حفظ»', () => {
  it('sends only the lines that changed, each with every paper it now prints, in print order', () => {
    const chosen = choiceOf(DATA);
    expect(changedLines(DATA, chosen, new Map())).toEqual([]);
    const next = new Map(chosen).set(lineKey('ops', 'guard'), new Set(['card.guard', 'weapon', 'contract']));
    expect(changedLines(DATA, next, new Map())).toEqual([{ departmentId: 'ops', jobTitleId: 'guard', keys: ['contract', 'weapon', 'card.guard'] }]);
  });

  it('sends a job added to a department, as it was added', () => {
    const coder = DATA.jobs.find((j) => j.jobTitleId === 'coder')!;
    const added = new Map([['it', [coder]]]);
    expect(jobsOf(DATA.departments[1]!, added).map((j) => j.jobTitleId)).toEqual(['coder']);
    expect(changedLines(DATA, choiceOf(DATA), added)).toEqual([{ departmentId: 'it', jobTitleId: 'coder', keys: ['contract', 'sheet'] }]);
  });
});

describe('«جاهزون للتعيين»', () => {
  it('opens «مستندات الوظائف» from a button at the top, for who may change the templates', () => {
    expect(READY).toContain('<Can permission="contractTemplate.manage">');
    expect(READY).toContain('onClick={() => setJobPapers(true)} data-job-papers-open');
    expect(READY).toContain('<JobPapersDialog open={jobPapers} onClose={() => setJobPapers(false)} />');
    expect(translate('ar', 'employees.ready.jobPapers')).toBe('مستندات الوظائف');
  });

  it('opens each department to its jobs, a line for all of them first, and saves the changed lines', () => {
    expect(DIALOG).toContain('data-department-toggle={id}');
    expect(DIALOG).toContain('data-department-all={id}');
    expect(DIALOG).toContain('(key, on) => toggleAll(id, jobs, key, on)');
    expect(DIALOG).toContain('data-job-line={lineKey(id, job.jobTitleId)}');
    expect(DIALOG).toContain('data-department-add={id}');
    expect(DIALOG).toContain('save.mutateAsync({ lines: changed })');
    expect(DIALOG).toContain('disabled={changed.length === 0}');
  });

  it('names everything in both languages', () => {
    const used = [...DIALOG.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(8);
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
