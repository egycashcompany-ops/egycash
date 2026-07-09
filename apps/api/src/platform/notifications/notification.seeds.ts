// Built-in templates for the two initial event subscriptions (Sprint 3.3 plan §4).
// Idempotent (same pattern as `organizationService.ensure`/`fileCategoryService.ensure`)
// so both templates exist unconditionally at boot — including in test suites — since
// the plan's acceptance criteria requires both subscriptions to work end-to-end.
import { notificationTemplateService } from './notification-template.service';

export const SECURITY_ALERT_TEMPLATE_KEY = 'platform.securityAlertRaised';
export const ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY = 'platform.roleAssignmentChanged';

export const ensureBuiltinNotificationTemplates = async (): Promise<void> => {
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
