# ADR-038: A job title says where it sits in the company structure — descriptively, many places, keyed on the company units

**Status:** Accepted · **Date:** 2026-11-17 · **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (job titles are an organization-wide catalog),
[ADR-030](ADR-030-requisition-names-its-placement.md) (no seat, vacancy or headcount entity),
[ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md) (the company catalog of departments
and sections), [org-chart-design.md](../12-planning/org-chart-design.md) (P-ORG-3)

## Context

[ADR-015](ADR-015-single-organization-model.md) made job titles one organization-wide catalog. P-ORG-1
then merged the old Job Position into the title. It deliberately did **not** move `departmentId` onto
the title, because «سائق» exists in many departments, and binding a title to one department would
multiply the catalog instead of unifying it. Since then a job's place has been carried only by the
record that holds the title: the employee, the offer, the requisition.

The owner now wants two things:
- A company org chart: departments, the sections under each, and the jobs under each section.
- The job form to say where a job belongs: «فى المسميات الوظيفية … لا يوجد أى ربط بينها وبين
  الأقسام والإدارات … عايزك تضيفها».

The two must read and write the same thing: «الأتنين يسمعوا فى بعض».

The data model already allows for this. [organization-structure.md](../02-architecture/organization-structure.md)
says departments and sections carry no embedded job lists, so that "a future M2M join is a pure
addition". This ADR is that join.

## Decision

**A job title may name the places in the company structure where it is found: a department, or a
section of that department. It may name several. The list describes the structure. It enforces
nothing and counts nothing.**

- **The record.** The places are rows of `job_title_placements`:
  `{jobTitleId, departmentCatalogId, sectionCatalogId | null}`, unique among the living.
  - They are keyed on the company units of [ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md),
    never on a branch's row, because a place means "Operations, in whichever branch has it".
  - The title stays one organization-wide record, as ADR-015 has it.
  - "Not owned by a unit" still holds: a title with no places is valid, and a title in five places
    is one title.
- **Descriptive, not enforced.** Registration, transfer, promotion, requisitions, offers and
  applicant placement keep validating section ⊂ department ⊂ branch and an active title, and no
  more. None of them checks the title against its places.
  - Enforcing it would invalidate every current employee whose job sits elsewhere.
  - It would also turn a description the owner edits freely into a gate on hiring.
- **No counts.** A place carries no headcount, seat, budget or vacancy field.
  [ADR-030](ADR-030-requisition-names-its-placement.md)'s rule stands: a PR that adds one is rejected
  on sight. The chart shows which jobs a section has, never how many of each.
- **Part of the job.** A place is written either from the job form or from the chart. Every write:
  - is audited as an `update` of the job;
  - raises the job's `version`, so a form opened before a chart change cannot silently overwrite
    it.
  - The form sends the whole set of places with the job's own save. The chart sends one change at a
    time.
- **Filled once from reality, then owned by the owner.**
  - On first start after release, each job is placed where its current holders and accepted
    candidates sit.
  - A mark row (`job_title_placement_fills`) makes the fill run exactly once. A place the owner
    removes is never put back.
- **Entries are created only when a write needs one.** A place needs a catalog entry. Where a
  department or section group has none (its rows predate the catalog or were created unlinked), the
  write that needs the entry creates it:
  - from the group's oldest row's name and code;
  - with **no row changed**. The rows join the entry by the name fold, which now also considers
    entries that have no linked row yet.

  This needs only the key of the write that caused it (`jobTitle.edit`, `section.create`, or the
  fill, which runs as the system). It creates no department. It gives an existing one its company
  entry.
- **Sections never move between departments here.** `UpdateSectionCatalogSchema` already refuses to
  re-parent a section. The chart offers add, rename and stop, not move.
- **No new permission keys.**
  - Viewing the chart needs `department.view`.
  - Section writes need `section.create` / `section.edit`.
  - Places need `jobTitle.edit`, or `jobTitle.create` with a new job.

## Consequences

- ✅ The org chart and the job form are two views of one record, so they cannot disagree.
- ✅ A job keeps one identity across the company: «سائق» under Movement and under Cash-in-transit is
  one title with two places, which the P-ORG-1 merge argued for.
- ✅ A branch that opens later inherits the structure, because places name company units, not
  branch rows.
- ⚠️ Places can drift from reality. An employee may hold a job in a section the job is not placed
  in, and nothing warns. That is the price of D-ORG3-1. A report of "holders outside their job's
  places" is a later, separate request.
- ⚠️ The fill creates catalog entries for unlinked groups that hold jobs. Other screens fold rows
  without the entries, so they see no change. The entries are visible on the catalog endpoints.
- ⚠️ A stopped section hides its places rather than deleting them. Restarting it shows them again.
- Enforcement is by review and this ADR: any PR that makes a place a validation rule, or adds a count
  to it, needs a new ADR that supersedes this one.

## Alternatives considered

- **Put `departmentId` / `sectionId` on the job title.** Rejected for the reason P-ORG-1 gave: a job
  in two departments would have to become two titles, which multiplies the catalog the merge unified.
- **Key places on branch rows** (`departments._id`, `sections._id`). Rejected:
  - one place per branch per job;
  - nothing for a branch added later;
  - the chart is "the company", not "each branch".
- **Derive the chart from where holders sit, and store nothing.** Rejected. The owner asked to edit
  it, and a job nobody holds yet could never appear. It survives as the one-time fill.
- **Enforce places on registration and hiring.** Rejected (see Decision). If the business ever wants
  it, it is a separate decision with its own migration of the people who sit outside.
- **Link the unlinked rows to their entries as part of this feature** (set `catalogId` on rows).
  Rejected for the fill and for writes that only place a job:
  - linking re-spells rows;
  - it can collide with the `{branchId, catalogId}` index;
  - it is the operator's decision ADR-031 kept out of boot.

  Only "add a section in these branches" links the one department row per branch it builds under,
  because a section row's `catalogId` requires its department row's.
- **Re-run the fill on every start.** Rejected: it would put back every place the owner removed.
