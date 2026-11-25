# Findings about other modules — Administrative Affairs design review (2026-11-17)

The discovery and design review of the Administrative Affairs module
(`docs/12-planning/administration-module-design.md` and its three companion files) read most of the code base. Along
the way it found the items below in **other** modules and in repository-wide documents. They are not the Administrative
Affairs design's work, and nobody has decided to defer them, so they are not in `technical-debt.md` (which holds only
decided deferrals). They are listed here so the owners of those areas can find them. Citations are against `4c0fa1b0`,
except row 12, which Phase 2's P2.2 found and cites against its own tree.

| # | Area | Finding | Evidence |
|---|---|---|---|
| 1 | Web dialogs | 22 dialogs disable Save until required fields are filled, against the owner's recorded reason for the shared required-fields rule | `apps/web/src/shared/ui/required-fields.tsx:1-14` |
| 2 | Web references | 21 files import Organization's `useBranchOptions` from another module's folder | `apps/web/src/modules/organization/shared/references.ts:44` |
| 3 | IT web errors | IT has no module error map, so a code without a platform friendly entry shows the server's English `message` in Arabic too; ATM maps its work-branch code to its own i18n keys | `apps/web/src/shared/lib/errors.ts:235-238`; ATM, `apps/web/src/modules/atm/lib/settlement-view.ts:218-233` |
| 4 | Module homes | `ModuleHome` paints placeholder KPI tiles and an always-rendered placeholder activity panel; ATM, Operations and Organization build their homes on it | `apps/web/src/modules/atm/pages/AtmOverviewPage.tsx:197`; `apps/web/src/modules/operations/pages/OperationsOverviewPage.tsx:200`; `apps/web/src/modules/organization/pages/OrganizationOverview.tsx:54-56` |
| 5 | Approval screens | The approval-chain screen and its panel show Arabic names in both locales (a P2 prerequisite for Administrative Affairs, its §13.4 rule 6) | `apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx:91-92`, `:97-101` |
| 6 | `docs/README.md` | Still reads "Milestone 2 — Platform Core implementation (phase 2.1 in progress)" and lists one planning document | `docs/README.md:8`, `:33` |
| 7 | `ECMS-BOOK.md` | The delivery table ends with System Administration P7 and three planned rows (Sprint 2.3, Sprint 2.4, Milestone 3+); it has no Fleet, IT, ATM or Gold row | `ECMS-BOOK.md:103-106` |
| 8 | ADR index | The index table lists ADR-001 to ADR-038, but its prose stops at ADR-028, and the ADR-026 paragraph is split by the ADR-028 and ADR-027 paragraphs ("which the roles screens" … "now warn about but do not change") | `docs/03-decisions/README.md:75-79`, `:95` |
| 9 | Counters | Fleet's custody counter and ATM's note counter are two copies of one counter rule; the Administrative Affairs design's PC-13 writes a shared counter factory in `apps/api/src/shared/base/` that both could move onto | `apps/api/src/modules/fleet/custody/custody-counter.model.ts`; `apps/api/src/modules/atm/settlements/plans/note-counter.model.ts` |
| 10 | Scope rules | ATM keeps `registerScopeBranches` beside the shared `selectorBranches`, which was written as its copy | `apps/api/src/modules/atm/register/register.repository.ts:33-47`; `apps/api/src/shared/types/index.ts:284-308` |
| 11 | Stray file | An empty tracked file, `__tmp_ignore__`, sits among IT's web helpers | `apps/web/src/modules/it/lib/__tmp_ignore__` (added in `9770febc`) |
| 12 | Platform load order | Three platform files import each other in a cycle: `org-unit.ts` imports `auditService`, `audit.service.ts` imports `directoryProfileService`, and `directory-profile.service.ts` imports the organization's models, whose schemas call `org-unit.ts`'s `addOrgUnitIndexes`. A process whose first platform import is the approvals barrel meets `TypeError: (0 , addOrgUnitIndexes) is not a function`; a boot loads the platform in another order and does not. To reproduce, swap the two imports of Administrative Affairs' indexes spec, which loads the module's manifest first as its workaround, and run it | `apps/api/src/platform/organization/shared/org-unit.ts:25`; `apps/api/src/platform/audit/audit.service.ts:33`; `apps/api/src/platform/directory/directory-profile.service.ts:13-15`; `apps/api/src/platform/organization/departments/department.model.ts:36`; the workaround, `apps/api/src/modules/administration/administration-indexes.spec.ts:15-18` |
