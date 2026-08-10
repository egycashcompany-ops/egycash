// Platform Core permission catalog — phase 2.1 services only.
// Later phases (files, notifications, workflow, …) add their resources when they land,
// per the vertical-slice plan (Architecture Review 01, R2).
import { declarePermissions, type PageDef, type PermissionDef } from './def.js';

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
  'platform.users',
);

export const rolePermissions = declarePermissions(
  P,
  'role',
  { en: 'roles', ar: 'الأدوار' },
  ['view', 'create', 'edit', 'delete'],
  [{ action: 'assign', name: { en: 'Assign roles to users', ar: 'إسناد الأدوار للمستخدمين' } }],
  'platform.roles',
);

export const permissionRegistryPermissions = declarePermissions(
  P,
  'permission',
  { en: 'permission registry', ar: 'سجل الصلاحيات' },
  ['view'],
  [],
  'platform.permissions',
);

export const organizationPermissions = declarePermissions(
  P,
  'organization',
  { en: 'organization profile', ar: 'ملف المؤسسة' },
  ['view', 'edit'],
  [],
  'platform.company',
);

export const branchPermissions = declarePermissions(
  P,
  'branch',
  { en: 'branches', ar: 'الفروع' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.branches',
);

export const departmentPermissions = declarePermissions(
  P,
  'department',
  { en: 'departments', ar: 'الإدارات' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.departments',
);

export const sectionPermissions = declarePermissions(
  P,
  'section',
  { en: 'sections', ar: 'الأقسام' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.sections',
);

export const jobTitlePermissions = declarePermissions(
  P,
  'jobTitle',
  { en: 'job titles', ar: 'المسميات الوظيفية' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.job-titles',
);

export const jobPositionPermissions = declarePermissions(
  P,
  'jobPosition',
  { en: 'job positions', ar: 'الوظائف' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.job-positions',
);

export const applicationPermissions = declarePermissions(
  P,
  'application',
  { en: 'applications', ar: 'التطبيقات' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.applications',
);

export const applicationCategoryPermissions = declarePermissions(
  P,
  'applicationCategory',
  { en: 'application categories', ar: 'فئات التطبيقات' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'platform.application-categories',
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

/**
 * The platform's administration surfaces.
 *
 * Eleven, against eighteen resources — and the seven without a page are the point of the design
 * rather than an omission. `setting`, `auditLog` and `activityLog` are administered by screens that
 * are named in the System Administration plan and **not built yet**; `file`, `fileCategory`,
 * `notificationTemplate` and `scheduledTask` have no administration screen at all and never have.
 * Inventing a page for either group would put a claim in the registry that no screen honours, so
 * their permissions carry `pageId: null` and group under Other / Unassigned until a real surface
 * exists to name.
 *
 * `route` is recorded where a screen is routed today. Nothing resolves it — it is here so the next
 * reader can check a page against the thing it claims to describe.
 */
export const platformPages: PageDef[] = [
  {
    id: 'platform.users',
    moduleId: P,
    name: { en: 'System Users', ar: 'مستخدمو النظام' },
    route: '/system/users',
    sortOrder: 10,
  },
  {
    id: 'platform.roles',
    moduleId: P,
    name: { en: 'Roles', ar: 'الأدوار' },
    route: '/system/roles',
    sortOrder: 20,
  },
  {
    id: 'platform.permissions',
    moduleId: P,
    name: { en: 'Permission registry', ar: 'سجل الصلاحيات' },
    route: '/system/permissions',
    sortOrder: 30,
  },
  {
    id: 'platform.company',
    moduleId: P,
    name: { en: 'Company profile', ar: 'ملف المؤسسة' },
    route: '/organization/company',
    sortOrder: 40,
  },
  {
    id: 'platform.branches',
    moduleId: P,
    name: { en: 'Branches', ar: 'الفروع' },
    route: '/organization/branches',
    sortOrder: 50,
  },
  {
    id: 'platform.departments',
    moduleId: P,
    name: { en: 'Departments', ar: 'الإدارات' },
    route: '/organization/departments',
    sortOrder: 60,
  },
  {
    id: 'platform.sections',
    moduleId: P,
    name: { en: 'Sections', ar: 'الأقسام' },
    route: '/organization/sections',
    sortOrder: 70,
  },
  {
    id: 'platform.job-titles',
    moduleId: P,
    name: { en: 'Job titles', ar: 'المسميات الوظيفية' },
    route: '/organization/job-titles',
    sortOrder: 80,
  },
  {
    id: 'platform.job-positions',
    moduleId: P,
    name: { en: 'Job positions', ar: 'الوظائف' },
    route: '/organization/job-positions',
    sortOrder: 90,
  },
  {
    id: 'platform.applications',
    moduleId: P,
    name: { en: 'Applications', ar: 'التطبيقات' },
    route: '/organization/applications',
    sortOrder: 100,
  },
  {
    id: 'platform.application-categories',
    moduleId: P,
    name: { en: 'Application categories', ar: 'فئات التطبيقات' },
    route: '/organization/application-categories',
    sortOrder: 110,
  },
];

/** Break-glass keys drive mandatory-2FA enforcement (Review R13) and quarterly review. */
export const breakGlassPermissionKeys = platformPermissions
  .filter((p) => p.breakGlass === true)
  .map((p) => p.key);
