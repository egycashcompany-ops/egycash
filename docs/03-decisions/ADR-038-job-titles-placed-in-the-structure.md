# ADR-038: A job title names its places in the company structure, descriptively and possibly more than one, keyed on the catalog

**Status:** Accepted (design review recorded in [org-chart-design.md](../12-planning/org-chart-design.md) §11; the owner approved the behaviour on 2026-11-17) · **Date:** 2026-11-17 · **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (job titles are one organization-wide catalog),
[ADR-030](ADR-030-requisition-names-its-placement.md) (no seat, vacancy or headcount entity),
[ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md) (the company catalog of departments
and sections) · **Supersedes in part:** ADR-031's "a deployment that never defines a catalog runs exactly
as it does today" — new rows are now linked when created, so the first department created starts the
catalog

## Context

[ADR-015](ADR-015-single-organization-model.md) made job titles one organization-wide catalog.
P-ORG-1 then merged the old Job Position into the title, and it deliberately did **not** move
`departmentId` onto the title. «سائق» (driver) exists in many departments, and tying a title to one
department would split one job into several. Since then, where a job sits has been recorded only on
whatever holds it: the employee, the offer or the requisition.

The owner now wants two things:
- a company org chart showing departments, the sections under each, and the jobs under each section;
- the job form to say where a job belongs: «فى المسميات الوظيفية … لا يوجد أى ربط بينها وبين الأقسام
  والإدارات … عايزك تضيفها» ("job titles have no link to sections and departments; add it").

He also wants the two to stay in step: «الأتنين يسمعوا فى بعض».

[organization-structure.md](../02-architecture/organization-structure.md) §7.4 notes that departments
and sections embed no lists, so a many-to-many link can be added without changing them. This ADR adds
one: job title ⇄ department or section.

## Decision

**A job title may name the places in the company structure where it is found: a department, or a
section of that department. It may name several. These job places describe the structure. No other
flow checks them, and they count nothing.**

- **The record.**
  - Job places are rows of `job_title_places`: `{jobTitleId, departmentCatalogId, sectionCatalogId |
    null}`. The combination is unique among rows where `isDeleted:false`.
  - They name the company's catalog entries (ADR-031), never a branch's row. "Operations" means
    Operations in every branch, including one that opens later.
  - The title remains one record. A title with no places is valid, and a title in five places is still
    one title.
- **Not enforced.** Registering, transferring and promoting an employee, requisitions, offers and
  applicant placement keep their present checks: the section belongs to the department, the department
  belongs to the branch, and the title is active. None of them compares the title with its places.
  Enforcing that would make every current employee whose job sits elsewhere invalid, and it would turn
  a description that users edit freely into a gate on hiring.
- **No headcounts.** A job place has no headcount, seat, budget or vacancy field, and ADR-030's rule
  stands. A screen may count how many jobs a section has, but never how many people a job needs.
- **One write path.**
  - Job places are saved through the job title's own create and update, as the whole set, with the
    job's `version` checked.
  - The org chart uses the same path, one change at a time.
  - Each change is audited as an `update` of the job.
- **No write links an existing row.**
  - A department row's `catalogId` decides who reaches it. A role assignment over «a department
    everywhere» resolves to every row linked to that entry.
  - So neither the chart nor the job form ever sets `catalogId` on an existing row. A department or
    section that is not linked to a catalog entry is shown read-only in the chart.
  - Linking existing rows remains ADR-031's operator command, a deliberate change to who reaches what.
- **New rows are linked when they are created (supersedes ADR-031 in part).** The owner chose this
  when the design review raised it: «أيوه، يتربط تلقائيًا» ("yes, link it automatically").
  - ADR-031 left `catalogId` optional, and the department and section forms never send one, so every
    row they made was unlinked. Now, when a create names no `catalogId`, the service links the new row
    to the single active entry its name folds to, or creates an entry for a new name. The row is
    created first, as before. Linking is a second step, so a step that fails or refuses leaves exactly
    the unlinked row of today. It never leaves an entry without its row.
  - This runs under `department.create` / `section.create`, the keys ADR-031 already gives catalog
    writes.
  - The row stays unlinked, as before, when:
    - the match is ambiguous;
    - the branch already has a row linked to that entry;
    - an unlinked row of that name already exists. That group stays with the operator command, which
      must not meet an entry it did not plan.
    - an entry exactly clashes by name.
  - The effect on access is the one ADR-031 and ADR-032 intended: a branch that declares a department
    joins "that department everywhere" from the day the row is created.
- **Filled once per department, from reality.**
  - At start-up, each department entry that has active rows and no mark gets the places where its
    holders and accepted candidates sit.
  - Its mark row (`job_title_place_fills`, unique per department entry) is written in the same
    transaction.
  - A department whose places were already edited by hand is marked without being filled.
  - A department created after release is marked when its entry is created.
  - Once a department is marked, it is never filled again, so a place removed afterwards is not put
    back.
  - The fill links no row and creates no entry.
- **Sections do not change department.** `UpdateSectionCatalogSchema` already refuses to re-parent a
  section. The chart offers add, rename and stop.
- **No new permission keys.**
  - The chart page needs `department.view`.
  - Its data endpoint accepts any of `department.view`, `jobTitle.view`, `jobTitle.create` and
    `jobTitle.edit`, so the job form can list departments for a job editor. This lets a
    `department.view` holder read each job's places and `version`. Before, only `jobTitle.view` could
    read them. This is accepted: places describe the structure the page exists to show.
  - Section writes need `section.create` / `section.edit`.
  - Job places need `jobTitle.create` / `jobTitle.edit`.
- **Deleting catalog entries.** A catalog entry cited by a live job place cannot be deleted.

## Consequences

- ✅ The org chart and the job form read and write the same rows. Open screens refresh as the design's
  §6 describes.
- ✅ A job keeps one identity across the company. «سائق» under Movement and under Cash-in-transit is one
  title with two places, which is what P-ORG-1 intended.
- ✅ Places name company units, so a branch that opens later is covered by them.
- ✅ Departments and sections created after this ADR are linked from the start, so they are editable in
  the chart and fold correctly everywhere.
- ⚠️ Departments still unlinked on release day are read-only in the chart and are not filled. Linking
  them is the operator's `migrate:org-catalog`, after which the next start fills them.
- ⚠️ Places can differ from where people actually sit. An employee may hold a job in a section where it
  is not placed, and nothing warns about it. That is the cost of not enforcing. A report of such
  differences would be a separate request.
- ⚠️ «مستندات الوظائف» (job papers) still lists the jobs people hold in a department. That answers a
  different question from where a job belongs, so the two lists can differ.
- A PR that makes a job place a validation rule, adds a count of people to it, or links existing rows
  as a side effect of another edit, needs a new ADR that supersedes this one.

## Alternatives considered

- **Put `departmentId` / `sectionId` on the job title.** Rejected for the reason P-ORG-1 gave: a job in
  two departments would have to become two titles.
- **Key places on branch rows.** Rejected. It would need one place per branch per job, a branch added
  later would get none, and the chart describes the company, not each branch.
- **Derive the chart from where holders sit and store nothing.** Rejected. The owner asked to edit it,
  and a job nobody holds yet could never appear. The derivation survives as the one-time fill.
- **Enforce places when registering and hiring.** Rejected, see Decision. If the business wants it
  later, it is a separate decision with its own migration for the people who sit elsewhere.
- **Link an existing group's rows on the first chart or job write that needs it.** Rejected. It widens
  every «department everywhere» role assignment to those rows as a side effect of a job edit. It also
  changes the key under which job papers stored the department's lines.
- **Create the entry but leave the rows unlinked, joining them to it by name.** Rejected.
  `migrate:org-catalog` would plan a second entry for those rows. The catalog's delete guard and rename,
  which see only linked rows, would treat the entry as unused.
- **Separate endpoints for job places.** Rejected. That would mean two write paths with two concurrency
  rules, when the job update already checks `version` and is audited.
- **One global fill mark.** Rejected. A department linked after the first start would never be filled.
- **Re-run the fill on every start.** Rejected, because it would put back every place a user removed.
