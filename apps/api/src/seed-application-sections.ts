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
//   • filing happens ONLY on a boot where the module's GROUPING CHANGED — that is, where this file
//     created at least one section. A boot that creates none leaves every row exactly where it is,
//     which is what keeps a page an administrator dragged out of a group from being dragged back;
//   • an application this file does not name is left entirely alone.
// Re-running it on a database already at this grouping changes nothing at all.
//
// WHY THE EVENT IS "A SECTION WAS CREATED" RATHER THAN "THIS SECTION WAS CREATED". The earlier rule
// asked the question once per SECTION: a section that already existed skipped its rows entirely.
// That is wrong in a way that took a release to show. `Payroll` shipped in PY-1 holding
// `/payroll/pay-items`; PY-6 added `/payroll/runs` to the same list — and because the section
// already existed, the new row was never filed. It rendered flat, above the groups, forever.
//
// Every page added to an EXISTING group since has had the same fate, which is how a sidebar that
// was organized once drifts back into one long list. Adding a section changes where its
// neighbours' pages belong too, so the module is re-filed as a whole or not at all.
//
// THE ONE EXCEPTION, AND ITS EXACT SHAPE (`regroupFrom`). When a later release SPLITS a group this
// file created — HR's "Employee Management" into "Employees" and "Employee File" — the new
// sections do not exist yet, so they are created; but their rows are already sitting in the old
// one, and the rule above would leave them there forever. An install would get two empty headings
// and no reorganization at all.
//
// So a section may name the earlier sections of its own lineage, and take rows back FROM THOSE
// ONLY. Everything that made the rule worth having still holds:
//   • it happens on the boot that creates the new section, and never again;
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
  for (const [categoryName, defs] of Object.entries(DEFAULTS)) {
    const categoryId = await findCategory(categoryName);
    if (categoryId === null) continue;

    // ── Pass 1: the sections themselves ───────────────────────────────────
    // Keyed by English name within the category: a rename by an administrator does not make this
    // recreate the section — the lookup misses, and a renamed group is somebody else's anyway.
    const sectionIdByName = new Map<string, string>();
    const createdNow: string[] = [];
    for (const [index, def] of defs.entries()) {
      const existing = await ApplicationSectionModel.findOne({
        categoryId,
        'name.en': def.en,
        isDeleted: false,
      })
        .lean<{ _id: unknown }>()
        .exec();
      if (existing !== null) {
        sectionIdByName.set(def.en, String(existing._id));
        continue;
      }
      const created = await applicationSectionService.create(
        { name: { ar: def.ar, en: def.en }, categoryId, sortOrder: index * 10 },
        adminId,
      );
      sectionIdByName.set(def.en, String(created._id));
      createdNow.push(def.en);
    }

    // NOTHING STRUCTURAL CHANGED — so nothing is re-filed, and this is the whole idempotency rule.
    // A boot that creates no section leaves every row exactly where it is, which is what keeps a
    // page an administrator dragged out of a group from being dragged back on the next restart.
    if (createdNow.length === 0) continue;

    // ── Pass 2: file the module's pages ───────────────────────────────────
    // Reached only on a boot where the module's GROUPING actually changed. That event — and not
    // the creation of one section in isolation — is what re-files the module, because a section
    // added to an existing set changes where its NEIGHBOURS' pages belong too.
    for (const def of defs) {
      const sectionId = sectionIdByName.get(def.en);
      if (sectionId === undefined) continue;
      // The sections a row may be TAKEN BACK from — this file's own earlier defaults, by name.
      const reclaimable = await sectionIdsByName(categoryId, def.regroupFrom ?? []);

      let position = 0;
      for (const route of def.routes) {
        const app = await applicationRepository.findOne({ route });
        if (app === null) continue;
        // A route is unique, but the ROW it names must belong to the category being organized:
        // filing another module's page into this module's section produces a row that renders in
        // neither (the navigation payload drops a section/app category mismatch on purpose).
        if (String(app.categoryId) !== categoryId) continue;
        position += 10;

        const from = app.sectionId === null ? null : String(app.sectionId);
        if (from === sectionId) continue; // already filed here — nothing to do, no write
        // Grouped, and not by a default this file wrote: an administrator's decision, left alone.
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
