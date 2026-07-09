# Database Design

MongoDB with Mongoose ([ADR-005](../03-decisions/ADR-005-mongodb-mongoose.md)). This document
defines the conventions every collection follows and the key schema designs for the Platform Core
and the Recruitment feature set. Visual relationships: [ER Diagrams](er-diagrams.md).

## 1. Conventions (apply to every collection)

### 1.1 Standard fields

```jsonc
{
  "_id": "ObjectId",
  "schemaVersion": 1,             // lazy-migration marker (ADR-005)
  "companyId": "ObjectId",        // scoping — on all scoped business data
  "branchId": "ObjectId",         // where branch-scoped
  "status": "active",             // lifecycle: entity-specific closed vocabulary
  "isDeleted": false,             // SOFT delete only for business data (audit integrity)
  "deletedAt": null, "deletedBy": null,
  "createdAt": "Date", "createdBy": "ObjectId",
  "updatedAt": "Date", "updatedBy": "ObjectId"
}
```

- **Soft delete** for all business data (hard delete only via explicit, permission-gated,
  audited purge jobs). BaseRepository filters `isDeleted: false` by default.
- **Localized names** use `LocalizedString`: `{ ar: string, en: string }`.
- **Denormalization policy:** store foreign *display* fields (e.g., `branchName`) only when
  list-rendering performance demands it, always alongside the ID, refreshed by event subscribers.
  IDs are the truth; names are cache.

### 1.2 Collection naming & ownership

- Platform: unprefixed (`users`, `roles`, `files`). Modules: prefixed (`hr_applicants`).
- A collection is written by exactly **one** feature's repository. No cross-module `$lookup`.

### 1.3 Indexing rules

- Every query path in a repository has a covering index, declared in the model file.
- Mandatory: scope compound indexes on business data (`{ companyId: 1, branchId: 1, status: 1 }`),
  unique indexes on natural keys (partial, excluding soft-deleted), text indexes for declared
  searchable fields.
- `autoIndex` off in production; index sync is a deploy step with diff review.

## 2. Platform Core — key schemas (abridged)

### users
```jsonc
{ "email": "unique", "phone": "…", "passwordHash": "argon2id",
  "profile": { "firstName": {"ar":"…","en":"…"}, "lastName": {…}, "avatarFileId": null },
  "locale": "ar", "status": "active|suspended|archived",
  "organization": { "companyId": "…", "branchId": "…", "departmentId": "…",
                    "sectionId": "…", "jobTitleId": "…" },
  "security": { "passwordChangedAt": "…", "failedLogins": 0, "lockedUntil": null,
                "permissionVersion": 7 } }
```
Indexes: `ux_email`, `ix_companyId_branchId_status`.

### sessions  *(auth)*
```jsonc
{ "userId": "…", "refreshTokenHash": "…", "family": "uuid",   // rotation family (ADR-006)
  "device": { "userAgent": "…", "ip": "…" },
  "expiresAt": "TTL index", "revokedAt": null, "revokedReason": null }
```

### permissions / roles / role_assignments  *(rbac)*
```jsonc
// permissions — synced from code at boot; read-only at runtime
{ "key": "applicant.create", "resource": "applicant", "action": "create",
  "moduleId": "hr", "name": {"ar":"…","en":"…"} }

// roles — admin-managed data
{ "name": {"ar":"…","en":"…"}, "companyId": null /* null = system role */,
  "isSystem": false, "permissionKeys": ["applicant.view", "applicant.create"] }

// role_assignments
{ "userId": "…", "roleId": "…", "scope": "own|branch|company|all",
  "scopeRef": { "companyId": "…", "branchId": "…" } }
```

### companies / branches / departments / sections / job_titles  *(organization)*
```jsonc
// shared shape; hierarchy via parent + materialized path
{ "code": "BR-0007",                       // sequence-generated
  "name": {"ar":"…","en":"…"}, "status": "active",
  "parentId": "…", "path": "comp1/br7",    // fast subtree queries
  /* branches add: */ "companyId": "…", "address": {…}, "geo": {…} }
```

### settings_values
```jsonc
{ "key": "auth.passwordPolicy.minLength", "scope": "system|company|branch|user",
  "scopeRef": "ObjectId|null", "value": "mixed (Zod-validated against declared type)" }
```
Unique: `ux_key_scope_scopeRef`.

### files / file_groups / file_categories
```jsonc
// files — metadata only (ADR-010)
{ "groupId": "…", "fileVersion": 3, "isLatest": true,
  "originalName": "id-front.jpg", "storedName": "3-<uuid>.jpg",
  "displayName": "National ID — front", "description": "…",
  "categoryId": "…", "tags": ["…"], "mime": "image/jpeg", "extension": ".jpg",
  "size": 482113, "checksum": "sha256:…",
  "visibility": "private|public", "status": "active|archived",
  "storage": { "driver": "local|railway|s3|minio|azure", "key": "files/<groupId>/…" },
  "entityRef": { "moduleId": "hr", "entityType": "applicant", "entityId": "…" },
  "uploadedBy": "…", "uploadedAt": "…",
  "scanStatus": "unscanned|pending|clean|blocked" }
```
Indexes: `ix_entityRef`, `ix_groupId_version`, `ix_checksum`.

### audit_logs *(append-only)* / activity_logs
```jsonc
// audit_logs
{ "entityRef": { "moduleId": "hr", "entityType": "applicant", "entityId": "…" },
  "action": "create|update|delete|transition|approve|login|…",
  "changes": [ { "field": "status", "old": "screening", "new": "interview" } ],
  "actor": { "userId": "…", "ip": "…", "userAgent": "…" },
  "requestId": "…", "at": "Date" }

// activity_logs — human timeline entries
{ "entityRef": {…}, "messageKey": "hr.applicants.activity.interviewScheduled",
  "params": { "interviewer": "…" }, "actorId": "…", "at": "Date" }
```
Indexes: `ix_entityRef_at`; audit collection uses a restricted DB role (insert-only).

### workflow_definitions / workflow_instances / workflow_transitions
```jsonc
// workflow_definitions — versioned (ADR-011)
{ "key": "hr.recruitment", "version": 3, "isActive": true,
  "entityType": "applicant", "moduleId": "hr",
  "states": [ { "key": "screening", "name": {…}, "sla": { "hours": 48, "escalateTo": "…" } } ],
  "transitions": [ { "from": "screening", "to": "interview",
                     "permission": "applicant.edit",
                     "guards": [ { "field": "screeningScore", "op": "gte", "value": 60 } ],
                     "approvalChainKey": null,
                     "actions": [ { "type": "notify", "template": "…" } ] } ] }

// workflow_instances
{ "definitionKey": "hr.recruitment", "definitionVersion": 3,
  "entityRef": {…}, "currentState": "interview", "startedAt": "…", "closedAt": null }

// workflow_transitions — the status history
{ "instanceId": "…", "from": "screening", "to": "interview",
  "actorId": "…", "comment": "…", "approvalRequestId": null, "at": "Date" }
```

### approval_chains / approval_requests / approval_decisions
```jsonc
{ // approval_chains — definition
  "key": "hr.offer-approval", "steps": [
    { "order": 1, "approverType": "jobTitle|role|orgManager|user", "approverRef": "…",
      "quorum": "all|any", "escalation": { "afterHours": 24, "to": "…" } } ] }
{ // approval_requests — one running chain
  "chainKey": "…", "entityRef": {…}, "status": "pending|approved|rejected|cancelled",
  "currentStep": 1, "requestedBy": "…" }
{ // approval_decisions
  "requestId": "…", "step": 1, "approverId": "…",
  "decision": "approved|rejected|returned", "comment": "…",
  "delegatedFrom": null, "at": "Date" }
```

### sequence_counters
```jsonc
{ "key": "hr.applicant", "scopeRef": "companyId|null", "period": "2026",
  "value": 1234 }   // findOneAndUpdate $inc — atomic
```
Unique: `ux_key_scopeRef_period`.

### outbox  *(kernel, ADR-008)*
```jsonc
{ "eventName": "hr.applicant.hired", "payload": {…}, "emittedAt": "…",
  "status": "pending|dispatched|failed", "attempts": 0, "requestId": "…" }
```

*(notifications, translations, integration connectors, dashboards follow the same conventions —
full field lists are specified at implementation-PR time per service.)*

## 3. Recruitment — key schemas

### hr_applicants
```jsonc
{ "code": "APP-2026-000123",                    // sequences service
  "companyId": "…", "branchId": "…",
  "person": {
    "fullName": { "ar": "…", "en": "…" },
    "nationalId": "29801011234567",             // validated: 14 digits + structure
    "birthDate": "…", "gender": "…", "address": {…}, "phone": "…", "email": "…" },
  "nationalIdOcr": {                             // provenance of OCR-prefilled data (ADR-014)
    "jobId": "…", "provider": "…", "confidence": { "fullName": 0.97, "nationalId": 0.99 },
    "confirmedBy": "…", "confirmedAt": "…" },
  "position": { "jobTitleId": "…", "departmentId": "…" },
  "sourceId": "…",                               // → hr_recruitment_sources
  "resumeFileGroupId": "…",                      // files service
  "workflow": { "instanceId": "…", "currentState": "screening" },  // denormalized read model
  "tags": ["…"], "isDeleted": false, /* + standard fields */ }
```
Indexes: `ux_code`, `ux_nationalId_companyId` (partial), `ix_companyId_state`,
text index on names + code.

### Supporting collections
| Collection | Purpose |
|---|---|
| `hr_recruitment_sources` | Catalog: referral, job board, walk-in… (localized names) |
| `hr_applicant_notes` | Free-form notes: `{ applicantId, body, authorId, at }` |
| `hr_applicant_activities` | Scheduled activities: calls, reminders `{ applicantId, type, dueAt, status, assigneeId }` |
| `hr_screenings` | Screening form instances: `{ applicantId, formVersion, answers, score, decision }` |
| `hr_interviews` | `{ applicantId, round, panel: [userId], scheduledAt, location, evaluations: [{ interviewerId, scores, comment }], result }` |
| `hr_offers` | `{ applicantId, terms: { salary, grade, startDate }, approvalRequestId, status, sentAt, respondedAt }` |
| `hr_hirings` | `{ applicantId, offerId, checklist: [{ documentTypeId, required, fileId, status }], completedAt }` |
| `hr_document_types` | Required-document catalog for hiring checklists |
| `hr_employee_files` | Electronic employee file: consolidated refs to person data + all documents, handed to the future `employees` sub-module |

**Timeline** is a *view*, not a collection: merged from `activity_logs`,
`workflow_transitions`, `hr_applicant_notes`, and file uploads for the applicant's `entityRef`,
sorted by time.

## 4. Data lifecycle & operations

- **Backups:** managed MongoDB provider with point-in-time recovery; restore drills quarterly.
- **Retention:** audit years-long; system logs weeks; soft-deleted business data purgeable only
  by explicit policy jobs.
- **Migrations:** versioned scripts + `schemaVersion` lazy migration (ADR-005); every migration
  has a rollback note.
- **PII:** national IDs and contact data are PII — encrypted at rest by the DB provider, redacted
  from system logs, exportable/erasable per future data-protection requirements (erasure =
  anonymization, preserving audit integrity).
