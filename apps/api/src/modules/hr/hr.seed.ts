// HR reference-data seed (Module Structure §2.1) — run at boot by the kernel after
// permissions and the organization singleton exist. Idempotent: safe on every boot.
// Seeds the 10 initial applicant sources (Sprint 4.1 plan §3). The OCR provider and
// requisition validator default to their safe stubs at import time (OQ-30), so nothing
// to register here.
import { type CreateApplicantSource } from '@ecms/contracts';
import { applicantSourceService } from './recruitment/applicants';

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

export const seedHrRecruitment = async (): Promise<void> => {
  for (const source of SOURCES) {
    await applicantSourceService.ensure(source);
  }
};
