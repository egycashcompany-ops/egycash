# Permission Matrix

The authoritative catalog of permissions for the Platform Core and the Recruitment feature set,
plus the seeded role templates. Permission keys follow `<resource>.<action>`
([ADR-004](../03-decisions/ADR-004-permission-based-authorization.md)); the machine-readable
catalog will live in `packages/contracts/permissions` and is synced to the DB at boot.

## 1. Action vocabulary (closed)

| Action | Meaning |
|---|---|
| `view` | Read/list (within the caller's data scope) |
| `create` | Create new records |
| `edit` | Modify existing records |
| `delete` | Soft-delete records |
| `export` | Bulk data egress (Excel/CSV) — audited individually |
| `print` | Formatted document/report output — audited individually |
| `approve` / `reject` | Decide on approval steps / gated transitions |

Special administrative actions (e.g., `assign`, `manage`) are introduced per resource below and
require an ADR to extend the global vocabulary.

## 2. Platform Core permissions

| Resource | view | create | edit | delete | export | print | approve | reject | special |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `user` | ● | ● | ● | ● | ● | | | | `user.resetPassword`, `user.manageSessions` |
| `role` | ● | ● | ● | ● | | | | | `role.assign` |
| `permission` | ● | | | | | | | | *(registry is read-only)* |
| `company` | ● | ● | ● | ● | | | | | |
| `branch` | ● | ● | ● | ● | | | | | |
| `department` | ● | ● | ● | ● | | | | | |
| `section` | ● | ● | ● | ● | | | | | |
| `jobTitle` | ● | ● | ● | ● | | | | | |
| `setting` | ● | | ● | | | | | | scoped: system/company/branch |
| `notificationTemplate` | ● | ● | ● | ● | | | | | |
| `file` | ● | ● | ● | ● | | | | | `file.download` (audited), `fileCategory.manage` |
| `auditLog` | ● | | | | ● | | | | *(no edit/delete exists)* |
| `activityLog` | ● | | | | | | | | |
| `workflowDefinition` | ● | ● | ● | ● | | | | | `workflowDefinition.activate` |
| `workflowInstance` | ● | | | | | | | | `workflowInstance.forceTransition` (break-glass, audited) |
| `approvalChain` | ● | ● | ● | ● | | | | | |
| `approvalRequest` | ● | | | | | | ● | ● | `approvalRequest.delegate` |
| `dashboard` | ● | ● | ● | ● | | | | | |
| `report` | ● | | | | ● | ● | | | `report.schedule` |
| `sequence` | ● | | ● | | | | | | |
| `translation` | ● | | ● | | | | | | |
| `integration` | ● | ● | ● | ● | | | | | `integration.viewLogs` |
| `apiKey` | ● | ● | | ● | | | | | |

## 3. Recruitment permissions (HR module)

| Resource | view | create | edit | delete | export | print | approve | reject | special |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `applicant` | ● | ● | ● | ● | ● | ● | ● | ● | `applicant.viewSensitive` (unmasked national ID), `applicant.transition` |
| `applicantNote` | ● | ● | ● | ● | | | | | |
| `applicantActivity` | ● | ● | ● | ● | | | | | |
| `screening` | ● | ● | ● | | | ● | ● | ● | |
| `interview` | ● | ● | ● | ● | | ● | | | `interview.evaluate` |
| `offer` | ● | ● | ● | ● | | ● | ● | ● | `offer.send` |
| `hiring` | ● | ● | ● | | | ● | ● | ● | `hiring.complete` |
| `hiringDocument` | ● | ● | ● | ● | | | | | |
| `employeeFile` | ● | ● | ● | | ● | ● | | | |
| `recruitmentSource` | ● | ● | ● | ● | | | | | |
| `recruitmentReport` | ● | | | | ● | ● | | | |

Full example keys: `applicant.view`, `applicant.create`, `applicant.edit`, `applicant.delete`,
`applicant.export`, `applicant.print`, `applicant.approve`, `applicant.reject`.

## 4. Data scopes

Every role assignment carries a scope evaluated by the repository layer on top of the permission:

| Scope | Sees |
|---|---|
| `own` | Records the user created or is assigned to |
| `branch` | Records of the user's branch |
| `company` | Records of the user's company (all branches) |
| `all` | Everything (system administration) |

Example: *HR Specialist* with `applicant.view @ branch` sees only their branch's applicants;
an *HR Manager* with `applicant.view @ company` sees all branches.

## 5. Seeded role templates

Roles are data — these are starting templates, editable by administrators (except protected
system roles).

| Role | Type | Permission grant (summary) | Typical scope |
|---|---|---|---|
| **Super Admin** | system, protected | everything | `all` |
| **Platform Admin** | system, protected | all platform resources; no business-module data | `all` |
| **Company Admin** | template | org structure, users, roles, settings within company | `company` |
| **HR Manager** | template | all recruitment permissions incl. approve/reject/export + `applicant.viewSensitive` | `company` |
| **HR Specialist** | template | applicant/screening/interview view-create-edit; no approve, no delete, no export | `branch` |
| **Recruiter** | template | applicant view/create/edit, notes, activities, interview scheduling | `branch` |
| **Interviewer** | template | `interview.view`, `interview.evaluate`, `applicant.view` (limited) | `own` |
| **Auditor** | template | `auditLog.view`, `activityLog.view`, read-only `view` on business resources | `company` |

## 6. Governance rules

1. Only module manifests and platform services may declare permissions; the DB registry is
   sync-only (no hand-created permissions).
2. Adding a permission = code PR (catalog + usage + docs row here) — reviewable and traceable.
3. Removing a permission requires a migration note for roles that reference it.
4. `export`, `print`, `viewSensitive`, `forceTransition` grants are reviewed quarterly (audited
   usage report from the Reports Engine).
5. Break-glass permissions (`workflowInstance.forceTransition`, `user.manageSessions`) page an
   alert on use.
