// Platform Core permission catalog — phase 2.1 services only.
// Later phases (files, notifications, workflow, …) add their resources when they land,
// per the vertical-slice plan (Architecture Review 01, R2).
import { declarePermissions, type PermissionDef } from './def.js';

const P = 'platform';

export const userPermissions = declarePermissions(
  P,
  'user',
  { en: 'users', ar: 'المستخدمين' },
  ['view', 'create', 'edit', 'delete', 'export'],
  [
    {
      action: 'resetPassword',
      name: { en: 'Reset user passwords', ar: 'إعادة تعيين كلمات المرور' },
    },
    {
      action: 'manageSessions',
      name: { en: 'Manage user sessions (force logout)', ar: 'إدارة جلسات المستخدمين' },
      breakGlass: true,
    },
  ],
);

export const rolePermissions = declarePermissions(
  P,
  'role',
  { en: 'roles', ar: 'الأدوار' },
  ['view', 'create', 'edit', 'delete'],
  [{ action: 'assign', name: { en: 'Assign roles to users', ar: 'إسناد الأدوار للمستخدمين' } }],
);

export const permissionRegistryPermissions = declarePermissions(
  P,
  'permission',
  { en: 'permission registry', ar: 'سجل الصلاحيات' },
  ['view'],
);

export const organizationPermissions = declarePermissions(
  P,
  'organization',
  { en: 'organization profile', ar: 'ملف المؤسسة' },
  ['view', 'edit'],
);

export const branchPermissions = declarePermissions(P, 'branch', { en: 'branches', ar: 'الفروع' }, [
  'view',
  'create',
  'edit',
  'delete',
]);

export const departmentPermissions = declarePermissions(
  P,
  'department',
  { en: 'departments', ar: 'الإدارات' },
  ['view', 'create', 'edit', 'delete'],
);

export const sectionPermissions = declarePermissions(
  P,
  'section',
  { en: 'sections', ar: 'الأقسام' },
  ['view', 'create', 'edit', 'delete'],
);

export const jobTitlePermissions = declarePermissions(
  P,
  'jobTitle',
  { en: 'job titles', ar: 'المسميات الوظيفية' },
  ['view', 'create', 'edit', 'delete'],
);

export const jobPositionPermissions = declarePermissions(
  P,
  'jobPosition',
  { en: 'job positions', ar: 'الوظائف' },
  ['view', 'create', 'edit', 'delete'],
);

export const applicationPermissions = declarePermissions(
  P,
  'application',
  { en: 'applications', ar: 'التطبيقات' },
  ['view', 'create', 'edit', 'delete'],
);

export const applicationCategoryPermissions = declarePermissions(
  P,
  'applicationCategory',
  { en: 'application categories', ar: 'فئات التطبيقات' },
  ['view', 'create', 'edit', 'delete'],
);

export const settingPermissions = declarePermissions(
  P,
  'setting',
  { en: 'settings', ar: 'الإعدادات' },
  ['view', 'edit'],
);

export const auditLogPermissions = declarePermissions(
  P,
  'auditLog',
  { en: 'audit logs', ar: 'سجلات التدقيق' },
  ['view', 'export'],
);

export const activityLogPermissions = declarePermissions(
  P,
  'activityLog',
  { en: 'activity logs', ar: 'سجلات النشاط' },
  ['view'],
);

export const filePermissions = declarePermissions(
  P,
  'file',
  { en: 'files', ar: 'الملفات' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'download',
      name: { en: 'Download files (audited)', ar: 'تنزيل الملفات (مُدقق)' },
    },
    {
      action: 'purge',
      name: { en: 'Permanently delete files', ar: 'الحذف النهائي للملفات' },
      breakGlass: true,
    },
  ],
);

export const fileCategoryPermissions = declarePermissions(
  P,
  'fileCategory',
  { en: 'file categories', ar: 'فئات الملفات' },
  [],
  [{ action: 'manage', name: { en: 'Manage file categories', ar: 'إدارة فئات الملفات' } }],
);

export const scheduledTaskPermissions = declarePermissions(
  P,
  'scheduledTask',
  { en: 'scheduled tasks', ar: 'المهام المجدولة' },
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Pause / resume / run scheduled tasks', ar: 'إدارة المهام المجدولة' },
    },
  ],
);

export const notificationTemplatePermissions = declarePermissions(
  P,
  'notificationTemplate',
  { en: 'notification templates', ar: 'قوالب الإشعارات' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'test',
      name: { en: 'Send a test notification', ar: 'إرسال إشعار تجريبي' },
    },
  ],
);

export const platformPermissions: PermissionDef[] = [
  ...userPermissions,
  ...rolePermissions,
  ...permissionRegistryPermissions,
  ...organizationPermissions,
  ...branchPermissions,
  ...departmentPermissions,
  ...sectionPermissions,
  ...jobTitlePermissions,
  ...jobPositionPermissions,
  ...applicationPermissions,
  ...applicationCategoryPermissions,
  ...settingPermissions,
  ...auditLogPermissions,
  ...activityLogPermissions,
  ...scheduledTaskPermissions,
  ...filePermissions,
  ...fileCategoryPermissions,
  ...notificationTemplatePermissions,
];

/** Break-glass keys drive mandatory-2FA enforcement (Review R13) and quarterly review. */
export const breakGlassPermissionKeys = platformPermissions
  .filter((p) => p.breakGlass === true)
  .map((p) => p.key);
