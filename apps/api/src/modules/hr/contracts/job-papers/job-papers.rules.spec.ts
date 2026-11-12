// A28 — a person's papers by department and job: only their own are offered, the weapon declaration
// to everyone but ticked for crew leaders only, and «مستندات الوظائف» adds and takes off per line.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { isTickedForJob, overrideFor, papersOfJob, tickedKeys } from './job-papers.rules';

const LEADER = new Types.ObjectId();
const GUARD = new Types.ObjectId();
const LEADER_NAME = 'قائد طاقم صراف آلي';
const GUARD_NAME = 'مراقب أمن';

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

const WEAPON = 'egycash.hiring.weapon'; // ticked for crew leaders only (`tickedFor`)
const PUBLISHED = [
  template('card', { kind: 'form', allJobs: false, jobTitleIds: [LEADER], printOrder: 60 }),
  template('sheet', { kind: 'form', allJobs: true, printOrder: 10 }),
  template('contract', { kind: 'contract', allJobs: true, printOrder: 0 }),
  template('old-contract', { kind: 'contract', allJobs: true, printOrder: 100 }),
  template('guard-card', { kind: 'form', allJobs: false, jobTitleIds: [GUARD], printOrder: 60 }),
  template(WEAPON, { kind: 'form', allJobs: true, printOrder: 50 }),
];
const shape = (papers: ReturnType<typeof papersOfJob>) => papers.map((p) => [p.template.key, p.group, p.optional]);

describe('a person\'s papers', () => {
  it('are only their own, in print order: one contract, the forms every job signs, their job\'s', () => {
    expect(shape(papersOfJob(PUBLISHED, String(LEADER), LEADER_NAME))).toEqual([
      ['contract', 'contract', false],
      ['sheet', 'everyJob', false],
      [WEAPON, 'everyJob', false],
      ['card', 'thisJob', false],
    ]);
    // Another job's card is never offered — «وظائف تانيه ملهاش علاقه بنمازج معينه».
    expect(papersOfJob(PUBLISHED, String(GUARD), GUARD_NAME).map((p) => p.template.key)).not.toContain('card');
  });

  it('offer the weapon declaration to every job unticked, and ticked to crew leaders — «لكلو بس مطفيه وللقائد معموله mark»', () => {
    const weapon = (job: Types.ObjectId, name: string | null) =>
      papersOfJob(PUBLISHED, String(job), name).find((p) => p.template.key === WEAPON);
    expect(weapon(GUARD, GUARD_NAME)).toMatchObject({ optional: true });
    expect(weapon(LEADER, LEADER_NAME)).toMatchObject({ optional: false });
    expect(weapon(LEADER, 'قائد طاقم نقل أموال')).toMatchObject({ optional: false });
    // A job whose name is unknown is offered it unticked too.
    expect(weapon(GUARD, null)).toMatchObject({ optional: true });
    expect(tickedKeys(PUBLISHED, String(GUARD), GUARD_NAME, null)).toEqual(['contract', 'sheet', 'guard-card']);
  });

  it('have no contract when none is published', () => {
    const papers = papersOfJob(PUBLISHED.filter((t) => t.kind !== 'contract'), String(LEADER), LEADER_NAME);
    expect(papers.map((p) => p.group)).toEqual(['everyJob', 'everyJob', 'thisJob']);
  });
});

describe('a line «مستندات الوظائف» saved', () => {
  it('ticks what was added and offers nothing taken off', () => {
    const papers = papersOfJob(PUBLISHED, String(GUARD), GUARD_NAME, { added: ['card'], removed: ['sheet'] });
    expect(shape(papers)).toEqual([
      ['contract', 'contract', false],
      [WEAPON, 'everyJob', true],
      ['card', 'thisJob', false],
      ['guard-card', 'thisJob', false],
    ]);
  });

  it('keeps what was added and taken off — and gives back exactly what was ticked', () => {
    const keys = ['contract', WEAPON, 'card', 'guard-card'];
    const override = overrideFor(PUBLISHED, String(GUARD), GUARD_NAME, keys);
    expect(override).toEqual({ added: [WEAPON, 'card'], removed: ['sheet'] });
    expect(tickedKeys(PUBLISHED, String(GUARD), GUARD_NAME, override)).toEqual(keys);
  });

  it('still offers the weapon declaration unticked when it was left unticked', () => {
    const override = overrideFor(PUBLISHED, String(GUARD), GUARD_NAME, ['contract', 'sheet', 'guard-card']);
    expect(override).toEqual({ added: [], removed: [] });
    expect(papersOfJob(PUBLISHED, String(GUARD), GUARD_NAME, override).find((p) => p.template.key === WEAPON)).toMatchObject({
      optional: true,
    });
  });

  it('takes the other contract when its own is taken off and the other ticked — one contract only', () => {
    const papers = papersOfJob(PUBLISHED, String(LEADER), LEADER_NAME, { added: ['old-contract'], removed: ['contract'] });
    expect(papers.filter((p) => p.group === 'contract').map((p) => p.template.key)).toEqual(['old-contract']);
  });

  it('still gives a changed line a paper published later for every job', () => {
    const override = overrideFor(PUBLISHED, String(GUARD), GUARD_NAME, ['contract', 'guard-card']);
    const later = [...PUBLISHED, template('form-1', { kind: 'form', allJobs: true, printOrder: 5 })];
    expect(tickedKeys(later, String(GUARD), GUARD_NAME, override)).toEqual(['contract', 'form-1', 'guard-card']);
  });

  it('ticks a paper until somebody ticks otherwise only when it is not just offered', () => {
    expect(isTickedForJob({ optional: false })).toBe(true);
    expect(isTickedForJob({ optional: true })).toBe(false);
  });
});
