// Built-in templates for the two initial event subscriptions (Sprint 3.3 plan §4).
// Idempotent (same pattern as `organizationService.ensure`/`fileCategoryService.ensure`)
// so both templates exist unconditionally at boot — including in test suites — since
// the plan's acceptance criteria requires both subscriptions to work end-to-end.
import { notificationTemplateService } from './notification-template.service';
import { CREDENTIALS_TEMPLATE_KEY } from '../users/credentials-delivery';

export const SECURITY_ALERT_TEMPLATE_KEY = 'platform.securityAlertRaised';
export const ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY = 'platform.roleAssignmentChanged';

export const ensureBuiltinNotificationTemplates = async (): Promise<void> => {
  // Credential message (auth design §13 R15): ADMIN-EDITABLE wording; rendered in memory by
  // the transient credentials-delivery service — never sent through the persisted pipeline
  // (the body carries a temporary password, which must never be stored, R12). `channels`
  // is informational here: delivery goes to WhatsApp + email transports directly.
  await notificationTemplateService.ensure({
    key: CREDENTIALS_TEMPLATE_KEY,
    category: 'security',
    priority: 'critical',
    subject: {
      ar: 'EGYCASH — بيانات الدخول',
      en: 'EGYCASH — your login credentials',
    },
    body: {
      ar:
        'EGYCASH — حساب الدخول الخاص بك\nاسم المستخدم: {{username}}\nكود الموظف: {{employeeCode}}\n' +
        'كلمة المرور المؤقتة: {{temporaryPassword}}\nرابط الدخول: {{loginUrl}}\n' +
        'هذه كلمة مرور مؤقتة ويجب تغييرها عند أول تسجيل دخول. صلاحيتها تنتهي في {{expiresAt}}.',
      en:
        'EGYCASH — your login account\nUsername: {{username}}\nEmployee Code: {{employeeCode}}\n' +
        'Temporary password: {{temporaryPassword}}\nLogin: {{loginUrl}}\n' +
        'This password is TEMPORARY and must be changed at your first sign-in. It expires at {{expiresAt}}.',
    },
    channels: ['email'],
    variables: ['username', 'employeeCode', 'temporaryPassword', 'loginUrl', 'expiresAt'],
    defaultExpiryHours: null,
  });
  await notificationTemplateService.ensure({
    key: SECURITY_ALERT_TEMPLATE_KEY,
    category: 'security',
    priority: 'critical', // security alerts bypass quiet hours (§3c)
    subject: {
      ar: 'تنبيه أمني: {{signal}}',
      en: 'Security alert: {{signal}}',
    },
    body: {
      ar: 'تم رصد نشاط أمني "{{signal}}" ({{count}} مرة خلال {{windowMinutes}} دقيقة).',
      en: 'Security signal "{{signal}}" was raised ({{count}} occurrences in the last {{windowMinutes}} minutes).',
    },
    channels: ['inApp', 'email'],
    variables: ['signal', 'count', 'windowMinutes'],
    defaultExpiryHours: null,
  });

  await notificationTemplateService.ensure({
    key: ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY,
    category: 'security',
    priority: 'normal',
    subject: {
      ar: 'تغيير في صلاحياتك',
      en: 'Your role assignment changed',
    },
    body: {
      ar: 'تم {{change}} الدور "{{roleName}}" الخاص بحسابك.',
      en: 'Your role "{{roleName}}" was {{change}}.',
    },
    channels: ['inApp', 'email'],
    variables: ['roleName', 'change'],
    defaultExpiryHours: null,
  });
};
