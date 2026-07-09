<!-- GENERATED FILE — do not edit by hand.
     Source: packages/contracts/src/permissions/ (single source of truth, ADR-004).
     Regenerate: npm run gen:permission-matrix -->

# Permission Matrix — generated catalog

Machine-derived from `packages/contracts`. The narrative matrix lives in
[permission-matrix.md](permission-matrix.md); this file is the code-accurate inventory
synced to the DB registry at boot (Review R18).

| Resource | Module | view | create | edit | delete | export | print | approve | reject | Special actions |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `activityLog` | platform | ● |  |  |  |  |  |  |  |  |
| `auditLog` | platform | ● |  |  |  | ● |  |  |  |  |
| `branch` | platform | ● | ● | ● | ● |  |  |  |  |  |
| `department` | platform | ● | ● | ● | ● |  |  |  |  |  |
| `file` | platform | ● | ● | ● | ● |  |  |  |  | `file.download`, `file.purge` ⚠️ break-glass |
| `fileCategory` | platform |  |  |  |  |  |  |  |  | `fileCategory.manage` |
| `jobTitle` | platform | ● | ● | ● | ● |  |  |  |  |  |
| `organization` | platform | ● |  | ● |  |  |  |  |  |  |
| `permission` | platform | ● |  |  |  |  |  |  |  |  |
| `role` | platform | ● | ● | ● | ● |  |  |  |  | `role.assign` |
| `scheduledTask` | platform | ● |  |  |  |  |  |  |  | `scheduledTask.manage` |
| `section` | platform | ● | ● | ● | ● |  |  |  |  |  |
| `setting` | platform | ● |  | ● |  |  |  |  |  |  |
| `user` | platform | ● | ● | ● | ● | ● |  |  |  | `user.resetPassword`, `user.manageSessions` ⚠️ break-glass |

Total permissions: **45**
