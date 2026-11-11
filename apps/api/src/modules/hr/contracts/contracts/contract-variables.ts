// Variable resolution with provenance (frozen design D5 + A3/A16): resolves every
// placeholder the pinned template uses from employee / employment / organization /
// contract / company data, applies manual overrides (recorded as such), and returns a
// STRUCTURED validation report for anything required that stayed empty — generation
// fails loud, an unresolved {{…}} can never reach a document.
import { type Types } from 'mongoose';
import {
  amountInArabicWords,
  salaryBreakdown,
  type ContractVariableIssueDto,
  type ContractVariableSource,
  type EducationLevel,
  type MaritalStatus,
  type MilitaryStatus,
} from '@ecms/contracts';
import { branchService, departmentService, jobTitleService, organizationService } from '../../../../platform/organization';
import { cairoToday, dateOnlyIso } from '../../shared/business-date';
import { type EmployeeDoc } from '../../employee-management/employees/employee.model';
import { CONTRACT_VARIABLE_CATALOG, isRequiredVariable } from '../shared/variable-catalog';
import { type ContractVariableValue } from './contract.model';

interface ResolutionInput {
  employee: EmployeeDoc;
  code: string;
  startDate: string;
  endDate: string | null;
  language: 'ar' | 'en';
  overrides: Record<string, string>;
  overriddenBy: Types.ObjectId | null;
}

const addressOf = (employee: EmployeeDoc): string => {
  const addr = employee.personal.currentAddress ?? employee.personal.officialAddress;
  if (addr == null) return '';
  return Object.values(addr as unknown as Record<string, unknown>)
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('، ');
};

/**
 * A date as the template's language writes it: `15/11/2026` in Arabic (the company's papers write
 * day/month/year, no leading zeros), ISO in English. Input is an ISO date or a Date.
 */
export const formatTemplateDate = (value: string | Date | null, language: 'ar' | 'en'): string => {
  if (value === null || value === '') return '';
  const iso = typeof value === 'string' ? value : dateOnlyIso(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return iso;
  if (language === 'en') return `${match[1]}-${match[2]}-${match[3]}`;
  return `${Number(match[3])}/${Number(match[2])}/${match[1]}`;
};

const DAY_NAMES = {
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/** The weekday of an ISO date, by the calendar date itself (no timezone shift). */
export const dayNameOf = (value: string | Date | null, language: 'ar' | 'en'): string => {
  if (value === null || value === '') return '';
  const iso = typeof value === 'string' ? value : dateOnlyIso(value);
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? '' : DAY_NAMES[language][day] ?? '';
};

const MARITAL: Record<MaritalStatus, { ar: string; en: string }> = {
  single: { ar: 'أعزب', en: 'Single' },
  married: { ar: 'متزوج', en: 'Married' },
  divorced: { ar: 'مطلق', en: 'Divorced' },
  widowed: { ar: 'أرمل', en: 'Widowed' },
};
const MILITARY: Record<MilitaryStatus, { ar: string; en: string }> = {
  completed: { ar: 'أدى الخدمة', en: 'Completed' },
  exempted: { ar: 'معفى', en: 'Exempted' },
  postponed: { ar: 'مؤجل', en: 'Postponed' },
  serving: { ar: 'يؤدي الخدمة', en: 'Serving' },
  notApplicable: { ar: 'لا ينطبق', en: 'Not applicable' },
};
const EDUCATION: Record<EducationLevel, { ar: string; en: string }> = {
  none: { ar: 'بدون', en: 'None' },
  primary: { ar: 'ابتدائي', en: 'Primary' },
  preparatory: { ar: 'إعدادي', en: 'Preparatory' },
  secondary: { ar: 'ثانوي', en: 'Secondary' },
  diploma: { ar: 'دبلوم', en: 'Diploma' },
  bachelor: { ar: 'بكالوريوس', en: "Bachelor's" },
  master: { ar: 'ماجستير', en: "Master's" },
  doctorate: { ar: 'دكتوراه', en: 'Doctorate' },
};

/** An amount the way the company's papers print it: `7,000`, or `85.40` when there are piastres. */
const money = (amount: number): string =>
  amount.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

/** Resolve the catalog value for one key from live data ('' when absent). */
const resolveFromData = async (key: string, input: ResolutionInput): Promise<string> => {
  const { employee } = input;
  switch (key) {
    case 'employee.fullName':
      return employee.personal.fullNameAr;
    case 'employee.employeeCode':
      return employee.code;
    case 'employee.nationalId':
      return employee.personal.nationalId ?? '';
    case 'employee.address':
      return addressOf(employee);
    // Broken/missing referents resolve to '' so a REQUIRED one surfaces as a structured
    // A16 issue (fail loud with a report) instead of a raw lookup error.
    case 'job.title': {
      const title = await jobTitleService.getById(String(employee.employment.jobTitleId)).catch(() => null);
      if (title === null) return '';
      return input.language === 'ar' ? title.name.ar : title.name.en;
    }
    case 'department.name': {
      const dep = await departmentService.getById(String(employee.employment.departmentId)).catch(() => null);
      if (dep === null) return '';
      return input.language === 'ar' ? dep.name.ar : dep.name.en;
    }
    case 'branch.name': {
      const branch = await branchService.getById(String(employee.employment.branchId)).catch(() => null);
      if (branch === null) return '';
      return input.language === 'ar' ? branch.name.ar : branch.name.en;
    }
    case 'salary.basic':
      return employee.employment.salary === null ? '' : String(employee.employment.salary.amount);
    case 'salary.currency':
      return employee.employment.salary === null ? '' : employee.employment.salary.currency;
    case 'contract.code':
      return input.code;
    case 'contract.startDate':
      return formatTemplateDate(input.startDate, input.language);
    case 'contract.endDate':
      return formatTemplateDate(input.endDate, input.language);
    case 'contract.currentDate':
      // The signing-office calendar (Africa/Cairo), not the server's UTC clock.
      return formatTemplateDate(cairoToday(), input.language);
    case 'contract.currentDayName':
      return dayNameOf(cairoToday(), input.language);
    case 'employee.phone':
      return employee.personal.contact.primaryPhone;
    case 'employee.birthDate':
      return formatTemplateDate(employee.personal.birthDate, input.language);
    case 'employee.maritalStatus':
      return employee.personal.maritalStatus === null
        ? ''
        : MARITAL[employee.personal.maritalStatus][input.language];
    case 'employee.militaryStatus':
      return employee.personal.military === null
        ? ''
        : MILITARY[employee.personal.military.status][input.language];
    case 'employee.qualification': {
      const education = employee.personal.education;
      if (education === null) return '';
      return [EDUCATION[education.level][input.language], education.specialization ?? '']
        .filter((part) => part.trim() !== '')
        .join(' ');
    }
    case 'employee.graduationYear':
      return employee.personal.education?.graduationYear == null
        ? ''
        : String(employee.personal.education.graduationYear);
    case 'employee.institution':
      return employee.personal.education?.institution ?? '';
    case 'employee.hireDate':
      return formatTemplateDate(employee.hiredAt, input.language);
    case 'employee.weaponLicenseExpiry':
      return formatTemplateDate(employee.officer?.weaponLicense?.expiry ?? null, input.language);
    case 'employment.startDate':
      return formatTemplateDate(employee.employment.startDate, input.language);
    case 'employment.startDayName':
      return dayNameOf(employee.employment.startDate, input.language);
    case 'employment.startDay':
    case 'employment.startMonth':
    case 'employment.startYear': {
      // The boxes of «نموذج رقم (1)»: two digits for the day and the month, four for the year.
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnlyIso(employee.employment.startDate));
      if (match === null) return '';
      return key === 'employment.startYear' ? (match[1] ?? '') : key === 'employment.startMonth' ? (match[2] ?? '') : (match[3] ?? '');
    }
    case 'employee.nationality': {
      const nationality = employee.personal.nationality;
      if (input.language === 'ar' && nationality.trim().toLowerCase() === 'egyptian') return 'مصري';
      return nationality;
    }
    case 'employee.email':
      return employee.personal.contact.email ?? '';
    case 'employee.insuranceNumber':
      return employee.insurance?.insuranceNumber ?? '';
    case 'salary.gross':
    case 'salary.fixed':
    case 'salary.attendanceBonus':
    case 'salary.grossInWords': {
      // The one split the register screen shows (70% basic, 30% attendance), from the gross.
      const parts = salaryBreakdown(employee.employment.salary?.amount ?? null);
      if (parts === null) return '';
      if (key === 'salary.gross') return money(parts.gross);
      if (key === 'salary.fixed') return money(parts.fixed);
      if (key === 'salary.attendanceBonus') return money(parts.attendanceBonus);
      return amountInArabicWords(parts.gross);
    }
    case 'company.name': {
      const org = await organizationService.get().catch(() => null);
      if (org === null) return '';
      const name = org.name as { ar?: string; en?: string } | string;
      if (typeof name === 'string') return name;
      return (input.language === 'ar' ? name.ar : name.en) ?? '';
    }
    default:
      return '';
  }
};

/**
 * Resolve `placeholders` (the pinned template's set) → frozen values with provenance +
 * the A16 issue report (required-and-empty only; optional empties render blank by choice).
 */
export const resolveContractVariables = async (
  placeholders: string[],
  input: ResolutionInput,
): Promise<{ values: ContractVariableValue[]; issues: ContractVariableIssueDto[] }> => {
  const values: ContractVariableValue[] = [];
  const issues: ContractVariableIssueDto[] = [];
  for (const key of placeholders) {
    const catalogEntry = CONTRACT_VARIABLE_CATALOG.find((v) => v.key === key);
    const override = input.overrides[key];
    if (override !== undefined && override.trim() !== '') {
      values.push({ key, value: override, source: 'override', overriddenBy: input.overriddenBy });
      continue;
    }
    const value = await resolveFromData(key, input);
    const source: ContractVariableSource = catalogEntry?.source ?? 'contract';
    values.push({ key, value, source, overriddenBy: null });
    if (value.trim() === '' && isRequiredVariable(key)) {
      issues.push({
        placeholder: key,
        source,
        reason: 'required value is empty — fill the source data or provide an override',
      });
    }
  }
  return { values, issues };
};
