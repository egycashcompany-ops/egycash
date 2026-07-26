// The server-owned placeholder catalog (frozen contracts design D5) — the ONE list that
// drives the editor's variable browser, template validation and the generation resolver.
import { type ContractVariableDto } from '@ecms/contracts';

export const CONTRACT_VARIABLE_CATALOG: ContractVariableDto[] = [
  { key: 'employee.fullName', label: { en: 'Employee full name', ar: 'اسم الموظف الكامل' }, source: 'employee', sample: 'أحمد محمد علي', required: true },
  { key: 'employee.employeeCode', label: { en: 'Employee code', ar: 'كود الموظف' }, source: 'employee', sample: '001000125', required: true },
  { key: 'employee.nationalId', label: { en: 'National ID', ar: 'الرقم القومي' }, source: 'employee', sample: '29001011234567', required: true },
  { key: 'employee.address', label: { en: 'Employee address', ar: 'عنوان الموظف' }, source: 'employee', sample: 'القاهرة', required: false },
  { key: 'job.title', label: { en: 'Job title', ar: 'المسمى الوظيفي' }, source: 'employment', sample: 'صراف', required: true },
  { key: 'department.name', label: { en: 'Department', ar: 'الإدارة' }, source: 'employment', sample: 'العمليات', required: true },
  { key: 'branch.name', label: { en: 'Branch', ar: 'الفرع' }, source: 'employment', sample: 'الرئيسي', required: true },
  { key: 'salary.basic', label: { en: 'Basic salary', ar: 'الراتب الأساسي' }, source: 'employment', sample: '15000', required: false },
  { key: 'salary.currency', label: { en: 'Salary currency', ar: 'عملة الراتب' }, source: 'employment', sample: 'EGP', required: false },
  { key: 'contract.code', label: { en: 'Contract number', ar: 'رقم العقد' }, source: 'contract', sample: 'ECMS-CON-2026-000001', required: true },
  { key: 'contract.startDate', label: { en: 'Contract start date', ar: 'تاريخ بداية العقد' }, source: 'contract', sample: '2026-08-01', required: true },
  { key: 'contract.endDate', label: { en: 'Contract end date', ar: 'تاريخ نهاية العقد' }, source: 'contract', sample: '2027-07-31', required: false },
  { key: 'company.name', label: { en: 'Company name', ar: 'اسم الشركة' }, source: 'company', sample: 'EGYCASH', required: true },
];

export const CATALOG_KEYS = new Set(CONTRACT_VARIABLE_CATALOG.map((v) => v.key));

export const isRequiredVariable = (key: string): boolean =>
  CONTRACT_VARIABLE_CATALOG.find((v) => v.key === key)?.required ?? false;
