# ADR-031: A department is defined once for the company and declared per branch

**Status:** Accepted · **Date:** 2026-09-07 · **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (the Branch → Department → Section hierarchy),
[ADR-017](ADR-017-platform-identity-and-access-control.md) (hierarchical data scopes),
[ADR-004](ADR-004-permission-based-authorization.md) (what a scope filters on)

## Context

A Department is created **under** a Branch. Seven branches later, «العمليات» exists seven times as
seven unrelated records that merely share a word, and the company-wide dropdown offers it six times
with nothing to tell the copies apart. The owner's report was exact: *"the departments, sections and
job titles are duplicated… they should be defined for the whole company, and I say which branches
have which"*.

The duplication is not an accident of data entry. The workforce importer keys a department by
`(branch, folded name)` and a section by `(department, folded name)`, so the same words typed against
seven sites become seven units by design (`workforce-import/org.ts`). Job titles were keyed by name
alone and are already one company-wide list — the production export confirms it: 147 titles, 147
distinct names.

The obvious fix — collapse the seven rows into one — is the dangerous one, and this ADR exists mostly
to write down why.

**`departments._id` is a data-scope axis.** A user holding a permission at `department` scope reads
rows matching `{departmentId: <theirs>}`, and `BaseRepository.scopeFilter` emits exactly that one
clause. Nothing in it mentions a branch. The reason a department-scoped reader in Tanta does not see
Mohandiseen's rows is that the two branches hold *different department ids* — an accident of
`departments.branchId` being required, not a rule anything enforces. Merging the seven rows into one
would, in a single migration, widen every department-scoped reader across more than twenty
collections from their own site to the whole company, silently, with no error and no test failing.

## Decision

**The catalog is the department the company has. The row in `departments` is a branch declaring that
it has it. Both exist; neither replaces the other.**

- Two new organization-wide collections, `department_catalog` and `section_catalog`, shaped after the
  cost-centre catalog: `code` (unique among the living), bilingual `name`, `description`, `status`.
  No branch, no manager, no acting-manager window, no materialized path — a catalog entry is not a
  place anybody works.
- A section catalog entry belongs to a **department catalog entry**, never to one branch's copy of a
  department. «العد والفرز» is a section of Operations company-wide; hanging that off whichever
  branch was created first would make a company-level fact the property of one site.
- `departments` and `sections` each gain a nullable `catalogId`. **Every other field stays**, and no
  row moves, so every data scope filters on exactly what it filtered on yesterday.
- `{branchId, catalogId}` is unique on departments and `{departmentId, catalogId}` on sections, both
  **partial** on `{isDeleted: false, catalogId: {$type: 'objectId'}}`. The partial filter is
  load-bearing: without it, two rows in one branch that name no entry would both key on
  `(branchId, null)` and the second would be refused — on a deployment that has no catalog at all.
- Creating a unit against a `catalogId` **copies the entry's name** onto the row, and renaming an
  entry carries the new name down to every row that declared it. The row keeps its own `name` because
  the list endpoint searches on it and the DTO is built one document at a time; a read-time join has
  nowhere to go in a paged reader, and a `name.ar` search that quietly stopped matching linked rows
  would be worse than the copy.
- **No new permission keys.** The catalogs are gated on `department.*` and `section.*` — the same
  authority, exercised once instead of once per branch. Splitting them would let somebody add a
  department to a branch while being forbidden to say what that department is.
- The workforce importer resolves the catalog first and passes `catalogId`, so a re-import cannot
  recreate the duplication it caused.

**Existing data is migrated by an operator-run command, never at boot.** `migrate:org-catalog` is a
dry run by default: it groups the rows with the importer's own fold, plans one entry per group taking
the **oldest live member's code and spelling** (inventing nothing), and prints exactly what it would
write. `--write` applies that same plan.

**Two rows are merged only when a human says so.** `--merge LOSER=WINNER` is the sole path by which a
department is retired and its references repointed, and it is refused across branches: moving people
between sites is a transfer, with a date and an approver, not a migration's side effect.

**The migration refuses rather than half-applies.** Two same-named departments in one branch that
nobody has resolved, a unique index the repointing would violate, a notification rule naming a
department being merged — any one of these and nothing at all is written.

## Consequences

- The duplication becomes visible and fixable without moving a single employee, and the
  `{branchId, catalogId}` index stops it returning through the create form.
- Two collections and a nullable column are added; every existing query, index and scope is
  untouched. A deployment that never defines a catalog runs exactly as it does today.
- A **merge** does repoint snapshots — an applicant's placement history, an evaluation batch's
  immutable placement snapshot, a job offer's revisions. That looks like rewriting history and is
  the opposite: a merge asserts the two rows were always the same department, one of them entered
  twice, so a snapshot that keeps naming the retired duplicate is the falsification. The migration's
  reference sweep is derived from the schemas rather than from a list, so a collection added later
  is swept because it declares the field.
- Two collections carry org ids inside `Schema.Types.Mixed` — an announcement's audience and a
  notification rule's audience and filters. No schema walk can find them, so rows naming a merged
  department are **reported and the migration refuses**; they are corrected on their own screens.
- Job titles are unchanged. They are already one company-wide catalog and the data says so.

## Alternatives considered

- **Physically merge the seven rows into one.** Rejected — the data-scope widening described above,
  across twenty-odd collections, with nothing to catch it.
- **Keep the rows and dedupe only in the UI.** Rejected: it fixes the dropdown and nothing else. The
  next import still creates the eighth copy, and every report grouped by department still splits one
  department into seven columns.
- **Make `catalogId` required.** Rejected: it refuses a department a single branch genuinely has, and
  it turns every pre-catalog row into a broken row until a migration has run.
- **Give the catalogs their own permission keys.** Rejected as a separation nobody asked for and no
  screen could explain; see the Decision.
- **Run the migration at boot.** Rejected. It merges records and retires departments on a live org
  chart; that is an operator's decision, taken after reading a dry run, not something a deploy does
  on its own.
- **Derive the display name from the catalog at read time.** Rejected on mechanics: the paged list
  maps one document at a time, so there is nowhere to batch the join, and searching `name.ar` would
  stop matching linked rows.
