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
// IDEMPOTENT, AND NEVER DESTRUCTIVE:
//   • a section is created only when the category has no section by that English name;
//   • each section then files the pages IT NAMES that are not already somewhere an administrator
//     put them. A row already in the right group is not rewritten, so the order inside a group is
//     the administrator's; a row in a group this file did not write is never moved;
//   • an application this file does not name is left entirely alone;
//   • no section is ever deleted, and a row can never be in two groups — `sectionId` holds one
//     value, so filing is a move, not a copy.
// Re-running it on a database already at this grouping writes nothing at all.
//
// WHY FILING IS NOT SKIPPED FOR A SECTION THAT ALREADY EXISTS. It used to be — `if (existing !==
// null) continue` — and that is wrong in a way that took a release to show. `Payroll` shipped in
// PY-1 (d42c559) holding `/payroll/pay-items`; PY-6 (b70e462) added `/payroll/runs` to the same
// list. The section already existed, so the new row was never filed: it rendered flat, above the
// groups, and every page added to an existing group since met the same fate. That is how a column
// organized once drifts back into one long list, a phase at a time.
//
// THE PRICE, STATED PLAINLY. A row that is in NO group looks the same whether nobody ever filed it
// or an administrator deliberately took it out, so adopting the first necessarily adopts the
// second: a page this file names, dragged out of every group, comes back on the next boot. That
// is a deliberate trade — a page silently missing from its group is a defect every release makes
// worse, while a page returning to the group it is named in is visible, reversible, and can be
// settled for good by moving it to a different group instead, which IS respected.
//
// `regroupFrom` — THE ONE PLACE A GROUPED ROW MOVES. When a later release SPLITS a group this file
// created (HR's "Employee Management" into "Employees" and "Employee File"), the new sections may
// take rows back from the earlier sections of their own lineage, named here and matched by their
// seeded English name. A group an administrator created, or renamed, is not recognized and is
// never raided. The emptied section is left in place: an empty section is already omitted from the
// navigation payload, so it stops rendering without anything being destroyed.
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
 * `/applicant-documents` goes the OTHER way for the same reason: what a candidate hands in after
 * clearing screening is collected before anybody is hired, so its subject is a candidate and it
 * belongs in Recruitment. Two documents screens, two sections, one test applied twice.
 *
 * `/evaluations` and `/evaluations/phases` stay in Recruitment for the same kind of reason — they
 * evaluate APPLICANTS (the code lives in `modules/hr/recruitment/evaluations`). There is no
 * performance-review feature in this repository, so there is no Performance group to put them in
 * and none is invented here.
 *
 * Keyed by the CATEGORY's English name — the same key the navigation seed uses.
 */
/** Exported for `seed-navigation.spec.ts`: a section naming an unseeded route groups nothing. */
export const APPLICATION_SECTION_DEFAULTS: Record<string, SectionDef[]> = {
  HR: [
    {
      // Its own group rather than a corner of Employees: an announcement is not a fact about
      // anybody's record, it is the company talking to its people. The rules screen sits beside
      // it — the same act, said once by a person or every time by the system.
      en: 'Communication',
      ar: 'التواصل',
      routes: ['/announcements', '/notification-rules'],
    },
    {
      en: 'Recruitment',
      ar: 'التوظيف',
      // Pipeline first, then the two screens that configure it — the order somebody works in.
      // The requisition opens it: a hire is asked for before anybody applies. Its subject is a
      // REQUEST rather than a person, which is why it is first here and not a pipeline stage.
      routes: [
        '/job-requisitions',
        '/applicants',
        '/screening',
        '/interviews',
        '/interviews/stages',
        '/evaluations',
        '/evaluations/phases',
        // P-HR-APP §5 — sits in Recruitment, not Employees, by the same evidence the note above
        // uses for `/hiring-documents`: its subject is a CANDIDATE, and the set is collected
        // before anybody is hired.
        '/applicant-documents',
        '/evaluation-batches/phase/securityCheck',
        '/evaluation-batches/phase/drivingTest',
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
      routes: [
        '/payroll/pay-items',
        '/payroll/runs',
        '/payroll/adjustments',
        '/payroll/employee-loans',
        // Last, because it READS what the four above produce: a report is composed over payslips
        // that a run has already issued.
        '/payroll/reports',
      ],
    },
    {
      // P-HR-TRN. Its own group rather than a corner of an existing one, because training is about
      // an employee's DEVELOPMENT and none of the five above is: Recruitment's subject is a
      // candidate, Employees and Employee File hold who somebody is, and Attendance and Payroll
      // hold what they did and what they were paid for it. Performance and Medical land here too.
      //
      // The sessions row first — it is the daily work, and the catalogue behind it is configuration
      // somebody visits when the programme changes.
      //
      // P-HR-PRF joins the group the line above said it would. Training answers «what has this
      // person been taught» and Performance answers «how are they doing» — two halves of the same
      // subject, and putting the second in a section of its own would suggest they are unrelated.
      // Both performance rows come AFTER the four training ones: a cycle reviews a period that has
      // already happened, including the training in it.
      en: 'Training & Development',
      ar: 'التدريب والتطوير',
      routes: [
        '/training/sessions',
        '/training/nominations',
        '/training/records',
        '/training/courses',
        '/performance/cycles',
        '/performance/reviews',
        // P-HR-MED joins the group the section's note said Medical would. It is about the person
        // rather than about their work, which is what this group already holds.
        '/medical/profiles',
        '/medical/insurance',
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
  for (const [categoryName, defs] of Object.entries(APPLICATION_SECTION_DEFAULTS)) {
    const categoryId = await findCategory(categoryName);
    if (categoryId === null) continue;

    // ── Pass 1: the sections themselves ───────────────────────────────────
    // Keyed by English name within the category: a rename by an administrator does not make this
    // recreate the section — the lookup misses, and a renamed group is somebody else's anyway.
    const sectionIdByName = new Map<string, string>();
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
    }

    // ── Pass 2: file the pages each section names ─────────────────────────
    // Runs for EVERY section, existing or not. That is the fix: a section that was already there
    // used to skip this step entirely, so a route added to its list by a later release was never
    // filed at all.
    for (const def of defs) {
      const sectionId = sectionIdByName.get(def.en);
      if (sectionId === undefined) continue;
      // Sections of this section's own lineage, whose rows it may take back (see `regroupFrom`).
      const reclaimable = await sectionIdsByName(categoryId, def.regroupFrom ?? []);

      let position = 0;
      for (const route of def.routes) {
        const app = await applicationRepository.findOne({ route });
        if (app === null) continue;
        // A route is unique, but the ROW it names must belong to the category being organized:
        // filing another module's page into this module's section produces a row that renders in
        // neither, because the navigation payload drops a section/category mismatch on purpose.
        if (String(app.categoryId) !== categoryId) continue;
        position += 10;

        const from = app.sectionId === null ? null : String(app.sectionId);
        // Already here. No write — so an administrator's ORDER inside the group survives, and a
        // row can never end up counted in two groups (`sectionId` holds one value by construction).
        if (from === sectionId) continue;
        // In a group this file did not write: an administrator put it there, and it stays there.
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
