// A28 — which of the published papers a candidate's job prints, and under which heading.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { isTickedForJob, papersOfJob } from './candidate-draft.service';

const LEADER = new Types.ObjectId();
const GUARD = new Types.ObjectId();

const template = (key: string, over: Partial<ContractTemplateDoc>): ContractTemplateDoc =>
  ({
    _id: new Types.ObjectId(),
    key,
    name: { ar: key, en: key },
    language: 'ar',
    sections: { header: '', body: '', footer: '' },
    signatures: [],
    placeholders: [],
    ...over,
  }) as unknown as ContractTemplateDoc;

const PUBLISHED = [
  template('card', { kind: 'form', allJobs: false, jobTitleIds: [LEADER], printOrder: 60 }),
  template('sheet', { kind: 'form', allJobs: true, printOrder: 10 }),
  template('contract', { kind: 'contract', allJobs: true, printOrder: 0 }),
  template('old-contract', { kind: 'contract', allJobs: true, printOrder: 100 }),
  template('guard-card', { kind: 'form', allJobs: false, jobTitleIds: [GUARD], printOrder: 60 }),
];

describe('the papers of a candidate\'s job', () => {
  it('are every paper, in print order: the job\'s contract first, then the forms — the job\'s marked, the rest `other`', () => {
    expect(papersOfJob(PUBLISHED, String(LEADER)).map((p) => [p.template.key, p.group])).toEqual([
      ['contract', 'contract'],
      // A second contract is never the job's: one contract only, and it is the first.
      ['old-contract', 'other'],
      ['sheet', 'everyJob'],
      ['card', 'thisJob'],
      ['guard-card', 'other'],
    ]);
  });

  it('tick the job\'s own and leave another job\'s there unticked', () => {
    const ticked = (job: Types.ObjectId): string[] =>
      papersOfJob(PUBLISHED, String(job)).filter(isTickedForJob).map((p) => p.template.key);
    expect(ticked(GUARD)).toEqual(['contract', 'sheet', 'guard-card']);
    expect(papersOfJob(PUBLISHED, String(GUARD)).find((p) => p.template.key === 'card')?.group).toBe('other');
  });

  it('offer the weapon declaration to a cash-in-transit specialist unticked, and ticked to a crew leader', () => {
    const SPECIALIST = new Types.ObjectId();
    const weapon = template('egycash.hiring.weapon', {
      kind: 'form',
      allJobs: false,
      jobTitleIds: [LEADER, SPECIALIST],
      printOrder: 50,
    });
    const optional = (job: Types.ObjectId, name: string): boolean | undefined =>
      papersOfJob([...PUBLISHED, weapon], String(job), name).find((p) => p.template.key === weapon.key)?.optional;
    expect(optional(SPECIALIST, 'أخصائي نقل أموال')).toBe(true);
    expect(optional(LEADER, 'قائد طاقم')).toBe(false);
    // A job whose name is unknown is offered every paper of its own as usual.
    expect(papersOfJob([...PUBLISHED, weapon], String(SPECIALIST)).every((p) => !p.optional)).toBe(true);
  });

  it('have no contract heading when no contract is published', () => {
    expect(papersOfJob(PUBLISHED.filter((t) => t.kind !== 'contract'), String(LEADER)).map((p) => p.group)).toEqual([
      'everyJob',
      'thisJob',
      'other',
    ]);
  });
});

describe('a job «مستندات الوظائف» changed', () => {
  it('prints what was added to it and not what was taken off', () => {
    const papers = papersOfJob(PUBLISHED, String(LEADER), null, { added: ['guard-card'], removed: ['sheet'] });
    expect(papers.map((p) => [p.template.key, p.group])).toEqual([
      ['contract', 'contract'],
      ['old-contract', 'other'],
      ['sheet', 'other'],
      ['card', 'thisJob'],
      ['guard-card', 'thisJob'],
    ]);
  });

  it('takes another contract when its own is taken off and the other added', () => {
    const papers = papersOfJob(PUBLISHED, String(LEADER), null, { added: [], removed: ['contract'] });
    expect(papers.find((p) => p.group === 'contract')?.template.key).toBe('old-contract');
  });

  it('prints exactly what was ticked: an optional paper it kept is ticked', () => {
    const SPECIALIST = new Types.ObjectId();
    const weapon = template('egycash.hiring.weapon', { kind: 'form', allJobs: false, jobTitleIds: [SPECIALIST], printOrder: 50 });
    const papers = papersOfJob([...PUBLISHED, weapon], String(SPECIALIST), 'أخصائي نقل أموال', { added: [], removed: [] });
    expect(papers.find((p) => p.template.key === weapon.key)).toMatchObject({ group: 'thisJob', optional: false });
  });
});
