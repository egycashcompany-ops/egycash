// HR module manifest — THE single integration point between the HR business module and
// the Platform Core (Module Structure §2.1). The kernel validates it at boot (unique id,
// permission naming, `hr_` collection prefix, `/hr` route prefix) and fails the boot on
// violation. Release v0.6 ships the Recruitment sub-module, Stage 1 (Applicants) only.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildApplicantSourcesRouter, buildApplicantsRouter } from './recruitment/applicants';
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

export const hrPermissions: PermissionDef[] = [...applicantPermissions, ...applicantSourcePermissions];

export const hrModule: ModuleManifest = {
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '0.6.0',
  requiresPlatform: '^2.1',
  permissions: hrPermissions,
  routes: [
    { prefix: '/hr/applicants', router: buildApplicantsRouter() },
    { prefix: '/hr/applicant-sources', router: buildApplicantSourcesRouter() },
  ],
  collections: ['hr_applicants', 'hr_applicant_sources', 'hr_sequences'],
  eventSubscriptions: [],
  seed: seedHrRecruitment,
};
