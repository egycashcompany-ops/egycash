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
import { buildEmployeesRouter } from './recruitment/employees';
import { buildHiringDocumentTypesRouter, buildHiringDocumentsRouter } from './recruitment/hiring-documents';
import { buildEmployeeFilesRouter } from './recruitment/employee-file';
import { seedHrRecruitment } from './hr.seed';

const applicantPermissions = declarePermissions(
  'hr',
  'applicant',
  { en: 'applicants', ar: 'المتقدمين' },
  ['view', 'create', 'edit', 'delete', 'export'],
  [{ action: 'verifyIdentity', name: { en: 'Verify applicant identity', ar: 'توثيق هوية المتقدم' } }],
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

// Employees sub-module. `create` hires an applicant from an accepted offer; `view` reads the
// resulting records; `changeStatus` drives the post-hire lifecycle (leave / suspend / reinstate /
// terminate), enforced against the shared transition matrix and recorded as a status trail.
const employeePermissions = declarePermissions(
  'hr',
  'employee',
  { en: 'employees', ar: 'الموظفين' },
  ['view', 'create'],
  [{ action: 'changeStatus', name: { en: 'Change employee status', ar: 'تغيير حالة الموظف' } }],
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
];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.13.0',
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
    { prefix: '/hr/employees', router: buildEmployeesRouter() },
    { prefix: '/hr/hiring-documents', router: buildHiringDocumentsRouter() },
    { prefix: '/hr/hiring-document-types', router: buildHiringDocumentTypesRouter() },
    { prefix: '/hr/employee-files', router: buildEmployeeFilesRouter() },
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
    'hr_hiring_documents',
    'hr_hiring_document_types',
    'hr_employee_files',
  ],
  eventSubscriptions: [],
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
  ],
  seed: seedHrRecruitment,
};
