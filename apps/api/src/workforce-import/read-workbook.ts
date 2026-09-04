// Reading the two sheets into `SourceRow`s — the only file in this feature that knows what Excel is.
//
// The column spec below IS the contract with the workbook. Every entry names the header it binds
// to and, where the header repeats, which occurrence: `جهة الحصول` and `تاريخ المؤهل` each appear
// twice, and the first of each pair is the primary qualification (see `columns.ts` for what goes
// wrong when that is read by header alone).
import ExcelJS from 'exceljs';
import { at, bindColumns, fingerprint, type ColumnRef } from './columns';
import { date, flag, nationalId, num, phone, text, year } from './cell';
import {
  educationLevel,
  exitType,
  insuranceStatus,
  militaryStatus,
  weaponLicenseType,
} from './vocabulary';
import { type SourceRow } from './plan';

/**
 * The Master sheet has TWO header rows — row 1 carries the merged band titles (بــيـانــات
 * شـخـصـيـة, المؤهلات الدراسية, …) and row 2 the real column names. Resignation has one.
 */
const HEADER_ROWS = { master: 2, resignation: 1 } as const;

/** Shared by both sheets: the Resignation sheet is the Master sheet minus its leading `#` column. */
const COMMON = {
  code: at('code'),
  fullNameAr: at('الاسم'),
  fullNameEn: at('Name'),
  hiredAt: at('تاريخ التعيين'),
  branchName: at('الموقع'),
  departmentName: at('الإدارة'),
  sectionName: at('القسم'),
  jobTitleName: at('الوظيفة'),
  nationalId: at('الرقم القومى'),
  nationalIdExpiry: at('تاريخ الانتهاء'),
  drivingLicenseExpiry: at('تاريخ انتهاء ترخيص القيادة'),
  governorate: at('محافظة السكن'),
  addressLine: at('العنوان'),
  primaryPhone: at('رقم الهاتف'),
  emergencyPhone: at('رقم هاتف الطوارئ'),
  maritalStatus: at('الحالة الاجتماعية'),
  religion: at('الديانة'),
  qualification: at('المؤهل الدراسي'),
  specialization: at('القسم \\ الشعبة'),
  // FIRST occurrence — the primary qualification's.
  institution: at('جهة الحصول', 0),
  graduationYear: at('تاريخ المؤهل', 0),
  additionalQualification: at('مؤهلات اخرى'),
  // SECOND occurrence — the additional qualification's.
  additionalInstitution: at('جهة الحصول', 1),
  additionalYear: at('تاريخ المؤهل', 1),
  militaryStatus: at('الموقف من التجنيد'),
  militaryUpdated: at('تاريخ التحديث'),
  reserveOfficer: at('ظابط احتياط'),
  insuranceNumber: at('الرقم التاميني'),
  occupation: at('المهنة'),
  occupationCode: at('كود المهنة'),
  grossWage: at('الاجر الشامل'),
  contributionWage: at('اجر الاشتراك'),
  basicWage: at('الاجر الأساسي'),
  employerShare: at('حصة الشركة'),
  employeeShare: at('حصة العامل'),
  weaponLicense: at('رخصة السلاح'),
  weaponLicenseExpiry: at('تاريخ انتهاء رخصة السلاح'),
  rank: at('الرتبة'),
  professionPractice: at('مزاولة المهنة'),
  retirementDate: at('تاريخ الاحالة للمعاش للظباط'),
  incentive: at('حافز'),
  priorExperience: at('خبرة سابقة'),
} satisfies Record<string, ColumnRef>;

const RESIGNATION_ONLY = {
  exitReason: at('سبب الإستبعاد'),
  exitDate: at('تاريخ الإستبعاد'),
  insuranceState: at('الحالة التأمينية'),
  note: at('ملاحظات'),
} satisfies Record<string, ColumnRef>;

export interface SheetReadError {
  sheet: string;
  problem: string;
}

export interface WorkbookRead {
  rows: SourceRow[];
  /** The layout the workbook actually had, one line per sheet — recorded in the run report. */
  fingerprints: { sheet: string; fingerprint: string }[];
}

/**
 * Read both sheets. Fails whole rather than partially: a workbook whose columns moved produces an
 * error list, never a half-mapped set of rows.
 */
export const readWorkbook = async (
  path: string,
): Promise<WorkbookRead | { errors: SheetReadError[] }> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const errors: SheetReadError[] = [];
  const rows: SourceRow[] = [];
  const fingerprints: { sheet: string; fingerprint: string }[] = [];

  for (const sheet of ['master', 'resignation'] as const) {
    const name = sheet === 'master' ? 'Master' : 'Resignation';
    const ws = wb.getWorksheet(name);
    if (ws === undefined) {
      errors.push({ sheet: name, problem: 'sheet not found in the workbook' });
      continue;
    }

    const headerRow = ws.getRow(HEADER_ROWS[sheet]);
    const headers: (string | null)[] = [];
    // `actualCellCount` skips trailing blanks; `columnCount` is the width we must walk to keep
    // indices aligned with the data rows below.
    for (let c = 1; c <= ws.columnCount; c += 1) {
      headers.push(cellText(headerRow.getCell(c).value));
    }
    fingerprints.push({ sheet: name, fingerprint: fingerprint(headers) });

    const spec = sheet === 'resignation' ? { ...COMMON, ...RESIGNATION_ONLY } : COMMON;
    const bound = bindColumns(headers, spec);
    if ('missing' in bound) {
      errors.push({ sheet: name, problem: `columns not found: ${bound.missing.join(', ')}` });
      continue;
    }
    // A union, not an intersection: the two sheets share the COMMON columns and only Resignation
    // carries the exit ones, so a Master row simply has no index for those. `cell` answers
    // `undefined` for an unbound column rather than reaching for column NaN.
    const col: Partial<Record<keyof typeof COMMON | keyof typeof RESIGNATION_ONLY, number>> =
      bound.columns;

    for (let r = HEADER_ROWS[sheet] + 1; r <= ws.rowCount; r += 1) {
      const excelRow = ws.getRow(r);
      const cell = (key: string): unknown => {
        const index = col[key as keyof typeof col];
        return index === undefined ? undefined : excelRow.getCell(index + 1).value;
      };
      // A row with no code and no name is spreadsheet padding, not an employee.
      if (text(cell('code')) === null && text(cell('fullNameAr')) === null) continue;
      rows.push(toSourceRow(sheet, r, cell));
    }
  }

  return errors.length > 0 ? { errors } : { rows, fingerprints };
};

/** ExcelJS hands back rich objects for formulas and hyperlinks; take the value a human would see. */
const cellText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null) {
    const o = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return text(o.richText.map((p) => p.text).join(''));
    if (o.text !== undefined) return text(o.text);
    if (o.result !== undefined) return text(o.result);
  }
  return text(value);
};

/** Same unwrapping, but for the cells whose value may legitimately be a Date or a number. */
const cellValue = (value: unknown): unknown => {
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const o = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join('');
    if (o.result !== undefined) return o.result;
    if (o.text !== undefined) return o.text;
  }
  return value;
};

const toSourceRow = (
  sheet: 'master' | 'resignation',
  rowNumber: number,
  raw: (key: string) => unknown,
): SourceRow => {
  const cell = (key: string): unknown => cellValue(raw(key));
  const str = (key: string): string | null => cellText(raw(key));

  const qualification = str('qualification');
  const militaryUpdated = cell('militaryUpdated');

  return {
    sheet,
    rowNumber,
    code: str('code'),
    nationalId: nationalId(cell('nationalId')),
    fullNameAr: str('fullNameAr'),
    fullNameEn: str('fullNameEn'),
    hiredAt: date(cell('hiredAt')),
    branchName: str('branchName'),
    departmentName: str('departmentName'),
    sectionName: str('sectionName'),
    jobTitleName: str('jobTitleName'),
    primaryPhone: phone(cell('primaryPhone')),
    emergencyPhone: phone(cell('emergencyPhone')),
    addressLine: str('addressLine'),
    governorate: str('governorate'),
    maritalStatus: str('maritalStatus'),
    religion: str('religion'),
    nationalIdExpiry: date(cell('nationalIdExpiry')),
    drivingLicenseExpiry: date(cell('drivingLicenseExpiry')),
    military: {
      status: militaryStatus(str('militaryStatus')),
      // `تاريخ التحديث` holds a date for some and the word `نهائي` (final) for others. Both are
      // real answers to "when was this last updated", so each goes to the field that can hold it.
      certificateRef: date(militaryUpdated) === null ? cellText(militaryUpdated) : null,
      completedAt: date(militaryUpdated),
    },
    education: {
      level: educationLevel(qualification),
      qualification,
      specialization: str('specialization'),
      institution: str('institution'),
      graduationYear: year(cell('graduationYear')),
    },
    additionalQualification: {
      qualification: str('additionalQualification'),
      institution: str('additionalInstitution'),
      year: year(cell('additionalYear')),
    },
    hasPriorExperience: flag(cell('priorExperience')),
    incentive: num(cell('incentive')),
    insurance: {
      insuranceNumber: str('insuranceNumber'),
      occupation: str('occupation'),
      occupationCode: str('occupationCode'),
      grossWage: num(cell('grossWage')),
      contributionWage: num(cell('contributionWage')),
      basicWage: num(cell('basicWage')),
      employerShare: num(cell('employerShare')),
      employeeShare: num(cell('employeeShare')),
      // Only the Resignation sheet records it; Master employees get it from HR later.
      status: sheet === 'resignation' ? insuranceStatus(str('insuranceState')) : null,
    },
    officer: {
      reserveOfficer: flag(cell('reserveOfficer')),
      rank: str('rank'),
      weaponLicenseType: weaponLicenseType(str('weaponLicense')),
      weaponLicenseExpiry: date(cell('weaponLicenseExpiry')),
      professionPractice: flag(cell('professionPractice')),
      retirementDate: date(cell('retirementDate')),
    },
    exit:
      sheet === 'resignation'
        ? {
            type: exitType(str('exitReason')),
            effectiveDate: date(cell('exitDate')),
            reason: str('exitReason'),
            note: str('note'),
          }
        : null,
  };
};
