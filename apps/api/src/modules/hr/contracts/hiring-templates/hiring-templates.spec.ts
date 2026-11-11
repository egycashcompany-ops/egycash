// The owner's thirteen hiring papers as templates (A27, stage 2) — what each one prints, and for
// which jobs, without a database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { renderContractHtml, renderFormHtml } from '../contracts/contract-render';
import { type ContractVariableValue } from '../contracts/contract.model';
import { CATALOG_KEYS, CONTRACT_VARIABLE_CATALOG } from '../shared/variable-catalog';
import { HIRING_PAPERS, type HiringPaper } from './hiring-papers';
import { jobKey, matchesJob } from '../../shared/job-match';
import { jobsFor, preparedSections } from './hiring-templates.sync';

const paper = (key: string): HiringPaper => {
  const found = HIRING_PAPERS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`no paper ${key}`);
  return found;
};
const CONTRACT = paper('egycash.hiring.contract');
const WEAPON = paper('egycash.hiring.weapon');
const CARDS = HIRING_PAPERS.filter((p) => p.key.startsWith('egycash.hiring.card.'));

/** Which job papers (the weapon declaration and the cards) a job named `name` prints. */
const papersFor = (name: string): string[] =>
  HIRING_PAPERS.filter((p) => p.jobs !== 'all' && matchesJob(p.jobs, name)).map((p) => p.key);

const SAMPLES: ContractVariableValue[] = CONTRACT_VARIABLE_CATALOG.map((v) => ({
  key: v.key,
  value: v.sample,
  source: v.source,
  overriddenBy: null,
}));

describe('the thirteen papers', () => {
  it('are the contract, five forms for every job and seven job description cards', () => {
    expect(HIRING_PAPERS).toHaveLength(13);
    expect(new Set(HIRING_PAPERS.map((p) => p.key)).size).toBe(13);
    expect(HIRING_PAPERS.filter((p) => p.kind === 'contract')).toEqual([CONTRACT]);
    expect(HIRING_PAPERS.filter((p) => p.kind === 'form' && p.jobs === 'all')).toHaveLength(4);
    expect(CARDS).toHaveLength(7);
  });

  it('print the contract first, one copy, for every job', () => {
    expect(CONTRACT.jobs).toBe('all');
    expect(CONTRACT.printOrder).toBe(0);
    for (const p of HIRING_PAPERS.filter((x) => x !== CONTRACT)) expect(p.printOrder).toBeGreaterThan(0);
  });

  it('are stored exactly as written — the sanitizer drops nothing from them', () => {
    for (const p of HIRING_PAPERS) expect(preparedSections(p).sections, p.key).toEqual(p.sections);
  });

  it('use only variables the catalog knows, so every one of them can publish', () => {
    for (const p of HIRING_PAPERS) {
      const unknown = preparedSections(p).placeholders.filter((key) => !CATALOG_KEYS.has(key));
      expect(unknown, p.key).toEqual([]);
    }
    expect(preparedSections(CONTRACT).placeholders).toEqual(
      expect.arrayContaining([
        'employee.fullName',
        'employee.nationalId',
        'job.title',
        'contract.startDate',
        'contract.endDate',
        'salary.fixed',
        'salary.attendanceBonus',
        'salary.gross',
        'salary.grossInWords',
      ]),
    );
  });

  it('name every paper in both languages, and label every signature', () => {
    for (const p of HIRING_PAPERS) {
      expect(p.name.ar.trim(), p.key).not.toBe('');
      expect(p.name.en.trim(), p.key).not.toBe('');
      for (const block of p.signatures) expect(block.label.trim(), p.key).not.toBe('');
    }
  });

  it('carry none of the sample employee the bank letter was sent with', () => {
    const all = JSON.stringify(HIRING_PAPERS);
    expect(all).not.toMatch(/\d{14}/); // a national ID
    expect(all).not.toMatch(/01\d{9}/); // a mobile number
    expect(all).not.toMatch(/\d{6}/); // an employee code
    expect(all).not.toMatch(/[A-Z]:\\/); // a path on somebody's computer
  });
});

describe('what they print', () => {
  it('fills the contract from the employee — the salary split and in words, one year', () => {
    const html = renderContractHtml({ ...CONTRACT, language: 'ar' }, SAMPLES);
    expect(html).toContain('بسم الله الرحمن الرحيم');
    expect(html).toContain('عقد عمل محدد المدة');
    expect(html).toContain('السيد/ أحمد محمد علي المقيم في القاهرة ويحمل رقم قومي 29001011234567');
    expect(html).toContain('تبدأ من 2026-08-01 وتنتهي في 2027-07-31');
    expect(html).toContain('<td>7,000 جنيها</td>');
    expect(html).toContain('<td>3,000 جنيها</td>');
    expect(html).toContain('( فقط عشرة آلاف جنيه لا غير )');
    expect(html).toContain('EGYCASH-HR-F-10-04');
    expect(html).not.toContain('{{');
  });

  it('fills every form, and leaves a line where the record has nothing', () => {
    for (const p of HIRING_PAPERS.filter((x) => x.kind === 'form')) {
      const filled = renderFormHtml({ ...p, language: 'ar' }, SAMPLES, { logoDataUri: 'data:,', lines: ['شركة'] });
      expect(filled, p.key).not.toContain('{{');
      const empty = renderFormHtml({ ...p, language: 'ar' }, [], { logoDataUri: 'data:,', lines: ['شركة'] });
      expect(empty, p.key).toContain('<span class="blank">&nbsp;</span>');
    }
  });

  it('puts the employee\'s code into the bank letter, twice, and leaves the bank branch to fill in', () => {
    const body = paper('egycash.hiring.bank-letter').sections.body;
    expect(body.match(/\{\{employee\.employeeCode\}\}/g)).toHaveLength(2);
    expect(body).toContain('ربط الحساب بكود الشركة (12879)');
    expect(body).toMatch(/فرع \/ \.{10,}/);
  });

  it('dates the work receipt by the first working day, and names the place of work', () => {
    const body = paper('egycash.hiring.work-receipt').sections.body;
    expect(body).toContain('{{employment.startDayName}} الموافق {{employment.startDate}}');
    for (const key of ['branch.name', 'department.name', 'job.title']) expect(body).toContain(`{{${key}}}`);
  });

  it('asks the crew leader for his licence\'s expiry on the weapon declaration', () => {
    expect(WEAPON.sections.body).toContain('{{employee.weaponLicenseExpiry}}');
  });
});

describe('which job prints which paper — matched by the job\'s name', () => {
  it('folds the spellings a job title is typed with', () => {
    expect(jobKey('أخصائى عد و فرز')).toBe(jobKey('اخصائي عد وفرز'));
    expect(jobKey('أمين خزينة')).toBe(jobKey('امين خزينه'));
    expect(jobKey('أخصائى صراف آلى')).toBe(jobKey('اخصائى صراف الى'));
  });

  it('gives each job its own card', () => {
    expect(papersFor('اخصائى صراف الى')).toEqual(['egycash.hiring.card.atm-specialist']);
    expect(papersFor('اخصائي عد وفرز')).toEqual(['egycash.hiring.card.counting-specialist']);
    expect(papersFor('أخصائي نقل أموال')).toEqual(['egycash.hiring.card.cit-specialist']);
    expect(papersFor('اخصائي تجهيز')).toEqual(['egycash.hiring.card.preparation-specialist']);
    expect(papersFor('امين خزينة')).toEqual(['egycash.hiring.card.treasurer']);
    expect(papersFor('مراقب امن')).toEqual(['egycash.hiring.card.security-guard']);
  });

  it('gives the weapon declaration to crew leaders only — «قائد طاقم»', () => {
    expect(papersFor('قائد طاقم')).toEqual(['egycash.hiring.weapon', 'egycash.hiring.card.atm-crew-leader']);
    expect(papersFor('قائد طاقم صراف آلي')).toEqual(['egycash.hiring.weapon', 'egycash.hiring.card.atm-crew-leader']);
    // Another crew leader signs the declaration, but the ATM card is not his.
    expect(papersFor('قائد طاقم نقل أموال')).toEqual(['egycash.hiring.weapon']);
    expect(papersFor('اخصائى صراف الى')).not.toContain('egycash.hiring.weapon');
  });

  it('takes a grade after the name, and nothing that merely shares a word', () => {
    expect(papersFor('أمين خزينة أول')).toEqual(['egycash.hiring.card.treasurer']);
    expect(papersFor('مشرف تشغيل صراف آلي')).toEqual([]);
    expect(papersFor('سائق')).toEqual([]);
    expect(papersFor('قائد')).toEqual([]);
  });

  it('lists the matching jobs\' ids, and none for a paper every job prints', () => {
    const leader = { _id: new Types.ObjectId(), name: { ar: 'قائد طاقم' } };
    const driver = { _id: new Types.ObjectId(), name: { ar: 'سائق' } };
    expect(jobsFor(WEAPON.jobs, [leader, driver])).toEqual([leader._id]);
    expect(jobsFor(CONTRACT.jobs, [leader, driver])).toEqual([]);
  });
});
