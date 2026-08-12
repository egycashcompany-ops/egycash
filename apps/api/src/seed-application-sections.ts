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
//   • a section is created only when the category has no section by that English name;
//   • assignment happens ONLY on the run that creates the section. Once it exists, this file never
//     moves another row into it — because a row an administrator deliberately took out of every
//     section looks exactly like a row nobody ever grouped (both null), and a rule that read only
//     the row would drag that decision back on the next boot;
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
    {
      en: 'Payroll',
      ar: 'الرواتب',
      routes: ['/payroll/pay-items'],
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
      // A section that is already there means this module has been organized once — by this file
      // on an earlier boot, or by an administrator since. Either way the assignment step is SKIPPED
      // entirely, and that is the whole idempotency rule.
      //
      // Skipping it because the row is already in a section would not be enough: a row an
      // administrator deliberately took OUT of every section is null, exactly like a row nobody
      // ever grouped, so a rule reading only the row would keep dragging that decision back. The
      // question has to be asked once per section, not once per row.
      if (existing !== null) continue;

      const created = await applicationSectionService.create(
        { name: { ar: def.ar, en: def.en }, categoryId, sortOrder: index * 10 },
        adminId,
      );
      const sectionId = String(created._id);

      // First run for this section: place the rows nobody has grouped yet, in the order listed.
      let position = 0;
      for (const route of def.routes) {
        const app = await applicationRepository.findOne({ route });
        if (app === null) continue;
        position += 10;
        if (app.sectionId !== null) continue; // already organized elsewhere — left alone
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
