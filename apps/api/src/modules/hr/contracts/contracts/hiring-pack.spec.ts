// «مستندات التعيين» (A27) — the pieces of the printed set that carry rules, without a database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import {
  pageFootCells,
  renderContractHtml,
  renderFormHtml,
  renderHiringPackHtml,
  type HiringPackPart,
  type Letterhead,
} from './contract-render';
import { dayNameOf, formatTemplateDate } from './contract-variables';
import { appliesToJob, oneYearFrom, templatesForJob } from './hiring-pack.service';

const DRIVER = new Types.ObjectId();
const GUARD = new Types.ObjectId();

const template = (over: Partial<ContractTemplateDoc>): ContractTemplateDoc =>
  ({
    _id: new Types.ObjectId(),
    key: String(new Types.ObjectId()),
    name: { ar: 'قالب', en: 'Template' },
    language: 'ar',
    sections: { header: '', body: '<p>{{employee.fullName}}</p>', footer: '' },
    signatures: [],
    ...over,
  }) as unknown as ContractTemplateDoc;

const LETTERHEAD: Letterhead = { logoDataUri: 'data:image/png;base64,AAAA', lines: ['شركة', 'إدارة الموارد البشرية'] };

describe('which documents an employee\'s job prints', () => {
  const contract = template({ name: { ar: 'العقد', en: 'Contract' }, kind: 'contract', printOrder: 1 });
  const legacy = template({ name: { ar: 'عقد قديم', en: 'Old' } }); // written before A27: no print fields
  const sheet = template({ name: { ar: 'صحيفة البيانات', en: 'Data sheet' }, kind: 'form', allJobs: true, printOrder: 10 });
  const driverCard = template({
    name: { ar: 'بطاقة السائق', en: 'Driver card' },
    kind: 'form',
    allJobs: false,
    jobTitleIds: [DRIVER],
    printOrder: 20,
  });
  const weapon = template({
    name: { ar: 'إقرار سلاح', en: 'Weapon' },
    kind: 'form',
    allJobs: false,
    jobTitleIds: [GUARD],
    printOrder: 30,
  });
  const unassigned = template({ name: { ar: 'بلا وظائف', en: 'None' }, kind: 'form', allJobs: false, jobTitleIds: [] });

  it('prints a form for its jobs only — and one for no job for nobody, not for everybody', () => {
    expect(appliesToJob(driverCard, String(DRIVER))).toBe(true);
    expect(appliesToJob(driverCard, String(GUARD))).toBe(false);
    expect(appliesToJob(unassigned, String(DRIVER))).toBe(false);
    expect(appliesToJob(sheet, String(GUARD))).toBe(true);
  });

  it('reads a template from before A27 as a contract for every job', () => {
    const { contracts, forms } = templatesForJob([legacy], String(DRIVER));
    expect(contracts).toEqual([legacy]);
    expect(forms).toEqual([]);
  });

  it('splits contracts from forms and keeps each job\'s forms in print order', () => {
    const all = [weapon, driverCard, sheet, contract, unassigned];
    const driver = templatesForJob(all, String(DRIVER));
    expect(driver.contracts).toEqual([contract]);
    expect(driver.forms.map((f) => f.name.ar)).toEqual(['صحيفة البيانات', 'بطاقة السائق']);
    expect(templatesForJob(all, String(GUARD)).forms.map((f) => f.name.ar)).toEqual(['صحيفة البيانات', 'إقرار سلاح']);
  });
});

describe('the contract the set makes', () => {
  it('runs one year, ending the day before the anniversary — «مدة هذا العقد هي عام واحد»', () => {
    expect(oneYearFrom(new Date('2026-11-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-11-14');
    expect(oneYearFrom(new Date('2028-02-29T00:00:00Z')).toISOString().slice(0, 10)).toBe('2029-02-28');
  });
});

describe('dates on the company\'s papers', () => {
  it('writes day/month/year in Arabic, as the papers do, and ISO in English', () => {
    expect(formatTemplateDate('2026-11-15', 'ar')).toBe('15/11/2026');
    expect(formatTemplateDate(new Date('2026-04-21T00:00:00Z'), 'ar')).toBe('21/4/2026');
    expect(formatTemplateDate('2026-11-15', 'en')).toBe('2026-11-15');
    expect(formatTemplateDate(null, 'ar')).toBe('');
  });

  it('names the day of the date itself', () => {
    expect(dayNameOf('2026-11-15', 'ar')).toBe('الأحد');
    expect(dayNameOf('2026-11-15', 'en')).toBe('Sunday');
  });
});

describe('a hiring form', () => {
  const form = template({ kind: 'form', sections: { header: '', body: '<p>{{employee.fullName}} — {{employee.phone}}</p>', footer: '' } });

  it('wears the letterhead inside its page frame', () => {
    const html = renderFormHtml(form, [{ key: 'employee.fullName', value: 'أحمد', source: 'employee', overriddenBy: null }], LETTERHEAD);
    expect(html).toContain('class="form-doc"');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('إدارة الموارد البشرية');
    expect(html).toContain('أحمد');
  });

  it('prints a dotted line to fill in by hand where the record holds nothing', () => {
    const html = renderFormHtml(
      form,
      [
        { key: 'employee.fullName', value: 'أحمد', source: 'employee', overriddenBy: null },
        { key: 'employee.phone', value: '', source: 'employee', overriddenBy: null },
      ],
      LETTERHEAD,
    );
    expect(html).toContain('أحمد — <span class="blank">&nbsp;</span>');
  });
});

describe('the printed set', () => {
  const contract = template({ kind: 'contract', sections: { header: '', body: '<p>CONTRACT {{employee.fullName}}</p>', footer: '' } });
  const formA = template({ kind: 'form', sections: { header: '', body: '<p>FORM-A</p>', footer: '' } });
  const formB = template({ kind: 'form', sections: { header: '', body: '<p>FORM-B</p>', footer: '' } });
  const values = [{ key: 'employee.fullName', value: 'أحمد', source: 'employee' as const, overriddenBy: null }];

  const html = renderHiringPackHtml(
    [
      { kind: 'contract', template: contract, values, options: {} },
      { kind: 'form', template: formA, values: [] },
      { kind: 'form', template: formB, values: [] },
    ],
    'ar',
    LETTERHEAD,
  );

  it('is one document, the contract first, every later part on a fresh page', () => {
    expect(html.indexOf('CONTRACT أحمد')).toBeLessThan(html.indexOf('FORM-A'));
    expect(html.indexOf('FORM-A')).toBeLessThan(html.indexOf('FORM-B'));
    expect(html.match(/break-before: page/g)).toHaveLength(2);
    expect(html.match(/<!doctype html>/g)).toHaveLength(1);
  });

  it('frames the forms and not the contract', () => {
    const contractSection = html.slice(html.indexOf('doc-contract'), html.indexOf('doc-form'));
    expect(contractSection).not.toContain('form-doc');
    expect(html.match(/class="form-doc"/g)).toHaveLength(2);
    // The frame is the border of the forms' own named page, so it closes on every page they run
    // over; the contract stays on the default page, unframed.
    expect(html).toContain('@page form { margin: 12mm; border: 1.5px solid #111;');
    expect(html).toContain('.doc-form { page: form; }');
    expect(html.match(/class="doc doc-form"/g)).toHaveLength(2);
    expect(html).not.toContain('form-frame');
  });
});

describe('the salary on the contract', () => {
  it('splits the gross the way the register screen does, and writes it out in words', async () => {
    const { resolveContractVariables } = await import('./contract-variables');
    const employee = {
      employment: { salary: { amount: 10000, currency: 'EGP' } },
    } as unknown as Parameters<typeof resolveContractVariables>[1]['employee'];
    const { values } = await resolveContractVariables(
      ['salary.gross', 'salary.fixed', 'salary.attendanceBonus', 'salary.grossInWords'],
      { employee, code: '', startDate: '', endDate: null, language: 'ar', overrides: {}, overriddenBy: null },
    );
    expect(Object.fromEntries(values.map((v) => [v.key, v.value]))).toEqual({
      'salary.gross': '10,000',
      'salary.fixed': '7,000',
      'salary.attendanceBonus': '3,000',
      'salary.grossInWords': 'عشرة آلاف جنيه لا غير',
    });
  });
});

describe('his contract as printed — the page foot, the page number, the basmala (A27)', () => {
  const FOOT =
    '<table class="foot"><tbody><tr><td>EGYCASH-HR-F-10-04</td><td>Issue / Rev. no.: 1/0</td><td>Issue date: 1/5/2022</td></tr></tbody></table>';
  const contract = (footer: string, body = '<p>نص</p>') =>
    template({ kind: 'contract', sections: { header: '', body, footer } });
  const part = (footer: string, body?: string): HiringPackPart => ({
    kind: 'contract',
    template: contract(footer, body),
    values: [],
    options: {},
  });
  const form: HiringPackPart = { kind: 'form', template: template({ kind: 'form' }), values: [] };

  it('reads the doc-control line cell by cell, and nothing else as one', () => {
    expect(pageFootCells(FOOT)).toEqual(['EGYCASH-HR-F-10-04', 'Issue / Rev. no.: 1/0', 'Issue date: 1/5/2022']);
    expect(pageFootCells('<p>تذييل</p>')).toBeNull();
    expect(pageFootCells('')).toBeNull();
  });

  it('prints it at the foot of every page, and the page number from the second page', () => {
    const html = renderContractHtml(contract(FOOT), []);
    expect(html).toContain('@bottom-center { content: "EGYCASH-HR-F-10-04');
    expect(html).toContain('@top-center { content: "- " counter(page) " -"');
    expect(html).toContain('@page :first { @top-center { content: none; } }');
    // On screen (no pages) the line shows under the text instead.
    expect(html).toContain('<div class="page-foot"><table class="foot">');
    // A contract without one prints as before.
    expect(renderContractHtml(contract('<p>تذييل</p>'), [])).not.toContain('@bottom-center');
  });

  it('numbers a printed set only when it holds one contract, and never a form\'s page', () => {
    const one = renderHiringPackHtml([part(FOOT), form], 'ar', LETTERHEAD);
    expect(one).toContain('counter(page)');
    expect(one).toContain('@page form { @top-center { content: none; } @bottom-center { content: none; } }');
    const two = renderHiringPackHtml([part(FOOT), form, part(FOOT)], 'ar', LETTERHEAD);
    expect(two).not.toContain('counter(page)');
    expect(two).toContain('@bottom-center { content: "EGYCASH-HR-F-10-04');
  });

  it('can never close the style with what a footer holds', () => {
    // Tags are dropped from the line; a bare «<», a quote and a backslash are escaped.
    const html = renderContractHtml(
      contract('<table class="foot"><tbody><tr><td>a"b\\c </style x</td><td>y<script>z</td></tr></tbody></table>'),
      [],
    );
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
    expect(style).toContain('content: "a\\"b\\\\c \\3c /style x          yz"');
    expect(style.match(/<\/style>/g)).toHaveLength(1);
    expect(style).not.toContain('<script>');
  });

  it('carries the basmala picture only in a document that uses it', () => {
    expect(renderContractHtml(contract(FOOT, '<p class="basmala">بسم الله الرحمن الرحيم</p>'), [])).toContain(
      'p.basmala { height: 11mm',
    );
    expect(renderContractHtml(contract(FOOT), [])).not.toContain('data:image/png;base64,iVBOR');
  });
});
