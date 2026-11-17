# Organization — the company org chart and where each job sits (P-ORG-3)

**Status:** the owner approved the page and its four defaults on 2026-11-17 («تمام موافق على
اقتراحاتك كلها، ابدأ») after seeing a static sample of it. He added one requirement in the same
message: the job form at `/organization/job-titles` must say which department and section a job
belongs to, and that form and the chart must read and write the same thing («لو عدلت أى حاجة فيها
أو فى شارت الهيكل التنظيمي الأتنين يسمعوا فى بعض»). This document records what was agreed (§1),
what the user sees (§2), the record behind it (§3), how the chart is read and written (§4–§6), the
one-time fill (§7), risks (§8) and the delivery plan (§9). The decision it rests on is
[ADR-038](../03-decisions/ADR-038-job-titles-placed-in-the-structure.md). §10 records the review.

## 1. The owner's request and the adopted defaults

### 1.1 What the owner asked for

- «HR hierarchical chart (or organizational chart) … عبارة عن شارت بالشركة كلها .. فيه الإدارات
  والأقسام والمسميات الوظيفية»: one chart for the whole company, with departments, sections and
  jobs.
- «يكون فى فوق كل الإدارات جنب بعض فى كروت ولما أختار إدارة بالضغط على كارت يجيب تحتها الشارت بتاع
  هيكلها التنظيمي»: every department as a card side by side at the top; picking one draws its chart
  below.
- «مع إمكانية تعديل الهيكل التنظيمي للأقسام تحت الإدارات وللوظائف تحت الأقسام»: editing the sections
  under a department and the jobs under a section.
- «مش كل الإدارات فيها أقسام»: a department may have no sections; its jobs then hang directly under
  it.
- «فى المسميات الوظيفية … لا يوجد أى ربط بينها وبين الأقسام والإدارات … عايزك تضيفها»: the job form
  gains its department and section.
- «الأتنين يسمعوا فى بعض»: the chart and the job form show each other's changes.

### 1.2 The four defaults he approved

The owner approved these four recommendations together, after seeing the sample.

| # | Decision | Why |
|---|---|---|
| D-ORG3-1 | A job's place in the structure is **descriptive**. It never blocks registering, transferring or hiring someone into a different department or section. One job may sit in several places: «سائق» under Movement and under Cash-in-transit. There are no counts, seats or vacancies. | If the link were a rule, it would change validation in registration, transfer, requisitions, offers and applicant placement. Every current employee whose job sits elsewhere would become invalid. A count would be the seat entity that [ADR-030](../03-decisions/ADR-030-requisition-names-its-placement.md) forbids. |
| D-ORG3-2 | The chart is **filled once from reality**: each job is placed where its holders sit today (employees not exited, plus accepted offers not yet hired). After that the owner edits it, and a job he removes is never put back. | An empty chart would make him build 147 jobs by hand. A fill that repeated on every start would undo his edits. |
| D-ORG3-3 | **Moving a section to another department is not offered.** He can add a section, rename it, or stop it. A section created under the wrong department is added under the right one and the old one is stopped; people move with the existing «نقل» action. | A move would change the department of everyone in that section, in every branch at once. That is a re-organization, which `UpdateSectionCatalogSchema` already refuses on purpose. |
| D-ORG3-4 | **A section added from the chart is created in every branch that has the department**, and he may untick branches before saving. | Sections are rows per branch, and an employee is registered on their own branch's row. A section that exists only in the company list could not be chosen when registering anyone. |

### 1.3 Defaults taken without asking

He was told about each of these in the same proposal and did not object.

- **No new permission keys.**
  - Viewing the chart needs `department.view`.
  - Adding a section needs `section.create`; renaming or stopping one needs `section.edit`.
  - Placing a job needs `jobTitle.edit` from the chart. From the job form it needs the key that form
    already uses (`jobTitle.create` or `jobTitle.edit`).
- **One department card per company department.** Branch copies are folded by name, as the crew
  screen does (§4.1), so «العمليات» in seven branches is one card.
- **No headcounts on the cards.** He did not ask for them, and he had said not to add what was not
  asked for («متعملش حاجه زياده عن اللي قلتلك عليه»).
- **The job list page (`JobTitlesListPage`) is unchanged.** The form and the detail page carry the
  placement; the list gains no column or filter.

## 2. What the user sees

The approved sample is the reference. It lives outside the repository, as a static drawing with
the project's colours, and is not checked in.

### 2.1 The page `/organization/chart` («شجرة الهيكل التنظيمي»)

The parts of the page, top to bottom:

1. **`PageHeader`.** Breadcrumbs «الهيكل التنظيمي ‹ شجرة الهيكل التنظيمي», the title, and one line
   under it. On the action side is «تعديل الهيكل», shown only to someone holding at least one of
   `section.create`, `section.edit` or `jobTitle.edit`. In edit mode it reads «خلصت التعديل».
2. **Department tiles.** One tile per company department, in Arabic alphabetical order.
   - Each tile shows the name and two counts: sections («3 أقسام», or «بدون أقسام») and distinct
     jobs placed («8 وظايف»).
   - The picked tile uses the crew tile's selected style (`border-brand-400 bg-brand-50/70`).
   - The grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4`, the crew grid.
   - The pick is kept in the URL (`?dept=<ref>`), so a link opens on the same department.
   - With no `?dept`, the first tile is picked.
   - A search box above the tiles narrows them by folded name (`foldOrgUnitName`, the crew card's
     search) once there are more than 7 tiles.
3. **The chart `Card`.**
   - **Header:** «الهيكل التنظيمي لإدارة X» and «N أقسام · M وظايف».
   - **Body, from `sm` up:** a top-down chart.
     - The department node shows «موجودة في N فروع».
     - Under it the sections sit side by side, with connector lines drawn by logical borders so they
       mirror in RTL.
     - Under each section is a vertical list of its jobs.
     - Jobs placed in the department but in no section form a first column, «تابعة للإدارة
       مباشرة», drawn dashed. It is shown only when there is at least one such job, or in edit
       mode.
     - A department with no sections has its jobs directly under the department node.
     - A chart wider than the card scrolls sideways inside the card.
   - **Body below `sm`:** the same content as an indented tree (department › section › job), the
     shape `OrganizeApplicationsPage` uses.
4. **States.**
   - Loading: `LoadingState`.
   - Failure: the shared error state with a retry.
   - No departments at all: `EmptyState` «لا توجد إدارات بعد», with a link to the departments page
     for someone holding `department.create`.
   - A department with no sections and no jobs shows its node and «لا توجد وظائف في هذه الإدارة
     بعد».

### 2.2 Edit mode

- A banner says changes are saved as they are made. Every gesture writes at once, the
  `OrganizeApplicationsPage` save model. There is no draft and no «حفظ».
- **Each job row** shows:
  - a ↕ grip, to drag the job to another section of the same department or to «تابعة للإدارة
    مباشرة»;
  - «انقل إلى», a `Select` of the same targets, for anyone who cannot drag;
  - ✕ to remove the job from that place. This removes the placement only, never the job.
  - These controls are gated by `jobTitle.edit`.
- **Under each section** (and under «تابعة للإدارة مباشرة»), «+ إضافة وظيفة» opens a `Dialog` with a
  `SearchableSelect` of active jobs. Each option says where else the job already sits («موجودة كمان
  تحت: …»). A job already in that exact place is not offered.
- **Next to the sections**, «+ إضافة قسم» (`section.create`) opens a `Dialog` with:
  - the name in Arabic and in English, both required as everywhere in the org module;
  - the branches that have the department, all ticked;
  - a line saying the section is created in the ticked branches.
  - With no branch ticked, the section exists in the company list only, and the dialog says so.
- **⋮ on a section** (`section.edit`) offers:
  - «تغيير الاسم»: a `Dialog` with both names;
  - «إيقاف القسم»: a confirming `Dialog`. It says the section stops being offered for new choices
    in every branch, and that the people in it keep it.
- **Moving a section between departments is not offered** (D-ORG3-3).

### 2.3 The job form and detail (`/organization/job-titles/*`)

- **Form.** A new `Card` «مكانها في الهيكل التنظيمي» sits between the identity card and the
  requirements card.
  - It lists the job's places as rows: «الإدارة › القسم», or «الإدارة › تابعة للإدارة مباشرة».
    Each row has ✕.
  - Under the list is an add row: a department `SearchableSelect` (the chart's departments), a
    section `SearchableSelect` («تابعة للإدارة مباشرة» first, then the department's sections) and
    «إضافة».
  - The places save with the form's own «حفظ», in the same request (§5.3).
- **Detail.** A third `Card` with the same rows, read-only. When the job has no place, it shows
  «لم تُحدَّد بعد».
- **Delete.** Deleting a job removes its places.

## 3. The record — `job_title_placements`

```jsonc
{
  "_id": ObjectId,
  "jobTitleId": ObjectId,             // job_titles
  "departmentCatalogId": ObjectId,    // department_catalog: the company department
  "sectionCatalogId": ObjectId | null,// section_catalog under that department; null = directly under it
  "isDeleted": false, "createdBy": ObjectId, "updatedBy": ObjectId,
  "createdAt": Date, "updatedAt": Date, "__v": 0
}
```

**Indexes:**
- `ux_job_place`: unique on `{jobTitleId, departmentCatalogId, sectionCatalogId}`, partial on
  `isDeleted:false`. A job sits in one place once.
- `ix_department`: `{departmentCatalogId}`, for the chart.
- `ix_job`: `{jobTitleId}`, for the form and the delete.

**Why it is keyed on catalog entries** ([ADR-031](../03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md)):
- A department or section row is one branch's copy. A job placed «under Operations» means
  Operations in every branch, including one that opens next year.
- Placing a job against a row would need one placement per branch, and none for a branch added
  later.

**Rules:**
- `sectionCatalogId`, when set, belongs to `departmentCatalogId`. The section entry's
  `departmentCatalogId` must equal it, and it never changes.
- The job is active when a placement is written.
- Nothing in this record is a count, a seat or a vacancy (D-ORG3-1).

**The fill's mark: `job_title_placement_fills`.** `{ key: string, at: Date, placed: number,
skipped: number }`, unique on `key` (`ux_key`). One row, key `v1`, means the one-time fill (§7)
has run.

## 4. Reading the chart

### 4.1 Folding branch copies into company units

The chart reads every department row, every section row (inactive ones included, as
`orgUnitGroupKeys` asks), both catalogs, the live placements and the jobs they name. It reads
company-wide, as `/options` does: the names are not scoped data.

**Departments.** `orgUnitGroupKeys` gains an optional second argument: the catalog entries
themselves.
- With the entries passed, an unlinked row joins the **single** active entry whose folded Arabic
  or English name equals its own. Today it can only join an entry that already has a linked row.
- Each entry, with or without rows, is a group `catalog:<id>`.
- Unlinked rows that match no entry, or match two or more, fold by name into `name:<folded>`, as
  today.
- Without the second argument the function behaves exactly as before. The crew screen and the HR
  filters do not pass it.

**Sections.** The same fold, run separately inside each department group. It covers the section
rows whose department row is in the group, and the section entries under the group's catalog
entry. Folding sections company-wide would join «الإدارة» of one department to another's.

**Which groups are shown:**
- A department or section group appears when at least one of its rows is active, or when it has
  an active entry and no rows.
- A stopped group disappears from the chart. Its placements are kept, and they come back if the
  group is made active again from the departments or sections page.

**What the chart returns** (`OrgChartDto`, §6.2):
- Each department group, with:
  - `ref`;
  - its name (the entry's, else the oldest active row's);
  - the branches with an active row;
  - its section groups, each with `ref`, name, branches and placed jobs;
  - its directly placed jobs.
- The jobs named by any placement, with `id`, `code` and `name`. Placements of inactive or deleted
  jobs are left out.

### 4.2 References

A group is addressed by an opaque `ref` the server produces and the client sends back. It is
never built by the client.
- `catalog:<id>`: a group with an entry.
- `unit:<rowId>`: a group without one. The row is its oldest live member.

On a write, the server recomputes the fold and finds the group from the ref. A `unit:` ref whose
row has since joined an entry resolves to that entry's group.

## 5. Writing

### 5.1 Giving a group an entry, only when a write needs one

A placement needs a catalog entry, and so does a section added under a department. When the
target group has none (a `unit:` ref), the write first creates the entry, in the same transaction:
- **Name:** the group's oldest active row's name.
- **Code:** that row's code if no catalog entry holds it; otherwise the next free `DEP-####` /
  `SEC-####`. The importer's `nextFreeCode` rule moves to `platform/organization/shared`, and the
  importer uses it from there.
- **Rows:** none is changed. They join the entry by the fold in §4.1.

When the fold finds two or more entries for one name, the group is ambiguous. A write under it is
refused with `ORG_UNIT_AMBIGUOUS` (409): «الاسم ده متكرر في قائمة الإدارات الموحدة — صحّحه من شاشة
الإدارات الأول». The chart still shows the group.

Creating an entry is how the existing data is tidied, not a new department. It needs only the key
of the write that caused it (ADR-038).

### 5.2 From the chart (`/api/v1/platform/org-chart`)

Every write runs in one `unitOfWork`, records its audit entries, and answers with the fresh
`OrgChartDto` for the department it touched. The client sets that into the cache, so the next
gesture works on fresh data.

| Write | Key | What it does |
|---|---|---|
| `POST /sections` `{departmentRef, name:{ar,en}, branchIds[]}` | `section.create` | Gives the department an entry if it has none (§5.1). Refuses a name whose fold matches a section group in that department (`DUPLICATE`, 409, «القسم ده موجود — لو موقوف شغّله من شاشة الأقسام»). Creates the section entry (code per §5.1). For each ticked branch it takes the department's row there (the linked one, else the oldest active member). If that row is unlinked, it links it: `catalogId` is set and the name is left alone. It then creates the section row with the next free `SEC-####` code, the entry's name and `catalogId`. A ticked branch where the department has no active row is refused (422). |
| `PATCH /sections/:ref` `{name:{ar,en}}` | `section.edit` | Renames the entry (if any), which renames its linked rows as today. It also renames every unlinked row in the group, so they keep folding together. |
| `POST /sections/:ref/stop` | `section.edit` | Marks the entry (if any) and every active row in the group inactive. Placements are kept. |
| `POST /placements` `{jobTitleId, departmentRef, sectionRef\|null}` | `jobTitle.edit` | Gives the group(s) entries if needed (§5.1), then inserts the placement. A placement that already exists is a 409 `DUPLICATE`. |
| `PATCH /placements/:id` `{sectionRef\|null}` | `jobTitle.edit` | Moves the job to another section of the **same** department, or to directly under it. If the job is already at the target, the moved placement is removed, so the two become one. |
| `DELETE /placements/:id` | `jobTitle.edit` | Removes the placement (soft delete). |

**Version stamps:**
- Placement writes from the chart do not ask for the job's `version`, but they raise it
  (`$inc: {__v: 1}`). A job form opened before the chart's change then saves into a 409
  `STALE_DOCUMENT`, instead of overwriting the move it never saw.
- Section rename and stop send the entry's `version` when the group has one. The read model
  carries it.

### 5.3 From the job form

- `CreateJobTitleSchema` and `UpdateJobTitleSchema` gain an optional
  `placements: {departmentRef, sectionRef|null}[]` (max 50). It is the whole set.
- **Create** inserts the job and then its placements in one `unitOfWork`.
- **Update** compares the set with what is stored, inserts what is new and soft-deletes what is
  gone, in the same transaction as the job's own update. The update already checks `version`.
  Omitting `placements` leaves them untouched, the rule every other optional field follows.
- `JobTitleDto` gains `placements: { id, department: {ref, name}, section: {ref, name} | null }[]`.
  The names are read in one batch for a page, as the shift names already are (`toDtos`).
- **Delete** soft-deletes the job's placements in the same transaction.

### 5.4 The audit trail and the job's history

- A job's places are part of the job. Every placement write is audited as an `update` of that job
  (`{moduleId:'platform', entityType:'jobTitle'}`).
- The `changes` show the places before and after, as labels («العمليات › الخزينة»).
- The job's `snapshot()` gains `placements` as sorted labels, so the form's audit shows them like
  any other field.
- Section writes are audited on the rows and entries they touch, as today: `platform.section` and
  `platform.sectionCatalog`. A section added in several branches uses `recordMany`.
- The `OrgUnitChanged` events keep their current payloads. A placement emits `unitType:'jobTitle'`,
  `change:'updated'`.

## 6. How the two screens hear each other

### 6.1 In the same browser

The chart's key is `['organization','org-chart']`.
- **Every chart write** sets the chart into the cache, then invalidates:
  - `['organization','jobTitles']` (the job pages);
  - `['organization','job-titles']` (the job pickers);
  - and, for section writes, `['organization','sections']` and `['organization','departments']`.
- **The job form's create, update and delete** additionally invalidate
  `['organization','org-chart']`.

### 6.2 Across users (realtime)

- The audit row already announces `platform.jobTitle`, `platform.section`,
  `platform.sectionCatalog`, `platform.department` and `platform.departmentCatalog` to holders of
  the topic's key.
- The web registry rows for those topics today invalidate `['org', …]` and
  `['platform','organization']`. Neither prefix is a key the organization module uses
  (`['organization', …]`), so another user's edit does not refresh `/organization/*` at present.
  The rows gain:
  - `platform.jobTitle`: `['organization','jobTitles']`, `['organization','job-titles']`,
    `['organization','org-chart']`;
  - `platform.section`, `platform.sectionCatalog`: `['organization','sections']`,
    `['organization','org-chart']`;
  - `platform.department`, `platform.departmentCatalog`: `['organization','departments']`,
    `['organization','org-chart']`.
- The existing entries stay. No server topic is added, so `realtime-registry.spec` is unchanged.
- A holder of only `department.view` hears `platform.section` only if they hold
  `organization.view` (the topic's key, unchanged). Without it, they see another user's edit on
  their next load.

## 7. The one-time fill

- **Where it runs:** HR's seed, after the employee migrations and before the payroll backfills.
  The platform cannot read HR (`eslint.config.js` boundaries), so HR gathers the facts and hands
  them to a platform service exported from `platform/organization/index.ts`.
- **Run once:**
  - If `job_title_placement_fills` holds `v1`, the step returns before reading anything.
  - Otherwise HR reads the triples `{departmentId, sectionId|null, jobTitleId}`:
    - from employees whose status is not `exited` (a new `heldPlacementsSystem()` beside
      `jobsByDepartmentSystem`, with the section added to the group);
    - from accepted, not-yet-hired offers (`acceptedPlacementsSystem()`, the accepted terms first,
      as `acceptedJobsByDepartment` reads them).
  - The platform resolves each triple:
    - **Department:** department row → group, giving the entry for the group as §5.1 does.
    - **Section:** section row → section group, with the same treatment.
    - A section row that has gone, or that is not in the department's group, places the job
      directly under the department.
    - Jobs that are inactive or deleted are skipped.
  - It inserts what is missing and ignores duplicates.
  - It writes the mark with the counts. The mark is written **after** the inserts. A crash in
    between runs the fill again on the next start; the inserts are idempotent and nobody could have
    edited in between.
- **After the mark:**
  - A start never fills again. A job the owner removes stays removed.
  - Jobs that gain holders later are not placed automatically. The owner places them.
- **Logging:** the step logs `{placed, skipped}`. It is wrapped like the other seed migrations: a
  failure logs a warning and the start continues.
- **Under test** it runs like any seed. The integration spec calls it directly after clearing the
  mark.

## 8. Risks and limits

- **The fill gives entries to unlinked groups** (§5.1). If production was never linked by
  `migrate:org-catalog`, the fill creates the department entries it needs.
  - This is not the boot-time migration [ADR-031](../03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md)
    rejected: no row is merged, retired, renamed or relinked.
  - Its effect on other screens is none. Those screens fold rows without the entries, as today.
- **Places are descriptive.** Registering someone under a job that is not placed in their
  department is allowed, and nothing warns (D-ORG3-1).
- **A stopped section's places are hidden, not deleted.** Restarting the section from the sections
  page shows them again.
- **Branch-scoped readers see the company chart**, as they already see the company's names in
  every `/options` picker.
- **No move between departments** (D-ORG3-3).
- **Realtime reaches organization-scope holders only** (§6.2), as for every org-unit write today.
- **Deleting a section entry** that has placements but no rows is allowed, as today. The read
  model drops placements whose entry is gone.

## 9. Delivery plan

One PR: these documents, then the code. The recent practice for ADR-036 and ADR-037 was one PR
with both. After each step, `npm run typecheck`, `npm run lint` and every workspace's tests pass.

**Step 1: documents.**

| File | Change |
|---|---|
| `docs/12-planning/org-chart-design.md` | Create (this file) |
| `docs/03-decisions/ADR-038-job-titles-placed-in-the-structure.md` | Create |
| `docs/03-decisions/README.md` | Modify: the ADR-038 row (and the missing ADR-029 row) |
| `docs/02-architecture/organization-structure.md` | Modify. §2: titles are still not owned by a unit, but carry descriptive places, keyed on the catalog. The closing paragraph: the M2M join is now realized. Add the chart page. |
| `docs/05-database/database-design.md` | Modify: add `job_title_placements` and `job_title_placement_fills` beside the catalogs |

**Step 2: contracts.**

| File | Change |
|---|---|
| `packages/contracts/src/platform/org-chart.ts` | Create: `OrgUnitRefSchema` (`catalog:`/`unit:` + 24 hex), `AddChartSectionSchema`, `RenameChartSectionSchema`, `AddPlacementSchema`, `MovePlacementSchema`, `JobPlacementInputSchema`, and the DTOs `OrgChartDto`, `OrgChartDepartmentDto`, `OrgChartSectionDto`, `OrgChartJobDto`, `JobTitlePlacementDto` |
| `packages/contracts/src/platform/organization.ts` | Modify: `placements` on `CreateJobTitleSchema`, `UpdateJobTitleSchema` and `JobTitleDto`, and the comment on job titles (ADR-038) |
| `packages/contracts/src/platform/org-unit-groups.ts` (+ spec) | Modify: the optional catalog-entries argument (§4.1). Spec: an entry with no rows; an unlinked row joining it; two entries with one name staying `name:`; and the old call unchanged |
| `packages/contracts/src/errors/index.ts` | Modify: `ORG_UNIT_AMBIGUOUS` |
| `packages/contracts/src/index.ts` / platform barrel | Modify: export the new file |

**Step 3: API.**

| File | Change |
|---|---|
| `apps/api/src/platform/organization/job-placements/job-placement.model.ts`, `.repository.ts`, `job-placement-fill.model.ts` | Create (§3) |
| `apps/api/src/platform/organization/org-chart/org-chart.read.ts` | Create: load and fold (§4), pure folding in a separate `org-chart.fold.ts` with a unit spec |
| `apps/api/src/platform/organization/org-chart/org-chart.service.ts`, `.controller.ts`, `.routes.ts` | Create (§5.1, §5.2) |
| `apps/api/src/platform/organization/shared/next-free-code.ts` | Create (moved from `workforce-import/org.ts`; the importer imports it) |
| `apps/api/src/platform/organization/job-titles/job-title.service.ts` | Modify: placements on create, update and delete; the snapshot; `toDtos` (§5.3, §5.4) |
| `apps/api/src/platform/organization/index.ts` | Modify: export `jobPlacementFill` for HR |
| `apps/api/src/app.ts` | Modify: mount `/platform/org-chart` |
| `apps/api/src/modules/hr/employee-management/employees/employee.repository.ts`, `.../job-offers/job-offer.repository.ts` | Modify: `heldPlacementsSystem`, `acceptedPlacementsSystem` |
| `apps/api/src/modules/hr/hr.seed.ts` | Modify: the fill step (§7) |
| `apps/api/src/seed-navigation.ts` (+ `seed-navigation.spec.ts`, `tests/integration/auth-seed-login.spec.ts`) | Modify: the Organization row «شجرة الهيكل التنظيمي» `/organization/chart`, `department.view`, icon `sitemap`. The pinned row count rises by one in both specs. |
| `apps/api/src/sync-indexes.models.ts` | Modify: register the two models |
| `apps/api/tests/integration/org-chart.spec.ts` | Create (cases below) |

Integration cases:
- **Read.** Folds seven branch copies into one tile. An unlinked row joins the entry with its name.
  Two entries with one name stay apart, and a write under that group is refused `ORG_UNIT_AMBIGUOUS`.
- **Department with no sections.** Its jobs come back directly under it.
- **Add section:**
  - a section ticked in three of four branches makes three rows, with codes, linked;
  - an unlinked department row is linked;
  - a duplicate folded name gets 409;
  - a branch without the department gets 422;
  - adding without `section.create` gets 403.
- **Rename and stop.** Rename reaches unlinked members. Stop keeps the placements, and they are
  hidden.
- **Placements:**
  - add, then a duplicate gets 409;
  - move within a department, and a move onto an existing place merges;
  - a move to another department's section gets 422;
  - delete;
  - each raises the job's version, so a stale job update gets 409;
  - a `unit:` ref creates exactly one entry and no row changes.
- **Job form:**
  - create with places;
  - update replaces the set;
  - an update that omits `placements` keeps them;
  - delete removes them;
  - the job's audit shows the labels.
- **The fill:**
  - it places by holders, including a section;
  - it skips exited employees and inactive jobs;
  - a section row outside the group falls back to directly under the department;
  - a second run does nothing, even after a removal.

**Step 4: web.**

| File | Change |
|---|---|
| `apps/web/src/modules/organization/org-chart/org-chart-api.ts`, `org-chart-queries.ts` | Create (§6.1) |
| `apps/web/src/modules/organization/org-chart/pages/OrgChartPage.tsx` and its components (`DepartmentTiles`, `ChartBoard`, `ChartTree` (phone), `AddSectionDialog`, `RenameSectionDialog`, `StopSectionDialog`, `AddJobDialog`) | Create (§2.1, §2.2) |
| `apps/web/src/modules/organization/org-chart/lib/chart-moves.ts` (+ spec) | Create: pure move targets and labels |
| `apps/web/src/modules/organization/routes.tsx`, `pages/OrganizationOverview.tsx` | Modify: the route `chart` behind `department.view`; a shortcut card |
| `apps/web/src/modules/organization/job-titles/components/JobPlacementsField.tsx` | Create (§2.3) |
| `apps/web/src/modules/organization/job-titles/pages/JobTitleFormPage.tsx`, `JobTitleDetailPage.tsx`, `job-title-queries.ts` | Modify (§2.3, §6.1) |
| `apps/web/src/platform/realtime/invalidation-registry.ts` | Modify (§6.2) |
| `apps/web/src/platform/localization/i18n.ts` | Modify: the page's strings, Arabic and English |
| `apps/web/src/modules/organization/org-chart/*.spec.tsx` | Create: the page renders tiles and the chart from a fixture; a department with no sections; edit controls hidden without the keys; the phone tree |

**Step 5: CHANGELOG** under Unreleased › Added.

## 10. Review

To be recorded by the design review before the code is written.
