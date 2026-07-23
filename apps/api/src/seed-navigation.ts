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
import { applicationCategoryService, applicationCategoryRepository } from './platform/application-categories';
import { applicationService, applicationRepository } from './platform/applications';
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
  sortOrder: number;
  apps: AppDef[];
}

// Grouped to mirror the two route trees (Recruitment `/…`, Organization `/organization/…`) plus the
// platform catalog. Icons are names the sidebar's resolveNavIcon knows.
const CATALOG: CategoryDef[] = [
  {
    en: 'HR',
    ar: 'الموارد البشرية',
    sortOrder: 10,
    apps: [
      { en: 'Applicants', ar: 'المتقدمون', route: '/applicants', icon: 'users' },
      { en: 'Screening', ar: 'الفرز', route: '/screening', icon: 'clipboard' },
      { en: 'Interviews', ar: 'المقابلات', route: '/interviews', icon: 'chat' },
      { en: 'Evaluations', ar: 'التقييمات', route: '/evaluations', icon: 'clipboard' },
      { en: 'Job Offers', ar: 'عروض العمل', route: '/job-offers', icon: 'offer' },
      { en: 'Employees', ar: 'الموظفون', route: '/employees', icon: 'badge' },
      { en: 'Hiring Documents', ar: 'مستندات التعيين', route: '/hiring-documents', icon: 'file' },
      { en: 'Employee Files', ar: 'ملفات الموظفين', route: '/employee-files', icon: 'folder' },
    ],
  },
  {
    en: 'Organization',
    ar: 'الهيكل التنظيمي',
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
    sortOrder: 30,
    apps: [
      { en: 'Applications', ar: 'التطبيقات', route: '/organization/applications', icon: 'folder' },
      { en: 'Application Categories', ar: 'فئات التطبيقات', route: '/organization/application-categories', icon: 'tag' },
    ],
  },
];

const ensureCategory = async (def: CategoryDef, by: string): Promise<string> => {
  const existing = await applicationCategoryRepository.findOne({ 'name.en': def.en });
  if (existing !== null) return String(existing._id);
  const created = await applicationCategoryService.create(
    { name: { ar: def.ar, en: def.en }, sortOrder: def.sortOrder },
    by,
  );
  return String(created._id);
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
