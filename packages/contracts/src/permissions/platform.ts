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
    /**
     * P9-A. Reading a setup link is a **stronger** capability than resetting a password, which is
     * why it is its own key rather than riding `resetPassword`.
     *
     * An administrator who can reset can clear a password and have a fresh link delivered to the
     * account's own phone and email — they never see it, so they cannot take the account over.
     * An administrator who can READ the link can open it themselves, choose the password, and sign
     * in as that person. Break-glass, therefore: holders get mandatory two-factor (Review R13) and
     * appear in the quarterly review, which is the mitigation for a key that can reach any account
     * awaiting activation — including a Super Admin's.
     */
    {
      action: 'setupLink',
      name: {
        en: 'Read an account setup link (manual delivery)',
        ar: 'قراءة رابط إعداد الحساب (إرسال يدوي)',
      },
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

/**
 * Cost centres (P-HR-23) — a reporting dimension the organization defines for itself.
 *
 * `assign` is separate from `edit` on purpose. Renaming a centre and deciding which one a person
 * belongs to are different authorities held by different people: the first is catalog maintenance,
 * the second places a human being's cost somewhere. Folding them into one key would mean anyone
 * who may tidy a label may also move the money.
 *
 * NOT an accounting concept. A cost centre here is an HR/Payroll axis and maps to no account —
 * that mapping is the Accounting phase's, and nothing in this codebase anticipates it.
 */
export const costCenterPermissions = declarePermissions(
  P,
  'costCenter',
  { en: 'cost centers', ar: 'مراكز التكلفة' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'assign',
      name: { en: 'Assign an employee to a cost center', ar: 'إسناد موظف لمركز تكلفة' },
    },
  ],
  'platform.cost-centers',
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
  [],
  'platform.settings',
);

export const auditLogPermissions = declarePermissions(
  P,
  'auditLog',
  { en: 'audit logs', ar: 'سجلات التدقيق' },
  ['view', 'export'],
  [],
  'platform.audit',
);

export const activityLogPermissions = declarePermissions(
  P,
  'activityLog',
  { en: 'activity logs', ar: 'سجلات النشاط' },
  ['view'],
  [],
  'platform.activity',
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
  'platform.notification-templates',
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
  ...costCenterPermissions,
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
 * Fifteen, against eighteen resources — and the three without a page are the point of the design
 * rather than an omission: `file`, `fileCategory` and `scheduledTask` have no administration screen
 * at all and never have. Inventing a page for them would put a claim in the registry that no screen
 * honours, so their permissions carry `pageId: null` and group under Other / Unassigned until a
 * real surface exists to name.
 *
 * `setting` left that list in P8, `notificationTemplate` in P10 and `auditLog`/`activityLog` in
 * P11, which is the rule working as intended in the other direction: the page is added by the
 * change that builds the screen, not ahead of it. A page whose `route` nothing serves is the same
 * lie as a missing page for a screen that exists.
 *
 * The two log streams get **two pages, not one**. They are separate collections with separate
 * permissions, separate filter vocabularies and separate retention — `auditLog.view` and
 * `activityLog.view` are independent grants, and a single page would put both behind whichever one
 * the reader happened to hold.
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
    id: 'platform.cost-centers',
    moduleId: P,
    name: { en: 'Cost centers', ar: 'مراكز التكلفة' },
    route: '/organization/cost-centers',
    sortOrder: 95,
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
  {
    id: 'platform.settings',
    moduleId: P,
    name: { en: 'System Settings', ar: 'إعدادات النظام' },
    route: '/system/settings',
    sortOrder: 120,
  },
  {
    id: 'platform.notification-templates',
    moduleId: P,
    name: { en: 'Notification templates', ar: 'قوالب الإشعارات' },
    route: '/system/notification-templates',
    sortOrder: 130,
  },
  {
    id: 'platform.audit',
    moduleId: P,
    name: { en: 'Audit log', ar: 'سجل التدقيق' },
    route: '/system/audit',
    sortOrder: 140,
  },
  {
    id: 'platform.activity',
    moduleId: P,
    name: { en: 'Activity log', ar: 'سجل النشاط' },
    route: '/system/activity',
    sortOrder: 150,
  },
];

/** Break-glass keys drive mandatory-2FA enforcement (Review R13) and quarterly review. */
export const breakGlassPermissionKeys = platformPermissions
  .filter((p) => p.breakGlass === true)
  .map((p) => p.key);
