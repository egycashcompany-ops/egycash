# ADR-038: A job title names its places in the company structure: descriptive, several allowed, keyed on the catalog

**Status:** Proposed. It becomes Accepted when the design review in
[org-chart-design.md](../12-planning/org-chart-design.md) §11 is recorded. The owner approved the
behaviour on 2026-11-17. · **Date:** 2026-11-17 · **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (job titles are one organization-wide catalog),
[ADR-030](ADR-030-requisition-names-its-placement.md) (no seat, vacancy or headcount entity),
[ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md) (the company catalog of departments
and sections, which this ADR narrows on linking)

## Context

[ADR-015](ADR-015-single-organization-model.md) made job titles one organization-wide catalog. P-ORG-1
then merged the old Job Position into the title, and deliberately did **not** move `departmentId` onto
it. «سائق» (driver) exists in many departments, and tying a title to one department would split one
job into several. Since then, where a job sits has been recorded only on what holds it: the employee,
the offer, the requisition.

The owner now wants two things.
- **A company org chart:** departments, the sections under each, and the jobs under each section.
- **The job form says where a job belongs:** «فى المسميات الوظيفية … لا يوجد أى ربط بينها وبين الأقسام
  والإدارات … عايزك تضيفها» ("job titles have no link to sections and departments; add it").

The two must stay in step: «الأتنين يسمعوا فى بعض».

[organization-structure.md](../02-architecture/organization-structure.md) §7.4 notes that departments
and sections embed no lists. So a many-to-many link can be added without changing them, and this ADR
adds one: job title ⇄ department or section.

## Decision

**A job title may name the places in the company structure where it is found: a department, or a
section of that department. It may name several. These job places describe the structure. They are
not checked by any other flow, and they count nothing.**

- **The record.** Job places are rows of `job_title_places`:
  `{jobTitleId, departmentCatalogId, sectionCatalogId | null}`, unique among rows where
  `isDeleted:false`.
  - They name the company's catalog entries (ADR-031), never a branch's row. "Operations" means
    Operations in every branch, including one that opens later.
  - The title stays one record, so a title in five places is still one title.
  - A title is not owned by any unit, and a title with no places is valid.
- **Not enforced.** Registering, transferring or promoting an employee, requisitions, offers and
  applicant placement keep their present checks: section within department within branch, and an
  active title. None of them compares the title with its places. Enforcing that would make every
  current employee whose job sits elsewhere invalid, and would turn a description that users edit
  freely into a gate on hiring.
- **No headcounts.** A job place has no headcount, seat, budget or vacancy field. ADR-030's rule
  stands. A screen may count how many jobs a section has, never how many people a job needs.
- **One write path.** Job places are saved through the job title's own create and update, as the whole
  set, with the job's `version` checked.
  - The org chart uses the same path, one change at a time.
  - Every change is audited as an `update` of the job.
  - The form and the chart read and write the same rows.
- **Filled once from reality.**
  - On the first start-up after release, each job gets the places where its holders and accepted
    candidates sit.
  - The places and a mark row (`job_title_place_fills`) are written in one transaction. Once the mark
    has committed, no start-up fills again, so a place removed afterwards is not put back.
  - The fill creates no catalog entry and links no row.
- **Linking on write narrows ADR-031.** ADR-031 left the linking of existing rows to its operator
  command, and put catalog writes under the units' own keys. Here, a user write that needs a catalog
  entry for a group whose rows are unlinked does it itself, in the same transaction:
  1. it finds the entry the group's name folds to, or creates one from the group's oldest row (its
     name, and its code when that code is free, else the next free code);
  2. it sets `catalogId` on every row of the group, without renaming any of them;
  3. it refuses when the name folds to two entries, or when one branch holds two rows of the group.

  Linking runs under the key of the write that needed it: `jobTitle.create`, `jobTitle.edit`,
  `section.create` or `section.edit`. Every row and entry it touches is audited.
- **Sections do not change department.** `UpdateSectionCatalogSchema` already refuses to re-parent a
  section. The chart offers add, rename and stop.
- **No new permission keys.**
  - The chart page needs `department.view`.
  - Its data endpoint is open to any signed-in user, like the `/options` endpoints. That lets the job
    form list departments for a job editor.
  - Section writes need `section.create` or `section.edit`.
  - Job places need `jobTitle.create` or `jobTitle.edit`.
- **A catalog entry cited by a live job place cannot be deleted.**

## Consequences

- ✅ The org chart and the job form read and write the same rows. Open screens refresh as the design's
  §6 describes.
- ✅ A job keeps one identity across the company. «سائق» under Movement and under Cash-in-transit is one
  title with two places, as P-ORG-1 intended.
- ✅ Places name company units, so a branch that opens later is covered by them.
- ✅ After a group's first edit, its rows are linked. `migrate:org-catalog` then has nothing left to
  plan for them, and the catalog's delete guard and rename see them.
- ⚠️ Places can differ from where people actually sit. An employee may hold a job in a section where
  that job is not placed, and nothing warns. That is the cost of not enforcing. A report of such
  differences is a separate request.
- ⚠️ Holders of `jobTitle.edit` and `section.*` can now cause catalog entries to be created and rows
  to be linked, for the group their write names. Before this ADR, that needed the operator command or
  `department.*`.
- ⚠️ «مستندات الوظائف» (job papers) keeps listing the jobs people hold in a department. That is a
  different question from where a job belongs, so the two lists can differ.
- A PR that makes a job place a validation rule, or adds a count of people to it, needs a new ADR
  that supersedes this one.

## Alternatives considered

- **Put `departmentId` / `sectionId` on the job title.** Rejected, for the reason P-ORG-1 gave: a job
  in two departments would have to become two titles.
- **Key places on branch rows.** Rejected. Every job would need one place per branch, a branch added
  later would get none, and the chart describes the company, not each branch.
- **Derive the chart from where holders sit, and store nothing.** Rejected. The owner asked to edit it,
  and a job nobody holds yet could never appear. That derivation survives as the one-time fill.
- **Enforce places when registering and hiring.** Rejected (see Decision). If the business wants it
  later, it is a separate decision, with its own migration for the people who sit elsewhere.
- **Require the operator to link everything first, and keep unlinked groups read-only.** Rejected. The
  department and section forms still create unlinked rows, so every department added later would stay
  read-only until the operator ran the command again.
- **Create the entry but leave the rows unlinked**, joining them to it by name. Rejected.
  `migrate:org-catalog` would then plan a second entry for those rows. The catalog's delete guard and
  rename, which see only linked rows, would treat the entry as unused.
- **Separate endpoints for job places.** Rejected. That would mean two write paths with two
  concurrency rules, when the job update already checks `version` and is audited.
- **Re-run the fill on every start-up.** Rejected: it would put back every place a user removed.
