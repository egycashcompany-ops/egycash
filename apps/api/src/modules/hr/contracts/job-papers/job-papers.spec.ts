// A28 — «مستندات الوظائف»: what a job keeps when saved, and that it gives back exactly what was ticked.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { overrideFor, tickedKeys } from './job-papers.service';

const LEADER = new Types.ObjectId();
const SPECIALIST = new Types.ObjectId();

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
  template('contract', { kind: 'contract', allJobs: true, printOrder: 0 }),
  template('sheet', { kind: 'form', allJobs: true, printOrder: 10 }),
  template('bank', { kind: 'form', allJobs: true, printOrder: 40 }),
  template('egycash.hiring.weapon', { kind: 'form', allJobs: false, jobTitleIds: [LEADER, SPECIALIST], printOrder: 50 }),
  template('leader-card', { kind: 'form', allJobs: false, jobTitleIds: [LEADER], printOrder: 60 }),
  template('treasurer-card', { kind: 'form', allJobs: false, jobTitleIds: [], printOrder: 60 }),
];

describe('«مستندات الوظائف»', () => {
  it('ticks what a job\'s templates give it, but the paper it is only offered unticked', () => {
    expect(tickedKeys(PUBLISHED, String(LEADER), 'قائد طاقم', null)).toEqual([
      'contract', 'sheet', 'bank', 'egycash.hiring.weapon', 'leader-card',
    ]);
    expect(tickedKeys(PUBLISHED, String(SPECIALIST), 'أخصائي نقل أموال', null)).toEqual(['contract', 'sheet', 'bank']);
  });

  it('keeps what was added and taken off — and gives back exactly what was ticked', () => {
    const keys = ['contract', 'sheet', 'egycash.hiring.weapon', 'leader-card', 'treasurer-card'];
    const override = overrideFor(PUBLISHED, String(LEADER), keys);
    expect(override).toEqual({ added: ['treasurer-card'], removed: ['bank'] });
    expect(tickedKeys(PUBLISHED, String(LEADER), 'قائد طاقم', override)).toEqual(keys);
  });

  it('keeps an optional paper ticked once it is ticked, and off when it is not', () => {
    const on = overrideFor(PUBLISHED, String(SPECIALIST), ['contract', 'sheet', 'bank', 'egycash.hiring.weapon']);
    expect(on).toEqual({ added: [], removed: [] });
    expect(tickedKeys(PUBLISHED, String(SPECIALIST), 'أخصائي نقل أموال', on)).toContain('egycash.hiring.weapon');
    const off = overrideFor(PUBLISHED, String(SPECIALIST), ['contract', 'sheet', 'bank']);
    expect(off.removed).toEqual(['egycash.hiring.weapon']);
    expect(tickedKeys(PUBLISHED, String(SPECIALIST), 'أخصائي نقل أموال', off)).not.toContain('egycash.hiring.weapon');
  });

  it('still gives a changed job a paper published later for every job', () => {
    const override = overrideFor(PUBLISHED, String(LEADER), ['contract', 'sheet']);
    const later = [...PUBLISHED, template('form-1', { kind: 'form', allJobs: true, printOrder: 5 })];
    expect(tickedKeys(later, String(LEADER), 'قائد طاقم', override)).toEqual(['contract', 'form-1', 'sheet']);
  });
});
