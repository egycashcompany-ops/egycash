// HR reference-data seed (Module Structure §2.1) — run at boot by the kernel after
// permissions and the organization singleton exist. Idempotent: safe on every boot.
// Seeds the 10 initial applicant sources (Stage 1), the default two interview stages
// (Stage 3, OQ-31 — number/names/order are admin-configurable thereafter), and the
// interview notification templates the interview service sends through. The OCR provider
// and requisition validator default to their safe stubs at import time (OQ-30).
import {
  HrAttendanceTemplates,
  HrContractTemplates,
  HrEmployeeFileTemplates,
  HrEmployeeLoanTemplates,
  HrEmployeeTemplates,
  HrHiringDocumentsTemplates,
  HrInterviewTemplates,
  HrLeaveTemplates,
  HrOfferTemplates,
  HrPayrollTemplates,
  type CreateApplicantSource,
  type CreateEvaluationPhase,
  type CreateHiringDocumentType,
  type CreateInterviewStage,
} from '@ecms/contracts';
import { notificationTemplateService } from '../../platform/notifications';
import { ensureAnnouncementTemplate } from './announcements';
import { applicantSourceService, ensureApplicantSourceIconCategory } from './recruitment/applicants';
import { interviewStageService } from './recruitment/interviews';
import { ensureEvaluationCategory, evaluationPhaseService } from './recruitment/evaluations';
import { ensureEvaluationBatchCategory } from './recruitment/evaluation-batches';
import { ensureHiringDocsCategory, hiringDocumentTypeService } from './recruitment/hiring-documents';
import { migrateEmployeesToRegistry } from './employee-management/employees';
import { migrateEmployeeFiles } from './employee-management/employee-file';
import { migrateRecruitmentLegacy } from './recruitment/recruitment.migration';
import { ensureLeaveAttachmentsCategory } from './leave-management/leave-requests';
import { ensureEmployeeActionAttachmentsCategory } from './employee-management/employee-actions';
import { ensureAdjustmentAttachmentsCategory } from './payroll/adjustments';
import { ensureLoanAttachmentsCategory } from './employee-loans';
import { migrateLeaveModule } from './leave-management/leave.migration';
import { migrateAttendance } from './attendance/attendance.migration';
import {
  backfillAdjustmentDepartments,
  backfillEmployeePayItemDepartments,
  backfillPayslipDepartments,
} from './payroll';
import { backfillEmployeeLoanDepartments } from './employee-loans';

// `kind` says what a platform IS — how applications from it normally arrive. It does not say
// whether the platform has an application link: every active source can be published to, whatever
// its kind, because publishing is the same operation for all of them (one form, one token per
// source) and nothing in the API consults `kind` to decide it.
//
// So these classifications describe the domain and are left alone. Wuzzuf, LinkedIn and Forasna
// are job boards we integrate with; Facebook is a channel a recruiter records from; the website and
// the mobile app are our own public forms. All six can carry a link regardless.
const SOURCES: CreateApplicantSource[] = [
  { key: 'internalHr', name: { en: 'Internal HR', ar: 'الموارد البشرية الداخلية' }, kind: 'manual', requiresDetail: false },
  { key: 'companyWebsite', name: { en: 'Company Website', ar: 'موقع الشركة' }, kind: 'publicForm', requiresDetail: false },
  { key: 'mobileApp', name: { en: 'Mobile Application', ar: 'تطبيق الهاتف' }, kind: 'publicForm', requiresDetail: false },
  { key: 'linkedin', name: { en: 'LinkedIn', ar: 'لينكدإن' }, kind: 'integration', requiresDetail: false },
  { key: 'wuzzuf', name: { en: 'Wuzzuf', ar: 'وظف' }, kind: 'integration', requiresDetail: false },
  { key: 'forasna', name: { en: 'Forasna', ar: 'فرصنا' }, kind: 'integration', requiresDetail: false },
  { key: 'facebook', name: { en: 'Facebook', ar: 'فيسبوك' }, kind: 'manual', requiresDetail: false },
  { key: 'referral', name: { en: 'Referral', ar: 'ترشيح' }, kind: 'manual', requiresDetail: true },
  { key: 'walkIn', name: { en: 'Walk-in', ar: 'حضور شخصي' }, kind: 'manual', requiresDetail: false },
  { key: 'agency', name: { en: 'Recruitment Agency', ar: 'وكالة توظيف' }, kind: 'manual', requiresDetail: true },
];

const INTERVIEW_STAGES: CreateInterviewStage[] = [
  { key: 'firstInterview', name: { en: 'First Interview', ar: 'المقابلة الأولى' }, order: 1 },
  { key: 'secondInterview', name: { en: 'Second Interview', ar: 'المقابلة الثانية' }, order: 2 },
];

// Default post-interview evaluation phases, in REAL BUSINESS ORDER (frozen workflow design
// OQ-1): Security Check → Driving Test → Medical Check, with Medical last because it is normally
// the final external approval before hiring. The phases are INDEPENDENT (RW6) — `order` is
// display order only — and the catalog stays admin-configurable (number/names/order/kind change
// with no code change). Security and Driving are run as BATCHES (RW8); Medical is always
// individual (RW9). Each of the three has its own permission resource (RW7); phases an admin
// adds later fall back to the generic `evaluation` resource.
const EVALUATION_PHASES: CreateEvaluationPhase[] = [
  {
    key: 'securityCheck',
    name: { en: 'Security Check', ar: 'الفحص الأمني' },
    order: 1,
    driversOnly: false,
    applicability: 'all',
    kind: 'batch',
    permissionResource: 'securityCheck',
    appointmentEnabled: false,
    requiresResultDocument: true,
  },
  {
    key: 'drivingTest',
    name: { en: 'Driving Test', ar: 'اختبار القيادة' },
    order: 2,
    driversOnly: true,
    applicability: 'driversOnly',
    kind: 'batch',
    permissionResource: 'drivingTest',
    appointmentEnabled: false,
    requiresResultDocument: true,
  },
  {
    key: 'medicalExam',
    name: { en: 'Medical Check', ar: 'الكشف الطبي' },
    order: 3,
    driversOnly: false,
    applicability: 'all',
    kind: 'individual',
    permissionResource: 'medicalCheck',
    appointmentEnabled: true,
    requiresResultDocument: true,
  },
];

const ensureInterviewTemplates = async (): Promise<void> => {
  await notificationTemplateService.ensure({
    key: HrInterviewTemplates.Scheduled,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'موعد مقابلة جديد', en: 'New interview scheduled' },
    body: {
      ar: 'تمت جدولة مقابلة (الجولة {{round}}) للمتقدم {{applicantCode}} بتاريخ {{when}}.',
      en: 'An interview (round {{round}}) for applicant {{applicantCode}} is scheduled for {{when}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode', 'round', 'when'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrInterviewTemplates.Rescheduled,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم تغيير موعد المقابلة', en: 'Interview rescheduled' },
    body: {
      ar: 'تم تغيير موعد المقابلة (الجولة {{round}}) للمتقدم {{applicantCode}} إلى {{when}}.',
      en: 'The interview (round {{round}}) for applicant {{applicantCode}} was rescheduled to {{when}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode', 'round', 'when'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrInterviewTemplates.Cancelled,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم إلغاء المقابلة', en: 'Interview cancelled' },
    body: {
      ar: 'تم إلغاء المقابلة (الجولة {{round}}) للمتقدم {{applicantCode}}.',
      en: 'The interview (round {{round}}) for applicant {{applicantCode}} was cancelled.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode', 'round'],
    defaultExpiryHours: null,
  });
};

const ensureOfferTemplates = async (): Promise<void> => {
  await notificationTemplateService.ensure({
    key: HrOfferTemplates.Sent,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم إرسال عرض عمل', en: 'Job offer sent' },
    body: {
      ar: 'تم إرسال عرض عمل للمتقدم {{applicantCode}}، صالح حتى {{when}}.',
      en: 'A job offer was sent to applicant {{applicantCode}}, valid until {{when}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode', 'when'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrOfferTemplates.Accepted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم قبول عرض العمل', en: 'Job offer accepted' },
    body: {
      ar: 'قبل المتقدم {{applicantCode}} عرض العمل.',
      en: 'Applicant {{applicantCode}} accepted the job offer.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrOfferTemplates.Rejected,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم رفض عرض العمل', en: 'Job offer rejected' },
    body: {
      ar: 'رفض المتقدم {{applicantCode}} عرض العمل.',
      en: 'Applicant {{applicantCode}} rejected the job offer.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrOfferTemplates.Expired,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'انتهت صلاحية عرض العمل', en: 'Job offer expired' },
    body: {
      ar: 'انتهت صلاحية عرض العمل المرسل للمتقدم {{applicantCode}}.',
      en: 'The job offer sent to applicant {{applicantCode}} has expired.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode'],
    defaultExpiryHours: null,
  });
};

// The standard hiring-documents checklist (approved Recruitment spec — 7 documents, ALL required
// for completion). The set stays admin-configurable thereafter (add / remove / toggle required).
const HIRING_DOCUMENT_TYPES: CreateHiringDocumentType[] = [
  { key: 'employmentContract', name: { en: 'Employment Contract', ar: 'عقد العمل' }, required: true },
  { key: 'employmentAcceptance', name: { en: 'Employment Acceptance Acknowledgment', ar: 'إقرار قبول التعيين' }, required: true },
  { key: 'socialStatusForm', name: { en: 'Social Status Form', ar: 'استمارة الحالة الاجتماعية' }, required: true },
  { key: 'relativesDeclaration', name: { en: 'Relatives Declaration', ar: 'إقرار الأقارب' }, required: true },
  { key: 'jobDescription', name: { en: 'Job Description', ar: 'الوصف الوظيفي' }, required: true },
  { key: 'bankLetter', name: { en: 'National Bank / Banque Misr Letter', ar: 'خطاب البنك الأهلي / بنك مصر' }, required: true },
  { key: 'companyIdCard', name: { en: 'Company ID Card', ar: 'كارنيه الشركة' }, required: true },
];

const ensureHiringDocumentsSeeds = async (): Promise<void> => {
  for (const type of HIRING_DOCUMENT_TYPES) {
    await hiringDocumentTypeService.ensure(type);
  }
  await ensureHiringDocsCategory();
  // Source icons go up through the platform Files service; this is the category that holds the
  // "PNG or SVG, and small" rule for them.
  await ensureApplicantSourceIconCategory();
  await notificationTemplateService.ensure({
    key: HrHiringDocumentsTemplates.Completed,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'اكتملت مستندات التعيين', en: 'Hiring documents completed' },
    body: {
      ar: 'اكتملت مستندات التعيين للموظف {{employeeCode}}.',
      en: 'The hiring documents for employee {{employeeCode}} are complete.',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode'],
    defaultExpiryHours: null,
  });
};

const ensureEmployeeTemplates = async (): Promise<void> => {
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.Created,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم إنشاء موظف جديد', en: 'New employee created' },
    body: {
      ar: 'تم تعيين المتقدم {{applicantCode}} كموظف برقم {{employeeCode}}.',
      en: 'Applicant {{applicantCode}} was hired as employee {{employeeCode}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['applicantCode', 'employeeCode'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.ProbationEnding,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'فترة اختبار على وشك الانتهاء', en: 'Probation ending soon' },
    body: {
      ar: 'فترة اختبار الموظف {{employeeCode}} تنتهي في {{endDate}} — يلزم التثبيت أو التمديد أو الإنهاء.',
      en: 'Probation for employee {{employeeCode}} ends on {{endDate}} — confirm, extend or fail it.',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode', 'endDate'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.ScheduledActionApplied,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم تنفيذ إجراء مجدول', en: 'Scheduled action applied' },
    body: {
      ar: 'تم تنفيذ الإجراء المجدول ({{type}}) للموظف {{employeeCode}}.',
      en: 'The scheduled action ({{type}}) for employee {{employeeCode}} was applied.',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'type'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.ScheduledActionFailed,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'فشل تنفيذ إجراء مجدول', en: 'Scheduled action failed' },
    body: {
      ar: 'فشل تنفيذ الإجراء المجدول ({{type}}) للموظف {{employeeCode}}: {{failure}}',
      en: 'The scheduled action ({{type}}) for employee {{employeeCode}} failed: {{failure}}',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode', 'type', 'failure'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.Exited,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'انتهاء خدمة موظف', en: 'Employee exited' },
    body: {
      ar: 'تم تسجيل انتهاء خدمة الموظف {{employeeCode}} ({{exitType}}).',
      en: 'Employee {{employeeCode}} exited ({{exitType}}).',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'exitType'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeTemplates.Rehired,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'إعادة تعيين موظف', en: 'Employee rehired' },
    body: {
      ar: 'تمت إعادة تعيين الموظف {{employeeCode}} بنفس الرقم الوظيفي.',
      en: 'Employee {{employeeCode}} was rehired on the same employee number.',
    },
    channels: ['inApp'],
    variables: ['employeeCode'],
    defaultExpiryHours: null,
  });
};

const ensureEmployeeFileTemplates = async (): Promise<void> => {
  await notificationTemplateService.ensure({
    key: HrEmployeeFileTemplates.Created,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم فتح الملف الإلكتروني للموظف', en: 'Electronic employee file opened' },
    body: {
      ar: 'تم فتح الملف الإلكتروني للموظف {{employeeCode}} واكتمل التعيين.',
      en: 'The electronic file for employee {{employeeCode}} has been opened; hiring is complete.',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode'],
    defaultExpiryHours: null,
  });
};

const ensureLeaveTemplates = async (): Promise<void> => {
  const ensure = notificationTemplateService.ensure.bind(notificationTemplateService);
  await ensure({
    key: HrLeaveTemplates.RequestSubmitted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'طلب إجازة جديد', en: 'New leave request' },
    body: {
      ar: 'الموظف {{employeeCode}} طلب إجازة {{typeCode}} بدءًا من {{startDate}} ({{days}} يوم) — بانتظار قرارك.',
      en: 'Employee {{employeeCode}} requested {{typeCode}} leave starting {{startDate}} ({{days}} day(s)) — awaiting your decision.',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode', 'typeCode', 'startDate', 'days'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.RequestApproved,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تمت الموافقة على إجازتك', en: 'Your leave was approved' },
    body: {
      ar: 'تمت الموافقة على إجازة {{typeCode}} بدءًا من {{startDate}} ({{days}} يوم).',
      en: 'Your {{typeCode}} leave starting {{startDate}} ({{days}} day(s)) was approved.',
    },
    channels: ['inApp', 'email'],
    variables: ['typeCode', 'startDate', 'days'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.RequestRejected,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'تم رفض طلب الإجازة', en: 'Your leave request was rejected' },
    body: {
      ar: 'تم رفض طلب إجازة {{typeCode}} بدءًا من {{startDate}}.',
      en: 'Your {{typeCode}} leave request starting {{startDate}} was rejected.',
    },
    channels: ['inApp', 'email'],
    variables: ['typeCode', 'startDate', 'days'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.RequestCancelled,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تم إلغاء طلب إجازة', en: 'Leave request cancelled' },
    body: {
      ar: 'تم إلغاء طلب إجازة {{typeCode}} للموظف {{employeeCode}}.',
      en: 'The {{typeCode}} leave request of employee {{employeeCode}} was cancelled.',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'typeCode'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.ApprovalReminder,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'طلب إجازة بانتظار قرار', en: 'Leave request awaiting decision' },
    body: {
      ar: 'طلب إجازة {{typeCode}} للموظف {{employeeCode}} ({{days}} يوم) ما زال بانتظار القرار.',
      en: 'The {{typeCode}} leave request of employee {{employeeCode}} ({{days}} day(s)) is still awaiting a decision.',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode', 'typeCode', 'days'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.ReturnDue,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'عودة من إجازة غدًا', en: 'Return from leave due tomorrow' },
    body: {
      ar: 'الموظف {{employeeCode}} يعود من إجازة {{typeCode}} غدًا.',
      en: 'Employee {{employeeCode}} returns from {{typeCode}} leave tomorrow.',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'typeCode'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.LongLeaveStarted,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'بدء إجازة طويلة', en: 'Long leave started' },
    body: {
      ar: 'بدأت إجازة {{typeCode}} للموظف {{employeeCode}}: {{detail}}',
      en: '{{typeCode}} leave for employee {{employeeCode}}: {{detail}}',
    },
    channels: ['inApp', 'email'],
    variables: ['employeeCode', 'typeCode', 'detail'],
    defaultExpiryHours: null,
  });
  await ensure({
    key: HrLeaveTemplates.BalanceAdjusted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تعديل رصيد الإجازات', en: 'Leave balance adjusted' },
    body: {
      ar: 'تم تعديل رصيد إجازة {{typeCode}} لعام {{year}} بمقدار {{days}} يوم.',
      en: 'Your {{typeCode}} leave balance for {{year}} was adjusted by {{days}} day(s).',
    },
    channels: ['inApp', 'email'],
    variables: ['typeCode', 'days', 'year'],
    defaultExpiryHours: null,
  });
};

export const seedHrRecruitment = async (): Promise<void> => {
  for (const source of SOURCES) {
    await applicantSourceService.ensure(source);
  }
  for (const stage of INTERVIEW_STAGES) {
    await interviewStageService.ensure(stage);
  }
  for (const phase of EVALUATION_PHASES) {
    await evaluationPhaseService.ensure(phase);
  }
  await ensureEvaluationCategory();
  await ensureEvaluationBatchCategory();
  await ensureInterviewTemplates();
  await ensureOfferTemplates();
  await ensureEmployeeTemplates();
  await ensureEmployeeFileTemplates();
  // The carrier template every HR announcement renders through.
  await ensureAnnouncementTemplate();
  await ensureHiringDocumentsSeeds();
  // Legacy recruitment documents: late-added applicant fields + denormalized applicantName
  // on the stage collections (idempotent, missing-field guarded).
  await migrateRecruitmentLegacy();
  // Employee-registry boot migration (frozen design §10) — idempotent, legacy docs only.
  await migrateEmployeesToRegistry();
  // I5 — drop the re-derived recruitment milestones from legacy Employee Files; the canonical
  // recruitment timeline is now the only history (idempotent).
  await migrateEmployeeFiles();
  // Auth design D2 — every employed employee gets an auto-provisioned login (idempotent).
  const { employeeService } = await import('./employee-management/employees/employee.service');
  await employeeService.provisionMissingLogins();
  // Leave Management (frozen leave design §12): templates, attachments category, types,
  // holidays, current-year grants, ESS role.
  await ensureLeaveTemplates();
  await ensureLeaveAttachmentsCategory();
  // Personnel Actions (frozen employee design §3 / HR3-C): the supporting-document category.
  await ensureEmployeeActionAttachmentsCategory();
  // Payroll adjustments (P-HR-04): the supporting-document category — the memo behind a bonus,
  // the letter behind a penalty.
  await ensureAdjustmentAttachmentsCategory();
  // Employee loans (P-HR-05): the signed request behind a loan, the receipt behind a settlement.
  await ensureLoanAttachmentsCategory();
  await migrateLeaveModule();
  // Attendance (frozen attendance design v1.1 §12): the default GENERAL shift.
  await migrateAttendance();
  // Payroll (P-SCOPE-1 stage 3): give the rows written before the department axis one, read from
  // the action log at each row's own date. Runs AFTER the employee migrations above, because it
  // reads both the employee registry and the personnel actions they populate.
  //
  // FOUR CALLS, NOT ONE MIGRATION. Each collection is reachable only from the feature that owns it
  // — payroll may not name a loan collection at all — so the seed is where they meet, which is
  // what it already is for every other migration.
  await backfillPayslipDepartments();
  await backfillAdjustmentDepartments();
  await backfillEmployeePayItemDepartments();
  await backfillEmployeeLoanDepartments();
  // Contracts (frozen contracts design D11): the expiring-soon notice template.
  await notificationTemplateService.ensure({
    key: HrContractTemplates.ExpiringSoon,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'عقد يوشك على الانتهاء', en: 'Contract expiring soon' },
    body: {
      ar: 'عقد {{employeeName}} رقم {{code}} ينتهي في {{endDate}}.',
      en: 'Contract {{code}} for {{employeeName}} ends on {{endDate}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['code', 'employeeName', 'endDate'],
    defaultExpiryHours: null,
  });
  // Attendance (v1.1 §9): the three regularization/overtime sends (AT-5) and the two sweep
  // notices (AT-7). Each template shipped with the code that sends it, never ahead of it.
  await notificationTemplateService.ensure({
    key: HrAttendanceTemplates.RegularizationSubmitted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'طلب تسوية حضور جديد', en: 'New attendance regularization' },
    body: {
      ar: 'الموظف {{code}} طلب تسوية حضور ليوم {{workDate}}.',
      en: 'Employee {{code}} requested an attendance regularization for {{workDate}}.',
    },
    channels: ['inApp'],
    variables: ['code', 'workDate'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrAttendanceTemplates.RegularizationDecided,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'قرار في طلب تسوية الحضور', en: 'Attendance regularization decided' },
    body: {
      ar: 'طلب تسوية الحضور ليوم {{workDate}} أصبح: {{status}}.',
      en: 'Your attendance regularization for {{workDate}} is now: {{status}}.',
    },
    channels: ['inApp'],
    variables: ['workDate', 'status'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrAttendanceTemplates.OvertimeApproved,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'اعتماد عمل إضافي', en: 'Overtime approved' },
    body: {
      ar: 'اعتُمد لك {{minutes}} دقيقة عمل إضافي عن يوم {{workDate}}.',
      en: '{{minutes}} overtime minutes were approved for {{workDate}}.',
    },
    channels: ['inApp'],
    variables: ['workDate', 'minutes'],
    defaultExpiryHours: null,
  });
  // The two sweep notices. Both state what was RECORDED and how to correct it — neither carries
  // a consequence, because none follows automatically from an attendance fact.
  await notificationTemplateService.ensure({
    key: HrAttendanceTemplates.AbsenceRecorded,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'تسجيل غياب', en: 'Absence recorded' },
    body: {
      ar: 'سُجّل يوم {{workDate}} غيابًا. إن كان ذلك غير صحيح، قدّم طلب تسوية حضور.',
      en: '{{workDate}} was recorded as an absence. If that is wrong, file an attendance regularization.',
    },
    channels: ['inApp'],
    variables: ['workDate'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrAttendanceTemplates.MissingCheckout,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'انصراف غير مسجّل', en: 'Missing check-out' },
    body: {
      ar: 'يوم {{workDate}} فيه حضور بلا انصراف مسجّل. قدّم طلب تسوية حضور لاستكماله.',
      en: '{{workDate}} has a check-in with no check-out. File an attendance regularization to complete it.',
    },
    channels: ['inApp'],
    variables: ['workDate'],
    defaultExpiryHours: null,
  });

  // ── Payroll decisions (P-HR-07) ───────────────────────────────────────────
  //
  // Two audiences, and the split decides the channels. The two SUBMITTED notices go to whoever can
  // decide, and they are `inApp` only: an approver's queue is a screen they are already at, and an
  // email per bonus would train them to ignore the inbox. Everything addressed to the EMPLOYEE also
  // goes by email, because it is about their own money and they may not be logged in for weeks.
  //
  // No amount appears in any body. A notification is a pointer to a decision, not a second copy of
  // the figure — the screen is where the money is read, behind the permission that governs it.
  await notificationTemplateService.ensure({
    key: HrPayrollTemplates.AdjustmentSubmitted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'مؤثر رواتب بانتظار الاعتماد', en: 'Payroll adjustment awaiting approval' },
    body: {
      ar: 'الموظف {{employeeCode}} عليه {{kind}} لشهر {{period}} بانتظار قرارك.',
      en: 'Employee {{employeeCode}} has a {{kind}} for {{period}} awaiting your decision.',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'kind', 'period'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrPayrollTemplates.AdjustmentDecided,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'قرار في مؤثر الرواتب', en: 'Payroll adjustment decided' },
    body: {
      ar: 'المؤثر الخاص بشهر {{period}} أصبح: {{decision}}.',
      en: 'The adjustment for {{period}} is now: {{decision}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['period', 'decision'],
    defaultExpiryHours: null,
  });

  // ── Payroll run lifecycle (P-HR-16) ───────────────────────────────────────
  //
  // Each of these is a HANDOVER: the month reached a state, and somebody else's turn began. So the
  // body says what is now possible rather than what happened, and the recipient is the permission
  // holding that next act — never a manager, never an employee.
  //
  // `inApp` only, and no amount in any body. A payroll month is administrative work done at a
  // screen, and emailing every approver about every month would train them to ignore the inbox;
  // the figures are the payslips', behind the compensation key. `{{period}}` is the only variable
  // any of them needs, because it is the only thing that identifies the run to a human.
  await notificationTemplateService.ensure({
    key: HrPayrollTemplates.RunFrozen,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'دورة رواتب مجمّدة بانتظار الاعتماد', en: 'Frozen payroll run awaiting approval' },
    body: {
      ar: 'دورة رواتب شهر {{period}} جُمّدت وبانتظار اعتمادك.',
      en: 'The payroll run for {{period}} is frozen and awaiting your approval.',
    },
    channels: ['inApp'],
    variables: ['period'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrPayrollTemplates.RunApproved,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'دورة رواتب معتمدة بانتظار تسجيل الصرف', en: 'Approved payroll run awaiting payment' },
    body: {
      ar: 'دورة رواتب شهر {{period}} اعتُمدت وبانتظار تسجيل الصرف.',
      en: 'The payroll run for {{period}} is approved and awaiting the payment record.',
    },
    channels: ['inApp'],
    variables: ['period'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrPayrollTemplates.RunPaid,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'دورة رواتب مصروفة بانتظار الإغلاق', en: 'Paid payroll run awaiting close' },
    body: {
      ar: 'دورة رواتب شهر {{period}} سُجّل صرفها ويمكن إغلاقها الآن.',
      en: 'The payroll run for {{period}} is recorded as paid and can now be closed.',
    },
    channels: ['inApp'],
    variables: ['period'],
    defaultExpiryHours: null,
  });

  // ── Loan decisions (P-HR-07) ──────────────────────────────────────────────
  //
  // `disbursed` is the one that carries a consequence: from that moment a schedule exists and
  // instalments start coming off a salary. It is `high` priority for that reason and for no other
  // — the two before it are `normal`, because nothing has been taken from anybody yet.
  await notificationTemplateService.ensure({
    key: HrEmployeeLoanTemplates.Submitted,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'طلب قرض بانتظار الاعتماد', en: 'Loan request awaiting approval' },
    body: {
      ar: 'الموظف {{employeeCode}} قدّم طلب {{type}} بانتظار قرارك.',
      en: 'Employee {{employeeCode}} submitted a {{type}} request awaiting your decision.',
    },
    channels: ['inApp'],
    variables: ['employeeCode', 'type'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeLoanTemplates.Decided,
    category: 'hr',
    priority: 'normal',
    subject: { ar: 'قرار في طلب القرض', en: 'Loan request decided' },
    body: {
      ar: 'طلب {{type}} أصبح: {{decision}}.',
      en: 'Your {{type}} request is now: {{decision}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['type', 'decision'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: HrEmployeeLoanTemplates.Disbursed,
    category: 'hr',
    priority: 'high',
    subject: { ar: 'صرف القرض وبدء الأقساط', en: 'Loan paid out — instalments begin' },
    body: {
      ar: 'صُرف {{type}} بتاريخ {{disbursedAt}}. يبدأ الخصم على {{installmentCount}} قسط من شهر {{firstPeriod}}.',
      en: 'Your {{type}} was paid out on {{disbursedAt}}. It is repaid over {{installmentCount}} instalment(s), starting {{firstPeriod}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['type', 'disbursedAt', 'installmentCount', 'firstPeriod'],
    defaultExpiryHours: null,
  });
};
