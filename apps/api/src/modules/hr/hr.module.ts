// HR module manifest — THE single integration point between the HR business module and
// the Platform Core (Module Structure §2.1). The kernel validates it at boot (unique id,
// permission naming, `hr_` collection prefix, `/hr` route prefix) and fails the boot on
// violation. Ships the Recruitment sub-module: Stage 1 (Applicants), Stage 2 (Initial
// Screening), Stage 3 (Interviews), Stage 4 (Job Offer), Stage 5 (Employee Creation),
// Stage 6 (Hiring Documents), and Stage 7 (Electronic Employee File) — the final stage of the
// approved seven-stage workflow and the handoff artifact to the Employee module (BD-008).
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import {
  applicantService,
  buildApplicantSourcesRouter,
  buildApplicantsRouter,
} from './recruitment/applicants';
import { applicantPortalService, APPLICANT_PORTAL_PREFIX } from './recruitment/applicant-portal';
import {
  buildApplicantDocumentsRouter,
  buildApplicantPortalDocumentsRouter,
  hrApplicantDocumentFileAuthorizers,
} from './recruitment/applicant-documents';
import { logger } from '../../infrastructure/logging/logger';
import {
  buildPublicRecruitmentFormRouter,
  buildRecruitmentFormRouter,
} from './recruitment/recruitment-form';
import { buildScreeningsRouter } from './recruitment/screening';
import { buildInterviewStagesRouter, buildInterviewsRouter } from './recruitment/interviews';
import { buildEvaluationPhasesRouter, buildEvaluationsRouter } from './recruitment/evaluations';
import {
  buildEvaluationBatchesRouter,
  buildEvaluationBatchPackage,
} from './recruitment/evaluation-batches';
import { buildRecruitmentCountersRouter } from './recruitment/counters';
import { buildReturnToStageRouter } from './recruitment/return-to-stage';
import { buildRecruitmentTimelineRouter } from './recruitment/timeline/recruitment-timeline.routes';
import { buildJobOffersRouter, jobOfferService } from './recruitment/job-offers';
import {
  buildJobRequisitionsRouter,
  jobRequisitionReferenceValidator,
  recordHireAgainstRequisition,
} from './recruitment/job-requisitions';
import { setRequisitionValidator } from './recruitment/applicants';
import { buildEmployeesRouter, employeeService } from './employee-management/employees';
import {
  buildEmployeeActionsRouter,
  hrFileEntityAuthorizers,
  employeeActionService,
} from './employee-management/employee-actions';
import {
  buildHiringDocumentTypesRouter,
  buildHiringDocumentsRouter,
} from './recruitment/hiring-documents';
import { buildEmployeeFilesRouter } from './employee-management/employee-file';
import { buildAnnouncementsRouter } from './announcements';
import { buildNotificationRulesRouter, ruleEventSubscriptions } from './notification-rules';
import {
  buildHolidaysRouter,
  buildWorkCalendarRouter,
  registerHrWorkCalendarSettings,
} from './work-calendar';
import {
  buildAttendanceAssignmentsRouter,
  buildAttendanceDaysRouter,
  buildAttendanceExportRouter,
  buildAttendanceOvertimeRouter,
  buildAttendancePunchesRouter,
  buildAttendanceRegularizationsRouter,
  buildAttendanceShiftsRouter,
  attendanceSweepService,
  dayRecordService,
  registerHrAttendanceSettings,
} from './attendance';
import {
  buildCompensationRouter,
  buildEmployeePayItemsRouter,
  buildPayItemsRouter,
  buildPayrollRunsRouter,
  buildPayslipsRouter,
  buildRunPayslipsRouter,
  buildEmployeePayslipsRouter,
  buildReconciliationRouter,
  buildCostBreakdownRouter,
  buildCostReportRouter,
  buildReportBuilderRouter,
  buildEmployeeAdjustmentsRouter,
  buildPayrollAdjustmentsRouter,
  hrAdjustmentFileAuthorizers,
} from './payroll';
import {
  buildEmployeeLoansRouter,
  buildEmployeeLoansAdminRouter,
  employeeLoanService,
  hrEmployeeLoanFileAuthorizers,
} from './employee-loans';
import {
  buildTrainingCoursesRouter,
  buildTrainingSessionsRouter,
  seedTrainingCourses,
} from './training';
import { buildSettlementRouter } from './settlement';
import { addDays, cairoToday } from './shared/business-date';
import { registerHrIdentitySeams } from './employee-management/employees/identity-seams';
import { registerHrShiftLabelSeam } from './attendance/shifts/shift-label-seams';
import { buildEmployeeCostCentersRouter } from './employee-management/cost-center-assignments';
import { registerHrBranchCodeSeams } from './employee-management/employees/branch-code-seams';
import { registerHrDirectorySeams } from './directory-seams';
import {
  dispatchPendingWorkflowEvents,
  registerRecruitmentWorkflowConsumers,
} from './recruitment/workflow';
import { reconcileRecruitmentTimeline } from './recruitment/recruitment.reconciler';
import { registerQueueMaterializer } from './recruitment/materializer';
import { registerNationalIdOcrProvider } from './recruitment/applicants';
import { registerPlacementReassignment } from './recruitment/placement';
import { buildLeaveTypesRouter } from './leave-management/leave-types';
import { buildLeaveBalancesRouter, leaveBalanceService } from './leave-management/leave-balances';
import {
  buildLeaveCalendarRouter,
  buildLeaveRequestsRouter,
  leaveRequestService,
} from './leave-management/leave-requests';
import { buildContractTypesRouter } from './contracts/contract-types';
import { buildContractTemplatesRouter } from './contracts/contract-templates';
import { buildContractsRouter, contractService, renderContractPdf } from './contracts/contracts';
import { registerHrContractSettings } from './contracts/contracts.settings';
import { seedHrRecruitment } from './hr.seed';

// Business-calendar + leave settings enter the registry at module load, before boot resolves
// any value (Leave design C2).
registerHrWorkCalendarSettings();
// Attendance settings (frozen attendance design v1.1 §9).
registerHrAttendanceSettings();
// Contracts settings (frozen contracts design A1/A7/D11).
registerHrContractSettings();
// Auth design 4.3/4.4 — employee-code login + NID temp-password source (platform seams).
registerHrIdentitySeams();
// P-HR-22 / D-JOB-6 C — the platform Job catalog renders shift NAMES without an HR grant.
registerHrShiftLabelSeam();
registerHrDirectorySeams();
// P-HR-REQ §6 — the applicants' requisition seam gets its real answer. Registered here, at module
// load, exactly as the directory and shift-label seams are: the applicants feature still does not
// import the requisitions feature, it asks an interface, and this line decides who answers. Until
// this existed the permissive default accepted any well-formed id; from here a reference must name
// a requisition that exists and is still open.
setRequisitionValidator(jobRequisitionReferenceValidator);
// HR3-A — the Employee Code derives from the branch code and is stored, so a branch-code
// correction has to reach the employees that derived from it.
registerHrBranchCodeSeams();
// Workflow consumers (I15): the timeline projection and the audit trail react to published
// workflow events; the engine itself performs no side effects.
registerRecruitmentWorkflowConsumers();
registerQueueMaterializer();
// OQ-30 — the local OCR provider, only when a sidecar URL is configured; otherwise the null
// stub stays and National-ID OCR keeps reporting `available: false`.
registerNationalIdOcrProvider();
// RW2 — reassignment spans every stage, so it registers itself through the Applicants seam.
registerPlacementReassignment();

const applicantPermissions = declarePermissions(
  'hr',
  'applicant',
  { en: 'applicants', ar: 'المتقدمين' },
  ['view', 'create', 'edit', 'delete', 'export'],
  [
    {
      action: 'verifyIdentity',
      name: { en: 'Verify applicant identity', ar: 'توثيق هوية المتقدم' },
    },
    // Offer eligibility is never automatic: HR explicitly moves an applicant to the Job Offer stage.
    {
      action: 'moveToOffer',
      name: { en: 'Move applicant to job offer', ar: 'نقل المتقدم لمرحلة عرض العمل' },
    },
    // RW13 — send a candidate back to an earlier stage. Nothing is deleted; forward records are
    // superseded and the target re-opens on a new attempt.
    // RW2 — Position/Branch stay editable until the offer is accepted, but only through this
    // explicit grant: an `applicant.edit` holder can correct data, not move a candidate.
    {
      action: 'reassign',
      name: { en: 'Reassign applicant position or branch', ar: 'إعادة تعيين وظيفة أو فرع المتقدم' },
    },
    {
      action: 'returnToStage',
      name: { en: 'Return applicant to an earlier stage', ar: 'إعادة المتقدم لمرحلة سابقة' },
    },
  ],
  'hr.applicants',
);

const recruitmentFormPermissions = declarePermissions(
  'hr',
  'recruitmentForm',
  { en: 'recruitment form', ar: 'نموذج التقديم' },
  [],
  [
    {
      action: 'manage',
      name: { en: 'Manage the recruitment form and its links', ar: 'إدارة نموذج التقديم وروابطه' },
    },
  ],
  'hr.application-form',
);

const applicantSourcePermissions = declarePermissions(
  'hr',
  'applicantSource',
  { en: 'applicant sources', ar: 'مصادر التوظيف' },
  [],
  [{ action: 'manage', name: { en: 'Manage applicant sources', ar: 'إدارة مصادر التوظيف' } }],
  'hr.applicant-sources',
);

// Stage 2 — Initial Screening. `decide` is the terminal accept/reject action (OQ-32),
// separate from `edit` (which only appends notes to a pending screening).
const screeningPermissions = declarePermissions(
  'hr',
  'screening',
  { en: 'screenings', ar: 'الفرز المبدئي' },
  ['view', 'create', 'edit'],
  [
    {
      action: 'decide',
      name: { en: 'Decide applicant screening', ar: 'اتخاذ قرار الفرز المبدئي' },
    },
  ],
  'hr.screening',
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
  'hr.interviews',
);

const interviewStagePermissions = declarePermissions(
  'hr',
  'interviewStage',
  { en: 'interview stages', ar: 'مراحل المقابلات' },
  [],
  [{ action: 'manage', name: { en: 'Manage interview stages', ar: 'إدارة مراحل المقابلات' } }],
  'hr.interview-stages',
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
  'hr.evaluations',
);

// RW7 — one concrete resource per business check, so a security officer, a driving examiner and
// a company doctor each see only their own phase. A phase row points at its resource through
// `permissionResource`; admin-created phases keep the generic `evaluation` resource.
//
// Back-compat: the generic `evaluation.view` / `evaluation.manage` grants are a SUPERSET —
// holding one satisfies any phase's check, so existing roles keep working with no migration.
const securityCheckPermissions = declarePermissions(
  'hr',
  'securityCheck',
  { en: 'security checks', ar: 'التحريات الأمنية' },
  ['view'],
  [
    { action: 'manage', name: { en: 'Manage security checks', ar: 'إدارة التحريات الأمنية' } },
    {
      action: 'manageBatch',
      name: { en: 'Manage security check batches', ar: 'إدارة دفعات التحريات الأمنية' },
    },
    { action: 'export', name: { en: 'Export security checks', ar: 'تصدير التحريات الأمنية' } },
  ],
);

/**
 * The applicant portal (P-HR-APP). ONE key, held only by portal accounts themselves — it is not a
 * staff permission and grants nothing wide: every portal read is confined to the caller's own
 * `subjectId` regardless of scope (D-APP-9), and the surface gate refuses everything else.
 */
const applicantPortalPermissions = declarePermissions(
  'hr',
  'applicantPortal',
  { en: 'applicant portal', ar: 'بوابة المتقدمين' },
  ['view'],
);

/** Sending a candidate their portal link by hand (D-APP-3ب) — a staff act, audited and rationed. */
const applicantPortalAdminPermissions = declarePermissions(
  'hr',
  'applicantPortalAdmin',
  { en: 'applicant portal administration', ar: 'إدارة بوابة المتقدمين' },
  [],
  [{ action: 'sendLink', name: { en: 'Send the portal link', ar: 'إرسال رابط البوابة' } }],
);

/**
 * The documents a candidate hands in (P-HR-APP §5).
 *
 * `view` and `review` are separate grants for the reason the whole review exists: looking at what
 * somebody uploaded and RULING on it are different acts, and a refusal reopens the slot and asks
 * that person to go and get another document. Whoever may do that should have been given the key
 * on purpose.
 *
 * Note there is no `upload` key here at all — uploading is the CANDIDATE'S act, authorized by
 * their own portal session, and minting a staff key for it would create a door for HR to file a
 * certificate in somebody else's name.
 */
const applicantDocumentPermissions = declarePermissions(
  'hr',
  'applicantDocument',
  { en: 'applicant documents', ar: 'مستندات المتقدمين' },
  ['view'],
  [
    {
      action: 'review',
      name: { en: 'Review applicant documents', ar: 'مراجعة مستندات المتقدمين' },
    },
  ],
  'hr.applicant-documents',
);

/** The catalogue of what is asked for (D-APP-4) — administered, like every other catalogue. */
const applicantDocumentTypePermissions = declarePermissions(
  'hr',
  'applicantDocumentType',
  { en: 'applicant document types', ar: 'أنواع مستندات المتقدمين' },
  [],
  [
    {
      action: 'manage',
      name: { en: 'Manage applicant document types', ar: 'إدارة أنواع مستندات المتقدمين' },
    },
  ],
  'hr.applicant-documents',
);

const drivingTestPermissions = declarePermissions(
  'hr',
  'drivingTest',
  { en: 'driving tests', ar: 'اختبارات القيادة' },
  ['view'],
  [
    { action: 'manage', name: { en: 'Manage driving tests', ar: 'إدارة اختبارات القيادة' } },
    {
      action: 'manageBatch',
      name: { en: 'Manage driving test batches', ar: 'إدارة دفعات اختبارات القيادة' },
    },
    { action: 'export', name: { en: 'Export driving tests', ar: 'تصدير اختبارات القيادة' } },
  ],
);

const medicalCheckPermissions = declarePermissions(
  'hr',
  'medicalCheck',
  { en: 'medical checks', ar: 'الفحوصات الطبية' },
  ['view'],
  [
    { action: 'manage', name: { en: 'Manage medical checks', ar: 'إدارة الفحوصات الطبية' } },
    { action: 'export', name: { en: 'Export medical checks', ar: 'تصدير الفحوصات الطبية' } },
  ],
);

const evaluationPhasePermissions = declarePermissions(
  'hr',
  'evaluationPhase',
  { en: 'evaluation phases', ar: 'مراحل التقييم' },
  [],
  [{ action: 'manage', name: { en: 'Manage evaluation phases', ar: 'إدارة مراحل التقييم' } }],
  'hr.evaluation-phases',
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
  'hr.job-offers',
);

/**
 * Job Requisitions (P-HR-REQ, ADR-030) — the request to hire. FIVE keys, and the two worth stating
 * are the one that is here and the one that is not.
 *
 * `approve` decides BOTH steps, and the service decides which of them a caller may act on: the
 * manager step authorizes by relationship (the department's effective manager), the HR step by this
 * key. A holder of it may also act at step one — the deadlock escape for an absent manager — and
 * never skips step two. The requester is refused at either step, whatever they hold.
 *
 * There is NO `close` key (D-REQ-12): ending a live requisition early is the same authority that
 * opened it, and a sixth key would split one act between two people for no business reason.
 */
const jobRequisitionPermissions = declarePermissions(
  'hr',
  'jobRequisition',
  { en: 'job requisitions', ar: 'طلبات التوظيف' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'approve',
      name: { en: 'Approve job requisitions', ar: 'اعتماد طلبات التوظيف' },
    },
  ],
  'hr.job-requisitions',
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
    {
      action: 'registerDirect',
      name: { en: 'Register employee directly', ar: 'تسجيل موظف مباشرة' },
    },
    {
      action: 'editPersonal',
      name: { en: 'Edit employee personal data', ar: 'تعديل البيانات الشخصية للموظف' },
    },
    {
      action: 'manageActions',
      name: { en: 'Manage personnel actions', ar: 'إدارة الإجراءات الوظيفية' },
    },
    {
      action: 'manageCompensation',
      name: { en: 'Manage employee compensation', ar: 'إدارة أجر الموظف' },
    },
    {
      action: 'viewCompensation',
      name: { en: 'View employee compensation', ar: 'عرض أجر الموظف' },
    },
    { action: 'exit', name: { en: 'Record employee exit', ar: 'تسجيل انتهاء خدمة الموظف' } },
    {
      action: 'rehire',
      name: { en: 'Rehire an exited employee', ar: 'إعادة تعيين موظف منتهي الخدمة' },
    },
    {
      action: 'rehireOverride',
      name: { en: 'Override rehire ineligibility', ar: 'تجاوز عدم أهلية إعادة التعيين' },
    },
    {
      action: 'viewSensitive',
      name: { en: 'View sensitive employee data', ar: 'عرض البيانات الحساسة للموظف' },
    },
    {
      action: 'changeStatus',
      name: {
        en: 'Change employee status (deprecated alias)',
        ar: 'تغيير حالة الموظف (مسار قديم)',
      },
    },
  ],
  'hr.employees',
);

/**
 * Announcements — writing to everybody's screen at once.
 *
 * Its own resource rather than an employee action, because reading the registry and MESSAGING
 * everybody in it are different powers: plenty of people may legitimately list employees, and very
 * few should be able to put a notification on all their screens simultaneously. How FAR a sender
 * reaches is still bounded by their `employee.view` scope — this key only decides whether they may
 * announce at all.
 */
const announcementPermissions = declarePermissions(
  'hr',
  'announcement',
  { en: 'announcements', ar: 'الإعلانات' },
  ['view'],
  [{ action: 'send', name: { en: 'Send an announcement', ar: 'إرسال إعلان' } }],
  'hr.announcements',
);

/**
 * Notification rules — "when this happens, tell these people", standing.
 *
 * A separate resource from `announcement`, and `manage` is separate from `announcement.send`, for
 * a reason worth stating plainly: sending an announcement is one act by a person who is present.
 * A rule is a STANDING power for the system to message people on its own, repeatedly, with nobody
 * watching at the moment it happens — nearer to granting a permission than to sending a message.
 * Anyone who may announce should not automatically be able to install one.
 *
 * The routes add a second condition this declaration cannot express: `manage` must be held at
 * organization scope, because a rule resolves its audience with no caller to narrow it by.
 */
const notificationRulePermissions = declarePermissions(
  'hr',
  'notificationRule',
  { en: 'notification rules', ar: 'قواعد الإشعارات' },
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Manage notification rules', ar: 'إدارة قواعد الإشعارات' },
    },
  ],
  'hr.notification-rules',
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
  'hr.hiring-documents',
);

const hiringDocumentTypePermissions = declarePermissions(
  'hr',
  'hiringDocumentType',
  { en: 'hiring document types', ar: 'أنواع مستندات التعيين' },
  [],
  [
    {
      action: 'manage',
      name: { en: 'Manage hiring document types', ar: 'إدارة أنواع مستندات التعيين' },
    },
  ],
  'hr.hiring-documents',
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
  'hr.employee-files',
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
    {
      action: 'requestForOthers',
      name: { en: 'File leave for others', ar: 'تسجيل إجازة لموظف آخر' },
    },
    {
      action: 'approve',
      name: { en: 'Approve leave (HR step + override)', ar: 'اعتماد الإجازات' },
    },
    { action: 'cancelApproved', name: { en: 'Cancel approved leave', ar: 'إلغاء إجازة معتمدة' } },
    { action: 'manageTypes', name: { en: 'Manage leave types', ar: 'إدارة أنواع الإجازات' } },
    { action: 'adjustBalances', name: { en: 'Adjust leave balances', ar: 'تعديل أرصدة الإجازات' } },
    { action: 'viewLedger', name: { en: 'View the leave ledger', ar: 'عرض سجل حركات الإجازات' } },
  ],
  'hr.leave',
);

const workCalendarPermissions = declarePermissions(
  'hr',
  'workCalendar',
  { en: 'work calendar', ar: 'تقويم العمل' },
  [],
  [{ action: 'manage', name: { en: 'Manage the work calendar', ar: 'إدارة تقويم العمل' } }],
  'hr.holidays',
);

// Attendance (frozen design v1.1 §6 — keys settled in P-HR-01, two-segment per D-PR-01).
// One resource whose actions genuinely split across surfaces, expressed as three declarations —
// the call-site override the `declarePermissions` docstring names. The shifts catalog and the
// assignments screen ship with AT-1, so their keys sit on those pages; the punch and day-record
// keys have NO screen until AT-6 and stay deliberately unassigned — the page arrives with the
// change that builds the screen, never ahead of it.
const attendanceShiftAdminPermissions = declarePermissions(
  'hr',
  'attendance',
  { en: 'attendance', ar: 'الحضور والانصراف' },
  [],
  [{ action: 'manageShifts', name: { en: 'Manage shifts', ar: 'إدارة الورديات' } }],
  'hr.attendance-shifts',
);

const attendanceAssignPermissions = declarePermissions(
  'hr',
  'attendance',
  { en: 'attendance', ar: 'الحضور والانصراف' },
  [],
  [
    {
      action: 'assign',
      name: { en: 'Assign shifts to employees', ar: 'إسناد الورديات للموظفين' },
    },
  ],
  'hr.attendance-assignments',
);

// The daily sheet is the reading surface (AT-6): `attendance.view` opens it, and the CSV is its
// own key beside it — the audit-screen shape, where reading and exporting are separate grants.
const attendanceDailyPermissions = declarePermissions(
  'hr',
  'attendance',
  { en: 'attendance', ar: 'الحضور والانصراف' },
  ['view', 'export'],
  [],
  'hr.attendance-daily',
);

// The regularization queue's own screen (AT-6): the decision grant lives there.
const attendanceQueuePermissions = declarePermissions(
  'hr',
  'attendance',
  { en: 'attendance', ar: 'الحضور والانصراف' },
  [],
  [
    {
      action: 'decideRegularization',
      name: { en: 'Decide attendance regularizations', ar: 'البت في تسويات الحضور' },
    },
  ],
  'hr.attendance-regularizations',
);

const attendanceUnassignedPermissions = declarePermissions(
  'hr',
  'attendance',
  { en: 'attendance', ar: 'الحضور والانصراف' },
  [],
  [
    { action: 'recordPunch', name: { en: 'Record a punch manually', ar: 'تسجيل بصمة يدويًا' } },
    { action: 'importPunches', name: { en: 'Import device punches', ar: 'استيراد بصمات الأجهزة' } },
    {
      action: 'recompute',
      name: { en: 'Recompute attendance days', ar: 'إعادة احتساب أيام الحضور' },
    },
    // Self-service and the overtime release act on surfaces the employee already stands on (My
    // Attendance, the day row inside the daily sheet) rather than on administration screens of
    // their own — so they stay deliberately unassigned, like the punch and recompute keys.
    {
      action: 'requestRegularization',
      name: { en: 'Request an attendance regularization', ar: 'طلب تسوية حضور' },
    },
    {
      action: 'approveOvertime',
      name: { en: 'Approve overtime minutes', ar: 'اعتماد دقائق العمل الإضافي' },
    },
  ],
);

// Payroll (P-HR-02 / PY-1): the pay-item catalog. Four keys, all of them used by the CRUD this
// phase ships — nothing is declared here for a run, a payslip or a statutory rule that does not
// exist yet.
const payItemPermissions = declarePermissions(
  'hr',
  'payItem',
  { en: 'pay items', ar: 'بنود الأجر' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'hr.pay-items',
);

/**
 * The payroll run (PY-6). TWO keys, and the split is a separation of duty rather than a habit.
 *
 * Seeing whether a month is frozen is an everyday question for anyone working on pay; freezing one
 * is irreversible and covers the whole organization. And no existing key fits: the registry holds
 * nothing at PERIOD level, so the alternative would be `employee.manageCompensation` — which would
 * let anyone able to edit one employee's allowance freeze the entire company's month.
 */
const payrollRunPermissions = declarePermissions(
  'hr',
  'payrollRun',
  { en: 'payroll runs', ar: 'دورات الرواتب' },
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Manage payroll runs', ar: 'إدارة دورات الرواتب' },
    },
    /**
     * P-HR-10 — the two transitions that are not administration.
     *
     * `manage` creates, freezes, closes and cancels: those are acts on a PERIOD. Agreeing that a
     * whole company's figures are right, and saying the money went out, are decisions about money,
     * and the split is the same one P-HR-04 and P-HR-05 made for the same reason — one key held by
     * one person is not a governed lifecycle. The service additionally refuses an approval by
     * whoever froze the run, because a permission says what you MAY do, not who you are.
     */
    {
      action: 'approve',
      name: { en: 'Approve payroll runs', ar: 'اعتماد دورات الرواتب' },
    },
    {
      action: 'pay',
      name: { en: 'Record payroll payment', ar: 'تسجيل صرف الرواتب' },
    },
  ],
  'hr.payroll-runs',
);

/**
 * Payroll adjustments — bonuses and penalties (P-HR-04). THREE keys, and the split is the design.
 *
 * `create` records, edits a draft and cancels; `approve` decides. One key held by one person is
 * not a two-person rule, which is the whole of D1 — and no existing key fits: `payItem.*` governs
 * the CATALOG (what kinds of pay exist), while this governs a decision to pay one person once, and
 * `employee.manageCompensation` would let whoever edits an allowance approve their own bonus.
 */
const payrollAdjustmentPermissions = declarePermissions(
  'hr',
  'payrollAdjustment',
  { en: 'payroll adjustments', ar: 'مؤثرات الرواتب' },
  ['view', 'create'],
  [
    {
      action: 'approve',
      name: { en: 'Approve payroll adjustments', ar: 'اعتماد مؤثرات الرواتب' },
    },
  ],
  'hr.payroll-adjustments',
);

/**
 * The payroll report builder (scope B1). TWO keys, and NEITHER of them grants sight of a figure.
 *
 * `view` opens the builder and lists the definitions somebody saved; `manage` writes them. The
 * split is the ordinary one — reading a catalog is not editing it — but the part worth stating is
 * what these keys deliberately do NOT do: **running a report also demands
 * `employee.viewCompensation`**, because the rows it returns are somebody's pay in aggregate.
 *
 * Without that second key, `payrollReport.view` would become a way to read payroll without holding
 * the payroll key — a permission bypass wearing the costume of a feature. The router chains two
 * `authorize` middlewares to say so, and a guard holds it there.
 *
 * A page cannot exist without a permission (`validatePageRegistry` refuses `empty-page`), which is
 * why reusing an existing key alone was never an option here.
 */
const payrollReportPermissions = declarePermissions(
  'hr',
  'payrollReport',
  { en: 'payroll reports', ar: 'تقارير الرواتب' },
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Manage payroll report definitions', ar: 'إدارة تعريفات تقارير الرواتب' },
    },
  ],
  'hr.payroll-reports',
);

/**
 * Employee loans and advances (P-HR-05). THREE keys, and the split is the same one P-HR-04 made
 * for the same reason — one key held by one person is not a two-person rule (D2).
 *
 * `create` proposes, edits a draft and withdraws it. `approve` decides, records the payment,
 * reschedules and closes a balance: each of those moves real money, which is the seniority of act
 * that agreeing to lend it already is. No existing key fits — `payrollAdjustment.*` governs a
 * decision about one month's pay, while this governs a debt that outlives any month.
 *
 * `pageId` WAS null, and P-HR-06-B is what changed that. Phase A shipped the tab on the employee
 * profile and said so honestly: there was no administration screen to point at. There is one now —
 * `/payroll/employee-loans`, the organization-wide list — so the keys name it. The tab stays
 * exactly where it was; a page id records where a permission is ADMINISTERED, not its only surface.
 */
const employeeLoanPermissions = declarePermissions(
  'hr',
  'employeeLoan',
  { en: 'employee loans', ar: 'قروض وسلف الموظفين' },
  ['view', 'create'],
  [
    {
      action: 'approve',
      name: { en: 'Approve and disburse employee loans', ar: 'اعتماد وصرف قروض الموظفين' },
    },
  ],
  'hr.employee-loans',
);

/**
 * Training (P-HR-TRN). Two resources, because they are two jobs.
 *
 * `trainingCourse.manage` administers the CATALOGUE — configuration, and a small group's work.
 * `trainingSession.*` schedules and runs DELIVERIES, which is a larger group's daily business.
 *
 * `conduct` is separate from `edit` on purpose: completing a session is what will qualify the
 * people in it and write their permanent records (D7), and that is a heavier act than correcting
 * a room booking. A key that could do both would make the two indistinguishable in the matrix.
 */
const trainingCoursePermissions = declarePermissions(
  'hr',
  'trainingCourse',
  { en: 'training courses', ar: 'دورات التدريب' },
  [],
  [{ action: 'manage', name: { en: 'Manage the training catalogue', ar: 'إدارة كتالوج التدريب' } }],
  'hr.training-courses',
);

const trainingSessionPermissions = declarePermissions(
  'hr',
  'trainingSession',
  { en: 'training sessions', ar: 'جلسات التدريب' },
  ['view', 'create', 'edit'],
  [
    {
      action: 'conduct',
      name: {
        en: 'Start, complete or cancel a training session',
        ar: 'بدء أو إنهاء أو إلغاء جلسة تدريب',
      },
    },
  ],
  'hr.training-sessions',
);

const attendancePermissions = [
  ...attendanceShiftAdminPermissions,
  ...attendanceAssignPermissions,
  ...attendanceDailyPermissions,
  ...attendanceQueuePermissions,
  ...attendanceUnassignedPermissions,
];

// Contracts module (frozen design docs/12-planning/contracts-module-design.md §2 D10):
// lifecycle actions are each their own grant; print/download is separately auditable;
// templates and the type catalog are admin surfaces.
const contractPermissions = declarePermissions(
  'hr',
  'contract',
  { en: 'contracts', ar: 'العقود' },
  ['view', 'create'],
  [
    { action: 'approve', name: { en: 'Approve contracts', ar: 'اعتماد العقود' } },
    {
      action: 'generate',
      name: { en: 'Generate contracts & record signatures', ar: 'إصدار العقود وتسجيل التوقيعات' },
    },
    { action: 'amend', name: { en: 'Amend contracts', ar: 'تعديل العقود' } },
    { action: 'renew', name: { en: 'Renew contracts', ar: 'تجديد العقود' } },
    { action: 'terminate', name: { en: 'Terminate contracts', ar: 'إنهاء العقود' } },
    { action: 'print', name: { en: 'Print & download contracts', ar: 'طباعة وتنزيل العقود' } },
  ],
  'hr.contracts',
);

const contractTemplatePermissions = declarePermissions(
  'hr',
  'contractTemplate',
  { en: 'contract templates', ar: 'قوالب العقود' },
  [],
  [{ action: 'manage', name: { en: 'Manage contract templates', ar: 'إدارة قوالب العقود' } }],
  'hr.contract-templates',
);

const contractTypePermissions = declarePermissions(
  'hr',
  'contractType',
  { en: 'contract types', ar: 'أنواع العقود' },
  [],
  [{ action: 'manage', name: { en: 'Manage contract types', ar: 'إدارة أنواع العقود' } }],
  'hr.contracts',
);

export const hrPermissions: PermissionDef[] = [
  ...contractPermissions,
  ...contractTemplatePermissions,
  ...contractTypePermissions,
  ...applicantPermissions,
  ...applicantSourcePermissions,
  ...recruitmentFormPermissions,
  ...screeningPermissions,
  ...interviewPermissions,
  ...interviewStagePermissions,
  ...evaluationPermissions,
  ...securityCheckPermissions,
  ...drivingTestPermissions,
  ...applicantPortalPermissions,
  ...applicantPortalAdminPermissions,
  ...applicantDocumentPermissions,
  ...applicantDocumentTypePermissions,
  ...medicalCheckPermissions,
  ...evaluationPhasePermissions,
  ...jobOfferPermissions,
  ...jobRequisitionPermissions,
  ...employeePermissions,
  ...announcementPermissions,
  ...notificationRulePermissions,
  ...hiringDocumentsPermissions,
  ...hiringDocumentTypePermissions,
  ...employeeFilePermissions,
  ...leavePermissions,
  ...workCalendarPermissions,
  ...attendancePermissions,
  ...payItemPermissions,
  ...payrollRunPermissions,
  ...payrollAdjustmentPermissions,
  ...employeeLoanPermissions,
  ...payrollReportPermissions,
  ...trainingCoursePermissions,
  ...trainingSessionPermissions,
];

/**
 * The administration surfaces this module owns — the middle layer of the role matrix.
 * Organizational only: nothing authorizes on a page, and declaring one grants nobody anything.
 * Declared here rather than derived from the navigation catalogue, which is runtime data an
 * administrator can edit.
 */
export const hrPages: PageDef[] = [
  {
    id: 'hr.announcements',
    moduleId: 'hr',
    name: { en: 'Announcements', ar: 'الإعلانات' },
    route: '/announcements',
    sortOrder: 5,
  },
  {
    id: 'hr.notification-rules',
    moduleId: 'hr',
    name: { en: 'Notification rules', ar: 'قواعد الإشعارات' },
    route: '/notification-rules',
    sortOrder: 6,
  },
  {
    id: 'hr.applicants',
    moduleId: 'hr',
    name: { en: 'Applicants', ar: 'المتقدمون' },
    route: '/applicants',
    sortOrder: 10,
  },
  {
    id: 'hr.applicant-sources',
    moduleId: 'hr',
    name: { en: 'Applicant sources', ar: 'مصادر التقديم' },
    route: '/applicant-sources',
    sortOrder: 20,
  },
  {
    id: 'hr.application-form',
    moduleId: 'hr',
    name: { en: 'Application form', ar: 'نموذج التقديم' },
    route: '/recruitment-form',
    sortOrder: 30,
  },
  {
    id: 'hr.screening',
    moduleId: 'hr',
    name: { en: 'Initial screening', ar: 'الفرز المبدئي' },
    route: '/screening',
    sortOrder: 40,
  },
  {
    id: 'hr.interviews',
    moduleId: 'hr',
    name: { en: 'Interviews', ar: 'المقابلات' },
    route: '/interviews',
    sortOrder: 50,
  },
  {
    id: 'hr.interview-stages',
    moduleId: 'hr',
    name: { en: 'Interview stages', ar: 'مراحل المقابلات' },
    route: '/interviews/stages',
    sortOrder: 60,
  },
  {
    id: 'hr.evaluations',
    moduleId: 'hr',
    name: { en: 'Evaluations', ar: 'التقييمات' },
    route: '/evaluations',
    sortOrder: 70,
  },
  {
    id: 'hr.evaluation-phases',
    moduleId: 'hr',
    name: { en: 'Evaluation phases', ar: 'مراحل التقييم' },
    route: '/evaluations/phases',
    sortOrder: 80,
  },
  {
    id: 'hr.job-offers',
    moduleId: 'hr',
    name: { en: 'Job offers', ar: 'عروض العمل' },
    route: '/job-offers',
    sortOrder: 90,
  },
  {
    id: 'hr.job-requisitions',
    moduleId: 'hr',
    name: { en: 'Job requisitions', ar: 'طلبات التوظيف' },
    route: '/job-requisitions',
    sortOrder: 95,
  },
  {
    id: 'hr.employees',
    moduleId: 'hr',
    name: { en: 'Employees', ar: 'الموظفون' },
    route: '/employees',
    sortOrder: 100,
  },
  {
    id: 'hr.employee-files',
    moduleId: 'hr',
    name: { en: 'Employee files', ar: 'ملفات الموظفين' },
    route: '/employee-files',
    sortOrder: 110,
  },
  {
    // P-HR-APP §5 — the reviewer's worklist for what CANDIDATES hand in, which is a different
    // population and a different moment from the hiring documents a new employee provides.
    id: 'hr.applicant-documents',
    moduleId: 'hr',
    name: { en: 'Applicant documents', ar: 'مستندات المتقدمين' },
    route: '/applicant-documents',
    sortOrder: 118,
  },
  {
    id: 'hr.hiring-documents',
    moduleId: 'hr',
    name: { en: 'Hiring documents', ar: 'مستندات التعيين' },
    route: '/hiring-documents',
    sortOrder: 120,
  },
  {
    id: 'hr.contracts',
    moduleId: 'hr',
    name: { en: 'Contracts', ar: 'العقود' },
    route: '/contracts',
    sortOrder: 130,
  },
  {
    id: 'hr.contract-templates',
    moduleId: 'hr',
    name: { en: 'Contract templates', ar: 'قوالب العقود' },
    route: '/contracts/templates',
    sortOrder: 140,
  },
  {
    id: 'hr.leave',
    moduleId: 'hr',
    name: { en: 'Leave', ar: 'الإجازات' },
    route: '/leave',
    sortOrder: 150,
  },
  {
    id: 'hr.holidays',
    moduleId: 'hr',
    name: { en: 'Work calendar', ar: 'تقويم العمل' },
    route: '/leave/holidays',
    sortOrder: 160,
  },
  {
    id: 'hr.attendance-shifts',
    moduleId: 'hr',
    name: { en: 'Shifts', ar: 'الورديات' },
    route: '/attendance/shifts',
    sortOrder: 170,
  },
  {
    id: 'hr.attendance-assignments',
    moduleId: 'hr',
    name: { en: 'Shift assignments', ar: 'إسناد الورديات' },
    route: '/attendance/assignments',
    sortOrder: 180,
  },
  {
    id: 'hr.attendance-daily',
    moduleId: 'hr',
    name: { en: 'Daily attendance', ar: 'الحضور اليومي' },
    route: '/attendance/daily',
    sortOrder: 190,
  },
  {
    id: 'hr.attendance-regularizations',
    moduleId: 'hr',
    name: { en: 'Attendance regularizations', ar: 'تسويات الحضور' },
    route: '/attendance/regularizations',
    sortOrder: 200,
  },
  {
    id: 'hr.pay-items',
    moduleId: 'hr',
    name: { en: 'Pay items', ar: 'بنود الأجر' },
    route: '/payroll/pay-items',
    sortOrder: 210,
  },
  {
    id: 'hr.payroll-runs',
    moduleId: 'hr',
    name: { en: 'Payroll runs', ar: 'دورات الرواتب' },
    route: '/payroll/runs',
    sortOrder: 220,
  },
  {
    id: 'hr.payroll-adjustments',
    moduleId: 'hr',
    name: { en: 'Payroll adjustments', ar: 'مؤثرات الرواتب' },
    route: '/payroll/adjustments',
    sortOrder: 230,
  },
  // P-HR-06-B. Sits under Payroll rather than beside the employee list because that is where the
  // money is administered — the same reasoning that put the adjustments queue above it.
  {
    id: 'hr.employee-loans',
    moduleId: 'hr',
    name: { en: 'Employee loans', ar: 'قروض وسلف الموظفين' },
    route: '/payroll/employee-loans',
    sortOrder: 240,
  },
  // Scope B1. Last under Payroll: a report is read from what the surfaces above produced.
  {
    id: 'hr.payroll-reports',
    moduleId: 'hr',
    name: { en: 'Payroll reports', ar: 'تقارير الرواتب' },
    route: '/payroll/reports',
    sortOrder: 250,
  },
  // P-HR-TRN. The sessions screen first: it is the daily work, and the catalogue behind it is
  // configuration somebody visits when the programme changes.
  {
    id: 'hr.training-sessions',
    moduleId: 'hr',
    name: { en: 'Training sessions', ar: 'جلسات التدريب' },
    route: '/training/sessions',
    sortOrder: 300,
  },
  {
    id: 'hr.training-courses',
    moduleId: 'hr',
    name: { en: 'Training catalogue', ar: 'كتالوج التدريب' },
    route: '/training/courses',
    sortOrder: 310,
  },
];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.25.0',
  requiresPlatform: '^2.1',
  permissions: hrPermissions,
  pages: hrPages,
  routes: [
    { prefix: '/hr/announcements', router: buildAnnouncementsRouter() },
    { prefix: '/hr/notification-rules', router: buildNotificationRulesRouter() },
    { prefix: '/hr/applicants', router: buildRecruitmentTimelineRouter() },
    { prefix: '/hr/applicants', router: buildReturnToStageRouter() },
    { prefix: '/hr/applicants', router: buildApplicantsRouter() },
    { prefix: '/hr/applicant-sources', router: buildApplicantSourcesRouter() },
    { prefix: '/hr/recruitment-form', router: buildRecruitmentFormRouter() },
    // Unauthenticated by design — the token in the path is the credential (see the router).
    { prefix: '/hr/public/apply', router: buildPublicRecruitmentFormRouter() },
    { prefix: '/hr/screenings', router: buildScreeningsRouter() },
    { prefix: '/hr/interviews', router: buildInterviewsRouter() },
    { prefix: '/hr/interview-stages', router: buildInterviewStagesRouter() },
    { prefix: '/hr/evaluations', router: buildEvaluationsRouter() },
    { prefix: '/hr/evaluation-phases', router: buildEvaluationPhasesRouter() },
    { prefix: '/hr/evaluation-batches', router: buildEvaluationBatchesRouter() },
    { prefix: '/hr/recruitment', router: buildRecruitmentCountersRouter() },
    { prefix: '/hr/job-offers', router: buildJobOffersRouter() },
    { prefix: '/hr/job-requisitions', router: buildJobRequisitionsRouter() },
    { prefix: '/hr/employees', router: buildCompensationRouter() },
    { prefix: '/hr/employees', router: buildEmployeePayItemsRouter() },
    { prefix: '/hr/employees', router: buildEmployeeCostCentersRouter() },
    { prefix: '/hr/employees', router: buildEmployeeActionsRouter() },
    // …and the per-employee surface, because a bonus is that person's money.
    { prefix: '/hr/employees', router: buildEmployeeAdjustmentsRouter() },
    // P-HR-20 — this employee's payslips across every run. The mirror of the run's list, behind
    // the same compensation key, adding no permission of its own.
    { prefix: '/hr/employees', router: buildEmployeePayslipsRouter() },
    { prefix: '/hr/employees', router: buildEmployeeLoansRouter() },
    // P-HR-11 — the leaver's assembled read, beside the other per-employee readers. It adds no
    // collection below, because it stores nothing: every figure it states belongs to another feature.
    { prefix: '/hr/employees', router: buildSettlementRouter() },
    { prefix: '/hr/employees', router: buildLeaveBalancesRouter() },
    { prefix: '/hr/employees', router: buildEmployeesRouter() },
    // P-HR-APP §5 — two prefixes, two audiences. The candidate's router is mounted under the ONE
    // prefix their write surface declares, and it is the only router in ECMS an external applicant
    // account can reach; HR's review surface is an ordinary permissioned HR route.
    { prefix: APPLICANT_PORTAL_PREFIX, router: buildApplicantPortalDocumentsRouter() },
    { prefix: '/hr/applicant-documents', router: buildApplicantDocumentsRouter() },
    { prefix: '/hr/hiring-documents', router: buildHiringDocumentsRouter() },
    { prefix: '/hr/hiring-document-types', router: buildHiringDocumentTypesRouter() },
    { prefix: '/hr/employee-files', router: buildEmployeeFilesRouter() },
    { prefix: '/hr/leave-types', router: buildLeaveTypesRouter() },
    { prefix: '/hr/leave-requests', router: buildLeaveRequestsRouter() },
    { prefix: '/hr/leave-calendar', router: buildLeaveCalendarRouter() },
    { prefix: '/hr/holidays', router: buildHolidaysRouter() },
    { prefix: '/hr/work-calendar', router: buildWorkCalendarRouter() },
    { prefix: '/hr/contracts', router: buildContractsRouter() },
    { prefix: '/hr/contract-templates', router: buildContractTemplatesRouter() },
    { prefix: '/hr/contract-types', router: buildContractTypesRouter() },
    { prefix: '/hr/attendance/shifts', router: buildAttendanceShiftsRouter() },
    { prefix: '/hr/attendance/assignments', router: buildAttendanceAssignmentsRouter() },
    { prefix: '/hr/attendance/punches', router: buildAttendancePunchesRouter() },
    { prefix: '/hr/attendance/days', router: buildAttendanceDaysRouter() },
    { prefix: '/hr/attendance/regularizations', router: buildAttendanceRegularizationsRouter() },
    { prefix: '/hr/attendance/overtime', router: buildAttendanceOvertimeRouter() },
    { prefix: '/hr/attendance/export', router: buildAttendanceExportRouter() },
    { prefix: '/hr/payroll/pay-items', router: buildPayItemsRouter() },
    { prefix: '/hr/payroll/runs', router: buildPayrollRunsRouter() },
    // PY-7 — mounted at the same prefix, because a payslip has no existence apart from the run
    // that issued it. Two routers rather than one so the run's own keys stay separate from the
    // compensation key the payslip reads under.
    { prefix: '/hr/payroll/runs', router: buildRunPayslipsRouter() },
    // P-HR-15-A — the run reconciled against its own payslips. Same prefix and the same reason:
    // a reconciliation has no existence apart from the run it reconciles.
    { prefix: '/hr/payroll/runs', router: buildReconciliationRouter() },
    // P-HR-14 / U14-1 — what the run cost, grouped by the dimensions its lines already carry.
    // Same prefix, same reason, and the same compensation key: it names no account and posts
    // nothing, so it needs no key of its own.
    { prefix: '/hr/payroll/runs', router: buildCostBreakdownRouter() },
    { prefix: '/hr/payroll/runs', router: buildCostReportRouter() },
    { prefix: '/hr/payroll/reports', router: buildReportBuilderRouter() },
    { prefix: '/hr/payroll/payslips', router: buildPayslipsRouter() },
    // P-HR-04 — the organization-wide list the approval queue reads.
    { prefix: '/hr/payroll/adjustments', router: buildPayrollAdjustmentsRouter() },
    { prefix: '/hr/employee-loans', router: buildEmployeeLoansAdminRouter() },
    { prefix: '/hr/training/courses', router: buildTrainingCoursesRouter() },
    { prefix: '/hr/training/sessions', router: buildTrainingSessionsRouter() },
  ],
  collections: [
    'hr_applicants',
    'hr_applicant_sources',
    'hr_applicant_document_types',
    'hr_applicant_document_sets',
    'hr_sequences',
    'hr_screenings',
    'hr_interviews',
    'hr_interview_stages',
    'hr_evaluations',
    'hr_evaluation_phases',
    'hr_evaluation_batches',
    'hr_recruitment_timeline',
    'hr_recruitment_events',
    'hr_job_offers',
    'hr_job_requisitions',
    'hr_job_requisition_fills',
    'hr_employees',
    'hr_employee_actions',
    'hr_announcements',
    'hr_notification_rules',
    'hr_hiring_documents',
    'hr_hiring_document_types',
    'hr_employee_files',
    'hr_leave_types',
    'hr_leave_requests',
    'hr_leave_ledger',
    'hr_leave_balances',
    'hr_holidays',
    'hr_contracts',
    'hr_contract_templates',
    'hr_contract_types',
    'hr_contract_branding',
    'hr_shifts',
    'hr_shift_assignments',
    'hr_attendance_punches',
    'hr_attendance_days',
    'hr_attendance_regularizations',
    'hr_pay_items',
    'hr_employee_pay_items',
    'hr_payroll_runs',
    'hr_payroll_leave_snapshots',
    'hr_payslips',
    'hr_payroll_adjustments',
    'hr_employee_loans',
    'hr_loan_installments',
    'hr_loan_repayments',
    'hr_training_courses',
    'hr_training_sessions',
  ],
  // ADR-023 — HR answers the Files service's "may this caller see the owning entity?" for the
  // documents personnel actions are created with (HR3-C). One type, minted by this phase, so no
  // file already filed against an employee changes behaviour.
  fileEntityAuthorizers: [
    ...hrFileEntityAuthorizers,
    ...hrAdjustmentFileAuthorizers,
    ...hrEmployeeLoanFileAuthorizers,
    // ADR-023 + D-APP-9 — a candidate reaches their OWN uploads and nothing else, decided against
    // the subject on their session rather than anything in the request.
    ...hrApplicantDocumentFileAuthorizers,
  ],
  eventSubscriptions: [
    {
      // P-HR-REQ D-REQ-13 — fulfilment. The requisition COUNTS hires; it never causes one, and it
      // never writes workflow state back (I15). The handler swallows its own failures for the same
      // reason the rule bridge does: a courtesy attached to an event that already happened must not
      // become a liability for it.
      event: 'hr.applicant.hired',
      handlerId: 'jobRequisitions.recordFill',
      handler: async (envelope) => {
        await recordHireAgainstRequisition(envelope.payload);
      },
    },
    {
      // P-HR-APP D-APP-2 — the portal opens when a candidate CLEARS screening, and never before.
      // Idempotent by construction: a redelivered event, or a screening flipped back to accepted,
      // finds the existing account and does nothing. Like every courtesy attached to an event that
      // already happened, it swallows its own failures — a screening decision must not fail
      // because a portal account could not be made.
      event: 'hr.screening.decided',
      handlerId: 'applicantPortal.openOnScreeningPass',
      handler: async (envelope) => {
        const payload = envelope.payload as { applicantId?: string; outcome?: string };
        if (payload.outcome !== 'accepted' || typeof payload.applicantId !== 'string') return;
        try {
          const applicant = await applicantService.findByIdSystem(payload.applicantId);
          if (applicant === null) return;
          await applicantPortalService.openFor(applicant);
          await applicantPortalService.sendPortalLink(payload.applicantId, 'system');
        } catch (error) {
          logger.error({ err: error, applicantId: payload.applicantId }, 'opening the applicant portal failed');
        }
      },
    },
    // Notification rules (stage 3): one subscription per cataloged event, all routed to the same
    // handler, exactly as automation's trigger bridge does it. HR is an ordinary event consumer
    // here — no new bus, no new delivery guarantee, and no change to any publisher. The handler
    // never throws: a rule is a courtesy on top of an event that already happened, and a courtesy
    // that can break what it is attached to is a liability (see `rule-bridge`).
    ...ruleEventSubscriptions(),
    {
      // Contracts A13/D8 — the reliable tier executes in the WORKER: render the PDF
      // from the STORED snapshot and store one immutable file per contract version.
      event: 'hr.contract.renderRequested',
      handlerId: 'contracts.renderPdf',
      handler: async (envelope) => {
        const payload = envelope.payload as { contractId?: string };
        if (typeof payload.contractId === 'string') {
          await renderContractPdf(payload.contractId);
        }
      },
    },
    {
      // RW8b — the reliable tier executes in the WORKER: build the official PDF list and the
      // ZIP export package for an issued batch. Issuing never waits on chromium.
      event: 'hr.evaluationBatch.generated',
      handlerId: 'evaluationBatches.buildPackage',
      handler: async (envelope) => {
        const payload = envelope.payload as { batchId?: string };
        if (typeof payload.batchId === 'string') {
          await buildEvaluationBatchPackage(payload.batchId);
        }
      },
    },
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
      // Loans D8 (P-HR-05-B): withdraw the instalments scheduled after the exit and say plainly
      // whether a balance is left. Nothing is taken from a final salary and nothing is written
      // off — both would be decisions this system has not been granted.
      event: 'hr.employee.exited',
      handlerId: 'loans.exitSettlement',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string; effectiveDate?: string };
        // The DATE is required here, unlike in the two consumers above: they act on the fact that
        // somebody left, this one has to know which months to withdraw.
        if (typeof payload.employeeId === 'string' && typeof payload.effectiveDate === 'string') {
          await employeeLoanService.onEmployeeExited(payload.employeeId, payload.effectiveDate);
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
      // Rehires open a fresh pro-rated grant in the new employment period (leave design R12) —
      // same-year rehires re-grant via a period-keyed adjustment (the grant key is consumed).
      event: 'hr.employee.rehired',
      handlerId: 'leave.grantOnRehire',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await leaveBalanceService.regrantOnRehire(payload.employeeId);
        }
      },
    },
    {
      // Attendance §1.4: a day covered by approved leave is `onLeave`, never `absent`. The span
      // events Leave already publishes for this consumer drive a recompute of the covered days —
      // frozen days refuse inside the engine, so a late-decided leave can never restate a paid
      // month from here.
      event: 'hr.leave.started',
      handlerId: 'attendance.onLeaveStarted',
      handler: async (envelope) => {
        const payload = envelope.payload as {
          employeeId?: string;
          startDate?: string | Date;
          endDate?: string | Date;
        };
        if (
          typeof payload.employeeId === 'string' &&
          payload.startDate !== undefined &&
          payload.endDate !== undefined
        ) {
          await dayRecordService.recomputeSpanForEmployee(
            payload.employeeId,
            new Date(payload.startDate),
            new Date(payload.endDate),
          );
        }
      },
    },
    {
      // The mirror of the above: an early return truncates the span, so the tail days flip back
      // from `onLeave` to whatever the punches say they were.
      event: 'hr.leave.ended',
      handlerId: 'attendance.onLeaveEnded',
      handler: async (envelope) => {
        const payload = envelope.payload as {
          employeeId?: string;
          startDate?: string | Date;
          endDate?: string | Date;
        };
        if (
          typeof payload.employeeId === 'string' &&
          payload.startDate !== undefined &&
          payload.endDate !== undefined
        ) {
          await dayRecordService.recomputeSpanForEmployee(
            payload.employeeId,
            new Date(payload.startDate),
            new Date(payload.endDate),
          );
        }
      },
    },
    {
      // Attendance §1.5: stop expecting attendance from the exit date — recomputing around today
      // drops rows the employment-period check no longer supports.
      event: 'hr.employee.exited',
      handlerId: 'attendance.onEmployeeExited',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          const today = cairoToday();
          await dayRecordService.recomputeSpanForEmployee(
            payload.employeeId,
            addDays(today, -7),
            today,
          );
        }
      },
    },
  ],
  scheduledTasks: [
    {
      // I15 — the outbox's crash-recovery net.
      //
      // A workflow event is written in the SAME transaction as the aggregate change and published
      // only after that transaction commits. The gap between those two moments is small but real:
      // a process killed inside it leaves a committed state change whose event was never
      // delivered — no timeline entry, no notification, no projection. Every subsequent transition
      // drains the whole outbox, so the system usually heals itself on the next write; this sweep
      // is what heals it when there is no next write, on a quiet queue or overnight.
      //
      // Safe to run at any time and safe to overlap: delivery is per-event and marked, so an event
      // already dispatched is never dispatched twice, and consumers key on the immutable `eventId`.
      key: 'hr.recruitment.workflowOutbox',
      description: 'Publish committed recruitment workflow events whose dispatch never ran (I15)',
      cron: '*/5 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await dispatchPendingWorkflowEvents();
      },
    },
    {
      // I5 — the timeline's repair task.
      //
      // The timeline is THE history, which makes a missing entry silent: nothing errors, the
      // history is just shorter than the truth. This puts back what should be there — events that
      // were committed but never projected, and the two facts written outside the engine
      // (`applied`, `identityVerified`) whose writer logs and swallows rather than failing the
      // business operation. Every write it makes is keyed on a deterministic `sourceKey`, so a run
      // against a healthy database changes nothing and a rebuilt row keeps its original identity.
      //
      // Hourly rather than by the minute: this is a repair, not a delivery path — the outbox sweep
      // above is what keeps the normal case current.
      key: 'hr.recruitment.timelineReconcile',
      description: 'Rebuild recruitment timeline entries that should exist and do not (I5)',
      cron: '20 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await reconcileRecruitmentTimeline();
      },
    },
    {
      // Contracts D11 — fixed-term contracts past their end date flip to `expired`.
      key: 'hr.contracts.expire',
      description: 'Expire fixed-term contracts past their end date',
      cron: '0 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await contractService.expireOverdue();
      },
    },
    {
      // Contracts D11 — expiring-soon notices (once per contract, window setting-driven).
      key: 'hr.contracts.expiryNotice',
      description: 'Notify contract viewers about contracts ending within the notice window',
      cron: '0 7 * * *',
      ownerService: 'hr',
      handler: async () => {
        await contractService.notifyExpiring();
      },
    },
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
    {
      // Attendance (v1.1 §9): derive the previous Cairo day. Runs hourly and acts only when the
      // Cairo hour matches `hr.attendance.autoComputeHour` — a fixed cron cannot follow a
      // setting, so the task checks and the unique day key keeps double-runs harmless.
      key: 'hr.attendance.computeDaily',
      description: 'Derive attendance day records for the previous Cairo day',
      cron: '15 * * * *',
      ownerService: 'hr',
      handler: async () => {
        await dayRecordService.computePreviousDayIfDue();
      },
    },
    {
      // Attendance (§9, AT-7): the two morning notices, after the nightly compute has run. Both
      // are idempotent through the notification's deterministic key rather than through a marker
      // on the day, so a retry, a double tick or a manual re-run sends nothing twice.
      key: 'hr.attendance.missingCheckoutSweep',
      description: 'Notify employees whose previous day has a check-in and no check-out',
      cron: '0 6 * * *',
      ownerService: 'hr',
      handler: async () => {
        await attendanceSweepService.sweepMissingCheckouts();
      },
    },
    {
      key: 'hr.attendance.absenceNotifySweep',
      description: 'Notify employees whose previous day was recorded as an absence',
      cron: '10 6 * * *',
      ownerService: 'hr',
      handler: async () => {
        await attendanceSweepService.sweepAbsenceNotices();
      },
    },
  ],
  seed: seedHrRecruitment,
};
