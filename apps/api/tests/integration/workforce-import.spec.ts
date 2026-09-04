// The workforce importer, end to end, against a real database and a real workbook.
//
// The parsing and planning are covered exhaustively by unit tests (`src/workforce-import/*.spec.ts`,
// 81 cases). This suite covers the half those cannot reach: what actually lands in the registry.
// The claims it makes are the ones the whole exercise turns on —
//
//   • the employee code that comes out is the code the company put in, byte for byte;
//   • no login is created and nothing is sent to anybody;
//   • a person who left and came back is ONE employee with two periods, not two employees;
//   • the insurance wages never become pay;
//   • a dry run writes nothing at all;
//   • a second run imports nobody twice.
//
// The workbook is BUILT here rather than committed, so the fixture states its own shape: the
// two-row Master header, the duplicated `جهة الحصول`/`تاريخ المؤهل` columns, and the Resignation
// sheet's one-row header are all reproduced, because those are what the reader has to survive.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { employeeRepository } from '../../src/modules/hr/employee-management/employees';
import { runImport } from '../../src/workforce-import/run';
import { nextNationalId } from './helpers/national-id';

let replSet: MongoMemoryReplSet | null = null;
let dir = '';
let adminId = '';

/** Master's real column order, row 2. Row 1 carries the merged band titles. */
const MASTER_HEADERS = [
  '#', 'code', 'الاسم', 'Name', 'تاريخ التعيين', 'الموقع', 'Location', 'الإدارة', 'Department',
  'القسم', 'Section', 'الوظيفة', 'Title', 'c1', 'تاريخ الميلاد', 'السن', 'الرقم القومى',
  'تاريخ الانتهاء', 'تاريخ انتهاء ترخيص القيادة', 'محافظة الميلاد', 'محافظة السكن', 'العنوان',
  'رقم الهاتف', 'رقم هاتف الطوارئ', 'الحالة الاجتماعية', 'الديانة', 'c2', 'المؤهل الدراسي',
  'القسم \\ الشعبة', 'جهة الحصول', 'تاريخ المؤهل', 'مؤهلات اخرى', 'جهة الحصول', 'تاريخ المؤهل',
  'c3', 'الموقف من التجنيد', 'تاريخ التحديث', 'ظابط احتياط', 'c4', 'الرقم التاميني', 'المهنة',
  'كود المهنة', 'الاجر الشامل', 'اجر الاشتراك', 'الاجر الأساسي', 'حصة الشركة', 'حصة العامل', 'c5',
  'رخصة السلاح', 'تاريخ انتهاء رخصة السلاح', 'الرتبة', 'مزاولة المهنة',
  'تاريخ الاحالة للمعاش للظباط', 'c 6', 'حافز', 'خبرة سابقة',
];

/** Resignation = Master minus the leading `#`, plus the five exit columns. */
const RESIGNATION_HEADERS = [
  ...MASTER_HEADERS.slice(1),
  'سبب الإستبعاد', 'تاريخ الإستبعاد', 'الحالة التأمينية', 'حالة إخلاء الطرف', 'ملاحظات',
];

interface Person {
  code: string;
  nationalId: string;
  name: string;
  hired: Date;
  site: string;
  exit?: { reason: string; date: Date };
}

type Cell = string | number | Date | null;

/** Fill a row by header name, so the fixture reads as data rather than as column arithmetic. */
const fill = (
  headers: string[],
  values: Record<string, Cell>,
  dupes: Record<number, Cell> = {},
): Cell[] => {
  const row: Cell[] = headers.map((h) => values[h] ?? null);
  for (const [index, value] of Object.entries(dupes)) row[Number(index)] = value;
  return row;
};

const personRow = (headers: string[], p: Person): Cell[] =>
  fill(
    headers,
    {
      '#': 1,
      code: p.code,
      الاسم: p.name,
      'تاريخ التعيين': p.hired,
      الموقع: p.site,
      الإدارة: 'الصراف الالى',
      القسم: 'التشغيل',
      الوظيفة: 'اخصائى صراف الى',
      'الرقم القومى': p.nationalId,
      'رقم الهاتف': '01125232225',
      'الحالة الاجتماعية': 'متزوج',
      'المؤهل الدراسي': 'بكالوريوس تجاره',
      'الموقف من التجنيد': 'ادى الخدمه',
      'الرقم التاميني': '17987259',
      المهنة: 'اخصائي',
      'كود المهنة': '110510',
      'الاجر الشامل': 12600,
      'اجر الاشتراك': 12600,
      // The bracket. It must never become the employee's salary.
      'الاجر الأساسي': 2370,
      'حصة الشركة': 2362.5,
      'حصة العامل': 1386,
      'رخصة السلاح': 'شركة',
      الرتبة: 'عميد',
      'ظابط احتياط': 1,
      'مؤهلات اخرى': 'ماجستير اداره اعمال',
      ...(p.exit === undefined
        ? {}
        : { 'سبب الإستبعاد': p.exit.reason, 'تاريخ الإستبعاد': p.exit.date }),
    },
    // The duplicated headers, addressed by INDEX because that is the only way to tell them apart —
    // which is the whole point of the reader binding by occurrence.
    headers === MASTER_HEADERS
      ? { 29: 'جامعة القاهره', 30: 2004, 32: 'جامعة اسكندرية', 33: 2015 }
      : { 28: 'جامعة القاهره', 29: 2004, 31: 'جامعة اسكندرية', 32: 2015 },
  );

const writeWorkbook = async (path: string, master: Person[], resignation: Person[]): Promise<void> => {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet('Master');
  m.addRow(MASTER_HEADERS.map(() => null)); // row 1: the merged band titles
  m.addRow(MASTER_HEADERS);
  for (const p of master) m.addRow(personRow(MASTER_HEADERS, p));
  const r = wb.addWorksheet('Resignation');
  r.addRow(RESIGNATION_HEADERS);
  for (const p of resignation) r.addRow(personRow(RESIGNATION_HEADERS, p));
  await wb.xlsx.writeFile(path);
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = replSet.getUri(`ecms-workforce-import-${Date.now()}`);
  await bootPlatform({ modules: moduleManifests });
  dir = await mkdtemp(join(tmpdir(), 'workforce-import-'));
  const admin = await userService.create(
    {
      email: 'import-admin@ecms.local',
      firstName: { ar: 'م', en: 'A' },
      lastName: { ar: 'م', en: 'A' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(admin.user._id);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('the workforce importer', () => {
  it('imports the company’s own employee codes, byte for byte, with nothing sent to anybody', async () => {
    const file = join(dir, 'basic.xlsx');
    const nid = nextNationalId();
    await writeWorkbook(
      file,
      [{ code: '0100004', nationalId: nid, name: 'جمال احمد محمد', hired: new Date('2020-01-05T00:00:00.000Z'), site: 'المهندسين' }],
      [],
    );

    const dry = await runImport({ file, write: false, actorId: adminId });
    expect(dry.mode).toBe('dry-run');
    expect(dry.counts.people).toBe(1);
    // A dry run must leave the database exactly as it found it.
    expect(await employeeRepository.findByCodeSystem('0100004')).toBeNull();

    const report = await runImport({ file, write: true, actorId: adminId });
    expect(report.counts.imported).toBe(1);
    expect(report.counts.failed).toBe(0);

    const employee = await employeeRepository.findByCodeSystem('0100004');
    expect(employee).not.toBeNull();
    // THE claim: `010` + `0004`, exactly as it is printed on their contract.
    expect(employee?.code).toBe('0100004');
    expect(employee?.employeeNumber).toBe('0004');
    // No account, so no WhatsApp message and no email. This is the assertion that stands between
    // an import and ~1,670 real people receiving a password they never asked for.
    expect(employee?.userId).toBeNull();
    expect(employee?.status).toBe('active');
    expect(employee?.origin).toBe('direct');
  }, 240_000);

  it('keeps the insurance file, and never lets its wages become pay', async () => {
    const employee = await employeeRepository.findByCodeSystem('0100004');
    expect(employee?.insurance?.insuranceNumber).toBe('17987259');
    expect(employee?.insurance?.basicWage).toBe(2370);
    expect(employee?.insurance?.employerShare).toBe(2362.5);
    // The statutory bracket did NOT become a salary — the separation the whole model exists for.
    expect(employee?.employment.salary).toBeNull();
  });

  it('keeps the officer profile, including the rank the military status folded away', async () => {
    const employee = await employeeRepository.findByCodeSystem('0100004');
    expect(employee?.officer?.rank).toBe('عميد');
    expect(employee?.officer?.weaponLicense?.type).toBe('company');
    expect(employee?.officer?.reserveOfficer).toBe(true);
    // `ظابط` mapped to "served"; the rank itself survives here rather than being lost to the fold.
    expect(employee?.personal.military?.status).toBe('completed');
  });

  /**
   * The duplicate-header trap, proven at the far end. Both `جهة الحصول` columns are filled with
   * different values; reading by header alone keeps the SECOND, so the primary qualification's
   * institution would silently become the postgraduate one's.
   */
  it('reads the FIRST of each duplicated column into the primary qualification', async () => {
    const employee = await employeeRepository.findByCodeSystem('0100004');
    expect(employee?.personal.education?.institution).toBe('جامعة القاهره');
    expect(employee?.personal.education?.graduationYear).toBe(2004);
    // And the second qualification is kept rather than dropped — `education` holds only one.
    expect(employee?.personal.certifications.join(' ')).toContain('ماجستير اداره اعمال');
    expect(employee?.personal.certifications.join(' ')).toContain('جامعة اسكندرية');
  });

  it('is idempotent — a second run imports nobody twice', async () => {
    const file = join(dir, 'basic.xlsx');
    const again = await runImport({ file, write: true, actorId: adminId });
    expect(again.counts.imported).toBe(0);
    expect(again.counts.alreadyPresent).toBe(1);
    expect(again.counts.failed).toBe(0);
  }, 240_000);

  /**
   * The rehire case, and the reason identity is the national ID rather than the code: this person
   * left branch 010 and came back under a code from branch 050. Joined on the code they would be
   * two people; joined on the national ID they are one, with two periods behind them.
   */
  it('makes a rehire ONE employee with two periods, under their current code', async () => {
    const file = join(dir, 'rehire.xlsx');
    const nid = nextNationalId();
    await writeWorkbook(
      file,
      [{ code: '0502001', nationalId: nid, name: 'عمر رضا', hired: new Date('2023-06-01T00:00:00.000Z'), site: 'الاسكندرية' }],
      [
        {
          code: '0100226',
          nationalId: nid,
          name: 'عمر رضا',
          hired: new Date('2018-03-01T00:00:00.000Z'),
          site: 'المهندسين',
          exit: { reason: 'استقالة', date: new Date('2021-02-28T00:00:00.000Z') },
        },
      ],
    );

    const report = await runImport({ file, write: true, actorId: adminId });
    expect(report.counts.people).toBe(1);
    expect(report.counts.imported).toBe(1);

    // The old code belongs to nobody: it was the same person, not a second one.
    expect(await employeeRepository.findByCodeSystem('0100226')).toBeNull();
    const employee = await employeeRepository.findByCodeSystem('0502001');
    expect(employee).not.toBeNull();
    expect(employee?.status).toBe('active');
    expect(employee?.employmentPeriods).toHaveLength(2);
    expect(employee?.employmentPeriods[0]?.exitType).toBe('resignation');
    expect(employee?.employmentPeriods[0]?.exitedAt?.toISOString()).toBe('2021-02-28T00:00:00.000Z');
    // The open period is the one they are serving now, and they carry no exit.
    expect(employee?.employmentPeriods[1]?.exitedAt).toBeNull();
    expect(employee?.exit).toBeNull();
  }, 240_000);

  it('imports somebody who left as exited, under their last exit', async () => {
    const file = join(dir, 'exited.xlsx');
    await writeWorkbook(file, [], [
      {
        code: '0300857',
        nationalId: nextNationalId(),
        name: 'مصطفى عبد الباسط',
        hired: new Date('2019-01-01T00:00:00.000Z'),
        site: 'اسيوط',
        exit: { reason: 'انقطاع', date: new Date('2022-09-30T00:00:00.000Z') },
      },
    ]);

    const report = await runImport({ file, write: true, actorId: adminId });
    expect(report.counts.imported).toBe(1);

    const employee = await employeeRepository.findByCodeSystem('0300857');
    expect(employee?.status).toBe('exited');
    // `انقطاع` is absconding — the company ended it, so a termination rather than a resignation.
    expect(employee?.exit?.type).toBe('termination');
    expect(employee?.exit?.effectiveDate.toISOString()).toBe('2022-09-30T00:00:00.000Z');
    // Nobody recorded a rehire decision in 2022, so none is invented; the company decides later.
    expect(employee?.exit?.eligibleForRehire).toBe(true);
    expect(employee?.employmentPeriods).toHaveLength(1);
    expect(employee?.employmentPeriods[0]?.exitedAt).not.toBeNull();
  }, 240_000);

  /**
   * The counter has to end up past everything the import used, or the next real hire is allocated
   * `0001` and collides with an imported employee on `ux_code` — an import that looked fine and
   * hiring that breaks the following week.
   */
  it('advances the global counter past every imported number', async () => {
    const file = join(dir, 'high.xlsx');
    await writeWorkbook(
      file,
      [{ code: '0102717', nationalId: nextNationalId(), name: 'سعيد فتحي', hired: new Date('2021-05-01T00:00:00.000Z'), site: 'المهندسين' }],
      [],
    );
    await runImport({ file, write: true, actorId: adminId });

    const { nextEmployeeNumber } = await import(
      '../../src/modules/hr/employee-management/employees/employee-sequence'
    );
    expect(Number(await nextEmployeeNumber())).toBeGreaterThan(2717);
  }, 240_000);

  it('refuses the workbook when a sheet is missing rather than importing half of it', async () => {
    const file = join(dir, 'broken.xlsx');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Master').addRow(['nothing', 'like', 'the', 'real', 'thing']);
    await wb.xlsx.writeFile(file);
    await expect(runImport({ file, write: false, actorId: adminId })).rejects.toThrow(
      /does not have the expected layout/u,
    );
  }, 240_000);
});
