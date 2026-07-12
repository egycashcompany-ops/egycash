// HR reference-data seed (Module Structure §2.1) — run at boot by the kernel after
// permissions and the organization singleton exist. Idempotent: safe on every boot.
// Seeds the 10 initial applicant sources (Stage 1), the default two interview stages
// (Stage 3, OQ-31 — number/names/order are admin-configurable thereafter), and the
// interview notification templates the interview service sends through. The OCR provider
// and requisition validator default to their safe stubs at import time (OQ-30).
import {
  HrEmployeeTemplates,
  HrInterviewTemplates,
  HrOfferTemplates,
  type CreateApplicantSource,
  type CreateInterviewStage,
} from '@ecms/contracts';
import { notificationTemplateService } from '../../platform/notifications';
import { applicantSourceService } from './recruitment/applicants';
import { interviewStageService } from './recruitment/interviews';

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
};

export const seedHrRecruitment = async (): Promise<void> => {
  for (const source of SOURCES) {
    await applicantSourceService.ensure(source);
  }
  for (const stage of INTERVIEW_STAGES) {
    await interviewStageService.ensure(stage);
  }
  await ensureInterviewTemplates();
  await ensureOfferTemplates();
  await ensureEmployeeTemplates();
};
