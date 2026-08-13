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
//
// THE ONE EXCEPTION, AND ITS EXACT SHAPE (`regroupFrom`). When a later release SPLITS a group this
// file created — HR's "Employee Management" into "Employees" and "Employee File" — the new
// sections do not exist yet, so they are created; but their rows are already sitting in the old
// one, and the rule above would leave them there forever. An install would get two empty headings
// and no reorganization at all.
//
// So a section may name the earlier sections of its own lineage, and take rows back FROM THOSE
// ONLY. Everything that made the rule worth having still holds:
//   • it happens on the run that creates the new section, and never again;
//   • the source must be a section THIS FILE wrote, matched by its seeded English name — a group
//     an administrator created, or renamed, is not recognized and is never touched;
//   • a row an administrator moved anywhere else, or took out of every section, still looks like
//     what it is and is still left alone.
// The emptied section is not deleted: nothing here destroys an administrator's row, and an empty
// section is already omitted from the navigation payload, so it simply stops rendering.
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
  /**
   * English names of sections THIS FILE created on an earlier release, whose rows this one may
   * take back — see `regroupFrom` below. Omitted for a section that only ever fills blanks.
   */
  regroupFrom?: string[];
}

/**
 * The HR groups, along the employee lifecycle.
 *
 * ONE GROUP, ONE QUESTION IT ANSWERS. The split that matters is between somebody who has not been
 * hired and somebody who has:
 *
 *   • Recruitment      — the CANDIDATE: apply → screen → interview → evaluate → offer.
 *   • Employees        — the person, once they exist as an employee.
 *   • Employee File    — the RECORD that follows them: their file, their contracts.
 *   • Attendance & Leave / Payroll — what that record produces month to month.
 *
 * `/hiring-documents` sits under Employees rather than Recruitment on the evidence of what it is:
 * its own service says the set is collected "after an employee is created (Stage 5)". It is the
 * last step of hiring, and its subject is an employee, not a candidate.
 *
 * `/evaluations` and `/evaluations/phases` stay in Recruitment for the same kind of reason — they
 * evaluate APPLICANTS (the code lives in `modules/hr/recruitment/evaluations`). There is no
 * performance-review feature in this repository, so there is no Performance group to put them in
 * and none is invented here.
 *
 * Keyed by the CATEGORY's English name — the same key the navigation seed uses.
 */
const DEFAULTS: Record<string, SectionDef[]> = {
  HR: [
    {
      en: 'Recruitment',
      ar: 'التوظيف',
      // Pipeline first, then the two screens that configure it — the order somebody works in.
      routes: [
        '/applicants',
        '/screening',
        '/interviews',
        '/interviews/stages',
        '/evaluations',
        '/evaluations/phases',
        '/job-offers',
        '/applicant-sources',
        '/recruitment-form',
      ],
    },
    {
      en: 'Employees',
      ar: 'الموظفون',
      routes: ['/employees', '/hiring-documents'],
      regroupFrom: ['Employee Management'],
    },
    {
      en: 'Employee File',
      ar: 'ملف الموظف',
      routes: ['/employee-files', '/contracts'],
      regroupFrom: ['Employee Management'],
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
      routes: ['/payroll/pay-items', '/payroll/runs'],
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
      // The sections a row may be TAKEN BACK from on this run — this file's own earlier defaults,
      // resolved by name inside this category. Empty for a section that only fills blanks.
      const reclaimable = await sectionIdsByName(categoryId, def.regroupFrom ?? []);

      // First run for this section: place the rows nobody has grouped yet, in the order listed.
      let position = 0;
      for (const route of def.routes) {
        const app = await applicationRepository.findOne({ route });
        if (app === null) continue;
        position += 10;
        const from = app.sectionId === null ? null : String(app.sectionId);
        // Already grouped, and not by a default this file wrote — an administrator's decision.
        if (from !== null && !reclaimable.has(from)) continue;
        await applicationService_updateSection(String(app._id), sectionId, position - 10, from);
      }
    }
  }
};

/**
 * Section ids for the given English names inside one category.
 *
 * A section an administrator RENAMED will not be found, and that is the intended answer: the name
 * is how this file recognizes its own earlier work, so a renamed group is somebody else's.
 */
const sectionIdsByName = async (
  categoryId: string,
  names: readonly string[],
): Promise<Set<string>> => {
  if (names.length === 0) return new Set();
  const rows = await ApplicationSectionModel.find({
    categoryId,
    'name.en': { $in: names },
    isDeleted: false,
  })
    .select({ _id: 1 })
    .lean<{ _id: unknown }[]>()
    .exec();
  return new Set(rows.map((row) => String(row._id)));
};

/**
 * A direct, minimal write: the row's section and its position inside it.
 *
 * Deliberately not `applicationService.update` — that path is version-checked and audited as an
 * administrator's edit, and this is neither. It is a migration filling in a field that did not
 * exist when the row was written, or moving a row between two groupings this file itself chose.
 *
 * `from` is carried into the filter so the write stays conditional on the state that was read.
 * Without it a concurrent boot — or an administrator saving the organize screen at that moment —
 * could be overwritten by a decision taken against a row that has since moved.
 */
const applicationService_updateSection = async (
  applicationId: string,
  sectionId: string,
  sortOrder: number,
  from: string | null,
): Promise<void> => {
  const { ApplicationModel } = await import('./platform/applications/application.model');
  await ApplicationModel.updateOne(
    { _id: applicationId, sectionId: from },
    { $set: { sectionId, sortOrder } },
  ).exec();
  logger.debug({ applicationId, sectionId, from }, 'applications: default section assigned');
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
