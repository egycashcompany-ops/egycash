# Organization — the company org chart and where each job sits (P-ORG-3)

**Status:** approved by the owner on 2026-11-17. He saw a static sample of the page and answered
«تمام موافق على اقتراحاتك كلها، ابدأ» ("fine, I agree to all your suggestions, start"). That covers
§1.2 and §1.3. In the same message he added one requirement: the job form must say which department
and section a job belongs to, and the form and the chart must stay in step (§1.1). His words are
quoted from his messages in the Claude Code session of 2026-11-17. The decision this design rests on
is [ADR-038](../03-decisions/ADR-038-job-titles-placed-in-the-structure.md). §11 records the
fresh-context review.

## 0. Terms

| Term | Meaning |
|---|---|
| **row** | One branch's copy of a department (`departments`) or section (`sections`). Employees are registered on rows. |
| **catalog entry** | The company's own record of a department (`department_catalog`) or section (`section_catalog`), from [ADR-031](../03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md). A section entry belongs to one department entry. |
| **linked / unlinked** | A row is linked when its `catalogId` names a catalog entry, and unlinked when `catalogId` is null. Rows made by the department and section forms are unlinked, because those forms never send `catalogId`. |
| **fold** | `foldOrgUnitName` in `packages/contracts/src/platform/org-unit-groups.ts`: the name as a person reads it. Hamza forms, final ya and ta marbuta are unified; tashkeel, tatweel, direction marks, brackets and extra spaces are dropped. Used for matching only, never displayed. |
| **group** | One company department or section, gathered from its rows by `orgUnitGroupKeys` (same file, unchanged by this design). A linked row is in group `catalog:<entryId>`. An unlinked row joins the one catalog group whose linked rows fold to the same Arabic name (English when the Arabic is empty). With none, or more than one, it is in `name:<folded>` with the other unlinked rows of that name. |
| **ref** | How a client addresses a group: `catalog:<entryId>` for a catalog group, `unit:<rowId>` for a `name:` group. For a `name:` group, `rowId` is the group's oldest row by `createdAt`, not deleted, in any status. The server produces refs; the client sends them back and never builds one. |
| **job place** | New here: a job title's place in the structure, meaning a department entry, optionally narrowed to one of its section entries. A job may have several. In prose it is always "job place", to keep it apart from an **employee placement**, which is where a person, offer or requisition sits (branch, department and section on that record, as in [ADR-030](../03-decisions/ADR-030-requisition-names-its-placement.md)). |
| **tile** | A department's box in the row at the top of the page. "Card" means the shared `Card` component only. |

## 1. The owner's request and the decisions

### 1.1 What the owner asked for

- «HR hierarchical chart (or organizational chart) … عبارة عن شارت بالشركة كلها .. فيه الإدارات
  والأقسام والمسميات الوظيفية»: one chart of the whole company, with its departments, sections and
  job titles.
- «يكون فى فوق كل الإدارات جنب بعض فى كروت ولما أختار إدارة بالضغط على كارت يجيب تحتها الشارت بتاع
  هيكلها التنظيمي»: all departments side by side at the top; picking one draws its chart below.
- «مع إمكانية تعديل الهيكل التنظيمي للأقسام تحت الإدارات وللوظائف تحت الأقسام»: the sections under a
  department and the jobs under a section can be edited.
- «مش كل الإدارات فيها أقسام»: not every department has sections. Its jobs then sit directly under
  it.
- «فى المسميات الوظيفية /organization/job-titles لا يوجد أى ربط بينها وبين الأقسام والإدارات …
  عايزك تضيفها»: job titles are linked to no department or section, and the job form must gain that
  link.
- «لو عدلت أى حاجة فيها أو فى شارت الهيكل التنظيمي الأتنين يسمعوا فى بعض»: an edit in the job form
  or in the chart shows in the other.

### 1.2 The four decisions

| # | Decision | Why |
|---|---|---|
| D-ORG3-1 | **Job places describe; they do not enforce.** Registration, transfer, promotion, requisitions, offers and applicant placement are unchanged: none checks the job against its places. A job may have several places («سائق», driver, under Movement and under Cash-in-transit). A job place carries **no headcount, seat, budget or vacancy**. | Enforcing it would invalidate every current employee whose job sits elsewhere, and would turn a description into a gate on hiring. A headcount would be the seat entity ADR-030 forbids. |
| D-ORG3-2 | **The chart starts filled from reality, once.** Each job is placed where its holders sit (employees not exited, and accepted offers not yet hired). From then on the places are edited by hand. A start-up never fills again, so a place a user removes is not put back (§7 states the exact guarantee). | An empty chart means placing every job by hand (147 titles in ADR-031's 2026-09-07 export). A fill on every start would undo the edits. |
| D-ORG3-3 | **No moving a section to another department.** A section can be added, renamed or stopped. A section made under the wrong department is added under the right one and the old one is stopped. People change section through the existing «نقل» (transfer) action. | A move changes the department of everyone in that section, in every branch at once. `UpdateSectionCatalogSchema` (`packages/contracts/src/platform/organization.ts`) does not allow it. |
| D-ORG3-4 | **A section added from the chart is created in the branches that have the department.** All are ticked at first and any can be unticked. At least one must stay ticked. | Employees are registered on their own branch's section row. A section with no rows cannot be chosen anywhere. |

### 1.3 Defaults proposed with the decisions

The same proposal stated these and the owner's answer approved them all.

- **No new permission keys.**
  - Seeing the page needs `department.view`.
  - Adding a section needs `section.create`. Renaming or stopping one needs `section.edit`.
  - Changing a job's places needs `jobTitle.edit`, or `jobTitle.create` while creating the job. That
    applies from the chart and from the form alike.
- **One tile per company department.** Branch rows are folded as `orgUnitGroupKeys` folds them for
  the crew card (`apps/web/src/modules/operations/components/CrewDepartmentsCard.tsx`).
- **Counts:** a tile shows its sections and distinct jobs, as the approved sample did. It shows no
  headcounts: he had said «متعملش حاجه زياده عن اللي قلتلك عليه» ("don't add anything beyond what I
  told you").
- **The job list page is unchanged.** The form and the detail page carry the places.

### 1.4 Not in this phase

- Moving a section between departments (D-ORG3-3).
- Enforcing places, or warning when an employee placement falls outside its job's places (D-ORG3-1).
- Headcounts, seats or vacancies (D-ORG3-1).
- Adding or editing departments from the chart. The request covers sections under departments and
  jobs under sections. Departments are added on `/organization/departments`.
- Adding an existing section to more branches from the chart, or restarting a stopped section from
  the chart (§9).

## 2. What the user sees

This section is the specification. The sample the owner approved illustrates it and is not kept in
the repository. Strings are given as Arabic / English, in the product's formal register, as
`scripts/check-formal-arabic.mjs` requires. The sample's colloquial wording is not carried over.

### 2.1 The page `/organization/chart` («شجرة الهيكل التنظيمي» / "Org chart")

From top to bottom:

1. **`PageHeader`.**
   - Breadcrumbs: «الهيكل التنظيمي» / "Organization", then the page.
   - Under the title: «إدارات الشركة كلها. اختر إدارة لعرض أقسامها ووظائفها.» / "Every department
     of the company. Pick one to see its sections and jobs."
   - One action: «تعديل الهيكل» / "Edit structure". It shows only to someone holding at least one of
     `section.create`, `section.edit` or `jobTitle.edit`. In edit mode it reads «إنهاء التعديل» /
     "Done editing".
2. **Tiles.** One per shown department group (§4.2), sorted by name in the current language.
   - **Content:** the name and two counts: «{n} أقسام» / "{n} sections" (or «بدون أقسام» / "No
     sections"), and «{n} وظائف» / "{n} jobs" (distinct jobs placed anywhere in the department).
   - **Look:** the selected tile uses the crew tile's selected style, in the crew card's grid (one
     column on a phone).
   - **Selection in the URL:** the selection lives in `?dept=<ref>`.
     - A `unit:` ref that now belongs to a linked group is matched through the group's `rowIds`
       (§4.4) and replaced in the URL with the group's ref.
     - Any other ref no tile has, and an empty `?dept`, select the first tile.
   - **Search:** over 7 tiles, a search box above them narrows by fold, as the crew card's does.
3. **Chart `Card`.**
   - **Header:** «الهيكل التنظيمي لإدارة {name}» / "{name}: structure", with the counts.
   - **Body from `sm` up:** a top-down chart.
     - The department box: «موجودة في {n} فروع» / "In {n} branches".
     - The sections side by side, under connector lines drawn with logical borders so they mirror in
       RTL.
     - Each section's jobs in a column under it.
     - Jobs placed in the department with no section form a first column, «تابعة للإدارة مباشرة» /
       "Directly under the department", drawn dashed. It shows when it has jobs, or in edit mode.
     - A department with no sections has its jobs directly under its box.
     - A chart wider than the card scrolls sideways inside it.
   - **Body below `sm`:** the same content as an indented tree (department › section › job), as on
     `OrganizeApplicationsPage`.
4. **States.**
   - Loading: `LoadingState`. Failure: the shared error state with a retry.
   - No departments: `EmptyState` «لا توجد إدارات بعد» / "No departments yet", with a link to the
     departments page for a holder of `department.create`.
   - A department with no sections and no jobs: «لا توجد وظائف في هذه الإدارة بعد» / "No jobs in
     this department yet".

### 2.2 Edit mode

- **Banner:** «أنت في وضع التعديل. يُحفظ كل تغيير فور إجرائه.» / "You are editing. Each change is
  saved as you make it."
- **Saving:** there is no draft and no save button (`OrganizeApplicationsPage`'s model). One change
  is written at a time, and the controls are disabled while a write is in flight. A later answer
  therefore never lands over a newer one.
- **Job controls**, shown to a holder of `jobTitle.edit`:
  - Each job shows a ↕ grip. Dragging it moves the job to another section of the same department,
    or to «تابعة للإدارة مباشرة».
  - «نقل إلى» / "Move to" is a `Select` of the same targets, for anyone who cannot drag.
  - «إزالة من هنا» / "Remove from here" (✕) removes that job place. The job itself stays.
  - «إضافة وظيفة» / "Add job" sits under each section and under the direct column. It opens a
    `Dialog` with a `SearchableSelect` of active jobs.
    - Each option shows where else the job sits: «موجودة أيضًا في: …» / "Also in: …".
    - A job already in that exact place is not offered.
- **Section controls:**
  - «إضافة قسم» / "Add section" (`section.create`) sits beside the sections. It opens a `Dialog`
    with:
    - «الاسم بالعربية» / "Arabic name" and «الاسم بالإنجليزية» / "English name", both required, as
      `LocalizedStringSchema` requires;
    - «الفروع» / "Branches": the branches with an active row of the department, all ticked;
    - the hint «يُنشأ القسم في الفروع المحددة.» / "The section is created in the ticked branches."
    - «إضافة» / "Add" stays disabled with no branch ticked.
  - The ⋮ menu on a section (`section.edit`) offers:
    - «تغيير الاسم» / "Rename": a `Dialog` with both names.
    - «إيقاف القسم» / "Stop section": a confirming `Dialog` that says «سيتوقف عرض القسم للاختيار في
      كل الفروع، ويبقى الموظفون المسجلون فيه عليه.» / "The section stops being offered in every
      branch; the people in it keep it."
- **Errors** are shown with the shared toast, in the words of §5.5.

### 2.3 The job form and detail (`/organization/job-titles/*`)

- **Form.** A new `Card` «مكانها في الهيكل التنظيمي» / "Place in the structure" sits between the
  identity and requirements cards.
  - **The list.** Each job place is a row «{department} › {section}», or «{department} › تابعة
    للإدارة مباشرة», with ✕. A place whose group is stopped is tagged «موقوف» / "Stopped".
  - **The add row.**
    - A department `SearchableSelect` lists the chart's departments.
    - A section `SearchableSelect` lists «تابعة للإدارة مباشرة» first, then that department's sections.
    - «إضافة» / "Add" adds the place.
    - Both lists are read from the chart endpoint (§4.4).
  - The places are saved with the form's own «حفظ» / "Save", in the same request (§5.2).
- **Detail.** A third `Card` with the same rows, read-only. With none it shows «لم تُحدَّد بعد» /
  "Not set yet".
- **Delete.** Deleting a job removes its job places.

## 3. The records

### 3.1 `job_title_places`

```jsonc
{
  "_id": "<ObjectId>",
  "jobTitleId": "<ObjectId job_titles>",
  "departmentCatalogId": "<ObjectId department_catalog>",
  "sectionCatalogId": "<ObjectId section_catalog> | null", // null: directly under the department
  "isDeleted": false, "createdBy": "<ObjectId users> | null", "updatedBy": "<ObjectId users> | null",
  "createdAt": "<Date>", "updatedAt": "<Date>", "__v": 0
}
```

**Indexes:**
- `ux_jobTitleId_departmentCatalogId_sectionCatalogId`: unique, partial on `isDeleted:false`.
- `ix_departmentCatalogId`.
- `ix_sectionCatalogId`.

**Rules:**
- **The section's department.** When `sectionCatalogId` is set, that section entry's
  `departmentCatalogId` must equal this place's `departmentCatalogId`. A section entry never changes
  its department.
- **Active jobs only.** A new place can be written only for a job whose status is active after the
  write. Places of a job that later becomes inactive are kept.
- **No counts.** Nothing here counts, reserves or limits anything (D-ORG3-1).
- **`createdBy` is null** for the fill (§7), which runs as the system.

**Why catalog entries and not rows.** "Operations" means Operations in every branch, including one
that opens next year. A place against rows would need one per branch, and none for a later branch.

### 3.2 `job_title_place_fills`

```jsonc
{ "_id": "<ObjectId>", "key": "v1", "at": "<Date>", "placed": 0, "skipped": 0 }
```

- `ux_key` is unique on `key`. The row with key `v1` means the fill (§7) has committed.
- `placed` counts the job places written. `skipped` counts the employee and offer placements that
  produced none (§7 lists why).

## 4. Reading the chart

### 4.1 Groups

- **Departments.** `orgUnitGroupKeys` runs over every department row that is not deleted, in any
  status. This is the population the function's own comment asks for, and the crew card passes it.
  The function is not changed.
- **Sections.** The same function runs once per department group, over the section rows whose
  department row is in that group. Folding sections company-wide would merge «الإدارة» of one
  department with another's.
- **Job places.** A job place belongs to the department group `catalog:<departmentCatalogId>`.
  - With a `sectionCatalogId`, it belongs to that department's section group
    `catalog:<sectionCatalogId>`.
  - With none, it belongs to the department's direct column.

### 4.2 Which groups are shown

- **A group is shown when at least one of its rows is active.** A stopped group (all rows inactive)
  is not shown.
- **Hidden places are kept.** Places in a stopped group are hidden, not deleted. They show again when
  a row is made active again on the sections or departments page. That works because the group's rows
  are linked (§5.1), so it is still the same `catalog:` group.
- **Entries with no rows.** A catalog entry with no rows forms no group and is not shown.
- **What a hidden place looks like on the job form.** A job place whose group is not shown keeps its
  row on the job form, tagged «موقوف» (§5.2).

### 4.3 Cost

- **Every read** loads:
  - all department and section rows;
  - both catalogs;
  - the live job places;
  - the active jobs.
- **Size.** On this deployment that is about 71 department rows (ADR-031), a few hundred section
  rows, 147 jobs and a few hundred places. That is well under a megabyte, folded in memory. A read
  costs a handful of `find` calls, the size of one `/options` read per collection.
- **No caching.** The chart is not cached server-side.

### 4.4 `GET /api/v1/platform/org-chart`

**Access.** Any signed-in user may call it, as the `/options` endpoints allow. The page itself is
behind `department.view`, in the navigation and the route. The endpoint is open so that the job form
can list departments and sections for a job editor who lacks `department.view` (§2.3). Everything it
returns is already open:
- the names come from `/options`;
- a job's places are part of the job form.

**Scope.** The whole company, whatever the reader's data scope. That is what the request asks for, and
it is what `/options` already returns.

```ts
OrgChartDto = {
  departments: {
    ref: string;              // catalog:<id> | unit:<rowId>
    rowIds: string[];         // the group's rows, so a client can resolve an old unit: ref
    name: { ar: string; en: string };  // the entry's name, else the oldest row's
    branches: { id: string; name: { ar: string; en: string } }[]; // with an active row
    catalogVersion: number | null;     // the entry's version, null for a unit: group
    sections: {
      ref: string; rowIds: string[]; name: { ar: string; en: string };
      branches: { id: string; name: { ar: string; en: string } }[];
      catalogVersion: number | null;
    }[];
  }[];
  jobs: {                     // every active job
    id: string; code: string; name: { ar: string; en: string }; version: number;
    places: { departmentRef: string; sectionRef: string | null; active: boolean }[];
  }[];
};
```

- A department's or section's jobs are the jobs whose `places` name it. The client derives each
  column from `jobs`, so a job is sent once.
- `active` is false when the place's group is not shown (§4.2).
- `version` is the job's own `__v`, which a change of places sends back (§5.2).

## 5. Writing

### 5.1 Linking a group to the catalog

A job place and a section entry need a department catalog entry, and a job place in a section needs a
section catalog entry. A `unit:` ref names a group with no entry. A write that names one first links
the group, in the same transaction:

1. **Find or create the entry.** Find the catalog entries (in any status, not deleted) whose name
   folds like the group's name.
   - **None:** create one through the catalog's create path, so its name check runs.
     - Name: the oldest row's.
     - Code: the oldest row's code, if no entry of that catalog holds it. Otherwise the next free
       `DEP-####` / `SEC-####` (the rule in `workforce-import/org.ts` `nextFreeCode`, which moves to
       `platform/organization/shared/next-free-code.ts` and is imported back by the importer).
   - **One:** use it, whatever its status.
   - **More than one:** refuse with `ORG_UNIT_AMBIGUOUS`.
2. **Link every row of the group.** Set each row's `catalogId` to that entry. The name is not changed.
   - Two rows of the group in one branch would break the `{branchId, catalogId}` unique index, so a
     group with two rows in one branch is refused with `ORG_UNIT_AMBIGUOUS` before anything is
     written.
   - For a section group, the department rows of those sections are linked first (step 1 for the
     department group), because a section row's entry must belong to its department row's entry
     (`section.service.ts`).

After linking, the group is `catalog:<entryId>`. Every later write uses that ref, and so does
`migrate:org-catalog`. That command plans entries only for unlinked rows, so it never meets these rows
again.

**Authority.** Linking runs under the key of the write that needed it:
- `jobTitle.create` or `jobTitle.edit` for a job place;
- `section.create`, or `section.edit`, for section writes.

This is a deliberate change to ADR-031, which left linking existing rows to the operator command and
put catalog writes under the unit's own keys. ADR-038 records it. Every row and entry touched is
audited (§5.4).

### 5.2 Job places are saved with the job

There is **one write path** for job places: the job title's own create and update. The chart uses it
too.

- **Request.** `CreateJobTitleSchema` and `UpdateJobTitleSchema` gain an optional `places`, at most
  50 items:
  ```ts
  places: { departmentRef: string; sectionRef: string | null }[]
  ```
  - It is the whole set. Omitted means unchanged, the rule the update already follows for every
    optional field (`job-title.service.ts`).
  - On update, `version` is required as today, so a stale form or chart gets `STALE_DOCUMENT` (409).
- **Create** inserts the job, then its places.
- **Update** compares the set with what is stored:
  - It inserts what is new and soft-deletes what is gone, in the same transaction as the job's own
    update.
  - A **new** place must name a shown group (§4.2) and an active job.
  - A place that is **already stored** may stay even when its group is stopped. That is how the form
    keeps the «موقوف» rows it was sent.
- **Delete** soft-deletes the job's places in the same transaction as the job.
- **`JobTitleDto`** gains:
  ```ts
  places: {
    id: string;
    department: { ref: string; name: { ar: string; en: string } };
    section: { ref: string; name: { ar: string; en: string } } | null;
    active: boolean;
  }[]
  ```
  - `toDtos` fills it in one batch for a page, as it already batches the shift names.
  - `toDto`, the synchronous single-row form, returns `[]` with a comment, as it already does for
    `defaultShifts`.
- **From the chart**, each change becomes one `PATCH /platform/job-titles/:id` with
  `{version, places}`, the job's current set with the one change applied:
  - a move: section A → section B in the same department;
  - an add;
  - a removal.

  The chart reads `version` and the full set from `jobs` (§4.4).
- **Catalog entries with places.** A catalog entry cited by a live place cannot be deleted. The
  catalogs' `hasDependents` hook (`platform/organization/index.ts`) also counts live places, so an
  entry no row declares no longer looks unused while jobs sit in it.

### 5.3 Section writes from the chart

Each write answers with the whole fresh `OrgChartDto`, which the client puts in the cache.

| Write | Key | What it does |
|---|---|---|
| `POST /api/v1/platform/org-chart/sections` `{departmentRef, name:{ar,en}, branchIds[≥1]}` | `section.create` | Adds a section in the ticked branches (steps below). |
| `PATCH /api/v1/platform/org-chart/sections/:ref` `{name:{ar,en}, version: number \| null}` | `section.edit` | Renames the section group. |
| `POST /api/v1/platform/org-chart/sections/:ref/stop` `{version: number \| null}` | `section.edit` | Stops the section group. |

`version` is the section entry's `catalogVersion` from §4.4, and null for a `unit:` ref.

**Add a section:**
1. Link the department group (§5.1) if it is a `unit:` group.
2. Refuse a name that folds like a section group of that department (`DUPLICATE`), in any status.
3. Create the section entry with the next free `SEC-####` among section entries.
4. For each ticked branch, take the department's active row there. A ticked branch with none refuses
   the whole request (`BRANCH_WITHOUT_DEPARTMENT`, 422) before anything is written.
5. Create one section row per ticked branch, under that department row, with:
   - the entry's name and `catalogId`;
   - its own next free `SEC-####` among section rows (codes made in the same request are reserved, so
     two rows never draw the same one);
   - `branchId`, `departmentId` and `path` as `section.service.ts` builds them. That builder moves to
     an exported `sectionRowFields`, which both use.

**Rename:**
1. Link the group (§5.1) if it is a `unit:` group.
2. Refuse a name that folds like another section group of the same department (`DUPLICATE`).
3. Rename the entry. The catalog's rename carries the name to its linked rows (`renameLinked`), which
   after step 1 are all of the group's rows.

**Stop:**
1. Link the group (§5.1) if it is a `unit:` group.
2. Set the entry and every active row of the group to inactive.
3. The audit entry lists the rows this stop deactivated.
4. Job places are kept (§4.2).

**Scope.** These writes, like every org-unit write today, are checked by key and not by branch:
`apps/api/src/platform/organization/shared/org-unit.http.ts` passes no scope to create or update. A
holder of `section.create` may add a section in any branch that has the department (§9 lists this as
a risk).

### 5.4 Transactions, audit and events

- **One transaction.** Every write in §5.1–§5.3 runs in one `unitOfWork`. Inside it, documents are
  written through the repositories, passing the `session` that `BaseRepository.create`, `updateById`
  and `softDeleteById` already accept.
- **Shared checks.** The services' checks are kept by calling the same functions:
  - the catalogs' name checks, exported from `department-catalog.service.ts` and
    `section-catalog.service.ts`;
  - `sectionRowFields`.
- **Audit after commit.** Audit entries are collected during the transaction and written after it
  commits, with `auditService.recordMany`. The `OrgUnitChanged` events go out after them. This is the
  order `employee.service.ts` uses around its own `unitOfWork`. A rolled-back write therefore leaves no
  audit row and sends no realtime signal, and a transaction retry never audits twice.
- **What is audited:**

  | Change | Entity | Action | `changes` |
  |---|---|---|---|
  | A job's places | `platform.jobTitle` | `update` | `places` as sorted labels before and after («العمليات › الخزينة»). The job's `snapshot()` gains `places`. |
  | A linked row | `platform.department` / `platform.section` | `update` | `catalogId` |
  | A created entry | `platform.departmentCatalog` / `platform.sectionCatalog` | `create` | |
  | A created section row | `platform.section` | `create` | |
  | A renamed entry | `platform.sectionCatalog` | `update` | `linkedUnitsRenamed`, as today |
  | A stop | `platform.sectionCatalog`, and each row it deactivated | `update` | `status` |

- **Events.** `OrgUnitChanged` payloads are unchanged:
  - `jobTitle`/`updated` for places;
  - `department`/`section` and their catalogs for the rest.

### 5.5 Errors

| Code | HTTP | When | Message (ar / en) |
|---|---|---|---|
| `ORG_UNIT_AMBIGUOUS` | 409 | §5.1: more than one entry for the name, or two rows of the group in one branch | «لا يمكن ربط هذه الإدارة بقائمة الشركة: اسمها مكرر أو مسجل مرتين في فرع واحد. صحّح ذلك من شاشة الإدارات أو الأقسام أولًا.» / "This unit cannot be linked to the company list: its name is duplicated, or it is registered twice in one branch. Fix that on the departments or sections page first." |
| `DUPLICATE` | 409 | §5.3: the name folds like another section of the department | «يوجد قسم بهذا الاسم في هذه الإدارة.» / "This department already has a section with this name." |
| `BRANCH_WITHOUT_DEPARTMENT` | 422 | §5.3: a ticked branch has no active row of the department | «الإدارة غير موجودة في أحد الفروع المحددة.» / "The department does not exist in one of the ticked branches." |
| `NOT_FOUND` | 404 | A ref names no group, or a malformed ref | (shared) |
| `BUSINESS_RULE_VIOLATION` | 422 | A new place for an inactive job or a hidden group; a section ref outside its department | «لا يمكن وضع وظيفة موقوفة أو في قسم موقوف.» / "A stopped job, or a stopped section, cannot be given a new place." |
| `STALE_DOCUMENT` | 409 | A job or entry `version` that is not current | (shared: refresh and retry) |
| `FORBIDDEN` | 403 | The key of §1.3 is missing | (shared) |

## 6. Keeping the chart and the job form in step

### 6.1 In the same browser

The chart's query key is `['organization','org-chart']`. These writes invalidate the whole
`['organization']` prefix:
- every chart write;
- every job create, update or delete, whether from the chart or the form.

So the chart, the job pages, the job pickers and the department and section lists all refetch whatever
is on screen. A section write also puts its answer straight into the chart's key.

### 6.2 Across users

- **Today.** The audit row already announces its topic to the holders of that topic's key
  (`apps/api/src/platform/realtime/realtime-registry.ts`):
  - `platform.jobTitle` goes to `jobTitle.view`;
  - `platform.department`, `platform.section`, `platform.departmentCatalog` and
    `platform.sectionCatalog` go to `organization.view`.
- **The gap.** The web rows for those topics (`apps/web/src/platform/realtime/invalidation-registry.ts`)
  invalidate `['org', …]` and `['platform','organization']`. The organization module's queries all
  start with `['organization', …]`, so today another user's edit does not refresh `/organization/*`.
- **The change.** Each of the five rows gains `['organization']`. Their current entries stay, and no
  server topic is added.
- **Users without the keys.** A user without `jobTitle.view` is not sent place changes. A user without
  `organization.view` is not sent section changes. Either sees them on their next load of the page.

## 7. The one-time fill

1. **Where.** HR's seed (`apps/api/src/modules/hr/hr.seed.ts`), after the employee migrations and
   before the payroll backfills. It is wrapped in a `try/catch` like `migrateExternalEmployeeNumbers`
   there, so the start continues. The failure is logged at error level, not warn, because a fill that
   never commits leaves the chart empty. The platform may not read HR
   (`eslint.config.js` boundaries), so HR gathers the facts and calls a platform function exported from
   `platform/organization/index.ts`.
2. **Already done.** If `job_title_place_fills` holds `v1`, the step returns at once.
3. **Gather.** HR reads `{departmentId, sectionId | null, jobTitleId}` triples, one per distinct
   combination:
   - from employees whose status is not `exited`: a new `jobUnitsHeldSystem()` beside
     `jobsByDepartmentSystem()`, grouping by section as well;
   - from offers that are accepted, not hired and not superseded: a new `jobUnitsAcceptedSystem()`.
     It reads the accepted terms when the offer has them, else the offer's terms, and filters
     `supersededAt: null`, which `acceptedJobsByDepartment()` lacks.
4. **Resolve** each triple, skipping (counted in `skipped`) when:
   - the department row is gone;
   - the department row's group is a `name:` group (it has no entry, and the fill creates none);
   - the job is inactive or gone.

   Otherwise the place is in the department group's entry. The section narrows it only when the section
   row is still in that department group and its group is a `catalog:` group. If not, the job is placed
   directly under the department.
5. **Write.** In **one transaction**, insert the places that are not already stored, then insert the
   mark `{key:'v1', placed, skipped}`.
   - Both commit or neither does.
   - The API and the worker both run the seed. If they race, the unique `ux_key` lets one commit; the
     other's transaction fails and is logged at info level.
6. **Audit.** After commit, one `update` entry per job that gained places, with `by` null, through
   `recordMany`.

**What is guaranteed:**
- **After the mark.** Once the mark has committed, no start fills again, so a place a user removes is
  not put back.
- **After a failed fill.** A failed fill writes nothing, so the next start tries again. Until one
  succeeds, the chart shows only places users added. The first fill that succeeds adds the holders'
  places beside them. It removes nothing, though it can re-add a place a user had removed before that
  fill.
- **What the fill does not touch.** It never creates a catalog entry and never links a row. A
  department still unlinked at that point starts with no places, and the first edit links it (§5.1).

## 8. Alternatives considered

| Choice | Alternative | Why not |
|---|---|---|
| Link a group on the write that needs it (§5.1) | Require the operator to run `migrate:org-catalog` before release, and keep unlinked groups read-only in the chart | The department and section forms still make unlinked rows (they never send `catalogId`), so every department added later would stay read-only until the operator ran the command again. Linking on write also makes the chart correct whether or not production was ever linked, which this design cannot check. |
| Link on write (§5.1) | Create the entry and leave the rows unlinked, joining it by name | Then `migrate:org-catalog` would plan a second entry for those rows: a duplicate name, or a `ux_code` failure part-way through its `--write`. The catalog's delete guard and rename also see only linked rows, so the entry would look unused and could be deleted from under its places. |
| Job places saved through the job (§5.2) | Separate `POST`/`PATCH`/`DELETE /org-chart/places` endpoints | Two write paths with two concurrency rules. The job update already checks `version` and is already audited. |
| Fill at start-up, in one transaction with its mark (§7) | An operator command with a dry run, as ADR-031 chose for linking | The fill links nothing and creates no entry. It writes only places, from facts the system already holds, and only once. A command nobody runs would leave the chart empty, which D-ORG3-2 rejected. |
| Opaque refs (`catalog:` / `unit:`) (§0) | Send catalog entry ids only | A `name:` group has no entry until its first write. Refs let the chart show and address it before then. |

## 9. Risks and limits

| Risk / limit | Effect | Mitigation |
|---|---|---|
| **Wider authority.** Job and section keys now link rows and create catalog entries (§5.1). | A holder of `jobTitle.edit` can cause a `department_catalog` entry and set `catalogId` on department rows. | Only for a group whose rows already exist, and only to the entry its name folds to. Every row and entry touched is audited (§5.4). Recorded in ADR-038. |
| **Branch scope is not checked on writes** (§5.3). | A branch-scoped holder of `section.create` can add a section in other branches. | Same as every org-unit write today. Narrowing org writes by scope is a separate change for the whole module. |
| **Two users adding one section at once.** | The fold check reads before it writes, so two entries with one name can appear. That department's sections then show `ORG_UNIT_AMBIGUOUS` on their next link. | Rare: one screen, few editors. It is fixed by stopping one copy. A unique folded-name index on `section_catalog` is a follow-up if it happens. |
| **Places can drift from where people sit** (D-ORG3-1). | The chart can say a job is in Treasury while its holder is registered in Counting. | None by design. A report of such differences is a separate request. |
| **«مستندات الوظائف» shows a different list.** The job-papers popup lists the jobs people **hold** per department (`apps/api/src/modules/hr/contracts/job-papers/job-papers.service.ts`), keyed `catalogId ?? row id`. | The two HR screens can list different jobs for one department. | They answer different questions: which papers to print for the jobs held there, against which jobs belong there. Making the popup read places is a separate request. |
| **A section added later in another branch.** The chart has no «add to branch». | A branch that opens later gets its section rows from the sections page. | Such a row is typed by name and joins the group by fold, so it appears in the chart. It becomes linked on the next chart write that links the group. |
| **A stopped section is restarted per branch** on the sections page. Places do not follow D-ORG3-3's add-and-stop workaround. | Restarting takes one edit per row, and a new section starts with no places. | The stop's audit lists which rows it deactivated (§5.3). The jobs are re-added in the chart. |
| **Realtime reach** (§6.2). | Some users see others' edits only on their next load. | Unchanged topic keys. |

## 10. Delivery plan

One PR: these documents, then the code. ADR-036 and ADR-037 shipped the same way. After each step,
`npm run typecheck`, `npm run lint` and every workspace's tests pass.

**Step 1: documents.**

| File | Change |
|---|---|
| `docs/12-planning/org-chart-design.md` | Create (this file) |
| `docs/03-decisions/ADR-038-job-titles-placed-in-the-structure.md` | Create |
| `docs/03-decisions/README.md` | Modify: add the ADR-038 row, and the ADR-029 row that is missing |
| `docs/02-architecture/organization-structure.md` | Modify. §2 (job titles): still owned by no unit, and now with job places keyed on the catalog. The closing note on many-to-many joins: one now exists. Add the chart page to the screen list. |
| `docs/05-database/database-design.md` | Modify: add `job_title_places` and `job_title_place_fills` beside the catalogs. The catalog paragraph notes that chart and job writes link a group's rows (§5.1). |

**Step 2: contracts.**

| File | Change |
|---|---|
| `packages/contracts/src/platform/org-chart.ts` | Create: `OrgUnitRefSchema` (`catalog:` or `unit:`, then 24 hex), `JobPlaceInputSchema`, `AddChartSectionSchema`, `RenameChartSectionSchema`, `StopChartSectionSchema`, `OrgChartDto` and `JobTitlePlaceDto`, with a spec |
| `packages/contracts/src/platform/organization.ts` | Modify: `places` on `CreateJobTitleSchema`, `UpdateJobTitleSchema` and `JobTitleDto`. The job-titles comment points to ADR-038. |
| `packages/contracts/src/errors/index.ts` | Modify: add `ORG_UNIT_AMBIGUOUS` and `BRANCH_WITHOUT_DEPARTMENT` |
| `packages/contracts/src/index.ts` | Modify: export the new file |

**Step 3: API.**

| File | Change |
|---|---|
| `apps/api/src/platform/organization/job-places/job-place.model.ts`, `job-place.repository.ts`, `job-place-fill.model.ts`, `job-place-fill.ts` | Create (§3, §7) |
| `apps/api/src/platform/organization/org-chart/org-chart.groups.ts` | Create: the pure grouping, refs and shown-state (§4), with a unit spec |
| `apps/api/src/platform/organization/org-chart/org-chart.link.ts` | Create (§5.1) |
| `apps/api/src/platform/organization/org-chart/org-chart.service.ts`, `org-chart.controller.ts`, `org-chart.routes.ts` | Create (§4.4, §5.3) |
| `apps/api/src/platform/organization/shared/next-free-code.ts` | Create: moved from `workforce-import/org.ts`, which imports it back |
| `apps/api/src/platform/organization/sections/section.service.ts` | Modify: export `sectionRowFields` |
| `apps/api/src/platform/organization/department-catalog/department-catalog.service.ts`, `section-catalog/section-catalog.service.ts` | Modify: export the name checks |
| `apps/api/src/platform/organization/job-titles/job-title.service.ts` | Modify (§5.2, §5.4): places on create, update and delete, `snapshot`, `toDtos` |
| `apps/api/src/platform/organization/index.ts` | Modify: `hasDependents` also counts places; export the fill function |
| `apps/api/src/app.ts` | Modify: mount `/platform/org-chart` |
| `apps/api/src/modules/hr/employee-management/employees/employee.repository.ts` | Modify: add `jobUnitsHeldSystem` (§7) |
| `apps/api/src/modules/hr/recruitment/job-offers/job-offer.repository.ts` | Modify: add `jobUnitsAcceptedSystem` (§7) |
| `apps/api/src/modules/hr/hr.seed.ts` | Modify: the fill step |
| `apps/api/src/seed-navigation.ts` | Modify: the Organization row «شجرة الهيكل التنظيمي» / "Org chart", `/organization/chart`, `department.view`, icon `sitemap` |
| `apps/api/src/seed-navigation.spec.ts`, `apps/api/tests/integration/auth-seed-login.spec.ts` | Modify: the pinned row count goes up by one |
| `apps/api/src/sync-indexes.models.ts` | Modify: register the two models |
| `apps/api/tests/integration/org-chart.spec.ts` | Create (cases below) |

Integration cases:
- **Read**
  - Seven branch rows fold into one department.
  - Section groups stay inside their department.
  - A stopped group is hidden, and its places come back `active:false` on the job.
  - An anonymous call gets 401.
- **Linking**
  - A `unit:` place links every row of the group.
  - A later `migrate:org-catalog` plan has nothing to plan for those rows.
  - An existing entry with the same fold is reused.
  - Two rows of the group in one branch give `ORG_UNIT_AMBIGUOUS`, and nothing is written.
- **Add section**
  - Three of four branches give three linked rows with distinct codes.
  - A duplicate fold gives `DUPLICATE`.
  - A branch without the department gives 422.
  - No `section.create` gives 403.
  - A rolled-back request leaves no row and no audit entry.
- **Rename and stop**
  - Rename reaches every row.
  - A rename to a sibling's fold gives 409.
  - Stop lists the rows it deactivated and keeps the places.
- **Job places**
  - Create with places.
  - An update replaces the set.
  - An update without `places` keeps them.
  - A stale `version` gives 409.
  - A stopped place survives a form save that sends it back.
  - A new place in a stopped group gives 422.
  - Delete removes the places.
  - A catalog entry with places cannot be deleted.
  - The audit shows the place labels.
- **Fill**
  - Places follow the holders, sections included.
  - Exited employees, superseded offers and inactive jobs are skipped.
  - A section row outside the group falls back to the direct column.
  - A `name:` group is skipped.
  - A second run does nothing, even after a place is removed.
  - Two concurrent runs commit once.

**Step 4: web.**

| File | Change |
|---|---|
| `apps/web/src/modules/organization/org-chart/org-chart-api.ts`, `org-chart-queries.ts` | Create (§6.1) |
| `apps/web/src/modules/organization/org-chart/lib/chart-model.ts` | Create, with a spec: pure column derivation from `jobs`, move targets, the `places` set for one change, and `?dept` resolution through `rowIds` |
| `apps/web/src/modules/organization/org-chart/pages/OrgChartPage.tsx` and its components (`DepartmentTiles`, `ChartBoard`, `ChartTree`, `AddSectionDialog`, `RenameSectionDialog`, `StopSectionDialog`, `AddJobDialog`) | Create (§2.1, §2.2) |
| `apps/web/src/modules/organization/routes.tsx`, `pages/OrganizationOverview.tsx` | Modify: the `chart` route behind `department.view`, and a shortcut |
| `apps/web/src/modules/organization/job-titles/components/JobPlacesField.tsx` | Create (§2.3) |
| `apps/web/src/modules/organization/job-titles/pages/JobTitleFormPage.tsx`, `JobTitleDetailPage.tsx`, `job-title-queries.ts` | Modify (§2.3, §6.1) |
| `apps/web/src/platform/realtime/invalidation-registry.ts` | Modify (§6.2) |
| `apps/web/src/platform/localization/i18n.ts` | Modify: the strings of §2 and §5.5 |
| `apps/web/src/modules/organization/org-chart/*.spec.tsx` | Create. The page draws tiles and the chart from a fixture. It also covers a department with no sections, a stale `?dept`, edit controls hidden without the keys, and the phone tree. The job form keeps a stopped place on save. |

**Step 5: CHANGELOG** under Unreleased › Added.

## 11. Review

To be recorded by the design review before the code is written.
