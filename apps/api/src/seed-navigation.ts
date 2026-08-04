// First-run navigation bootstrap. The sidebar is fully data-driven (it renders only the applications
// GET /platform/me/applications returns), so a fresh install — where nothing is assigned — shows an
// empty sidebar even though everything works. This seeds the default Application Categories and
// Applications (mapped to the real client routes) and grants them directly to the System
// Administrator, so a fresh install immediately has a functional sidebar with no manual DB setup.
//
// The admin is created org-wide with no department, so department-based assignment can't reach them;
// the effective-applications resolver unions department + direct grants, so we grant directly to the
// admin here. Idempotent: categories are keyed by their English name, applications by route, and the
// grant is created only when missing — re-running the seed neither duplicates nor errors.
//
// This is default platform configuration (the module catalog), not synthetic dev data: the icon
// strings match the sidebar's icon registry, and the routes are the app's real routes.
import { Types } from 'mongoose';
import {
  applicationCategoryService,
  applicationCategoryRepository,
} from './platform/application-categories';
import { applicationService, applicationRepository } from './platform/applications';
import { rbacService } from './platform/rbac';
import { userApplicationService, userApplicationRepository } from './platform/user-applications';

interface AppDef {
  en: string;
  ar: string;
  route: string;
  icon: string;
}

interface CategoryDef {
  en: string;
  ar: string;
  icon: string;
  sortOrder: number;
  apps: AppDef[];
}

// Grouped to mirror the two route trees (Recruitment `/…`, Organization `/organization/…`) plus the
// platform catalog. Icons are names the sidebar's resolveNavIcon knows.
const CATALOG: CategoryDef[] = [
  {
    en: 'HR',
    ar: 'الموارد البشرية',
    icon: 'users',
    sortOrder: 10,
    apps: [
      { en: 'Applicants', ar: 'المتقدمون', route: '/applicants', icon: 'users' },
      { en: 'Screening', ar: 'الفرز', route: '/screening', icon: 'clipboard' },
      { en: 'Interviews', ar: 'المقابلات', route: '/interviews', icon: 'chat' },
      { en: 'Evaluations', ar: 'التقييمات', route: '/evaluations', icon: 'clipboard' },
      { en: 'Job Offers', ar: 'عروض العمل', route: '/job-offers', icon: 'offer' },
      { en: 'Employees', ar: 'الموظفون', route: '/employees', icon: 'badge' },
      { en: 'Leave', ar: 'الإجازات', route: '/leave', icon: 'calendar' },
      { en: 'Contracts', ar: 'العقود', route: '/contracts', icon: 'file' },
      { en: 'Hiring Documents', ar: 'مستندات التعيين', route: '/hiring-documents', icon: 'file' },
      { en: 'Employee Files', ar: 'ملفات الموظفين', route: '/employee-files', icon: 'folder' },
      // The intake form's admin page: which questions candidates answer, the per-source links,
      // and the source that internal registrations are filed under. It shipped without a way in
      // — no catalog row and no screen linking to it — so the "set it on the Application Form
      // page" hint pointed at somewhere unreachable.
      //
      // APPENDED, not slotted next to Applicants where it reads best. On installs that already
      // have this category, `sortOrder` here is derived from the position in this array while
      // existing rows keep whatever is stored, so inserting mid-list would hand the new row a
      // number an existing sibling already owns. Ordering is admin-editable; a collision is not.
      { en: 'Application Form', ar: 'نموذج التقديم', route: '/recruitment-form', icon: 'inbox' },
    ],
  },
  {
    en: 'Fleet',
    ar: 'الحركة',
    icon: 'truck',
    sortOrder: 15,
    // OWNER RULE (FW-1 review): only SHIPPED pages appear in navigation — each FW slice
    // appended its rows here as it landed (the boot sync is additive, so existing installs
    // pick them up). With FW-10 the module is COMPLETE: all twelve applications are live.
    apps: [
      { en: 'Fleet Home', ar: 'الرئيسية', route: '/fleet', icon: 'home' },
      { en: 'Vehicles', ar: 'السيارات', route: '/fleet/vehicles', icon: 'truck' },
      { en: 'Drivers', ar: 'السائقون', route: '/fleet/drivers', icon: 'users' },
      { en: 'Attendance', ar: 'التمامات', route: '/fleet/attendance', icon: 'calendar' },
      { en: 'Odometer', ar: 'عدادات السيارات', route: '/fleet/odometer', icon: 'gauge' },
      { en: 'Maintenance', ar: 'صيانة السيارات', route: '/fleet/maintenance', icon: 'wrench' },
      {
        en: 'Maintenance Alarms',
        ar: 'إنذارات الصيانة',
        route: '/fleet/maintenance-alarms',
        icon: 'alert',
      },
      { en: 'Daily Roster', ar: 'تعيين السيارات', route: '/fleet/roster', icon: 'clipboard' },
      { en: 'Accidents', ar: 'حوادث السيارات', route: '/fleet/accidents', icon: 'shield' },
      { en: 'Violations', ar: 'مخالفات السيارات', route: '/fleet/violations', icon: 'tag' },
      { en: 'Fleet Catalogs', ar: 'قوائم الحركة', route: '/fleet/catalogs', icon: 'folder' },
      { en: 'Fleet Settings', ar: 'إعدادات الحركة', route: '/fleet/settings', icon: 'cog' },
    ],
  },
  {
    en: 'Organization',
    ar: 'الهيكل التنظيمي',
    icon: 'building',
    sortOrder: 20,
    apps: [
      { en: 'Company', ar: 'الشركة', route: '/organization/company', icon: 'building' },
      { en: 'Branches', ar: 'الفروع', route: '/organization/branches', icon: 'building' },
      { en: 'Departments', ar: 'الإدارات', route: '/organization/departments', icon: 'sitemap' },
      { en: 'Sections', ar: 'الأقسام', route: '/organization/sections', icon: 'layers' },
      { en: 'Job Positions', ar: 'الوظائف', route: '/organization/job-positions', icon: 'badge' },
      { en: 'Job Titles', ar: 'المسميات الوظيفية', route: '/organization/job-titles', icon: 'tag' },
    ],
  },
  {
    en: 'Administration',
    ar: 'الإدارة',
    // A department is not its settings screen: the briefcase reads as "administration",
    // the cog would read as "settings".
    icon: 'briefcase',
    sortOrder: 30,
    apps: [
      { en: 'Applications', ar: 'التطبيقات', route: '/organization/applications', icon: 'folder' },
      {
        en: 'Application Categories',
        ar: 'فئات التطبيقات',
        route: '/organization/application-categories',
        icon: 'tag',
      },
    ],
  },
];

const ensureCategory = async (def: CategoryDef, by: string): Promise<string> => {
  const existing = await applicationCategoryRepository.findOne({ 'name.en': def.en });
  if (existing !== null) return String(existing._id);
  const created = await applicationCategoryService.create(
    { name: { ar: def.ar, en: def.en }, icon: def.icon, sortOrder: def.sortOrder },
    by,
  );
  return String(created._id);
};

/**
 * Category-icon backfill: categories created before icons were seeded carry `icon: null`, which
 * the sidebar can only render as the generic fallback tile. Filling ONLY null icons keeps the
 * additive contract — any icon an admin chose (any non-null value) is never overwritten.
 */
const backfillCategoryIcon = async (def: CategoryDef, by: string): Promise<void> => {
  const existing = await applicationCategoryRepository.findOne({ 'name.en': def.en });
  if (existing === null || existing.icon !== null) return;
  await applicationCategoryService.update(
    String(existing._id),
    { icon: def.icon, version: existing.__v },
    by,
  );
};

const ensureApplication = async (
  def: AppDef,
  categoryId: string,
  sortOrder: number,
  by: string,
): Promise<string> => {
  const existing = await applicationRepository.findOne({ route: def.route });
  if (existing !== null) return String(existing._id);
  const created = await applicationService.create(
    { name: { ar: def.ar, en: def.en }, icon: def.icon, route: def.route, categoryId, sortOrder },
    by,
  );
  return String(created._id);
};

const ensureGrant = async (userId: string, applicationId: string): Promise<void> => {
  const existing = await userApplicationRepository.findOne({
    userId: new Types.ObjectId(userId),
    applicationId: new Types.ObjectId(applicationId),
  });
  if (existing === null) await userApplicationService.assign(userId, applicationId, userId);
};

/** Seed the default navigation catalog and grant every application to the System Administrator. */
export const seedBootstrapNavigation = async (adminId: string): Promise<void> => {
  for (const category of CATALOG) {
    const categoryId = await ensureCategory(category, adminId);
    let sortOrder = 0;
    for (const app of category.apps) {
      const applicationId = await ensureApplication(app, categoryId, sortOrder, adminId);
      await ensureGrant(adminId, applicationId);
      sortOrder += 10;
    }
  }
};

/**
 * Boot-time catalog sync (runs on EVERY api start): existing installs must receive catalog
 * entries added by newer releases — the dev seed above only runs on fresh installs, which is
 * how `/leave` never appeared on databases seeded before the Leave module existed.
 *
 * STRICTLY ADDITIVE — administrator customizations are never touched:
 * - existing applications are matched by route and left completely alone (name, icon,
 *   ordering, category, status all stay whatever the admin made them);
 * - grants are created ONLY for applications this sync just created — a grant the admin
 *   revoked on an existing application stays revoked across restarts;
 * - a new application joins the category its group's existing apps live in TODAY (respecting
 *   admin re-grouping/renames); the seed category is created only when the whole group is new;
 * - a category icon is filled in ONLY while it is null (pre-icon installs); a non-null icon —
 *   seeded or admin-chosen — is never overwritten.
 */
export const syncNavigationCatalog = async (): Promise<void> => {
  const adminIds = await rbacService.userIdsWithSystemRole('super-admin');
  const actor = adminIds[0];
  if (actor === undefined) return; // pre-seed boot (no admin yet) — the dev seed covers it
  for (const category of CATALOG) {
    await backfillCategoryIcon(category, actor);
    let categoryId: string | null = null;
    let sortOrder = 0;
    for (const app of category.apps) {
      const existing = await applicationRepository.findOne({ route: app.route });
      if (existing !== null) {
        categoryId ??= String(existing.categoryId);
        sortOrder += 10;
        continue;
      }
      categoryId ??= await ensureCategory(category, actor);
      const created = await applicationService.create(
        {
          name: { ar: app.ar, en: app.en },
          icon: app.icon,
          route: app.route,
          categoryId,
          sortOrder,
        },
        actor,
      );
      // Surface the NEW module to current super-admins; everyone else stays admin-assigned.
      for (const adminId of adminIds) await ensureGrant(adminId, String(created._id));
      sortOrder += 10;
    }
  }
};
