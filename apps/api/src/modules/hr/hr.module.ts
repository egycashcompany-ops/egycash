// HR module manifest — THE single integration point between the HR business module and
// the Platform Core (Module Structure §2.1). The kernel validates it at boot (unique id,
// permission naming, `hr_` collection prefix, `/hr` route prefix) and fails the boot on
// violation. Ships the Recruitment sub-module: Stage 1 (Applicants) + Stage 2 (Initial
// Screening). Later recruitment stages (Interviews onward) are separate future sprints.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildApplicantSourcesRouter, buildApplicantsRouter } from './recruitment/applicants';
import { buildScreeningsRouter } from './recruitment/screening';
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

export const hrPermissions: PermissionDef[] = [
  ...applicantPermissions,
  ...applicantSourcePermissions,
  ...screeningPermissions,
];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.7.0',
  requiresPlatform: '^2.1',
  permissions: hrPermissions,
  routes: [
    { prefix: '/hr/applicants', router: buildApplicantsRouter() },
    { prefix: '/hr/applicant-sources', router: buildApplicantSourcesRouter() },
    { prefix: '/hr/screenings', router: buildScreeningsRouter() },
  ],
  collections: ['hr_applicants', 'hr_applicant_sources', 'hr_sequences', 'hr_screenings'],
  eventSubscriptions: [],
  seed: seedHrRecruitment,
};
