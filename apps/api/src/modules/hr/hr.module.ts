// HR module manifest — THE single integration point between the HR business module and
// the Platform Core (Module Structure §2.1). The kernel validates it at boot (unique id,
// permission naming, `hr_` collection prefix, `/hr` route prefix) and fails the boot on
// violation. Ships the Recruitment sub-module: Stage 1 (Applicants), Stage 2 (Initial
// Screening), Stage 3 (Interviews), Stage 4 (Job Offer), Stage 5 (Employee Creation),
// Stage 6 (Hiring Documents), and Stage 7 (Electronic Employee File) — the final stage of the
// approved seven-stage workflow and the handoff artifact to the Employee module (BD-008).
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildApplicantSourcesRouter, buildApplicantsRouter } from './recruitment/applicants';
import { buildScreeningsRouter } from './recruitment/screening';
import { buildInterviewStagesRouter, buildInterviewsRouter } from './recruitment/interviews';
import { buildEvaluationPhasesRouter, buildEvaluationsRouter } from './recruitment/evaluations';
import { buildJobOffersRouter, jobOfferService } from './recruitment/job-offers';
import { buildEmployeesRouter, employeeService } from './employee-management/employees';
import { buildEmployeeActionsRouter, employeeActionService } from './employee-management/employee-actions';
import { buildHiringDocumentTypesRouter, buildHiringDocumentsRouter } from './recruitment/hiring-documents';
import { buildEmployeeFilesRouter } from './employee-management/employee-file';
import { buildHolidaysRouter, buildWorkCalendarRouter, registerHrWorkCalendarSettings } from './work-calendar';
import { buildLeaveTypesRouter } from './leave-management/leave-types';
import { buildLeaveBalancesRouter, leaveBalanceService } from './leave-management/leave-balances';
import {
  buildLeaveCalendarRouter,
  buildLeaveRequestsRouter,
  leaveRequestService,
} from './leave-management/leave-requests';
import { seedHrRecruitment } from './hr.seed';

// Business-calendar + leave settings enter the registry at module load, before boot resolves
// any value (Leave design C2).
registerHrWorkCalendarSettings();

const applicantPermissions = declarePermissions(
  'hr',
  'applicant',
  { en: 'applicants', ar: 'المتقدمين' },
  ['view', 'create', 'edit', 'delete', 'export'],
  [
    { action: 'verifyIdentity', name: { en: 'Verify applicant identity', ar: 'توثيق هوية المتقدم' } },
    // Offer eligibility is never automatic: HR explicitly moves an applicant to the Job Offer stage.
    { action: 'moveToOffer', name: { en: 'Move applicant to job offer', ar: 'نقل المتقدم لمرحلة عرض العمل' } },
  ],
);

const applicantSourcePermissions = declarePermissions(
  'hr',
  'applicantSource',
  { en: 'applicant sources', ar: 'مصادر التوظيف' },
  [],
  [{ action: 'manage', name: { en: 'Manage applicant sources', ar: 'إدارة مصادر التوظيف' } }],
);

// Stage 2 — Initial Screening. `decide` is the terminal accept/reject action (OQ-32),
// separate from `edit` (which only appends notes to a pending screening).
const screeningPermissions = declarePermissions(
  'hr',
  'screening',
  { en: 'screenings', ar: 'الفرز المبدئي' },
  ['view', 'create', 'edit'],
  [{ action: 'decide', name: { en: 'Decide applicant screening', ar: 'اتخاذ قرار الفرز المبدئي' } }],
);

// Stage 3 — Interviews. `create` schedules a round; `edit` reschedules; `cancel`, `evaluate`
// (a panel member records their own assessment), and `decide` (the terminal pass/fail) are
// each their own grant. Stage config is admin-managed under `interviewStage.manage`.
const interviewPermissions = declarePermissions(
  'hr',
  'interview',
  { en: 'interviews', ar: 'المقابلات' },
  ['view', 'create', 'edit'],
  [
    { action: 'cancel', name: { en: 'Cancel interview', ar: 'إلغاء المقابلة' } },
    { action: 'evaluate', name: { en: 'Evaluate interview', ar: 'تقييم المقابلة' } },
    { action: 'decide', name: { en: 'Decide interview outcome', ar: 'اتخاذ قرار المقابلة' } },
  ],
);

const interviewStagePermissions = declarePermissions(
  'hr',
  'interviewStage',
  { en: 'interview stages', ar: 'مراحل المقابلات' },
  [],
  [{ action: 'manage', name: { en: 'Manage interview stages', ar: 'إدارة مراحل المقابلات' } }],
);

// Evaluation phases — the post-interview, file-based approval checks (Security Check, Medical
// Examination, Driving Test, …). `view` reads phases + records; `manage` opens/uploads/decides an
// applicant's evaluation. The phase catalog itself is admin-managed under `evaluationPhase.manage`.
const evaluationPermissions = declarePermissions(
  'hr',
  'evaluation',
  { en: 'evaluations', ar: 'التقييمات' },
  ['view'],
  [{ action: 'manage', name: { en: 'Manage evaluations', ar: 'إدارة التقييمات' } }],
);

const evaluationPhasePermissions = declarePermissions(
  'hr',
  'evaluationPhase',
  { en: 'evaluation phases', ar: 'مراحل التقييم' },
  [],
  [{ action: 'manage', name: { en: 'Manage evaluation phases', ar: 'إدارة مراحل التقييم' } }],
);

// Stage 4 — Job Offer. `send` issues a draft; `respond` records the applicant's
// accept/reject; `withdraw` retracts — each its own grant, separate from `edit` (which
// revises the package while draft/sent).
const jobOfferPermissions = declarePermissions(
  'hr',
  'jobOffer',
  { en: 'job offers', ar: 'عروض العمل' },
  ['view', 'create', 'edit'],
  [
    { action: 'send', name: { en: 'Send job offer', ar: 'إرسال عرض العمل' } },
    { action: 'respond', name: { en: 'Record job offer response', ar: 'تسجيل رد عرض العمل' } },
    { action: 'withdraw', name: { en: 'Withdraw job offer', ar: 'سحب عرض العمل' } },
  ],
);

// Employee Management — the registry (frozen design docs/12-planning/employee-module-design.md).
// `create` hires from an accepted offer; `registerDirect` onboards without a pipeline (D4);
// `editPersonal` maintains the owned personal data; the Personnel Actions engine is gated per
// group: `manageActions` (promotion/transfer/probation/suspension/leave), `manageCompensation` +
// `viewCompensation` (salary write/read split), `exit` (typed exits), `rehire` +
// `rehireOverride` (D2). `changeStatus` remains for the deprecated status alias (one release).
// `viewSensitive` is declared for the future unmasked-NID surface (unmasked egress is deferred
// platform-wide, OQ-27).
const employeePermissions = declarePermissions(
  'hr',
  'employee',
  { en: 'employees', ar: 'الموظفين' },
  ['view', 'create'],
  [
    { action: 'registerDirect', name: { en: 'Register employee directly', ar: 'تسجيل موظف مباشرة' } },
    { action: 'editPersonal', name: { en: 'Edit employee personal data', ar: 'تعديل البيانات الشخصية للموظف' } },
    { action: 'manageActions', name: { en: 'Manage personnel actions', ar: 'إدارة الإجراءات الوظيفية' } },
    { action: 'manageCompensation', name: { en: 'Manage employee compensation', ar: 'إدارة أجر الموظف' } },
    { action: 'viewCompensation', name: { en: 'View employee compensation', ar: 'عرض أجر الموظف' } },
    { action: 'exit', name: { en: 'Record employee exit', ar: 'تسجيل انتهاء خدمة الموظف' } },
    { action: 'rehire', name: { en: 'Rehire an exited employee', ar: 'إعادة تعيين موظف منتهي الخدمة' } },
    { action: 'rehireOverride', name: { en: 'Override rehire ineligibility', ar: 'تجاوز عدم أهلية إعادة التعيين' } },
    { action: 'viewSensitive', name: { en: 'View sensitive employee data', ar: 'عرض البيانات الحساسة للموظف' } },
    { action: 'changeStatus', name: { en: 'Change employee status (deprecated alias)', ar: 'تغيير حالة الموظف (مسار قديم)' } },
  ],
);

// Stage 6 — Hiring Documents. `upload` covers first upload + versioned replacement; `complete`
// is the mandatory-completion gate — each its own grant. The document-type catalog is
// admin-managed under `hiringDocumentType.manage`.
const hiringDocumentsPermissions = declarePermissions(
  'hr',
  'hiringDocuments',
  { en: 'hiring documents', ar: 'مستندات التعيين' },
  ['view', 'create'],
  [
    { action: 'upload', name: { en: 'Upload hiring document', ar: 'رفع مستند تعيين' } },
    { action: 'complete', name: { en: 'Complete hiring documents', ar: 'إكمال مستندات التعيين' } },
  ],
);

const hiringDocumentTypePermissions = declarePermissions(
  'hr',
  'hiringDocumentType',
  { en: 'hiring document types', ar: 'أنواع مستندات التعيين' },
  [],
  [{ action: 'manage', name: { en: 'Manage hiring document types', ar: 'إدارة أنواع مستندات التعيين' } }],
);

// Stage 7 — Electronic Employee File. `create` assembles the file from a completed hiring case
// (BD-008), copying the hiring documents as independent copies; `view` reads it; `edit` appends
// notes to the Employee Timeline; `upload` adds/removes custom documents (never touching the
// originals). This stage assembles and reads only — the post-hire employee lifecycle belongs to
// the Employee module.
const employeeFilePermissions = declarePermissions(
  'hr',
  'employeeFile',
  { en: 'employee files', ar: 'ملفات الموظفين' },
  ['view', 'create', 'edit'],
  [{ action: 'upload', name: { en: 'Upload employee file document', ar: 'رفع مستند ملف الموظف' } }],
);

// Leave Management (frozen design docs/12-planning/leave-management-design.md §8). `view` +
// `request` at OWN scope form the seeded Employee Self-Service role (L7). `approve` is the HR
// step + override — line managers act by RELATIONSHIP, not permission (R9). The calendar is
// its own resource: Attendance will share it (C2).
const leavePermissions = declarePermissions(
  'hr',
  'leave',
  { en: 'leave', ar: 'الإجازات' },
  ['view'],
  [
    { action: 'request', name: { en: 'Request own leave', ar: 'طلب إجازة' } },
    { action: 'requestForOthers', name: { en: 'File leave for others', ar: 'تسجيل إجازة لموظف آخر' } },
    { action: 'approve', name: { en: 'Approve leave (HR step + override)', ar: 'اعتماد الإجازات' } },
    { action: 'cancelApproved', name: { en: 'Cancel approved leave', ar: 'إلغاء إجازة معتمدة' } },
    { action: 'manageTypes', name: { en: 'Manage leave types', ar: 'إدارة أنواع الإجازات' } },
    { action: 'adjustBalances', name: { en: 'Adjust leave balances', ar: 'تعديل أرصدة الإجازات' } },
    { action: 'viewLedger', name: { en: 'View the leave ledger', ar: 'عرض سجل حركات الإجازات' } },
  ],
);

const workCalendarPermissions = declarePermissions(
  'hr',
  'workCalendar',
  { en: 'work calendar', ar: 'تقويم العمل' },
  [],
  [{ action: 'manage', name: { en: 'Manage the work calendar', ar: 'إدارة تقويم العمل' } }],
);

export const hrPermissions: PermissionDef[] = [
  ...applicantPermissions,
  ...applicantSourcePermissions,
  ...screeningPermissions,
  ...interviewPermissions,
  ...interviewStagePermissions,
  ...evaluationPermissions,
  ...evaluationPhasePermissions,
  ...jobOfferPermissions,
  ...employeePermissions,
  ...hiringDocumentsPermissions,
  ...hiringDocumentTypePermissions,
  ...employeeFilePermissions,
  ...leavePermissions,
  ...workCalendarPermissions,
];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.14.0',
  requiresPlatform: '^2.1',
  permissions: hrPermissions,
  routes: [
    { prefix: '/hr/applicants', router: buildApplicantsRouter() },
    { prefix: '/hr/applicant-sources', router: buildApplicantSourcesRouter() },
    { prefix: '/hr/screenings', router: buildScreeningsRouter() },
    { prefix: '/hr/interviews', router: buildInterviewsRouter() },
    { prefix: '/hr/interview-stages', router: buildInterviewStagesRouter() },
    { prefix: '/hr/evaluations', router: buildEvaluationsRouter() },
    { prefix: '/hr/evaluation-phases', router: buildEvaluationPhasesRouter() },
    { prefix: '/hr/job-offers', router: buildJobOffersRouter() },
    { prefix: '/hr/employees', router: buildEmployeeActionsRouter() },
    { prefix: '/hr/employees', router: buildLeaveBalancesRouter() },
    { prefix: '/hr/employees', router: buildEmployeesRouter() },
    { prefix: '/hr/hiring-documents', router: buildHiringDocumentsRouter() },
    { prefix: '/hr/hiring-document-types', router: buildHiringDocumentTypesRouter() },
    { prefix: '/hr/employee-files', router: buildEmployeeFilesRouter() },
    { prefix: '/hr/leave-types', router: buildLeaveTypesRouter() },
    { prefix: '/hr/leave-requests', router: buildLeaveRequestsRouter() },
    { prefix: '/hr/leave-calendar', router: buildLeaveCalendarRouter() },
    { prefix: '/hr/holidays', router: buildHolidaysRouter() },
    { prefix: '/hr/work-calendar', router: buildWorkCalendarRouter() },
  ],
  collections: [
    'hr_applicants',
    'hr_applicant_sources',
    'hr_sequences',
    'hr_screenings',
    'hr_interviews',
    'hr_interview_stages',
    'hr_evaluations',
    'hr_evaluation_phases',
    'hr_job_offers',
    'hr_employees',
    'hr_employee_actions',
    'hr_hiring_documents',
    'hr_hiring_document_types',
    'hr_employee_files',
    'hr_leave_types',
    'hr_leave_requests',
    'hr_leave_ledger',
    'hr_leave_balances',
    'hr_holidays',
  ],
  eventSubscriptions: [
    {
      // Exit settlement (leave design R12): terminate open leave, release, expire balances.
      event: 'hr.employee.exited',
      handlerId: 'leave.exitSettlement',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await leaveRequestService.onEmployeeExited(payload.employeeId);
        }
      },
    },
    {
      // Own-scope owner-field backfill (leave design C1-R).
      event: 'hr.employee.loginLinked',
      handlerId: 'leave.ownerBackfill',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string; userId?: string };
        if (typeof payload.employeeId === 'string' && typeof payload.userId === 'string') {
          await leaveRequestService.onLoginLinked(payload.employeeId, payload.userId);
        }
      },
    },
    {
      // Mid-year joiners get their pro-rated grant immediately (leave design §4).
      event: 'hr.employee.created',
      handlerId: 'leave.grantOnHire',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await leaveBalanceService.grantCurrentYearFor(payload.employeeId);
        }
      },
    },
    {
      // Rehires open a fresh pro-rated grant in the new employment period (leave design R12).
      event: 'hr.employee.rehired',
      handlerId: 'leave.grantOnRehire',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await leaveBalanceService.grantCurrentYearFor(payload.employeeId);
        }
      },
    },
  ],
  scheduledTasks: [
    {
      // Automatic offer expiration: flip sent offers past their validity to `expired`.
      key: 'hr.jobOffers.expire',
      description: 'Expire sent job offers whose validity has lapsed',
      cron: '*/15 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await jobOfferService.expireOverdue();
      },
    },
    {
      // Personnel Actions: apply due SCHEDULED actions in effective-date order (frozen design §3).
      key: 'hr.employeeActions.applyScheduled',
      description: 'Apply due scheduled personnel actions',
      cron: '*/10 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await employeeActionService.applyDueScheduled();
      },
    },
    {
      // Probation reminders (D1): notify HR + the manager before a probation deadline lapses.
      key: 'hr.employees.probationReminder',
      description: 'Remind about probations ending within the next 7 days',
      cron: '0 6 * * *',
      ownerService: 'hr',
      handler: async () => {
        await employeeService.remindEndingProbations();
      },
    },
    {
      // Leave (§10): approved → active at the Cairo start date (+ leaveStart drive).
      key: 'hr.leave.activateStarted',
      description: 'Activate approved leave whose start date has arrived',
      cron: '*/30 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await leaveRequestService.activateDueStarted();
      },
    },
    {
      // Leave (§10): active → completed after the end date; reservations become consumption.
      key: 'hr.leave.completeEnded',
      description: 'Complete active leave past its end date and finalize consumption',
      cron: '0 1 * * *',
      ownerService: 'hr',
      handler: async () => {
        await leaveRequestService.completeDueEnded();
      },
    },
    {
      // Leave (§10): SLA nudge for stale pending approvals.
      key: 'hr.leave.approvalReminder',
      description: 'Remind approvers about stale pending leave requests',
      cron: '0 6 * * *',
      ownerService: 'hr',
      handler: async () => {
        await leaveRequestService.remindPendingApprovals();
      },
    },
    {
      // Leave (§10): year-end close — carryover, new-year grants, carryover expiry.
      key: 'hr.leave.yearEnd',
      description: 'Year-end leave processing: carryover + entitlement grants',
      cron: '30 0 1 1 *',
      ownerService: 'hr',
      handler: async () => {
        await leaveBalanceService.yearEndProcessing();
      },
    },
  ],
  seed: seedHrRecruitment,
};
