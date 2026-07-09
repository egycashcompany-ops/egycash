# Ubiquitous Language

One term, one meaning, everywhere: in conversation, documents, UI (both languages), and in
every identifier the traceability discipline derives from it
([Module Hierarchy §5](../01-business/module-hierarchy.md) — permission keys, routes,
collections, events, folders). This glossary is the vocabulary contract; the
[Domain Model](domain-model.md) defines the entities behind it.

## 1. Rules of the language

1. **The English term is the canonical identifier root**; the Arabic term is the canonical
   UI translation. Both are part of the definition — a term without an agreed Arabic
   rendering is not done.
2. **Terms are context-scoped** ([Bounded Contexts](bounded-contexts.md)): "Assignment" in
   Identity & Access (role assignment) is a different word from "Assignment" in Employment
   (position assignment); across a boundary, qualify or translate.
3. **Synonyms are banned in artifacts.** The rejected synonym is listed so it never sneaks
   back in (e.g., *Candidate* for Applicant).
4. Changing a term is a **breaking rename** (permissions, routes, events) — done only with an
   ADR and a migration note.
5. Arabic renderings below are working proposals; **the business validates them** before they
   ship in UI catalogs (they are already used in seeded data where implemented).

## 2. Platform terms

| Term | Arabic | Meaning | Not to be confused with / rejected synonyms |
| --- | --- | --- | --- |
| Organization | المؤسسة | The single legal entity (EGYCASH) the platform serves (ADR-015) | *Company* — retired with the multi-company model |
| Branch | الفرع | A physical/operational site; the primary data-scoping unit | *Site*, *Location* |
| Department / Section | الإدارة / القسم | Functional unit within a branch / sub-unit of a department | Generic "org unit" (rejected, Review R12) |
| Job Title | المسمى الوظيفي | Organization-level position catalog entry | *Position* (reserved for Employment's post-with-headcount, if adopted) |
| User | المستخدم | An account that can authenticate and act | *Employee* — a User is not an employee (Platform Core §2) |
| Role | الدور | Admin-managed bundle of permissions | Never checked in code — permissions are |
| Permission | الصلاحية | Code-declared capability `<resource>.<action>` | *Privilege*, *Right* |
| Data Scope | نطاق البيانات | How far a granted permission reaches: `own · branch · organization` | Visibility ≠ permission: scope narrows, never grants |
| Role Assignment | إسناد الدور | Grant of a role to a user at a scope, optionally time-bound (Review R14) | — |
| Acting Manager | المدير بالإنابة | Time-boxed delegation of an org unit's management (Review R11) | Approval *Delegation* (Process context, per-approver) |
| Session | الجلسة | One device's authenticated presence (rotation family) | Browser session/cookies generally |
| Break-glass | صلاحية الطوارئ | A permission whose use pages an alert and mandates 2FA (e.g., force-transition) | Ordinary admin permissions |
| Setting | الإعداد | A declared, typed configuration point resolved `user → branch → organization → default` | Environment variables (deployment concern) |
| Feature Flag | مفتاح الميزة | Temporary, expiring toggle for dark-shipping/pilots (Review R27) | Settings (permanent), entitlements |
| Audit Record | سجل التدقيق | Immutable who-changed-what fact with old/new values | Activity Record; system logs |
| Activity Record | سجل النشاط | Human-readable timeline entry on an entity | Audit (compliance-grade) |
| Timeline | الخط الزمني | The merged *view* of an entity's history (activities, transitions, notes, documents) | A stored entity — it isn't one |
| Document | المستند | A stored file's metadata, versions, integrity, and access policy | *Attachment* (UI word for the relationship, not the entity) |
| Document Category | فئة المستند | Admin catalog with mime/size/retention rules per kind of document | Document Type (Recruitment checklist catalog) |
| Workflow | سير العمل | A configurable state machine (definition) or one entity's journey (instance) | Hard-coded status enums (banned, ADR-011) |
| Transition | الانتقال | One recorded state change with actor/time/comment | *Status update* |
| Approval Chain / Request / Decision | سلسلة الاعتماد / طلب الاعتماد / قرار الاعتماد | Who must say yes / one running ask / one verdict | *Sign-off* |
| Delegation | التفويض | An approver's out-of-office transfer of pending decisions | Acting Manager (Organization context) |
| Escalation | التصعيد | SLA-driven move of a pending decision to the next authority | Reminder notifications |
| Notification | الإشعار | A message to a person about an entity; inbox is truth, push is delivery | Emails as such (a channel) |
| Sequence | التسلسل | Gap-monitored counter behind human-facing document numbers | Database IDs |
| Domain Event | حدث النطاق | Named, versioned fact other contexts may react to | UI/socket events (delivery detail) |
| Reliable Event / Outbox | الحدث المضمون / صندوق الصادر | Business-consequence event persisted transactionally, delivered at-least-once | Fire-and-forget in-process events |
| Scheduled Task | المهمة المجدولة | Code-declared recurring work in the platform inventory (Review R3) | Ad-hoc background jobs |
| Connector | الموصل | Configured, health-monitored door to one external system | Direct HTTP calls (banned in modules) |
| Extraction (OCR) | الاستخراج الضوئي | Document-intelligence run that **pre-fills, never commits** (ADR-014) | Data entry |
| Soft Delete | الحذف المنطقي | Marking a record deleted while preserving it for audit | Purge (explicit, permission-gated job) |

## 3. Recruitment terms

| Term | Arabic | Meaning | Not to be confused with / rejected synonyms |
| --- | --- | --- | --- |
| Applicant | المتقدِّم | A person seeking employment, from intake to hire/rejection | ~~Candidate~~ (rejected synonym) |
| Recruitment Source | مصدر التوظيف | Where an applicant came from (referral, job board, walk-in) | Marketing channels generally |
| Screening | الفرز | Structured initial evaluation with score and pass/fail decision | Interview |
| Interview | المقابلة | A scheduled round with a panel and per-interviewer evaluations | Screening |
| Panel | لجنة المقابلة | The users evaluating one interview round | — |
| Offer | عرض العمل | Proposed employment terms requiring approval before sending | Contract (Client Agreements term) |
| Hiring Case | ملف التعيين | Post-acceptance conversion: the required-documents checklist to employment readiness | Onboarding (Employment-side, future) |
| Hiring Document | مستند التعيين | One checklist item: required document type × collected file | Document (platform entity it points to) |
| Document Type | نوع المستند | Recruitment catalog of documents a hire must provide | Document Category (platform files catalog) |
| Employee File | الملف الوظيفي | The consolidated digital file handed to Employment on completion | Personnel file cabinet metaphors |
| National ID | الرقم القومي | 14-digit Egyptian identity number; validated structurally; the person-correlation key across contexts (R9) | Passport/other IDs (future document types) |
| Job Requisition *(pending OQ-2)* | طلب شغل وظيفة | Approved vacancy applicants would apply against — **not yet adopted** | Job Title (catalog entry) |

## 4. Core-operations terms (future modules — vocabulary fixed now)

| Term | Arabic | Meaning | Not to be confused with |
| --- | --- | --- | --- |
| Client | العميل | The counterparty EGYCASH serves (bank, retailer); owned by Client Agreements | *Customer* (retired synonym); Vendor |
| Contract | العقد | Signed agreement: services, sites, validity, tariffs | Offer (Recruitment) |
| SLA | اتفاقية مستوى الخدمة | A time/frequency commitment operational contexts must honor | Internal workflow SLA timers (Process context) |
| Service Order | أمر الخدمة | A client's authorized request to move/handle value | Trip (the execution) |
| Trip | الرحلة | One armored-vehicle run executing service orders with a crew | Route (the plan) |
| Consignment | الإرسالية | The sealed value being moved: declared content + seals | Shipment (courier connotation) |
| Custody | العُهدة | Accountable possession of value by exactly one custodian at a time | Storage (passive) |
| Custody Transfer | نقل العُهدة | The immutable fact of value changing accountable hands | Handover (informal) |
| Seal | الختم الأمني | Tamper-evidence identity on a consignment | Signature |
| Custodian | أمين العُهدة | The person accountable for a consignment right now | Courier, guard |
| Vault | الخزينة | A physical strongroom at a branch | Safe (furniture), Treasury |
| Custody Account | حساب العُهدة | What a vault holds for one owner | Bank account |
| Vault Count | جرد الخزينة | Reconciliation event: expected vs counted, with attestations | Audit (Accountability context) |
| Denomination Breakdown | تفصيل الفئات | Value expressed as note/coin counts per denomination | Amount (scalar) |
| Replenishment | التغذية | Loading an ATM with prepared cassettes | Deposit |
| Cassette | الكاسيت | Denomination-loaded ATM cash container | Consignment (which may carry cassettes) |
| FLM / SLM | الصيانة الأولى / الثانية | First-line (operational) vs second-line (technical) ATM maintenance | Incident (the fault itself) |
| Incident | البلاغ | A fault or discrepancy with an SLA clock | Security Incident (Physical Security) |
| Precious Item | العهدة الثمينة | Identified gold/metal item or lot under custody | Consignment (cash) |
| Billable Event | حدث محاسبي | An operational fact Finance prices and invoices | Invoice (Finance's aggregate) |

## 5. Employment terms (reserved, designed later)

Employee (الموظف) · Position Assignment (الإسناد الوظيفي) · Attendance (الحضور) · Leave
(الإجازة) · Payroll (الرواتب) · Termination (إنهاء الخدمة). Definitions are fixed when the
Employment context is designed; the terms are reserved now so Recruitment artifacts don't
repurpose them.
