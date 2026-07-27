// Variable resolution with provenance (frozen design D5 + A3/A16): resolves every
// placeholder the pinned template uses from employee / employment / organization /
// contract / company data, applies manual overrides (recorded as such), and returns a
// STRUCTURED validation report for anything required that stayed empty — generation
// fails loud, an unresolved {{…}} can never reach a document.
import { type Types } from 'mongoose';
import {
  type ContractVariableIssueDto,
  type ContractVariableSource,
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
      return input.startDate;
    case 'contract.endDate':
      return input.endDate ?? '';
    case 'contract.currentDate':
      // The signing-office calendar (Africa/Cairo), not the server's UTC clock.
      return dateOnlyIso(cairoToday());
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
