# Compliance and Risks — «الملفات» (design and delivery record)

Module `compliance` — **الالتزام والمخاطر** (Compliance and Risks). Delivered with the code it
describes; each section is cited from the code as `§n`.

## 1. What was asked

The owner, 2026-11-25:

> فى إدارة جديدة عايزك تضيفها كمديول جديد وهي الالتزام والمخاطر Compliance and Risks. كل المطلوب
> فيها فى الوقت الحالى إن يكون فيها Page واحده فقط اسمها ملفات شبه /applicant-documents من جهة
> الفولدرات. بس الشخص المسئول يقدر يسمى الفولدرات دي ويغير تسميتهم ويقدر يرفع الصورة اللى على كل
> فولدر بنفسه أو يغيرها، ويحدد مين من الشركة ليه الأحقية أنه يشوف الفولدر دا، واللى يحددهم بس هما
> اللى يظهر عندهم الفولدر. يقدر هو بقي يرفع جوا كل فولدر فايلات PDF أو Word أو Excel وحط ليميت
> 20M، وبردو يقدر يغير مسمياتهم. وطبعاً الفايلات دى هتظهر للى ليه الأحقية أنه يفتح الفولدر بس، لكن
> محدش يقدر يغير أو يعدل حاجة هما بس يقدروا يفتحوا الفايلات ويعملولها Download و View. وطبعاً مهم
> المسئول يشوف هما عملوا Seen ولا لأ وكام مره بالتوقيت والتاريخ.

Read as requirements:

| # | Requirement | Where |
|---|---|---|
| R1 | A new module, Compliance and Risks, with one page «الملفات» | §2, §11 |
| R2 | Folders shaped like HR's `/applicant-documents` shelf | §11 |
| R3 | The responsible person names and renames folders | §3.1, §8 |
| R4 | … puts a picture on each folder, and changes it | §3.1, §5.1 |
| R5 | … chooses who in the company sees each folder; only they see it | §4 |
| R6 | … uploads PDF, Word and Excel into a folder, 20 MB each | §5 |
| R7 | … renames the files | §3.2 |
| R8 | The people a folder is shared with may only view and download | §4, §6 |
| R9 | The responsible person sees who has seen each file, how many times, and when | §7 |

One question was put to the owner while building: HR's folder drawing and file helpers live in the
HR module, and a module imports no other module's code. Answer: *«لأ أبنى أنت الشكل بتاع الالتزام
والمخاطر شبه HR ولما تتعدل هتتعدل لوحدها بعيداً عن الـ HR»* — the module keeps its own copy, which
changes on its own (§11).

## 2. Scope

One page, one sub-domain («files»). Nothing else of compliance or risk management — registers,
assessments, incidents — is in this slice; each would be its own page with its own design.

## 3. Data

Three collections, each with the standard base fields, indexes built by the seed (§10).

### 3.1 Folders — `compliance_folders`

| Field | |
|---|---|
| `name`, `nameKey` | the name as typed; `foldName(name)` under a unique partial index (`ux_name_key`) — one live folder per name, «أ» and «ا» or a doubled space are one name |
| `cover` | `{ fileId, setAt }` or null — the picture on the folder's front |
| `viewerUserIds` | the user accounts the folder is shown to (`ix_viewer`) |

Optimistic concurrency on every write (`version`, 409 `STALE_DOCUMENT`). Deleting a folder takes its
files and picture with it (their bytes are withdrawn from Files first, while the folder still exists
for the authorizer) and keeps the access log.

### 3.2 Documents — `compliance_documents`

`folderId`, `fileId` (the bytes, kept by Files), `name` (shown, editable), `fileName` (as uploaded,
never changed), `kind` (`pdf` | `word` | `excel`), `mime`, `size`, `uploadedByUserId`,
`uploadedAt`. Renaming changes `name` only.

## 4. Access

### 4.1 Keys and ready-made roles

One page, `compliance.files`, and two keys on it:

| Key | Who | Opens |
|---|---|---|
| `complianceFile.manage` | the responsible person | every folder; every write; the people picker; the seen report |
| `complianceFile.view` | a person a folder is shared with | the page — and only the folders whose list names them |

Two managed roles are seeded: **مسؤول ملفات الالتزام والمخاطر** (`compliance-files-manager`, both
keys) — an administrator assigns it to whoever keeps the shelf, at any scope — and **قارئ ملفات
الالتزام والمخاطر** (`compliance-files-reader`, the view key), which nobody assigns by hand (§4.2).

### 4.2 The reader's grant follows the lists

The sidebar is the set of applications whose key the caller holds, so a person a folder is shared
with must hold `complianceFile.view` for «الملفات» to appear for them. The module keeps it in step:
it gives the reader role (scope `own`) when a person is first named on a live folder, and takes back
exactly that grant when they are on no list any more — `rbacService.ensureAssignment` and the new
`rbacService.removeAssignment(userId, roleId, scope)`, which revokes only assignments at that scope,
so a grant an administrator made at another scope stays. A grant that could not be changed is a
line in the log and is reconciled at the next boot (`reconcileReaderGrants`: everyone on a list,
and everyone holding the module's grant, brought in line).

What a person may open is never decided by the key: every read asks the folder's list, and a person
not on it is answered **404**, as if the folder did not exist.

### 4.3 Who can be chosen

Active **employee** login accounts (`kind: employee`, `status: active`), searched on the server
(`GET /compliance/people`, manage key) by name, username or e-mail — never a customer's portal login
or a system account. A person already on a list whose account was suspended since stays on it,
marked, until taken off; only the people a write **adds** are judged (422
`COMPLIANCE_VIEWER_INVALID`).

## 5. Files

### 5.1 Categories and limits

| Category | Types | Limit |
|---|---|---|
| `compliance-documents` | PDF, Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`) | **20 MB** (the owner's) |
| `compliance-folder-covers` | JPEG, PNG, WebP | 5 MB |

The multipart cap sits 5 MB above a category's limit and never above `MAX_UPLOAD_MB`. A document's
type is decided by its **extension** (browsers send Word and Excel under several types, or none),
then its first bytes must agree — `%PDF-`, a zip for `.docx`/`.xlsx`, a compound file for
`.doc`/`.xls` — or it is refused (422 `COMPLIANCE_FILE_CONTENT_MISMATCH`). A cover is judged by its
bytes alone. Arabic file names arrive intact (multer's latin1 reading is undone).

## 6. Opening a file

### 6.1 Through the module, and counted

Every file is filed under `compliance/folder` behind a file authorizer (ADR-023): read — the
responsible person or a person on the folder's list; write and delete — the responsible person.
Readers reach bytes through `GET /compliance/documents/:id/content?mode=view|download`
(`inline` or `attachment`), which writes one access-log row per call (§7). Documents are private
files, so the platform's generic download path stays closed to a reader (it also asks
`file.download`), and the log is not stepped around.

### 6.2 «عرض» for Word and Excel

A browser shows a PDF itself (a new tab). It cannot show `.docx`/`.xlsx`, so
`GET /compliance/documents/:id/preview` reads one into headings, paragraphs and tables, or a
workbook's visible sheets as rows (dates printed as dates), and the page draws it in a dialog. The
read runs under the rules every workbook the API opens follows (SEC-2, SEC-13): the zip's entry count
checked from its directory first, each part inflated through a byte counter (a prefix is kept, so a
large file is cut, not refused), every XML part walked once by hand, one 10-second deadline. Limits:
10 sheets × 500 rows × 40 columns, 3,000 blocks; what was cut is reported. Older `.doc`/`.xls`, or a
file that does not read, answer `unavailable` and the page offers the download. A preview is counted
as one view.

## 7. The seen report

`compliance_document_access` — one row per opening or download: `documentId`, `folderId`, `userId`,
`action` (`view` | `download`), `at`; written once, never changed. Only the people the folder is
shared with are counted — the responsible person's own openings are not.

`GET /compliance/documents/:id/views` (manage key) answers, per person on the folder's list: seen or
not, the number of views and of downloads, the first and last time, and the latest 100 events with
their date and time — those who have not seen it first. People who saw the file while it was shared
with them and are no longer on the list are listed apart (`former`). Each file's row on the page
carries «اطّلع n من m».

## 8. API

| Method | Path | Key |
|---|---|---|
| GET | `/compliance/folders` (paginated, `search`) | manage or view |
| GET | `/compliance/folders/:id` | manage or view |
| POST | `/compliance/folders` | manage |
| PATCH | `/compliance/folders/:id` (`name`, `viewerUserIds`, `version`) | manage |
| DELETE | `/compliance/folders/:id?version=` | manage |
| GET | `/compliance/folders/:id/cover?v=` | manage or view |
| POST | `/compliance/folders/:id/cover` (multipart `file`, `version`) | manage |
| DELETE | `/compliance/folders/:id/cover?version=` | manage |
| GET | `/compliance/folders/:id/documents` | manage or view |
| POST | `/compliance/folders/:id/documents` (multipart `file`, optional `name`) | manage |
| PATCH | `/compliance/documents/:id` (`name`, `version`) | manage |
| DELETE | `/compliance/documents/:id?version=` | manage |
| GET | `/compliance/documents/:id/content?mode=view\|download` | manage or view |
| GET | `/compliance/documents/:id/preview` | manage or view |
| GET | `/compliance/documents/:id/views` | manage |
| GET | `/compliance/people` | manage |

Refusals of its own: 409 `COMPLIANCE_FOLDER_NAME_TAKEN`, 422 `COMPLIANCE_VIEWER_INVALID`, 422
`COMPLIANCE_FILE_CONTENT_MISMATCH`; otherwise the platform's (`FILE_TYPE_NOT_ALLOWED`,
`FILE_TOO_LARGE`, `STALE_DOCUMENT`, 404).

## 9. Audit and realtime

Every write is audited under `compliance.folder` (create, update — name, list, picture — delete) or
`compliance.document` (create, rename, delete). Openings and downloads are the access log's, not
the trail's. Both topics are registered for realtime with `complianceFile.manage`: readers join no
room (a signal names a folder id), and their page reads again on focus.

## 10. Boot

`seedCompliance`: the module's indexes first (`syncDeclaredIndexes('apply', …)`), the two file
categories, the two managed roles, then the readers' grants reconciled (§4.2). Each step that fails
is a line in the log and is repeated where it is needed.

## 11. The page

`/compliance/files` (`/compliance` lands on it), opened by either key — the sidebar row is a
`SHARED_NAVIGATION_ROWS` entry. The module tile is **الالتزام والمخاطر** with a shield, last in the
catalog (sortOrder 31; no whole number is free between Administrative Affairs and System
Administration — an administrator can reorder tiles).

Built after HR's `/applicant-documents` shelf, with the module's **own copy** of its folder drawing
(`folder-shell.tsx`) and file helpers, as the owner chose (§1):

- the shelf — one 3D folder per folder, its picture on the front, its file count in the corner, its
  name under it and a line under the name: how many people it is shared with for the responsible
  person, when a file was last added for a reader; a search remembered in the URL; edit/delete
  controls on the caption row for the responsible person; «مجلد جديد» in the header;
- the folder — its files, each with «عرض» and «تنزيل», and «تنزيل الكل»; for the responsible person,
  who it is shared with, «رفع ملف», and per file «اطّلع n من m», «تغيير الاسم» and «حذف»;
- dialogs for the folder (name, people, picture — through the shared `PhotoPickButton`), the upload
  (the shared `FileUpload`, the kind and 20 MB checked before it is sent, with progress), the
  rename, the Word/Excel preview, the seen report, and the confirmations. A save refused because
  someone saved the record meanwhile is rebased on the record as it now is, keeping what was typed,
  and a folder save that stopped part-way continues from what was saved.

The page was checked by a separate agent against the checklist drawn from the reference and the
newest module (after a calibration that found a planted difference); its findings were settled by
the decision order and fixed — the shared pickers, the stale-save rebase, one word for «عرض», the
reference's neutral file glyph and the line under each folder's name among them.

## 12. Tests

- API unit: the folder rules, the intake (names, content sniffing, covers), the preview readers
  (docx blocks, shared strings, date styles, sheet rows, limits), the manifest.
- API integration (`tests/integration/compliance-files.spec.ts`, real HTTP, RBAC and Mongo): the
  seeded roles; a folder shown only to its list (404 to others, even holders of the view key); the
  reader grant given and taken back; the duplicate name; the eligible people; renames under the
  version; covers; the three kinds accepted and the rest refused, by name and by content; the
  20 MB limit; a reader who can only view and download; the preview; the platform's download path
  closed to a reader; the seen report with counts and times; a person taken off kept under
  `former`; deletes.
- Web: i18n in both languages for every key the module uses and its refusals; the folder form's
  rules; the persistence census entry.

## 13. Later

- Readers' screens refresh on focus, not live (§9).
- A file is replaced by deleting it and uploading again; versions of one file are not kept.
- The seen report has no export.
