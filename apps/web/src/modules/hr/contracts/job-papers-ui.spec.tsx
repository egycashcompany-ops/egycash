// «مستندات الوظائف» on «جاهزون للتعيين» (A28) — every job beside every paper, the job's ticked; what
// a line holds as it is ticked, and what «حفظ» sends. Read from source where the screen needs a
// live client.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type JobPapersDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { changedJobs, choiceOf, everyPaper, toggled } from './components/JobPapersDialog';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(resolve(HERE, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const READY = code('../employee-management/employees/pages/EmployeesReadyPage.tsx');
const DIALOG = code('components/JobPapersDialog.tsx');

const paper = (key: string, kind: 'contract' | 'form' = 'form') => ({ key, name: { ar: key, en: key }, kind });
const DATA: JobPapersDto = {
  papers: [paper('contract', 'contract'), paper('old-contract', 'contract'), paper('sheet'), paper('weapon'), paper('card.leader'), paper('card.guard')],
  jobs: [
    { jobTitleId: 'leader', name: { ar: 'قائد طاقم', en: 'Crew leader' }, keys: ['contract', 'sheet', 'weapon', 'card.leader'] },
    { jobTitleId: 'guard', name: { ar: 'مراقب أمن', en: 'Guard' }, keys: ['contract', 'sheet', 'card.guard'] },
  ],
};

describe('a job\'s line', () => {
  it('starts with the papers the job prints ticked', () => {
    const start = choiceOf(DATA);
    expect([...(start.get('leader') ?? [])]).toEqual(['contract', 'sheet', 'weapon', 'card.leader']);
    expect(start.get('guard')?.has('card.leader')).toBe(false);
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
    expect(changedJobs(DATA, chosen)).toEqual([]);
    const next = new Map(chosen).set('guard', new Set(['card.guard', 'card.leader', 'contract']));
    expect(changedJobs(DATA, next)).toEqual([{ jobTitleId: 'guard', keys: ['contract', 'card.leader', 'card.guard'] }]);
  });
});

describe('«جاهزون للتعيين»', () => {
  it('opens «مستندات الوظائف» from a button at the top, for who may change the templates', () => {
    expect(READY).toContain('<Can permission="contractTemplate.manage">');
    expect(READY).toContain('onClick={() => setJobPapers(true)} data-job-papers-open');
    expect(READY).toContain('<JobPapersDialog open={jobPapers} onClose={() => setJobPapers(false)} />');
    expect(translate('ar', 'employees.ready.jobPapers')).toBe('مستندات الوظائف');
  });

  it('shows every job on a line with every paper as tiles, and saves the changed lines', () => {
    expect(DIALOG).toContain('data-job-line={job.jobTitleId}');
    expect(DIALOG).toContain('{data.papers.map((paper) => (');
    expect(DIALOG).toContain('checked={mine.has(paper.key)}');
    expect(DIALOG).toContain('save.mutateAsync({ jobs: changed })');
    expect(DIALOG).toContain('disabled={changed.length === 0}');
  });

  it('names everything in both languages', () => {
    const used = [...DIALOG.matchAll(/t\('([a-zA-Z.]+)'/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(5);
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of used) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
