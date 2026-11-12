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
  { key: 'contract.currentDate', label: { en: "Today's date", ar: 'تاريخ اليوم' }, source: 'contract', sample: '2026-07-27', required: false },
  { key: 'company.name', label: { en: 'Company name', ar: 'اسم الشركة' }, source: 'company', sample: 'EGYCASH', required: true },
  // A27 — what the hiring forms («مستندات التعيين») print. All optional: a form prints a blank
  // line where the record has nothing, to be filled in by hand.
  { key: 'employee.phone', label: { en: 'Mobile number', ar: 'رقم الموبايل' }, source: 'employee', sample: '01000000000', required: false },
  { key: 'employee.birthDate', label: { en: 'Date of birth', ar: 'تاريخ الميلاد' }, source: 'employee', sample: '1/1/1990', required: false },
  { key: 'employee.maritalStatus', label: { en: 'Marital status', ar: 'الحالة الاجتماعية' }, source: 'employee', sample: 'متزوج', required: false },
  { key: 'employee.militaryStatus', label: { en: 'Military service', ar: 'الموقف من التجنيد' }, source: 'employee', sample: 'أدى الخدمة', required: false },
  { key: 'employee.qualification', label: { en: 'Qualification', ar: 'المؤهل الدراسي' }, source: 'employee', sample: 'بكالوريوس تجارة', required: false },
  { key: 'employee.graduationYear', label: { en: 'Graduation year', ar: 'سنة التخرج' }, source: 'employee', sample: '2012', required: false },
  { key: 'employee.institution', label: { en: 'Awarding institution', ar: 'جهة الحصول على المؤهل' }, source: 'employee', sample: 'جامعة القاهرة', required: false },
  { key: 'employee.hireDate', label: { en: 'Hiring date', ar: 'تاريخ التعيين' }, source: 'employee', sample: '15/11/2026', required: false },
  { key: 'employee.weaponLicenseExpiry', label: { en: 'Weapon licence expiry', ar: 'تاريخ انتهاء رخصة السلاح' }, source: 'employee', sample: '30/6/2027', required: false },
  { key: 'employment.startDate', label: { en: 'Start date', ar: 'تاريخ المباشرة' }, source: 'employment', sample: '15/11/2026', required: false },
  { key: 'employment.startDayName', label: { en: 'Start day', ar: 'يوم المباشرة' }, source: 'employment', sample: 'الأحد', required: false },
  { key: 'contract.currentDayName', label: { en: "Today's day", ar: 'يوم اليوم' }, source: 'contract', sample: 'الأحد', required: false },
  { key: 'salary.gross', label: { en: 'Gross salary', ar: 'الراتب الشامل' }, source: 'employment', sample: '10,000', required: false },
  { key: 'salary.fixed', label: { en: 'Basic pay (70%)', ar: 'الأجر الأساسي (70%)' }, source: 'employment', sample: '7,000', required: false },
  { key: 'salary.attendanceBonus', label: { en: 'Attendance allowance (30%)', ar: 'بدل الانتظام (30%)' }, source: 'employment', sample: '3,000', required: false },
  { key: 'salary.grossInWords', label: { en: 'Gross salary in words', ar: 'الراتب الشامل بالحروف' }, source: 'employment', sample: 'عشرة آلاف جنيه لا غير', required: false },
  // A27 — «نموذج رقم (1)», the social-insurance registration: his facts, and the start date in its
  // day, month and year boxes.
  { key: 'employee.nationality', label: { en: 'Nationality', ar: 'الجنسية' }, source: 'employee', sample: 'مصري', required: false },
  { key: 'employee.email', label: { en: 'Email', ar: 'البريد الإلكتروني' }, source: 'employee', sample: 'name@example.com', required: false },
  { key: 'employee.insuranceNumber', label: { en: 'Social insurance number', ar: 'الرقم التأميني' }, source: 'employee', sample: '123456789', required: false },
  // A28 — the job's title at the social-insurance authority («مسميات الوظائف لدى التأمينات»), else its own.
  { key: 'job.insuranceTitle', label: { en: 'Job title at social insurance', ar: 'المسمى الوظيفي لدى التأمينات' }, source: 'employment', sample: 'مندوب تحصيل', required: false },
  { key: 'employment.startDay', label: { en: 'Start date — day', ar: 'تاريخ المباشرة — اليوم' }, source: 'employment', sample: '15', required: false },
  { key: 'employment.startMonth', label: { en: 'Start date — month', ar: 'تاريخ المباشرة — الشهر' }, source: 'employment', sample: '11', required: false },
  { key: 'employment.startYear', label: { en: 'Start date — year', ar: 'تاريخ المباشرة — السنة' }, source: 'employment', sample: '2026', required: false },
];

export const CATALOG_KEYS = new Set(CONTRACT_VARIABLE_CATALOG.map((v) => v.key));

export const isRequiredVariable = (key: string): boolean =>
  CONTRACT_VARIABLE_CATALOG.find((v) => v.key === key)?.required ?? false;
