// A28 — which of the published papers a candidate's job prints, and under which heading.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { papersOfJob } from './candidate-draft.service';

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
  it('are its contract first, then every job\'s forms, then its own — one contract only', () => {
    expect(papersOfJob(PUBLISHED, String(LEADER)).map((p) => [p.template.key, p.group])).toEqual([
      ['contract', 'contract'],
      ['sheet', 'everyJob'],
      ['card', 'thisJob'],
    ]);
  });

  it('leave out another job\'s papers', () => {
    expect(papersOfJob(PUBLISHED, String(GUARD)).map((p) => p.template.key)).toEqual(['contract', 'sheet', 'guard-card']);
  });

  it('have no contract heading when no contract is published', () => {
    expect(papersOfJob(PUBLISHED.filter((t) => t.kind !== 'contract'), String(LEADER)).map((p) => p.group)).toEqual([
      'everyJob',
      'thisJob',
    ]);
  });
});
