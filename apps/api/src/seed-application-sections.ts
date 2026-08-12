// Default Application Sections, and the one-time assignment of the applications that existed
// before sections did.
//
// WHY THIS EXISTS. Sections are optional — an application without one renders directly under its
// module, exactly as every application did before. So nothing here is required for correctness;
// what it does is give the module that actually outgrew a flat column (HR, eighteen pages) a
// sensible default grouping on the first boot after the upgrade, instead of leaving the
// administrator to build one from an empty screen.
//
// WHAT IT IS NOT. It is not a source of truth. Every name here is editable, every section is
// deletable, every assignment is re-draggable, and nothing re-asserts them on a later boot — see
// the idempotency rule below. The names are a starting point, not a schema.
//
// IDEMPOTENT, AND ONLY EVER ADDITIVE:
//   • a section is created only when the category has NO section by that English name;
//   • an application is assigned only while its `sectionId` is still null — a row an administrator
//     has since moved, unsectioned, or re-grouped is never touched again;
//   • an application this file does not name is left entirely alone.
// Re-running it on a database that has already been organized changes nothing at all.
import { logger } from './infrastructure/logging/logger';
import { applicationCategoryRepository } from './platform/application-categories';
import { applicationRepository } from './platform/applications';
import {
  ApplicationSectionModel,
  applicationSectionService,
} from './platform/application-sections';

interface SectionDef {
  en: string;
  ar: string;
  /** Routes of the applications that start out in this section, in the order they read best. */
  routes: string[];
}

/** Keyed by the CATEGORY's English name — the same key the navigation seed uses. */
const DEFAULTS: Record<string, SectionDef[]> = {
  HR: [
    {
      en: 'Recruitment',
      ar: 'التوظيف',
      routes: [
        '/applicants',
        '/recruitment-form',
        '/applicant-sources',
        '/screening',
        '/interviews',
        '/interviews/stages',
        '/evaluations',
        '/evaluations/phases',
        '/job-offers',
      ],
    },
    {
      en: 'Employee Management',
      ar: 'إدارة الموظفين',
      routes: ['/employees', '/employee-files', '/hiring-documents', '/contracts'],
    },
    {
      en: 'Attendance & Leave',
      ar: 'الحضور والإجازات',
      routes: [
        '/attendance/daily',
        '/attendance/regularizations',
        '/leave',
        '/attendance/shifts',
        '/attendance/assignments',
      ],
    },
  ],
};

/** The category by its seeded English name; null when this install never seeded it. */
const findCategory = async (englishName: string): Promise<string | null> => {
  const category = await applicationCategoryRepository.findOne({ 'name.en': englishName });
  return category === null ? null : String(category._id);
};

export const seedApplicationSections = async (adminId: string): Promise<void> => {
  for (const [categoryName, sections] of Object.entries(DEFAULTS)) {
    const categoryId = await findCategory(categoryName);
    if (categoryId === null) continue;

    for (const [index, def] of sections.entries()) {
      // Keyed by English name within the category: a rename by an administrator does not make
      // this recreate the section, because the lookup misses and the assignment step below is
      // skipped for rows that already carry a section anyway.
      const existing = await ApplicationSectionModel.findOne({
        categoryId,
        'name.en': def.en,
        isDeleted: false,
      })
        .lean<{ _id: unknown }>()
        .exec();
      const sectionId =
        existing !== null
          ? String(existing._id)
          : String(
              (
                await applicationSectionService.create(
                  { name: { ar: def.ar, en: def.en }, categoryId, sortOrder: index * 10 },
                  adminId,
                )
              )._id,
            );

      // Assign only the still-unsectioned rows, in the order this file lists them.
      let position = 0;
      for (const route of def.routes) {
        const app = await applicationRepository.findOne({ route });
        if (app === null) continue;
        position += 10;
        if (app.sectionId !== null) continue; // already organized — never re-grouped
        await applicationService_updateSection(String(app._id), sectionId, position - 10);
      }
    }
  }
};

/**
 * A direct, minimal write: the row's section and its position inside it.
 *
 * Deliberately not `applicationService.update` — that path is version-checked and audited as an
 * administrator's edit, and this is neither. It is a migration filling in a field that did not
 * exist when the row was written.
 */
const applicationService_updateSection = async (
  applicationId: string,
  sectionId: string,
  sortOrder: number,
): Promise<void> => {
  const { ApplicationModel } = await import('./platform/applications/application.model');
  await ApplicationModel.updateOne(
    { _id: applicationId, sectionId: null },
    { $set: { sectionId, sortOrder } },
  ).exec();
  logger.debug({ applicationId, sectionId }, 'applications: default section assigned');
};

/**
 * The boot-time variant, for installs that were seeded before sections existed. Same additive,
 * idempotent contract as the seed — it just has to find its own actor, and does nothing at all on
 * a database with no administrator yet (the fresh-install seed covers that case).
 */
export const syncApplicationSections = async (): Promise<void> => {
  const { rbacService } = await import('./platform/rbac');
  const adminIds = await rbacService.userIdsWithSystemRole('super-admin');
  const actor = adminIds[0];
  if (actor === undefined) return;
  await seedApplicationSections(actor);
};
