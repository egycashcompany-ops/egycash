// The owner's fourteen hiring papers as templates (A27, stage 2) — what each one prints, and for
// which jobs, without a database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { renderContractHtml, renderFormHtml } from '../contracts/contract-render';
import { type ContractVariableValue } from '../contracts/contract.model';
import { CATALOG_KEYS, CONTRACT_VARIABLE_CATALOG } from '../shared/variable-catalog';
import { HIRING_PAPERS, optionalForJob, type HiringPaper } from './hiring-papers';
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

describe('the fourteen papers', () => {
  it('are the contract, «نموذج رقم (1)», five more forms for every job and seven job description cards', () => {
    expect(HIRING_PAPERS).toHaveLength(14);
    expect(new Set(HIRING_PAPERS.map((p) => p.key)).size).toBe(14);
    expect(HIRING_PAPERS.filter((p) => p.kind === 'contract')).toEqual([CONTRACT]);
    // The weapon declaration among them — for every job, ticked for crew leaders only.
    expect(HIRING_PAPERS.filter((p) => p.kind === 'form' && p.jobs === 'all')).toHaveLength(6);
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

  it('prints every form but the bank letter BLANK, for the employee to write on by hand', () => {
    // «نموزج 1 و العقد و خطاب البنك هما الوحيدين اللي هيتملو … و الباقي لازم يكون فاضي».
    const forms = HIRING_PAPERS.filter((x) => x.kind === 'form');
    const filled = new Set(['egycash.hiring.bank-letter', 'egycash.hiring.insurance-form-1']);
    for (const p of forms.filter((x) => !filled.has(x.key))) {
      expect(preparedSections(p).placeholders, p.key).toEqual([]);
      const printed = renderFormHtml({ ...p, language: 'ar' }, SAMPLES, { logoDataUri: 'data:,', lines: ['شركة'] });
      expect(printed, p.key).not.toContain('أحمد محمد علي');
    }
    // The bank letter is filled, and leaves a line where the record has nothing.
    const letter = paper('egycash.hiring.bank-letter');
    const printed = renderFormHtml({ ...letter, language: 'ar' }, SAMPLES, { logoDataUri: 'data:,', lines: ['شركة'] });
    expect(printed).not.toContain('{{');
    const empty = renderFormHtml({ ...letter, language: 'ar' }, [], { logoDataUri: 'data:,', lines: ['شركة'] });
    expect(empty).toContain('<span class="blank">&nbsp;</span>');
  });

  it('prints his document-control line at the foot of the page, where his paper has one', () => {
    const codes: Record<string, string> = {
      'egycash.hiring.data-sheet': 'EGYCASH-HR-F-10-04',
      'egycash.hiring.work-receipt': 'EGYCASH-HR-F-10-05',
      'egycash.hiring.relatives': 'EGYCASH-HR-F-10-03',
    };
    for (const [key, code] of Object.entries(codes)) {
      const html = renderFormHtml({ ...paper(key), language: 'ar' }, [], { logoDataUri: 'data:,', lines: ['شركة'] });
      expect(html, key).toMatch(new RegExp(`<div class="form-foot"><table class="foot">.*${code}.*Issue / Rev\\. no\\.: 1/0.*Issue date: 1/5/2022`, 's'));
    }
    for (const p of [WEAPON, paper('egycash.hiring.bank-letter'), ...CARDS]) expect(p.sections.footer, p.key).toBe('');
  });

  it('prints his contract in his type: the basmala, starred clauses, the page foot', () => {
    const body = CONTRACT.sections.body;
    expect(body.startsWith('<p class="basmala">بسم الله الرحمن الرحيم</p>')).toBe(true);
    expect(body).toContain('<ul class="t14 l1 star">');
    expect(body).toContain('لدمة لا تقل عن خمس سنوات والا فيلتزن');
    expect(body).toContain('ونسة للتأمينات الإجتماعية');
    expect(CONTRACT.sections.header).toBe('');
    expect(CONTRACT.sections.footer).toContain('<table class="foot">');
    expect(CONTRACT.revision).toBe(2);
  });

  it('keeps his words as he spells them', () => {
    expect(paper('egycash.hiring.card.atm-specialist').sections.body).toContain('لماكينات الصراف اللآلي .');
    expect(paper('egycash.hiring.card.cit-specialist').sections.body).toContain('القيام بهمام تجهيز');
    expect(paper('egycash.hiring.card.treasurer').sections.body).toContain('عهده إداراة العمليات');
    expect(paper('egycash.hiring.card.atm-crew-leader').sections.body).toContain('اثتاء عمليه التغذيه');
    expect(paper('egycash.hiring.card.security-guard').sections.body).toContain('متاابعة ومراقبة');
    expect(WEAPON.sections.body).toContain('إدراة الـمـوارد الـبـشـريـة');
    expect(paper('egycash.hiring.bank-letter').sections.body).toContain('تفضلو بقبول فائق الاحترام');
    expect(paper('egycash.hiring.data-sheet').sections.body).toContain('رقم هاتف للطوارئى :');
  });

  it('sets each card in his own shape for it', () => {
    // Four columns and «الإدارة / الإطـار / الـمـسـئـولـية» …
    const columns = paper('egycash.hiring.card.atm-specialist').sections.body;
    expect(columns).toContain('<td><b>الـمـسـمـى الـوظـيـفـي :</b></td><td><b>أخـصـائـى صـراف آلـى</b>');
    expect(columns).toContain('الإطـار الـعـام للـوظـيـفة');
    expect(columns).toContain('نـطـاق الـمـسـئـولـية :');
    // … or each label and its value in one cell, «الادارة / الاطـار / الـمـسـئـولـيه».
    const joined = paper('egycash.hiring.card.security-guard').sections.body;
    expect(joined).toContain('<td><b>الادارة الـتـابـع لـهـا : ');
    expect(joined).toContain('الاطـار الـعـام للـوظـيـفة');
    expect(joined).toContain('نـطـاق الـمـسـئـولـيه :');
    // Both end with the name and signature left blank.
    for (const card of CARDS) expect(card.sections.body, card.key).toContain('<td><b>الإسم :</b></td></tr><tr><td><b>التوقيع :</b></td>');
  });

  it('puts the employee\'s code into the bank letter, twice, and leaves the bank branch to fill in', () => {
    const body = paper('egycash.hiring.bank-letter').sections.body;
    expect(body.match(/\{\{employee\.employeeCode\}\}/g)).toHaveLength(2);
    expect(body).toContain('ربط الحساب بكود الشركة (12879)');
    expect(body).toMatch(/فرع \/ \.{10,}/);
  });

  it('leaves the work receipt\'s day and five lines to write on', () => {
    const body = paper('egycash.hiring.work-receipt').sections.body;
    expect(body).toContain('أنـه فـى يـوم :');
    expect(body.match(/<td class="dots"><\/td>/g)).toHaveLength(5);
  });

  it('leaves the licence\'s expiry to write on the weapon declaration', () => {
    expect(WEAPON.sections.body).toMatch(/بتاريخ إنتهاء (&nbsp;)+\/(&nbsp;)+\/(&nbsp;)+202 /);
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

  it('gives the crew leader his ATM card — another crew leader none', () => {
    expect(papersFor('قائد طاقم')).toEqual(['egycash.hiring.card.atm-crew-leader']);
    expect(papersFor('قائد طاقم صراف آلي')).toEqual(['egycash.hiring.card.atm-crew-leader']);
    expect(papersFor('قائد طاقم نقل أموال')).toEqual([]);
  });

  it('offers the weapon declaration to every job, ticked for crew leaders only — «لكلو بس مطفيه وللقائد معموله mark»', () => {
    expect(WEAPON.jobs).toBe('all');
    expect(optionalForJob(WEAPON.key, 'قائد طاقم')).toBe(false);
    expect(optionalForJob(WEAPON.key, 'قائد طاقم نقل أموال')).toBe(false);
    expect(optionalForJob(WEAPON.key, 'أخصائي نقل أموال')).toBe(true);
    expect(optionalForJob(WEAPON.key, 'مراقب أمن')).toBe(true);
    // A job whose name is unknown is offered it unticked too.
    expect(optionalForJob(WEAPON.key, null)).toBe(true);
    // Every other paper is ticked for every job it prints for.
    for (const p of HIRING_PAPERS.filter((x) => x.key !== WEAPON.key)) {
      expect(optionalForJob(p.key, 'مراقب أمن'), p.key).toBe(false);
    }
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
    expect(jobsFor(paper('egycash.hiring.card.atm-crew-leader').jobs, [leader, driver])).toEqual([leader._id]);
    expect(jobsFor(CONTRACT.jobs, [leader, driver])).toEqual([]);
    expect(jobsFor(WEAPON.jobs, [leader, driver])).toEqual([]);
  });
});

describe('«نموذج رقم (1)» — the social-insurance registration', () => {
  const FORM = paper('egycash.hiring.insurance-form-1');
  const LETTERHEAD = { logoDataUri: 'data:image/png;base64,LOGO', lines: ['شركة'] };
  const value = (key: string, text: string): ContractVariableValue => ({ key, value: text, source: 'employee', overriddenBy: null });
  const html = renderFormHtml({ ...FORM, language: 'ar' }, [
    value('employee.nationalId', '29501011234567'),
    value('employee.fullName', 'أحمد محمد علي'),
    value('employment.startDay', '05'),
    value('employment.startMonth', '11'),
    value('employment.startYear', '2026'),
    value('company.name', 'إيجي كاش'),
  ], LETTERHEAD);

  it('prints for every job, right after the contract, filled from the record', () => {
    expect(FORM).toMatchObject({ kind: 'form', jobs: 'all', printOrder: 5 });
    expect(preparedSections(FORM).placeholders).toEqual(
      expect.arrayContaining(['employee.nationalId', 'employee.fullName', 'employment.startYear', 'company.name']),
    );
  });

  it('writes each digit in its own box, left to right, and leaves the rest of a row empty', () => {
    const boxes = (count: number, chars: string) =>
      `<span class="cells c${count}">${[...chars.padEnd(count, ' ')].map((c) => `<i>${c === ' ' ? '&nbsp;' : c}</i>`).join('')}</span>`;
    expect(html).toContain(boxes(14, '29501011234567'));
    expect(html).toContain(`${boxes(2, '05')} / ${boxes(2, '11')} / ${boxes(4, '2026')}`);
    expect(html).toContain(boxes(9, '')); // the insurance number the record does not hold
    expect(html).toContain(boxes(1, '✓')); // «عاملين لدى الغير»
  });

  it('registers the basic wage at 2720 pounds — «رقم 2720 دا يبقا الاجر الاساسي»', () => {
    expect(FORM.sections.body).toContain(
      '<b>*أجر أساسي:</b> <table class="mini" dir="ltr"><tbody><tr><td colspan="5">جنيـــه</td><td colspan="2">قرش</td></tr>' +
        '<tr><td>&nbsp;</td><td>2</td><td>7</td><td>2</td><td>0</td><td>0</td><td>0</td></tr>',
    );
  });

  it('wears its own head and emblem: no company letterhead, no frame', () => {
    expect(html).not.toContain('data:image/png;base64,LOGO');
    expect(html).toContain('<section class="doc doc-form doc-bare">');
    expect(html).toContain('p.nosi { height: 20mm');
    expect(html).toContain('<p class="newpage">'); // and its second page overleaf
  });
});
