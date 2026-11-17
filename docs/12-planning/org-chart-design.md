# Organization — the company org chart and where each job sits (P-ORG-3)

**Status:** approved by the owner on 2026-11-17. He saw a static sample of the page and answered
«تمام موافق على اقتراحاتك كلها، ابدأ» ("fine, I agree to all your suggestions, start"), which covers
§1.2 and §1.3. In the same message he added one requirement: the job form must say which department and
section a job belongs to, and the form and the chart must stay in step (§1.1). His words are quoted from
his messages in the Claude Code session of 2026-11-17. The decision this rests on is
[ADR-038](../03-decisions/ADR-038-job-titles-placed-in-the-structure.md). §11 will record the
fresh-context design review that checked this document over three rounds.

## 0. Terms

| Term | Meaning |
|---|---|
| **row** | One branch's copy of a department (`departments`) or section (`sections`). Employees are registered on rows. |
| **catalog entry** | The company's own record of a department (`department_catalog`) or section (`section_catalog`), introduced by [ADR-031](../03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md). A section entry belongs to one department entry. |
| **linked / unlinked** | A row is linked when its `catalogId` names a catalog entry, and unlinked when `catalogId` is null. |
| **fold** | `foldOrgUnitName` in `packages/contracts/src/platform/org-unit-groups.ts`: a name as a person reads it, used to match names and never displayed. It drops direction marks, tatweel and tashkeel; lower-cases; unifies the hamza forms, final ya and ta marbuta; turns brackets into spaces; collapses runs of spaces; and joins a lone «و» to the next word. |
| **group** | One company department or section, gathered from its rows by `orgUnitGroupKeys` (same file, not changed here). Each row gets a key: <br>· `catalog:<entryId>` for a linked row. <br>· `catalog:<entryId>` also for an unlinked row whose Arabic name (or English name, when the Arabic is empty) folds like the linked rows of exactly one entry. <br>· `name:<folded>` for any other unlinked row, shared with every unlinked row of that name. <br>· `unit:<rowId>` when the name folds to nothing. <br>A **catalog group** has an entry. A **name group** (`name:` or `unit:`) has none. |
| **job place** | New in this design: a job title's place in the structure. It is a department entry, optionally narrowed to one of its section entries, and a job may have several. In prose it is always "job place". An **employee placement** is something else: where a person, offer or requisition sits (the branch, department and section on that record, [ADR-030](../03-decisions/ADR-030-requisition-names-its-placement.md)). |
| **tile** | A department's box in the row at the top of the page. "Card" always means the shared `Card` component. |

## 1. The owner's request and the decisions

### 1.1 What the owner asked for

- «HR hierarchical chart (or organizational chart) … عبارة عن شارت بالشركة كلها .. فيه الإدارات
  والأقسام والمسميات الوظيفية»: one chart of the whole company, showing its departments, sections and
  job titles.
- «يكون فى فوق كل الإدارات جنب بعض فى كروت ولما أختار إدارة بالضغط على كارت يجيب تحتها الشارت بتاع
  هيكلها التنظيمي»: every department side by side at the top; choosing one draws its chart underneath.
- «مع إمكانية تعديل الهيكل التنظيمي للأقسام تحت الإدارات وللوظائف تحت الأقسام»: the sections under a
  department, and the jobs under a section, can be edited.
- «مش كل الإدارات فيها أقسام»: not every department has sections. When one has none, its jobs sit
  directly under it.
- «فى المسميات الوظيفية /organization/job-titles لا يوجد أى ربط بينها وبين الأقسام والإدارات …
  عايزك تضيفها»: job titles are linked to no department or section today, and the job form must gain
  that link.
- «لو عدلت أى حاجة فيها أو فى شارت الهيكل التنظيمي الأتنين يسمعوا فى بعض»: an edit made in the job
  form shows in the chart, and the other way round.

### 1.2 The four decisions

| # | Decision | Why |
|---|---|---|
| D-ORG3-1 | **Job places describe; they do not enforce.** Registration, transfer, promotion, requisitions, offers and applicant placement are unchanged: none of them checks a job against its places. A job may have several places, for example «سائق» (driver) under Movement and under Cash-in-transit. A job place carries **no headcount, seat, budget or vacancy**. | Enforcing places would make every current employee whose job sits elsewhere invalid, and would turn a description into a gate on hiring. A headcount would be the seat entity that ADR-030 forbids. |
| D-ORG3-2 | **The chart starts filled from reality, once.** Each job is placed where its holders sit: employees who have not exited, and accepted offers not yet hired. From then on, places are edited by hand. A department is filled only once, so a place a user removes is not put back (§7 gives the exact guarantee). | An empty chart means placing every job by hand: 147 titles in ADR-031's export of 2026-09-07. A fill on every start would undo users' edits. |
| D-ORG3-3 | **A section never moves to another department.** A section can be added, renamed or stopped. A section created under the wrong department is added again under the right one and the old one is stopped. People change section through the existing «نقل» (transfer) action. | A move changes the department of everyone in that section, in every branch at once. `UpdateSectionCatalogSchema` (`packages/contracts/src/platform/organization.ts`) does not allow it. |
| D-ORG3-4 | **A section added from the chart is created in the branches that have the department.** All of them are ticked at first, and any can be unticked, but at least one must stay ticked. | Employees are registered on their own branch's section row, so a section with no rows could not be chosen anywhere. |
| D-ORG3-5 | **A department or section added on its own page is linked to the company list when it is created** (§5.6), so it appears in the chart and can be edited there at once. The owner chose this when the review raised it: «أيوه، يتربط تلقائيًا» ("yes, link it automatically"). He was told that whoever holds that department "in every branch" will then reach the new branch's copy too. | Without it, every department or section added after release would be read-only in the chart until an operator ran `migrate:org-catalog`. |

### 1.3 Defaults proposed with the decisions

These were stated in the same proposal, and the owner's answer approved them.

- **No new permission keys.**
  - The page requires `department.view`.
  - Adding a section requires `section.create`. Renaming or stopping one requires `section.edit`.
  - Changing a job's places requires `jobTitle.edit`, or `jobTitle.create` while the job is being
    created. This holds both in the chart and in the form.
- **One tile per company department.** Branch rows are folded as `orgUnitGroupKeys` folds them for
  the crew card (`apps/web/src/modules/operations/components/CrewDepartmentsCard.tsx`).
- **Counts.** A tile shows how many sections and how many distinct jobs the department has, as in the
  approved sample. It shows no headcount: the owner said «متعملش حاجه زياده عن اللي قلتلك عليه» ("don't
  add anything beyond what I told you").
- **Behind the scenes.** Branch copies that are not linked to the company list are folded by name, so
  no department appears twice. No write links an existing row (§5.1); new rows are linked when they are
  created (D-ORG3-5, §5.6).

### 1.4 Not in this phase

- Moving a section between departments (D-ORG3-3).
- Enforcing places, warning when an employee placement lies outside its job's places, or headcounts
  (D-ORG3-1).
- Adding, renaming or stopping departments from the chart. The request covers sections under
  departments and jobs under sections; departments stay on `/organization/departments`.
- Linking existing unlinked rows to catalog entries. That remains the operator command of ADR-031
  (`migrate:org-catalog`), for the reason given in §5.1.
- From the chart: adding an existing section to more branches, or restarting a stopped section (§9).
- Changes to the job list page.

## 2. What the user sees

This section is the specification. The sample the owner approved illustrates it and is not kept in the
repository. Strings are given as Arabic / English. The Arabic is in the product's formal register, which
`scripts/check-formal-arabic.mjs` enforces in CI; the sample's colloquial wording is not used. New i18n
keys sit under `organization.chart.*`, and under `organization.jobTitles.places.*` for the job form.

### 2.1 The page `/organization/chart` («شجرة الهيكل التنظيمي» / "Org chart")

From top to bottom:

1. **`PageHeader`.**
   - Breadcrumbs: «الهيكل التنظيمي» / "Organization", then the page.
   - No description line: a page header carries no subtitle, an owner decision recorded in
     `apps/web/src/platform/layout/PageContainer.tsx` (the approved sample's line is not carried over).
   - Action: «تعديل الهيكل» / "Edit structure". It is shown to anyone who holds at least one of
     `section.create`, `section.edit` or `jobTitle.edit`. In edit mode it reads «إنهاء التعديل» /
     "Done editing".
2. **Tiles.** There is one tile for each shown department group (§4.2), sorted by name in the current
   language.
   - **Counts:** «{n} أقسام» / "{n} sections" (or «بدون أقسام» / "No sections") and «{n} وظائف» / "{n}
     jobs", where jobs means distinct jobs placed anywhere in the department.
   - **Look:** the selected tile uses the crew tile's selected style, in the crew card's grid, with one
     column on a phone.
   - **Name groups:** a name group's tile carries «غير مربوطة» / "Not linked" (§4.2).
   - **Selection in the URL:** `?dept=<group key>` (§0) holds the selection. A key that no tile has, or
     no key at all, selects the first tile. Keys do not change through anything this page does,
     because it links nothing (§5.1).
   - **Search:** with more than 7 tiles, a search box above them narrows by fold, as the crew card's box
     does.
3. **Chart `Card`.**
   - **Header:** «الهيكل التنظيمي لإدارة {name}» / "{name}: structure", followed by the counts.
   - **From `sm` up**, a top-down chart:
     - The department box shows «موجودة في {n} فروع» / "In {n} branches".
     - Under it, connector lines drawn with logical borders, so they mirror in RTL. The sections sit
       side by side below them, and each section's jobs form a column under it.
     - Jobs placed in the department but in no section form a first column, «تابعة للإدارة مباشرة» /
       "Directly under the department", drawn dashed. It appears when it has jobs, or in edit mode.
     - A department with no sections has its jobs directly under its box.
     - A chart wider than the card scrolls sideways inside it.
   - **Below `sm`:** the same content as an indented tree (department › section › job), drawn as
     `OrganizeApplicationsPage` draws its tree.
   - **Name groups:** a name group, whether a department or a section, is shown with «غير مربوط بقائمة
     الشركة، فلا يمكن تعديله من هنا.» / "Not linked to the company list, so it cannot be edited here."
4. **States.**
   - Loading: `LoadingState`.
   - Failure: the shared error state, with a retry.
   - No departments: `EmptyState` «لا توجد إدارات بعد» / "No departments yet", linking to the
     departments page for anyone who holds `department.create`.
   - A department with no sections and no jobs: «لا توجد وظائف في هذه الإدارة بعد» / "No jobs in this
     department yet".

The Organization home (`OrganizationOverview`) gains a shortcut to this page, beside the others in its
`SHORTCUTS`. It is shown to `department.view` holders, uses `SitemapIcon`, and reads «شجرة الهيكل
التنظيمي» / "Org chart", with the description «الإدارات وأقسامها ووظائفها في شجرة واحدة» / "Departments,
their sections and their jobs in one tree".

### 2.2 Edit mode

- **Banner:** «أنت في وضع التعديل. يُحفظ كل تغيير فور إجرائه.» / "You are editing. Each change is saved as
  you make it."
- **Saving:** there is no draft and no save button, as on `OrganizeApplicationsPage`.
  - One change is in flight at a time. The controls are disabled from the moment a change is sent until
    the chart in the cache reflects it (§6.1), so the next change always carries the current `version`.
- **Jobs.** These controls appear only on a catalog group, and only to someone holding `jobTitle.edit`.
  - **Drag:** each job has a ↕ grip. Dropping it on another section of the same department, or on
    «تابعة للإدارة مباشرة», moves it there. This uses native HTML5 drag-and-drop, as
    `OrganizeApplicationsPage` does, with no new dependency.
  - **«نقل إلى» / "Move to":** a `Select` of the same targets.
  - **«إزالة من هنا» / "Remove from here" (✕):** removes that job place. The job itself stays.
  - **«إضافة وظيفة» / "Add job":** under each section and under the direct column. It opens a `Dialog`
    with a `SearchableSelect` of active jobs.
    - Each option says where else that job sits: «موجودة أيضًا في: …» / "Also in: …".
    - A job that is already in that exact place is not offered.
- **Sections.**
  - **«إضافة قسم» / "Add section"** (`section.create`) sits beside the sections, on a catalog group
    only. It opens a `Dialog` with:
    - «الاسم بالعربية» / "Arabic name" and «الاسم بالإنجليزية» / "English name", both required (as
      `LocalizedStringSchema` requires);
    - «الفروع» / "Branches": the branches whose active row of the department is linked to its entry, all
      ticked. A branch where the department exists only as an unlinked row is listed disabled, with
      «الإدارة في هذا الفرع غير مربوطة بقائمة الشركة.» / "In this branch the department is not linked to
      the company list.";
    - the hint «يُنشأ القسم في الفروع المحددة.» / "The section is created in the ticked branches.";
    - «إضافة» / "Add", which is disabled while no branch is ticked.
  - **Two small buttons on a section's box** (`section.edit`) — the organize board's row actions; the
    shared UI has no menu component, and the one in the ATM module is that module's own:
    - «تغيير الاسم» / "Rename": a `Dialog` with both names.
    - «إيقاف القسم» / "Stop section": a confirming `Dialog` that says «سيتوقف عرض القسم للاختيار في كل
      الفروع، ويبقى الموظفون المسجلون فيه عليه.» / "The section stops being offered in every branch;
      the people in it keep it."
- **Errors** appear in the shared toast, with the messages in §5.5.

### 2.3 The job form and detail (`/organization/job-titles/*`)

- **Form.** A new `Card`, «مكانها في الهيكل التنظيمي» / "Place in the structure", sits between the
  identity card and the requirements card.
  - **Places:** each job place is a row reading «{department} › {section}» or «{department} › تابعة
    للإدارة مباشرة», with a ✕ to remove it. A place whose group is not shown (§4.2) is tagged «موقوف» /
    "Stopped".
  - **Adding:** an add row holds a department `SearchableSelect`, a section `SearchableSelect` and an
    «إضافة» / "Add" button. Both selects read from the chart endpoint (§4.4) and offer catalog groups
    only.
    - The section select lists «تابعة للإدارة مباشرة» first, then the department's sections.
    - Adding a place that is already listed does nothing.
  - **Saving:** the places are saved with the form's own «حفظ» / "Save", in the same request (§5.2).
  - **Errors:** `JOB_PLACE_NOT_ALLOWED` gets its own message (§5.5). The existing «duplicate code»
    message stays tied to `DUPLICATE`, which the job write still raises only for its code.
- **Detail.** A third `Card` shows the same rows, read-only. With no places it shows «لم تُحدَّد بعد» /
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
  "isDeleted": false, "deletedAt": "<Date> | null", "deletedBy": "<ObjectId users> | null",
  "createdBy": "<ObjectId users> | null", "updatedBy": "<ObjectId users> | null",
  "createdAt": "<Date>", "updatedAt": "<Date>", "__v": 0
}
```

- **Indexes:**
  - `ux_jobTitleId_departmentCatalogId_sectionCatalogId`: unique, partial on `isDeleted:false`.
  - `ix_departmentCatalogId`.
  - `ix_sectionCatalogId`.
- **Rules:**
  - The section entry belongs to the place's department entry. A section entry never changes its
    department.
  - A new place is written only for a job whose status after the write is active. A job made inactive
    keeps its places.
  - Nothing here counts, reserves or limits anything (D-ORG3-1).
  - `createdBy` is null when the fill (§7) wrote the place.
- **Why catalog entries, not rows:** "Operations" means Operations in every branch, including one that
  opens next year. Places held against rows would need one per branch, and none for a branch added
  later.

### 3.2 `job_title_place_fills`

```jsonc
{ "_id": "<ObjectId>", "departmentCatalogId": "<ObjectId department_catalog>", "at": "<Date>", "placed": 0 }
```

- **Index:** `ux_departmentCatalogId`, unique.
- **Meaning:** a row means that department has been filled (§7). `placed` is how many places the fill
  wrote for it.

### 3.3 Building the indexes

Production runs with `autoIndex` off. The platform's boot migrations therefore gain
`migrateJobPlaceIndexes()` in `platform/organization/job-places/job-place-indexes.ts`, called from
`platform/kernel/bootstrap.ts` right after `migrateOrgCatalogIndexes()`. It builds both collections'
indexes before any module seed runs, so the fill (§7) never runs without them. It follows
`org-catalog-indexes.ts`: idempotent, with a guard spec.

## 4. Reading the chart

### 4.1 Groups

- **Departments.** `orgUnitGroupKeys` runs over every department row that is not deleted, in any
  status. This is the population the function's own comment asks for, and the crew card passes the
  same. The function is not changed.
- **Sections.** The same function runs once per department group, over the section rows whose
  department row belongs to that group. Folding sections company-wide would merge one department's
  «الإدارة» with another's.
- **Job places.** A job place falls into the catalog group `catalog:<departmentCatalogId>`. When it has
  a `sectionCatalogId`, it falls into that department's section group `catalog:<sectionCatalogId>`.
  With none, it falls into the department's direct column.

### 4.2 Which groups are shown, and which can be edited

- **Shown:** a group is shown when at least one of its rows is active. A group whose rows are all
  inactive is stopped and is not shown.
  - A stopped group's places are hidden, not deleted.
  - Making a row active again (on the sections or departments page) brings back the same group, with
    its places. A catalog group's key is its entry, so the reactivated row lands in the same group:
    directly when it is linked, or by fold.
- **Editable:** a group that is shown, is a catalog group, and whose entry is active. Only an editable
  group takes new job places or section writes, subject to the keys in §1.3. "Stopped" in this design
  means not shown.
- **Read-only:**
  - A name group is read-only. It has no entry, so it cannot hold job places. Linking it is the
    operator's command (§5.1, §9).
  - A catalog group whose entry is inactive is read-only, with the reason «القسم أو الإدارة موقوفة في
    قائمة الشركة.» / "Stopped in the company list."
- **Entries without rows:** a catalog entry with no rows forms no group and is not shown.

### 4.3 Cost

- **What a read loads:** all department and section rows, both catalogs, the branches (for their
  names), the live job places and the active jobs.
- **Size:** on this deployment that is about 71 department rows (ADR-031), a few hundred section rows,
  147 jobs and a few hundred places. That is well under a megabyte, folded in memory, and costs one
  `find` per collection.
- **Where else it runs:** the same load backs `JobTitleDto.places` (§5.2). A page of jobs costs one such
  load, not one per job.
- **Caching:** there is no server cache.

### 4.4 `GET /api/v1/platform/org-chart`

- **Access:** `authorizeAny('department.view', 'jobTitle.view', 'jobTitle.create', 'jobTitle.edit')`.
  The chart page needs it, and so do the job form's selects (§2.3).
- **Reach:** the whole company, whatever the reader's data scope, because the request is for the whole
  company.
- **What it adds:** it returns each job's places and `version`, which before this design only
  `jobTitle.view` could read (`GET /platform/job-titles/:id`). That widening to `department.view` holders
  is deliberate, and ADR-038 records it.

```ts
OrgChartDto = {
  departments: {
    key: string;                       // the group key (§0)
    departmentCatalogId: string | null;
    editable: boolean;                 // §4.2
    name: { ar: string; en: string };  // the entry's name, else the group's oldest row's
    branches: { id: string; name: { ar: string; en: string } }[]; // branches with an active row
    linkedBranchIds: string[];         // branches whose active row is linked to the entry (§5.3)
    sections: {
      key: string; sectionCatalogId: string | null; editable: boolean;
      name: { ar: string; en: string };
      branches: { id: string; name: { ar: string; en: string } }[];
      catalogVersion: number | null;   // the section entry's __v; null for a name group
    }[];
  }[];
  jobs: {                               // every active job
    id: string; code: string; name: { ar: string; en: string }; version: number;
    places: { departmentCatalogId: string; sectionCatalogId: string | null; shown: boolean }[];
  }[];
};
```

- Each column on the chart is derived from `jobs`, so a job is sent only once.
- `shown` is false when the place's group is not shown (§4.2).

## 5. Writing

### 5.1 No write links a row

Nothing in this design sets `catalogId` on an existing row.

- **Why:** a department row's `catalogId` decides who can reach it. A role assignment over «a department
  everywhere» resolves to every row linked to that entry (`apps/api/src/platform/rbac/rbac.service.ts`,
  `resolveReach`). Linking an existing row would therefore widen other people's data access as a side
  effect of a job or section edit. It would also change the key that «مستندات الوظائف» (job papers)
  stores its lines under (`catalogId ?? row id`, in
  `apps/api/src/modules/hr/contracts/job-papers/job-papers.service.ts`), which would orphan those lines.
- **So:** linking existing rows stays the operator's deliberate act (`migrate:org-catalog`, ADR-031).
  Name groups stay read-only in the chart until it is run.
- **New rows:** these are linked when they are created (§5.6), under `department.create` and
  `section.create`. That is the keys ADR-031 already gives catalog writes, and the semantics ADR-031
  and ADR-032 intended: a branch that declares a department joins "that department everywhere".

### 5.2 Job places are saved with the job

There is one write path for job places: the job title's own create, update and delete. The chart uses it
as well.

- **Request:** `CreateJobTitleSchema` and `UpdateJobTitleSchema` gain an optional
  `places: { departmentCatalogId: string; sectionCatalogId: string | null }[]`, with at most 50 items.
  - The list is the whole set. Leaving it out means "unchanged", which is the rule the update already
    follows for every optional field.
  - Duplicates in the list are merged before anything else, both on the server and in the client's
    `chart-model.ts`, so a move onto a place the job already has becomes a removal of the moved place.
  - On update, `version` is required as it is today, so a stale form or chart gets `STALE_DOCUMENT`.
- **Create** inserts the job and then its places.
- **Update** compares the list with what is stored. It inserts the new places and soft-deletes the ones
  that are gone, in one transaction with the job's own update.
  - A new place must name an editable catalog group (§4.2), and a section entry that belongs to its
    department entry, for a job that is active after the write. Otherwise the request fails with
    `JOB_PLACE_NOT_ALLOWED` and the reason.
  - A place that is already stored may stay even when its group is stopped or read-only. That is how
    the form keeps the «موقوف» rows it was sent.
- **Delete** soft-deletes the job's places in the same transaction as the job.
- **`JobTitleDto`** gains `places`:
  ```ts
  places: {
    id: string;
    department: { departmentCatalogId: string; name: { ar: string; en: string } };
    section: { sectionCatalogId: string; name: { ar: string; en: string } } | null;
    shown: boolean;
  }[]
  ```
  - The names are the entries' own names.
  - `toDtos` fills `places` for a page with one load (§4.3), and every HTTP path already goes through
    `toDtos` or `toDtoNamed`.
  - The synchronous `toDto(doc, places)` now takes the places as an argument, so no caller can build a
    DTO with an empty list that does not mean empty.
  - `snapshot(doc, placeLabels)` takes the labels the same way.
- **From the chart,** each change is one `PATCH /api/v1/platform/job-titles/:id` carrying
  `{version, places}`: the job's current set from `jobs` (§4.4), with the one change applied (an add, a
  removal, or a move within the same department).
- **Catalog entries cited by places:** such an entry cannot be deleted. `OrgCatalogHooks` gains
  `hasPlaces(id)`, wired in `apps/api/src/platform/organization/index.ts` to count live places. A delete
  it blocks fails with its own code, `ORG_CATALOG_ENTRY_IN_USE` (409, "Jobs are placed in this entry").
  No screen deletes catalog entries, so the message is not translated.

### 5.3 Section writes from the chart

Each write below answers with the whole, fresh `OrgChartDto`.

| Write | Key | Body |
|---|---|---|
| `POST /api/v1/platform/org-chart/sections` | `section.create` | `{departmentCatalogId, name:{ar,en}, branchIds}`: 1–50 distinct ids |
| `PATCH /api/v1/platform/org-chart/sections/:sectionCatalogId` | `section.edit` | `{name:{ar,en}, version}` |
| `POST /api/v1/platform/org-chart/sections/:sectionCatalogId/stop` | `section.edit` | `{version}` |

`version` is the section entry's `catalogVersion` (§4.4). Every write is refused with
`ORG_UNIT_NOT_EDITABLE` unless its department group, and its section group where one is named, is
editable (§4.2).

**Add a section:**
1. Refuse the name when it clashes with a section of that department entry, in any status. A clash is
   an exact, case-insensitive match on the Arabic or English name, which is the section catalog's own
   rule. It is also any section group in the department group whose fold equals this name's fold. The
   refusal is `ORG_SECTION_NAME_TAKEN`.
2. For each ticked branch, find the department's active row in that branch that is linked to the
   department entry. A ticked branch without one refuses the whole request (`BRANCH_WITHOUT_DEPARTMENT`)
   before anything is written. This includes a branch where the department exists only as an unlinked
   row: a section row there could not name the new entry, so it would fold into the group by name only.
3. Create the section entry, with the next free `SEC-####` among section entry codes.
4. For each ticked branch, create one section row under that department row:
   - **Name:** the entry's name.
   - **Code:** its own next free `SEC-####` among section row codes. Codes minted in one request are
     reserved in memory, so no two collide.
   - **`catalogId`:** the new entry. Every chosen department row is linked (step 2), so every new
     section row can name it.
   - **`branchId`, `departmentId`, `path`:** built by `sectionRowFields` (§5.4).

**Rename:**
1. Apply the same clash rule as Add, against the department's other sections.
2. Rename the section entry.
3. Rename every row of the section group, linked or not. The unlinked members would otherwise stop
   folding with the group and split away from it.

**Stop:**
1. Set every active row of the section group to inactive. The section entry stays active, so the
   section can come back: a row made active again on the sections page brings the group back editable,
   with its places. A row created again under that name links to the same entry (§5.6).
2. The audit entry lists the rows this stop deactivated.
3. Job places are kept (§4.2).

**Scope.** These writes, like every org-unit write today, are checked by key and not by branch.
`apps/api/src/platform/organization/shared/org-unit.http.ts` passes no scope to create or update.
§9 lists this as a risk.

### 5.4 Transactions, reads and audit

- **One transaction, load first.** Each write in §5.2 and §5.3 runs in one `unitOfWork`. The first thing
  it does is load what it needs through the transaction's `session`: the catalog entries, rows, codes,
  the job and its places (`Model.find(...).session(session)`). It then works out every document to write
  in memory, using pure functions. Nothing re-reads its own uncommitted writes.
  - The writes go through `create` (which accepts `session`) and through `updateMany` /
    `findOneAndUpdate` with `session`.
  - Linked-name updates use `updateMany` without raising the rows' `__v`, as
    `departmentRepository.renameByCatalog` already does, so an open department or section form is not
    made stale by a chart rename.
- **Shared pure rules.** None of these writes calls `OrgCatalogService` or `OrgUnitService`, because
  those take no session and audit inline. They share the same rules as pure functions instead:
  - **`sectionRowFields(department, entryId, id)`** in
    `apps/api/src/platform/organization/sections/section-row.ts` returns `branchId`, `departmentId`,
    `catalogId` and `path`. `section.service.ts` keeps its reads, its checks and its own
    `name: catalog.name` line (`org-catalog-guards.spec.ts` pins it), and calls this function for the
    rest.
  - **`catalogNameClash(name, entries)`** in `shared/org-catalog-names.ts` is the exact,
    case-insensitive ar/en match. The catalog services keep their database query, which applies the
    same rule. A spec feeds both the same cases.
  - **`nextFreeCode(prefix, taken)`** moves from `apps/api/src/workforce-import/org.ts` to
    `platform/organization/shared/next-free-code.ts`, exported from the `platform/organization` barrel.
    `workforce-import/org.ts` imports it from there and re-exports it, so `org.spec.ts` keeps its import.
    The importer imports it from there, through the
    `platform/organization` barrel.
- **Audit after commit.** The `unitOfWork` callback returns the audit entries and events it built, so a
  retry rebuilds them. After commit they are written with `auditService.recordMany`, and the
  `OrgUnitChanged` events are emitted. This is the order `employee.service.ts` keeps around its own
  `unitOfWork`. A rolled-back write leaves no audit row and sends no realtime signal.

  | Change | Entity | Action | `changes` |
  |---|---|---|---|
  | A job's places | `platform.jobTitle` | `update` (`create` / `delete` with the job) | `places` as sorted labels before and after, e.g. «العمليات › الخزينة» |
  | A new section entry / row | `platform.sectionCatalog` / `platform.section` | `create` | |
  | A rename | `platform.sectionCatalog`, plus each unlinked row renamed | `update` | `name`; `linkedUnitsRenamed` on the entry, as today |
  | A stop | `platform.sectionCatalog`, plus each row it deactivated | `update` | `status` |
  | The fill (§7) | `platform.jobTitle` | `update`, actor `{userId:null}` | `places` |

  Events keep their payloads: `jobTitle`/`updated` for places, and `section`/`sectionCatalog` for the
  rest.

### 5.5 Errors

The new codes are specific, so the client can tell them apart without reading message text. The
existing `DUPLICATE` and `BUSINESS_RULE_VIOLATION` keep their meanings.

| Code | HTTP | When | Message (ar / en) |
|---|---|---|---|
| `ORG_UNIT_NOT_EDITABLE` | 422 | A section write whose department or section entry has no editable group: no active rows, or an inactive entry (§4.2) | «لا يمكن تعديل هذه الإدارة أو هذا القسم من هنا: غير مربوط بقائمة الشركة أو موقوف فيها.» / "This unit cannot be edited here: it is not linked to the company list, or is stopped in it." |
| `ORG_SECTION_NAME_TAKEN` | 409 | §5.3 step 1 | «يوجد قسم بهذا الاسم في هذه الإدارة.» / "This department already has a section with this name." |
| `BRANCH_WITHOUT_DEPARTMENT` | 422 | §5.3 step 2 | «الإدارة غير موجودة أو غير مربوطة بقائمة الشركة في أحد الفروع المحددة.» / "In one of the ticked branches the department does not exist, or is not linked to the company list." |
| `JOB_PLACE_NOT_ALLOWED` | 422 | §5.2: a new place whose entry has no editable group, for an inactive job, or with a section outside its department | «لا يمكن وضع الوظيفة في هذا المكان: الوظيفة أو القسم موقوف، أو القسم لا يتبع هذه الإدارة.» / "The job cannot be placed here: the job or the section is stopped, or the section is not in this department." |
| `STALE_DOCUMENT` | 409 | A job or section entry `version` that is not current | (shared: refresh and retry) |
| `NOT_FOUND` | 404 | A well-formed id that names no job, or a section write's id that names no section entry | (shared) |
| `ORG_CATALOG_ENTRY_IN_USE` | 409 | Deleting a catalog entry that job places cite (§5.2) | "Jobs are placed in this entry" (no screen deletes entries) |
| `VALIDATION_FAILED` | 400 | A malformed id or body | (shared) |
| `FORBIDDEN` | 403 | The key from §1.3 is missing | (shared) |

### 5.6 New rows are linked when they are created (D-ORG3-5)

A create through `department.service.ts` or `section.service.ts` that names no `catalogId` gains one
step, **after** the row is created as it is today. The order matters: if the step fails or refuses, the
result is exactly today's unlinked row, never an entry without its row.

1. **The row is created** by the existing path, unlinked, as today.
2. **Find the entry**, in one `unitOfWork` loading through its session. For a department, the scope is
   the company's department entries. For a section, it is the section entries of its department row's
   entry. Within the scope, find the **active** entries whose name folds like the row's: Arabic, else
   English (the `orgUnitGroupKeys` rule).
3. **Decide:**
   - **Leave the row unlinked, as today**, when any of these holds:
     - two or more entries match;
     - the branch (for a section, the department row) already has a live row linked to the match;
     - a **live unlinked row** of that name already exists in scope, other than the new one. That group
       stays with the operator command, which must not find an entry it did not plan (ADR-031).
     - (a section only) its department row is unlinked, or its department entry is inactive, which
       the section catalog's create path also refuses;
     - an entry of any status has exactly the same Arabic or English name (the catalog's own clash
       rule, `catalogNameClash`), while none folds the same;
     - anything in the step fails. The failure is logged at warn level.
   - **One match:** set the row's `catalogId` to it. The row keeps the name it was given, which already
     folds like the entry's.
   - **No match:** create an entry with the row's name and the row's code, then set the row's
     `catalogId`. The row has just claimed that code among rows. If an entry already holds it, `ux_code`
     refuses the insert and the step falls back to the unlinked row. For a
     new **department** entry, also insert its fill mark (§7) with `placed: 0`: a department that
     exists from this moment has nobody in it to fill from.
4. **Audit after commit,** through `recordMany`:
   - `platform.department` / `platform.section` `update` with `catalogId`;
   - when an entry was created, `platform.departmentCatalog` / `platform.sectionCatalog` `create`.

   The create's answer is the row as it stands after this step.

**Who is affected.** `OrgUnitService.create` gains an optional `afterCreate` hook; only these two
services set it. The importer passes `catalogId`, so this step is skipped for it. The seeds create
through the services, so a fresh install's departments start linked, which is ADR-031's intent. Specs
that create rows without `catalogId` and assert `catalogId: null` change with it (§10 Step 4 lists
them).

**Why this need not be one transaction with the row, while §5.3 must be.** Add section writes an entry
and a row in each of N branches. Half of that would leave a section that exists in some branches, a
state no screen can repair. Here the only half-state is the row without its link, and that is the
state every row was in before this design.

## 6. Keeping the chart and the job form in step

### 6.1 In the same browser

The chart's query key is `['organization','org-chart']`.

- **A section write** puts its answer into that key. It then invalidates `['organization','sections']`
  and `['organization','departments']`.
- **A job write** (create, update or delete, from the chart or the form):
  - patches the chart in the cache from the answer: the job's `version` and `places` in `jobs`;
  - re-enables the chart's controls;
  - then invalidates `['organization','org-chart']`, `['organization','jobTitles']` and
    `['organization','job-titles']` (the pickers).

### 6.2 Across users

- **Who is sent what.** The audit row announces its topic to the holders of that topic's key
  (`apps/api/src/platform/realtime/realtime-registry.ts`):
  - `platform.jobTitle` is sent to `jobTitle.view` holders.
  - `platform.section` and `platform.sectionCatalog` are sent to `organization.view` holders.
- **Today's gap.** The web rows for those topics
  (`apps/web/src/platform/realtime/invalidation-registry.ts`) invalidate `['org', …]` and
  `['platform','organization']`. No `/organization/*` query starts with either, so today another user's
  edit refreshes nothing there.
- **The fix.** The rows gain the organization module's keys and keep their current entries. No server
  topic is added.
  - `platform.jobTitle` gains `['organization','jobTitles']`, `['organization','job-titles']` and
    `['organization','org-chart']`.
  - `platform.section` and `platform.sectionCatalog` gain `['organization','sections']` and
    `['organization','org-chart']`.
  - `platform.department` and `platform.departmentCatalog` gain `['organization','departments']` and
    `['organization','org-chart']`.
- **Without the topic key.** A user who lacks the topic's key sees the change on their next load.

## 7. The one-time fill

**Exported function** (from `platform/organization/index.ts`):

```ts
fillJobPlacesFromHolders(
  readHolders: () => Promise<{ departmentId: string; sectionId: string | null; jobTitleId: string }[]>,
): Promise<{ departments: number; placed: number; skipped: number } | null>
```

It returns `null` when there was nothing to do.

1. **Where:** HR's seed (`apps/api/src/modules/hr/hr.seed.ts`), directly after `await
   migrateEmployeeFiles();`.
   - The call is wrapped in a `try/catch`, as `migrateExternalEmployeeNumbers` is, so the start
     continues.
   - It logs `{departments, placed, skipped}` at info level.
   - A lost race (below) is logged at info. Any other failure is logged at error level, because a fill
     that never commits leaves the chart empty.
   - The platform may not read HR (`eslint.config.js` boundaries), so HR passes the reader.
2. **What still needs filling:**
   - Find the department entries with an active row and no mark in `job_title_place_fills`.
   - With none, return `null` without calling `readHolders`. That is every start after the first.
3. **Read:** `readHolders` returns the distinct triples from two sources.
   - **Employees** whose status is not `exited`, from `employment.departmentId`,
     `employment.sectionId` and `employment.jobTitleId`. This is a new
     `employeeRepository.jobUnitsHeldSystem()`, beside `jobsByDepartmentSystem()`. That one stays as
     it is, because «مستندات الوظائف» groups by department only.
   - **Offers** that are `accepted`, not hired, and have `supersededAt: null`, taking
     `acceptedSnapshot.terms.*` first and `terms.*` otherwise. This is a new
     `jobOfferRepository.jobUnitsAcceptedSystem()`. The existing `acceptedJobsByDepartment()`, which
     lacks the `supersededAt` filter, is left for its own owner (§9).
4. **Departments already edited.** A department entry that already has any `job_title_places` row,
   live or deleted, has been edited by hand. It gets its mark with `placed: 0` and nothing is inserted
   for it, so the users' edits win. That is the case for an entry the operator linked while the server
   was running, if someone edited it before the next start.
5. **Resolve each triple.**
   - It is **skipped** (counted in `skipped`, one per distinct triple) when:
     - the department row is gone;
     - the department row is in a name group;
     - the row's department entry is already marked;
     - the job is inactive or gone.
   - Otherwise it becomes a place in the department group's entry. The section narrows it only when
     the section row is still in that department group and its group is a catalog group. Otherwise the
     job goes directly under the department.
   - **The cap.** A job whose stored places plus its new ones would pass `JOB_PLACES_MAX` (50, the
     contract's cap on `places`) gets none from the fill: its triples are counted in `skipped` and a
     warning is logged. The fill never stores a set the job's own update would refuse back.
6. **Write, in one transaction.** Step 2 runs inside the transaction callback, reading through its
   session. Then:
   - insert one mark per department entry from step 2 **first**, including the ones that will receive
     nothing;
   - then insert the places that are not already stored.

   Either everything commits or nothing does.
   - **Indexes:** before step 2, the function checks that `ux_departmentCatalogId` exists
     (`listIndexes`). If the boot index step (§3.3) failed to build it, the fill logs an error and does
     not run.
   - **Racing processes:** every `bootPlatform` caller runs the seed: the API, the worker and the CLIs.
     When two race, the marks collide first. Either `withTransaction` retries on the write conflict,
     and step 2 then finds the marks and returns `null`, or the insert fails with a duplicate key. The
     fill treats any duplicate-key error as the lost race and logs it at info.
7. **Audit:** after commit, one `update` entry for each job that gained places, through `recordMany`.
   It records the job's whole set before and after, as the job's own update does.

**What is guaranteed:**
- **Once per department.** A department is filled once: at the first start where it has an active
  catalog group, which on release day is every linked department. A place a user removes from a
  department that has been filled is never put back.
- **Departments linked later.** A department entry that first gains an active row later (the operator
  links a group that had no entry) is filled at the next start, from whoever sits in it by then, unless
  its places were already edited (step 4). Rows linked later to an entry that is already marked add no
  places. A department
  created after release is marked when its entry is created (§5.6), because nobody sits in it yet.
- **Failed fills.** A failed fill writes nothing, and the next start tries again. A department edited by
  hand before its fill commits keeps those edits (step 4).

## 8. Alternatives considered

| Choice | Alternative | Why not |
|---|---|---|
| Link nothing on write; name groups read-only (§5.1) | Link a group's rows on the first write that needs them | Linking an existing department row widens every «department everywhere» role assignment to it (`resolveReach`), and orphans its job-paper lines. Either would be a side effect of a job or section edit. |
| Link new rows when they are created (§5.6) | Leave the forms as they are | Every department added after release would be a read-only name group in the chart until the operator ran the command again. |
| One write path for places, the job's own (§5.2) | `POST`/`PATCH`/`DELETE /org-chart/places` | That would give two write paths with two concurrency rules, while the job update already checks `version` and is audited. |
| Chart section writes through repositories, in one transaction, sharing pure rules (§5.4) | Thread `session` and deferred audit through `OrgUnitService`, `OrgCatalogService` and their hooks | Wider change for the same outcome. The services' hooks read without a session, so each would need rework. The rules that must match are shared as pure functions, under a spec. |
| A fill per department, at start-up, in one transaction (§7) | One global mark | A department linked after the first start would never be filled. |
| A fill at start-up (§7) | An operator command | The fill only writes job places, from facts the system already holds. If the command were never run, the chart would stay empty, which is the outcome D-ORG3-2 rejected. |

## 9. Risks and limits

| Risk / limit | Effect | Mitigation |
|---|---|---|
| **Unlinked legacy departments** | A department with no catalog entry is shown read-only and is not filled. | Run ADR-031's `migrate:org-catalog`, dry run first. Its linking is the deliberate access change §5.1 describes, and the next start fills the departments it links. Whether production has any such departments is visible on the chart (the «غير مربوطة» tiles) on release day. |
| **Branch scope is not checked on writes** (§5.3) | A branch-scoped holder of `section.create` can add a section in other branches. | The same holds for every org-unit write today. Narrowing org writes by scope is a separate change for the whole module. |
| **Two users add the same section at once** | The clash check reads before it writes, so two entries with one name can appear. | Rare, with one screen and few editors. It is fixed by stopping one of them. A unique folded-name index on `section_catalog` is the follow-up if it happens. |
| **Places can drift from where people sit** (D-ORG3-1) | The chart can say a job is in Treasury while its holder is registered in Counting. | None, by design. A report of such differences would be a separate request. |
| **«مستندات الوظائف» shows a different list.** Job papers list the jobs people **hold** in each department. | The two HR screens can list different jobs for one department. | They answer different questions: what papers to print for the jobs held there, and which jobs belong there. Making the popup read places is a separate request. Its reader's missing `supersededAt` filter is also left to that feature. |
| **A section added later in another branch** | The chart has no «add to branch». | A branch added later gets its section rows from the sections page. With §5.6 they are linked at creation, so they join the group. |
| **A stopped section is restarted one row at a time** on the sections page, and places do not follow D-ORG3-3's add-and-stop workaround. | Restarting takes one edit per branch. A new section starts with no places. | Stop leaves the section entry active (§5.3), so each restarted row brings the group back editable, with its places. Stop's audit entry lists the rows it deactivated. |
| **Realtime reach** (§6.2) | Some users see others' edits only on their next load. | Topic keys are unchanged. |

## 10. Delivery plan

One PR carries these documents and the code, as was done for ADR-036 and ADR-037. After each step,
`npm run typecheck`, `npm run lint`, `npm test` and `node scripts/check-formal-arabic.mjs` must pass.

**Step 1: documents and review.** Record §11, then set ADR-038 to Accepted.

| File | Change |
|---|---|
| `docs/12-planning/org-chart-design.md` | Create (this file) |
| `docs/03-decisions/ADR-038-job-titles-placed-in-the-structure.md` | Create |
| `docs/03-decisions/README.md` | Modify: the ADR-038 row (added as Proposed with the draft, set to Accepted with §11), the ADR-029 row the index lacked, and a "superseded in part by ADR-038" note on ADR-031's row |
| `docs/02-architecture/organization-structure.md` | Modify. In its §2, add that job titles carry job places keyed on the catalog. In its §7.4, name `job_title_places` as the many-to-many link. In its §3, list the chart page. |
| `docs/05-database/database-design.md` | Modify: add `job_title_places` and `job_title_place_fills` beside the catalogs, and add to the catalog paragraph that new rows are linked at creation (§5.6). |

**Step 2: contracts and the read endpoint.** The read endpoint and `places` arrive together, so the build
stays green.

| File | Change |
|---|---|
| `packages/contracts/src/platform/org-chart.ts`, `org-chart.spec.ts` | Create: `JobPlaceInputSchema`, `AddChartSectionSchema`, `RenameChartSectionSchema`, `StopChartSectionSchema`, `OrgChartDto`, `JobTitlePlaceDto` |
| `packages/contracts/src/platform/organization.ts` | Modify: `places` on `CreateJobTitleSchema`, `UpdateJobTitleSchema` and `JobTitleDto`; point the job-titles comment to ADR-038 |
| `packages/contracts/src/errors/index.ts` | Modify: add `ORG_UNIT_NOT_EDITABLE`, `ORG_SECTION_NAME_TAKEN`, `BRANCH_WITHOUT_DEPARTMENT`, `JOB_PLACE_NOT_ALLOWED` |
| `packages/contracts/src/index.ts` | Modify: export `org-chart.ts` |
| `apps/api/src/platform/organization/job-places/job-place.model.ts`, `job-place-fill.model.ts`, `job-place-indexes.ts`, `job-place-indexes.spec.ts`, `index.ts` | Create (§3) |
| `apps/api/src/platform/kernel/bootstrap.ts` | Modify: call `migrateJobPlaceIndexes()` (§3.3) |
| `apps/api/src/platform/organization/org-chart/org-chart.load.ts` | Create: the load (§4.3), plain or with `session` |
| `apps/api/src/platform/organization/org-chart/org-chart.groups.ts`, `org-chart.groups.spec.ts` | Create: the pure groups, shown and editable states, and the DTO (§4) |
| `apps/api/src/platform/organization/org-chart/org-chart.controller.ts`, `org-chart.routes.ts`, `index.ts` | Create: the `GET` (§4.4) |
| `apps/api/src/platform/organization/job-titles/job-title.service.ts` | Modify: `toDtos` fills `places` from the load; `toDto(doc, places)` |
| `apps/api/src/platform/organization/index.ts` | Modify: export the org-chart router |
| `apps/api/src/app.ts` | Modify: mount `/platform/org-chart` |
| `apps/api/tests/integration/org-chart.spec.ts` | Create: the read cases below |

**Step 3: job places on write.**

| File | Change |
|---|---|
| `apps/api/src/platform/organization/job-titles/job-title.service.ts` | Modify: create, update and delete in `unitOfWork` with places. Inside the callback the place writes go first and the job's own `updateById` with `version` last, so a stale version rolls the places back. `snapshot(doc, labels)`; audit after commit (§5.2, §5.4). |
| `apps/api/src/platform/organization/job-places/job-place.repository.ts` | Create: the session-aware place reads and writes (`insertMany`, soft-delete by ids). They live here because `job-defaults-guards.spec.ts` forbids `updateMany` in `job-title.service.ts`. |
| `apps/api/src/platform/organization/index.ts` | Modify: wire `hasPlaces` (§5.2) |
| `apps/api/src/platform/organization/shared/org-catalog.service.ts` | Modify: the optional `hasPlaces` hook; `softDelete` refuses with `ORG_CATALOG_ENTRY_IN_USE` |
| `apps/api/tests/integration/org-chart.spec.ts` | Modify: the job-place cases |

**Step 4: section writes and linking at creation.**

| File | Change |
|---|---|
| `apps/api/src/platform/organization/sections/section-row.ts`, `section-row.spec.ts` | Create: `sectionRowFields` |
| `apps/api/src/platform/organization/sections/section.service.ts` | Modify: build through `sectionRowFields`; linking at creation (§5.6) |
| `apps/api/src/platform/organization/departments/department.service.ts` | Modify: linking at creation (§5.6) |
| `apps/api/src/platform/organization/shared/org-catalog-names.ts`, `org-catalog-names.spec.ts` | Create: `catalogNameClash`, checked against both catalog services' rule |
| `apps/api/src/platform/organization/shared/next-free-code.ts` | Create: moved |
| `apps/api/src/workforce-import/org.ts` | Modify: import `nextFreeCode` from the barrel and re-export it (its spec imports it from `./org`) |
| `apps/api/src/platform/organization/index.ts` | Modify: export `nextFreeCode` and `sectionRowFields` |
| `apps/api/src/platform/organization/shared/org-unit.ts` | Modify: the optional `afterCreate` hook (§5.6) |
| `apps/api/tests/integration/org-catalog.spec.ts`, `apps/api/tests/integration/operations-crew-departments.spec.ts` | Modify: rows that stand for "never linked" legacy data are inserted through the model (`DepartmentModel.create` / `SectionModel.create`), as `org-catalog.spec.ts` already inserts employees, because the services now link at creation (§5.6) |
| `apps/api/src/platform/organization/org-chart/org-chart.sections.ts` | Create (§5.3, §5.4) |
| `apps/api/src/platform/organization/org-chart/org-chart.routes.ts`, `org-chart.controller.ts` | Modify: the three writes |
| `apps/api/tests/integration/org-chart.spec.ts` | Modify: the section and creation-linking cases |

**Step 5: the fill and navigation.**

| File | Change |
|---|---|
| `apps/api/src/platform/organization/job-places/job-place-fill.ts` | Create: `fillJobPlacesFromHolders` (§7) |
| `apps/api/src/platform/organization/index.ts` | Modify: export it |
| `apps/api/src/modules/hr/employee-management/employees/employee.repository.ts` | Modify: `jobUnitsHeldSystem` |
| `apps/api/src/modules/hr/recruitment/job-offers/job-offer.repository.ts` | Modify: `jobUnitsAcceptedSystem` |
| `apps/api/src/modules/hr/hr.seed.ts` | Modify: the call, after `migrateEmployeeFiles()` |
| `apps/api/src/seed-navigation.ts` | Modify: add an Organization row after «الوظائف»: «شجرة الهيكل التنظيمي» / "Org chart", `/organization/chart`, `department.view`, icon `sitemap` |
| `apps/api/src/seed-navigation.spec.ts`, `apps/api/tests/integration/auth-seed-login.spec.ts` | Modify: the pinned row count goes up by one |
| `apps/api/tests/integration/org-chart.spec.ts` | Modify: the fill cases |

`sync-indexes.models.ts` needs no change: the new models are reached from `./app`.

**Step 6: web.**

| File | Change |
|---|---|
| `apps/web/src/modules/organization/org-chart/org-chart-api.ts`, `org-chart-queries.ts` | Create (§6.1) |
| `apps/web/src/modules/organization/org-chart/lib/chart-model.ts`, `chart-model.spec.ts` | Create: columns from `jobs`; move targets; the `places` set for one change, with duplicates merged; `?dept` fallback |
| `apps/web/src/modules/organization/org-chart/pages/OrgChartPage.tsx` | Create (§2.1) |
| `apps/web/src/modules/organization/org-chart/components/DepartmentTiles.tsx`, `ChartBoard.tsx`, `ChartTree.tsx`, `AddSectionDialog.tsx`, `RenameSectionDialog.tsx`, `StopSectionDialog.tsx`, `AddJobDialog.tsx` | Create (§2.1, §2.2) |
| `apps/web/src/modules/organization/org-chart/pages/OrgChartPage.spec.tsx` | Create: tiles and chart drawn from a fixture; a department without sections; a name group shown read-only; an unknown `?dept`; edit controls hidden without `section.create`, `section.edit` and `jobTitle.edit`; controls disabled while a change is in flight; the phone tree |
| `apps/web/src/modules/organization/routes.tsx`, `pages/OrganizationOverview.tsx` | Modify: the `chart` route behind `department.view`; the shortcut (§2.1) |
| `apps/web/src/modules/organization/job-titles/components/JobPlacesField.tsx`, `JobPlacesField.spec.tsx` | Create (§2.3). Spec: the section list follows the department, the direct choice comes first, add and remove, a duplicate is ignored, and a stopped place is kept on save. |
| `apps/web/src/modules/organization/job-titles/pages/JobTitleFormPage.tsx`, `JobTitleDetailPage.tsx`, `job-title-queries.ts`, `job-title-api.ts` | Modify (§2.3, §6.1). The header comments point to ADR-038. |
| `apps/web/src/platform/realtime/invalidation-registry.ts` | Modify (§6.2) |
| `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` | Modify: `OrgChartPage.tsx` is NOT_FILTER_CAPABLE (as `CrewDepartmentsPage` is): `?dept` is which department is open, not a filter, and the tile search is local |
| `apps/web/src/platform/localization/i18n.ts` | Modify: the strings of §2 and §5.5 |
| `apps/api/src/platform/organization/job-titles/job-title.model.ts`, `apps/api/src/modules/hr/employee-management/employees/employee.repository.ts` | Modify: the comments that say titles are linked to no unit point to ADR-038 |

**Step 7: `CHANGELOG.md`**, under Unreleased › Added. Entry: "**Organization: the company org chart, and
where each job sits** (P-ORG-3, ADR-038)". It quotes the owner's request, then lists the page, job places
on the form, the one-time fill, linking at creation and the realtime fix.

**Integration cases** (`apps/api/tests/integration/org-chart.spec.ts`):
- **Read (Step 2)**
  - Seven branch rows fold into one department.
  - Section groups stay inside their department; the same section name under two departments makes two
    groups.
  - A stopped group is hidden, and its places come back with `shown:false`.
  - A name group is `editable:false`.
  - A user with only `jobTitle.edit` can read the chart. An anonymous user gets 401.
- **Job places (Step 3)**
  - Create with places, and the job's detail lists them.
  - An update replaces the set. An update without `places` keeps it.
  - Duplicates in a request are merged, and a move onto an existing place leaves one.
  - A stale `version` gets `STALE_DOCUMENT`.
  - A stopped place that is sent back survives.
  - These each get `JOB_PLACE_NOT_ALLOWED`: a new place in a stopped group, under an entry with no rows, with a
    section from another department, or on an inactive job.
  - Without `jobTitle.edit`, 403.
  - Delete removes the places.
  - A department entry with places cannot be deleted, and the message names jobs.
  - The audit shows the place labels.
  - An update with new places and a stale `version` gets `STALE_DOCUMENT`, and leaves no place and no
    audit row (the job's own write is last in the transaction).
- **Sections (Step 4)**
  - Three of four branches make three linked section rows with distinct codes.
  - A branch where the department row is unlinked gets `BRANCH_WITHOUT_DEPARTMENT`.
  - `ORG_SECTION_NAME_TAKEN` on a fold match and on an exact English match.
  - `BRANCH_WITHOUT_DEPARTMENT`, with nothing written.
  - `ORG_UNIT_NOT_EDITABLE` under a department entry whose rows are all inactive, and under an inactive
    entry. Unlinked fixtures are inserted through the model (§5.6).
  - Without `section.create`, 403.
  - Rename reaches linked and unlinked rows alike, and gets `ORG_SECTION_NAME_TAKEN` on a sibling's fold.
  - Stop lists the rows it deactivated and keeps the places.
  - A stale `version` gets `STALE_DOCUMENT`.
- **Linking at creation (Step 4)**
  - A department created through the API with a name an entry already has is linked to that entry.
  - A new name creates an entry. Two matching entries leave the row unlinked.
  - The same applies to sections, scoped to the department's entry.
- **Fill (Step 5)**
  - Holders' places are written, sections included.
  - Exited employees, superseded offers, inactive jobs and name groups are skipped and counted.
  - A section row outside its department's group falls back to the direct column.
  - A second run does nothing, even after a place is removed.
  - A department that becomes linked later is filled on the next run.
  - Two concurrent runs: one commits and the other reports the lost race.

## 11. Review

**2026-11-17, Full preset** (`.claude/skills/design-review`), on three drafts of this document and
ADR-038.

**Reviewers.** Every reviewer ran as its own `egm-*` subagent; none needed the fallback.
- **Round 1, first draft:**
  - A: zoom-out
  - B: comprehension
  - C: design, structural, style
- **Round 2, second draft:**
  - D: zoom-out
  - E: implementation readiness, codebase details, style
- **Round 3, third draft:** the one re-run each stage allows.
  - D: zoom-out
  - E: implementation readiness and codebase details, combined into one reviewer
- **Timing.** D and E ran in parallel each time, not one after the other. D's fixes did not touch the
  delivery plan that E reads.
- **Working files.** Kept in the session scratchpad, outside the repository.

**What changed the design:**
- **Linking existing rows was dropped (round 2 into round 3).** Round 1 found that an entry created
  without linking its rows breaks `migrate:org-catalog` (a Blocker). The fix then tried was to link a
  group's rows on the first write that needs them. Checking that against `rbac.service.ts`
  `resolveReach` showed that linking an existing department row widens every «department everywhere»
  role grant to it. It also re-keys the department's lines in «مستندات الوظائف». So no write links an
  existing row (§5.1). Unlinked groups are read-only, and new rows are linked when created (§5.6).
- **New rows linked when created.** This changes what the departments and sections pages do. The owner
  was asked in Arabic, with the access effect explained. His answer, «أيوه، يتربط تلقائيًا», is
  D-ORG3-5. That makes it the review's one escalation.
- **One write path for job places**, the job's own save (§5.2), replacing three endpoints of their own.
- **Transactions load first through the session and plan in memory.** Round 2 found reads that could
  not see the transaction's own writes, a Blocker (§5.4).
- **The fill is per department, in one transaction, marks first** (§7):
  - a department linked later is filled at its next start;
  - hand edits are never overwritten;
  - a lost race is a duplicate key or a retry.
- **Indexes are built at boot** (§3.3), because `autoIndex` is off in production.
- **Specific error codes** (§5.5), and formal Arabic strings.
- **The realtime registry rows gain the organization module's keys** (§6.2). The review found that
  today's rows match no `/organization/*` query.
- **Stop leaves the section entry active** (§5.3), so a restarted section is editable again.

**Findings by outcome.**
- **Merged** across rounds into about 120 distinct findings.
- **Fixed** in the document: about 95. Each round's fixes came before the next round.
- **Contested,** with evidence in the code (3):
  - "reuse `jobsByDepartmentSystem` for the fill": job papers group it by department only, so a section
    key would change that screen (§7 step 3);
  - "a single global fill flag is enough": departments linked later would never fill (§8);
  - "`sync-indexes.models.ts` must register the models": they are reached from `./app` (§10 Step 5).
- **Accepted,** recorded and not changed: the remaining nits about wording a zero-context reader needs,
  such as glossing every P-code.
- **Declined:** implementation detail in the high-level sections (class names, method names). They stay
  where they help the implementer.
- **Dropped under the skill's rule (d):** none. Every claim about existing code that a reviewer raised
  was checked against the code. Where the code disagreed with the document, the document was fixed.
- **Open:** none. The duplicate-name race when two users add one section at once is recorded as a
  limit in §9, with its follow-up.
