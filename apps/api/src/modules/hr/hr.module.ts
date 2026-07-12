// HR module manifest — THE single integration point between the HR business module and
// the Platform Core (Module Structure §2.1). The kernel validates it at boot (unique id,
// permission naming, `hr_` collection prefix, `/hr` route prefix) and fails the boot on
// violation. Ships the Recruitment sub-module: Stage 1 (Applicants), Stage 2 (Initial
// Screening), Stage 3 (Interviews), Stage 4 (Job Offer), and Stage 5 (Employee Creation).
// Later stages (Hiring Documents onward) are future sprints.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildApplicantSourcesRouter, buildApplicantsRouter } from './recruitment/applicants';
import { buildScreeningsRouter } from './recruitment/screening';
import { buildInterviewStagesRouter, buildInterviewsRouter } from './recruitment/interviews';
import { buildJobOffersRouter, jobOfferService } from './recruitment/job-offers';
import { buildEmployeesRouter } from './recruitment/employees';
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

// Stage 5 — Employee Creation. `create` hires an applicant from an accepted offer; `view`
// reads the resulting employee records. (Employee lifecycle management is a later concern.)
const employeePermissions = declarePermissions(
  'hr',
  'employee',
  { en: 'employees', ar: 'الموظفين' },
  ['view', 'create'],
);

export const hrPermissions: PermissionDef[] = [
  ...applicantPermissions,
  ...applicantSourcePermissions,
  ...screeningPermissions,
  ...interviewPermissions,
  ...interviewStagePermissions,
  ...jobOfferPermissions,
  ...employeePermissions,
];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.10.0',
  requiresPlatform: '^2.1',
  permissions: hrPermissions,
  routes: [
    { prefix: '/hr/applicants', router: buildApplicantsRouter() },
    { prefix: '/hr/applicant-sources', router: buildApplicantSourcesRouter() },
    { prefix: '/hr/screenings', router: buildScreeningsRouter() },
    { prefix: '/hr/interviews', router: buildInterviewsRouter() },
    { prefix: '/hr/interview-stages', router: buildInterviewStagesRouter() },
    { prefix: '/hr/job-offers', router: buildJobOffersRouter() },
    { prefix: '/hr/employees', router: buildEmployeesRouter() },
  ],
  collections: [
    'hr_applicants',
    'hr_applicant_sources',
    'hr_sequences',
    'hr_screenings',
    'hr_interviews',
    'hr_interview_stages',
    'hr_job_offers',
    'hr_employees',
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
