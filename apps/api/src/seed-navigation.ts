// First-run navigation bootstrap. The sidebar is fully data-driven (it renders only the applications
// GET /platform/me/applications returns), so a fresh install needs this catalog to exist before
// anybody has a sidebar at all. It seeds the default Application Categories and Applications, mapped
// to the real client routes, each declaring the permission that opens it.
//
// NOTHING IS GRANTED HERE. Navigation is the set of applications whose `permissionKey` the caller
// holds, so the System Administrator sees the whole catalog by holding the whole permission
// registry — no per-user rows, and none to keep in step with the roles. Idempotent: categories are
// keyed by their English name and applications by route, so re-running neither duplicates nor errors.
//
// Every row MUST declare a permission. One without a key is entitled to nobody and would simply be
// invisible, which is why `AppDef.permission` is required rather than nullable.
//
// This is default platform configuration (the module catalog), not synthetic dev data: the icon
// strings match the sidebar's icon registry, and the routes are the app's real routes.
import {
  applicationCategoryService,
  applicationCategoryRepository,
} from './platform/application-categories';
import { applicationService, applicationRepository } from './platform/applications';
import { rbacService } from './platform/rbac';

interface AppDef {
  en: string;
  ar: string;
  route: string;
  icon: string;
  /**
   * The permission opening this page requires — the SAME key the client route guard checks.
   *
   * REQUIRED. Navigation is the set of applications whose key the caller holds, so a row without one
   * is a row nobody can ever see. There is no "open page" case to express here.
   */
  permission: string;
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
      // Three of these rows are catching up with pages that shipped without one. They were routed
      // and permission-gated but absent from this catalog and unlinked from every screen, so the
      // only way in was typing the URL — which made a hint unfollowable: registering an applicant
      // from inside the system says "set the internal source on the Application Form page", and
      // there was no such page to open. Each sits beside the stage it configures rather than in a
      // settings group of its own: they are part of the recruitment cycle, not general setup.
      {
        en: 'Applicants',
        ar: 'المتقدمون',
        route: '/applicants',
        icon: 'users',
        permission: 'applicant.view',
      },
      {
        en: 'Application Form',
        ar: 'نموذج التقديم',
        route: '/recruitment-form',
        icon: 'inbox',
        permission: 'recruitmentForm.manage',
      },
      {
        en: 'Applicant Sources',
        ar: 'مصادر التقديم',
        route: '/applicant-sources',
        icon: 'link',
        permission: 'applicant.view',
      },
      {
        en: 'Screening',
        ar: 'الفرز',
        route: '/screening',
        icon: 'clipboard',
        permission: 'screening.view',
      },
      {
        en: 'Interviews',
        ar: 'المقابلات',
        route: '/interviews',
        icon: 'chat',
        permission: 'interview.view',
      },
      {
        en: 'Interview Stages',
        ar: 'مراحل المقابلات',
        route: '/interviews/stages',
        icon: 'layers',
        permission: 'interviewStage.manage',
      },
      {
        en: 'Evaluations',
        ar: 'التقييمات',
        route: '/evaluations',
        icon: 'clipboard',
        permission: 'evaluation.view',
      },
      {
        en: 'Evaluation Phases',
        ar: 'مراحل التقييم',
        route: '/evaluations/phases',
        icon: 'layers',
        permission: 'evaluationPhase.manage',
      },
      {
        en: 'Job Offers',
        ar: 'عروض العمل',
        route: '/job-offers',
        icon: 'offer',
        permission: 'jobOffer.view',
      },
      {
        en: 'Employees',
        ar: 'الموظفون',
        route: '/employees',
        icon: 'badge',
        permission: 'employee.view',
      },
      { en: 'Leave', ar: 'الإجازات', route: '/leave', icon: 'calendar', permission: 'leave.view' },
      {
        en: 'Contracts',
        ar: 'العقود',
        route: '/contracts',
        icon: 'file',
        permission: 'contract.view',
      },
      {
        en: 'Hiring Documents',
        ar: 'مستندات التعيين',
        route: '/hiring-documents',
        icon: 'file',
        permission: 'hiringDocuments.view',
      },
      {
        en: 'Employee Files',
        ar: 'ملفات الموظفين',
        route: '/employee-files',
        icon: 'folder',
        permission: 'employeeFile.view',
      },
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
      {
        en: 'Fleet Home',
        ar: 'الرئيسية',
        route: '/fleet',
        icon: 'home',
        permission: 'fleetVehicle.view',
      },
      {
        en: 'Vehicles',
        ar: 'السيارات',
        route: '/fleet/vehicles',
        icon: 'truck',
        permission: 'fleetVehicle.view',
      },
      {
        en: 'Drivers',
        ar: 'السائقون',
        route: '/fleet/drivers',
        icon: 'users',
        permission: 'fleetDriver.view',
      },
      {
        en: 'Attendance',
        ar: 'التمامات',
        route: '/fleet/attendance',
        icon: 'calendar',
        permission: 'fleetAvailability.view',
      },
      {
        en: 'Odometer',
        ar: 'عدادات السيارات',
        route: '/fleet/odometer',
        icon: 'gauge',
        permission: 'fleetOdometer.view',
      },
      {
        en: 'Maintenance',
        ar: 'صيانة السيارات',
        route: '/fleet/maintenance',
        icon: 'wrench',
        permission: 'fleetMaintenance.view',
      },
      {
        en: 'Maintenance Alarms',
        ar: 'إنذارات الصيانة',
        route: '/fleet/maintenance-alarms',
        icon: 'alert',
        permission: 'fleetOdometer.view',
      },
      {
        en: 'Daily Roster',
        ar: 'تعيين السيارات',
        route: '/fleet/roster',
        icon: 'clipboard',
        permission: 'fleetRoster.view',
      },
      {
        en: 'Accidents',
        ar: 'حوادث السيارات',
        route: '/fleet/accidents',
        icon: 'shield',
        permission: 'fleetAccident.view',
      },
      {
        en: 'Violations',
        ar: 'مخالفات السيارات',
        route: '/fleet/violations',
        icon: 'tag',
        permission: 'fleetViolation.view',
      },
      {
        en: 'Fleet Catalogs',
        ar: 'قوائم الحركة',
        route: '/fleet/catalogs',
        icon: 'folder',
        permission: 'fleetCatalog.manage',
      },
      {
        en: 'Fleet Settings',
        ar: 'إعدادات الحركة',
        route: '/fleet/settings',
        icon: 'cog',
        permission: 'fleetMaintenanceRule.manage',
      },
    ],
  },
  {
    en: 'Organization',
    ar: 'الهيكل التنظيمي',
    icon: 'building',
    sortOrder: 20,
    apps: [
      {
        en: 'Company',
        ar: 'الشركة',
        route: '/organization/company',
        icon: 'building',
        permission: 'organization.view',
      },
      {
        en: 'Branches',
        ar: 'الفروع',
        route: '/organization/branches',
        icon: 'building',
        permission: 'branch.view',
      },
      {
        en: 'Departments',
        ar: 'الإدارات',
        route: '/organization/departments',
        icon: 'sitemap',
        permission: 'department.view',
      },
      {
        en: 'Sections',
        ar: 'الأقسام',
        route: '/organization/sections',
        icon: 'layers',
        permission: 'section.view',
      },
      {
        en: 'Job Positions',
        ar: 'الوظائف',
        route: '/organization/job-positions',
        icon: 'badge',
        permission: 'jobPosition.view',
      },
      {
        en: 'Job Titles',
        ar: 'المسميات الوظيفية',
        route: '/organization/job-titles',
        icon: 'tag',
        permission: 'jobTitle.view',
      },
    ],
  },
  {
    en: 'IT',
    ar: 'تقنية المعلومات',
    icon: 'monitor',
    sortOrder: 25,
    // OWNER RULE: only SHIPPED pages appear in navigation. ITW-1 shipped the IT-1 surface, IT-2
    // appended the custody register, IT-3 appended the help desk and IT-4 appends maintenance and
    // the spare-parts store (the boot sync is additive — existing installs pick new rows up on the
    // next deploy) and IT-5 appends the software register. Dashboards append theirs with IT-6.
    apps: [
      { en: 'IT Home', ar: 'الرئيسية', route: '/it', icon: 'home', permission: 'itAsset.view' },
      {
        en: 'Assets',
        ar: 'الأصول',
        route: '/it/assets',
        icon: 'monitor',
        permission: 'itAsset.view',
      },
      {
        en: 'Scan Asset',
        ar: 'مسح أصل',
        route: '/it/assets/scan',
        icon: 'qr',
        permission: 'itAsset.view',
      },
      {
        en: 'Asset Custody',
        ar: 'عهدة الأصول',
        route: '/it/custody',
        icon: 'clipboard',
        permission: 'itAsset.view',
      },
      {
        en: 'Help Desk',
        ar: 'الدعم الفني',
        route: '/it/tickets',
        icon: 'chat',
        permission: 'itTicket.view',
      },
      {
        en: 'Help Desk Settings',
        ar: 'إعدادات الدعم الفني',
        route: '/it/helpdesk-settings',
        icon: 'cog',
        permission: 'itSlaPolicy.manage',
      },
      {
        en: 'Maintenance',
        ar: 'الصيانة',
        route: '/it/maintenance',
        icon: 'wrench',
        permission: 'itMaintenance.view',
      },
      {
        en: 'Maintenance Plans',
        ar: 'خطط الصيانة',
        route: '/it/maintenance-plans',
        icon: 'calendar',
        permission: 'itMaintenance.view',
      },
      {
        en: 'Spare Parts',
        ar: 'قطع الغيار',
        route: '/it/spare-parts',
        icon: 'layers',
        permission: 'itSparePart.view',
      },
      {
        en: 'Software',
        ar: 'البرمجيات',
        route: '/it/software',
        icon: 'grid',
        permission: 'itSoftware.view',
      },
      {
        en: 'Licences',
        ar: 'التراخيص',
        route: '/it/licenses',
        icon: 'badge',
        permission: 'itLicense.view',
      },
      {
        en: 'IT Vendors',
        ar: 'موردو تقنية المعلومات',
        route: '/it/vendors',
        icon: 'folder',
        permission: 'itVendor.view',
      },
      {
        en: 'IT Catalogs',
        ar: 'قوائم تقنية المعلومات',
        route: '/it/catalogs',
        icon: 'folder',
        permission: 'itCatalog.manage',
      },
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
      {
        en: 'Applications',
        ar: 'التطبيقات',
        route: '/organization/applications',
        icon: 'folder',
        permission: 'application.view',
      },
      {
        en: 'Application Categories',
        ar: 'فئات التطبيقات',
        route: '/organization/application-categories',
        icon: 'tag',
        permission: 'applicationCategory.view',
      },
      // System Administration (SA-1). It joins the existing Administration group rather than
      // opening a second administration category beside it — a category is a purpose, not a URL
      // prefix, and two groups both called some form of "administration" would be a menu the
      // reader has to guess at. The route prefix differs from its siblings on purpose: the two
      // rows above are the pre-existing catalog screens, and whether they move under `/system`
      // is a decision this slice deliberately does not take.
      {
        en: 'System Users',
        ar: 'مستخدمو النظام',
        route: '/system/users',
        icon: 'users',
        permission: 'user.view',
      },
      // SA-3. Two rows, not one: an administrator may be allowed to read what a permission key
      // MEANS without being allowed to see who holds it, and each row carries the permission its
      // screen already enforces so the menu never offers a page that then refuses.
      {
        en: 'Roles',
        ar: 'الأدوار',
        route: '/system/roles',
        icon: 'shield',
        permission: 'role.view',
      },
      {
        en: 'Permissions',
        ar: 'الصلاحيات',
        route: '/system/permissions',
        icon: 'key',
        permission: 'permission.view',
      },
      // P8. `setting.view` is what `GET /settings/definitions` enforces and what the route guards
      // on, so the row advertises exactly the screen the caller can open. The values half of the
      // screen (`GET /settings/me`) is open to any session, which makes the definitions permission
      // the only honest key for this row.
      {
        en: 'System Settings',
        ar: 'إعدادات النظام',
        route: '/system/settings',
        icon: 'settings',
        permission: 'setting.view',
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
    {
      name: { ar: def.ar, en: def.en },
      icon: def.icon,
      route: def.route,
      categoryId,
      sortOrder,
      permissionKey: def.permission,
    },
    by,
  );
  return String(created._id);
};

/**
 * Permission-key backfill for applications catalogued before the field existed.
 *
 * Navigation IS the set of applications whose `permissionKey` the caller holds, so a null key now
 * means the row is invisible to everybody. On an existing install every catalogued row would stay
 * null and the whole sidebar would vanish; this fills in ONLY the null ones, from this catalog,
 * matched by route — which is what carries such a deployment across the change.
 *
 * It follows the same additive contract as the icon backfill above: a row whose key an administrator
 * already set (any non-null value) is never overwritten, and a route this catalog does not know is
 * left entirely alone. A row outside this catalog and still null stays invisible until somebody
 * gives it a key, which is the fail-closed half of the same rule.
 */
const backfillApplicationPermission = async (def: AppDef, by: string): Promise<void> => {
  const existing = await applicationRepository.findOne({ route: def.route });
  if (existing === null || (existing.permissionKey ?? null) !== null) return;
  await applicationService.update(
    String(existing._id),
    { permissionKey: def.permission, version: existing.__v },
    by,
  );
};

/**
 * Seed the default navigation catalog.
 *
 * It no longer grants anything to anybody: navigation is the set of applications whose
 * `permissionKey` the caller holds, so the System Administrator — who holds the whole registry —
 * sees the catalog by being the System Administrator. The per-user grants this used to write are
 * read by nothing now, and writing rows on every seed that nothing reads is how a retired mechanism
 * gets mistaken for a live one.
 */
export const seedBootstrapNavigation = async (adminId: string): Promise<void> => {
  for (const category of CATALOG) {
    const categoryId = await ensureCategory(category, adminId);
    let sortOrder = 0;
    for (const app of category.apps) {
      await ensureApplication(app, categoryId, sortOrder, adminId);
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
 * - a new application joins the category its group's existing apps live in TODAY (respecting
 *   admin re-grouping/renames); the seed category is created only when the whole group is new;
 * - a category icon is filled in ONLY while it is null (pre-icon installs); a non-null icon —
 *   seeded or admin-chosen — is never overwritten; an application's permission key follows the
 *   same rule (filled only while null, which is what teaches pre-field installs their keys);
 * - a new application lands BETWEEN the neighbours it sits between in the catalog, at half the
 *   gap in their STORED ordering. A counter derived from position in this array would hand an
 *   inserted row a number an existing sibling already owns (nothing renumbers the old rows), and
 *   ties sort arbitrarily — so a row added mid-list would land somewhere unpredictable.
 *   Renumbering the siblings instead would be the other way to make room, and it would overwrite
 *   an ordering the administrator may have set by hand.
 */
export const syncNavigationCatalog = async (): Promise<void> => {
  const adminIds = await rbacService.userIdsWithSystemRole('super-admin');
  const actor = adminIds[0];
  if (actor === undefined) return; // pre-seed boot (no admin yet) — the dev seed covers it
  for (const category of CATALOG) {
    await backfillCategoryIcon(category, actor);
    for (const app of category.apps) await backfillApplicationPermission(app, actor);
    // Resolve the whole group up front: where a new row belongs depends on the stored order of
    // the next EXISTING neighbour, which a forward-only walk cannot see yet.
    const rows = await Promise.all(
      category.apps.map(async (app) => ({
        app,
        existing: await applicationRepository.findOne({ route: app.route }),
      })),
    );

    let categoryId: string | null = null;
    // The order of the row we last placed or passed — the lower bound for the next new one.
    // Starting at -10 makes a wholly-new group come out 0, 10, 20 … exactly as it always has.
    let low = -10;
    for (const [index, row] of rows.entries()) {
      if (row.existing !== null) {
        categoryId ??= String(row.existing.categoryId);
        low = Number(row.existing.sortOrder);
        continue;
      }
      const next = rows.slice(index + 1).find((r) => r.existing !== null);
      const high = next === null || next === undefined ? low + 20 : Number(next.existing?.sortOrder);
      const sortOrder = (low + high) / 2;

      categoryId ??= await ensureCategory(category, actor);
      await applicationService.create(
        {
          name: { ar: row.app.ar, en: row.app.en },
          icon: row.app.icon,
          route: row.app.route,
          categoryId,
          sortOrder,
          permissionKey: row.app.permission,
        },
        actor,
      );
      // No grant is written: whoever holds the new application's permission already has it.
      low = sortOrder;
    }
  }
};
