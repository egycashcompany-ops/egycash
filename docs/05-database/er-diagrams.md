# ER Diagrams

Entity-relationship views of the [Database Design](database-design.md). MongoDB is
document-oriented — "relationships" here are reference fields (`…Id`), never enforced joins;
cross-module references (dashed notes) are ID-only and resolved via platform contracts or events.

## 1. Identity, RBAC & Organization

```mermaid
erDiagram
    COMPANY ||--o{ BRANCH : "has"
    BRANCH ||--o{ DEPARTMENT : "has"
    DEPARTMENT ||--o{ SECTION : "has"
    COMPANY ||--o{ JOB_TITLE : "defines"

    USER }o--|| COMPANY : "belongs to"
    USER }o--o| BRANCH : "assigned to"
    USER }o--o| DEPARTMENT : "assigned to"
    USER }o--o| SECTION : "assigned to"
    USER }o--o| JOB_TITLE : "holds"

    USER ||--o{ SESSION : "authenticates via"
    USER ||--o{ ROLE_ASSIGNMENT : "granted"
    ROLE ||--o{ ROLE_ASSIGNMENT : "assigned through"
    ROLE }o--o{ PERMISSION : "bundles (permissionKeys)"

    ROLE_ASSIGNMENT {
        ObjectId userId
        ObjectId roleId
        string scope "own|branch|company|all"
    }
    PERMISSION {
        string key "applicant.create"
        string resource
        string action
        string moduleId
    }
    USER {
        string email UK
        string passwordHash
        string status
        int permissionVersion
    }
    SESSION {
        string refreshTokenHash
        string family
        date expiresAt
    }
```

## 2. Files, Audit & Notifications

```mermaid
erDiagram
    FILE_GROUP ||--|{ FILE : "versions"
    FILE_CATEGORY ||--o{ FILE : "classifies"
    USER ||--o{ FILE : "uploaded"
    FILE {
        ObjectId groupId
        int version
        string displayName
        string mime
        string checksum
        json storage "driver + key"
        json entityRef "module/entityType/entityId"
    }

    USER ||--o{ AUDIT_LOG : "acted in"
    AUDIT_LOG {
        json entityRef
        string action
        json changes "field old new[]"
        string ip
        string requestId
        date at
    }
    USER ||--o{ ACTIVITY_LOG : "generated"
    ACTIVITY_LOG {
        json entityRef
        string messageKey
        json params
        date at
    }

    USER ||--o{ NOTIFICATION : "receives"
    NOTIFICATION_TEMPLATE ||--o{ NOTIFICATION : "rendered from"
    USER ||--o{ NOTIFICATION_PREFERENCE : "configures"
```

## 3. Workflow & Approval engines

```mermaid
erDiagram
    WORKFLOW_DEFINITION ||--o{ WORKFLOW_INSTANCE : "instantiated (pinned version)"
    WORKFLOW_INSTANCE ||--|{ WORKFLOW_TRANSITION : "history of"
    WORKFLOW_TRANSITION }o--o| APPROVAL_REQUEST : "may require"
    APPROVAL_CHAIN ||--o{ APPROVAL_REQUEST : "instantiated as"
    APPROVAL_REQUEST ||--|{ APPROVAL_DECISION : "collects"
    USER ||--o{ APPROVAL_DECISION : "decides"
    USER ||--o{ WORKFLOW_TRANSITION : "performs"

    WORKFLOW_DEFINITION {
        string key "hr.recruitment"
        int version
        string entityType
        json states
        json transitions "guards, actions, permissions"
    }
    WORKFLOW_INSTANCE {
        string definitionKey
        int definitionVersion
        json entityRef
        string currentState
    }
    APPROVAL_CHAIN {
        string key
        json steps "approverType, quorum, escalation"
    }
    APPROVAL_DECISION {
        int step
        string decision "approved|rejected|returned"
        string comment
    }
```

## 4. Recruitment (HR module)

```mermaid
erDiagram
    APPLICANT }o--|| RECRUITMENT_SOURCE : "came from"
    APPLICANT ||--o{ APPLICANT_NOTE : "has"
    APPLICANT ||--o{ APPLICANT_ACTIVITY : "schedules"
    APPLICANT ||--o{ SCREENING : "undergoes"
    APPLICANT ||--o{ INTERVIEW : "attends"
    APPLICANT ||--o{ OFFER : "receives"
    OFFER ||--o| HIRING : "on acceptance"
    HIRING ||--|| EMPLOYEE_FILE : "produces"
    DOCUMENT_TYPE ||--o{ HIRING : "checklist items"

    APPLICANT {
        string code UK "APP-2026-000123 (sequences)"
        json person "fullName ar-en, nationalId, ..."
        json nationalIdOcr "provider, confidence, confirmedBy"
        ObjectId sourceId
        ObjectId resumeFileGroupId "→ platform files"
        json workflow "instanceId, currentState (denormalized)"
        ObjectId companyId
        ObjectId branchId
    }
    INTERVIEW {
        int round
        date scheduledAt
        json evaluations "per interviewer"
        string result
    }
    OFFER {
        json terms "salary, grade, startDate"
        ObjectId approvalRequestId "→ platform approvals"
        string status
    }
    HIRING {
        json checklist "documentTypeId, fileId, status[]"
        date completedAt
    }
```

**Cross-boundary references (ID-only, no joins):**

| From (module) | To (platform) | Via |
|---|---|---|
| `hr_applicants.resumeFileGroupId`, attachments | `files` / `file_groups` | Files service API |
| `hr_applicants.workflow.instanceId` | `workflow_instances` | Workflow service API |
| `hr_offers.approvalRequestId` | `approval_requests` | Approval service API |
| Applicant timeline | `activity_logs`, `workflow_transitions` | Audit/Workflow read APIs, merged view |
| `position.jobTitleId`, `companyId`, `branchId` | organization collections | Organization service (cached) |
