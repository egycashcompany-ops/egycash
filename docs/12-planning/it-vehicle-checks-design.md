# IT — Vehicle device checks («فحص أجهزة السيارة», FR-21)

**Status:** the owner approved the phone sample on 2026-11-08 with one change and said to build it
(«طبق PR ولما CI يخضر أدمج»). Four smaller questions went unanswered, so the recommendations put to
him are adopted as defaults (§1.2). This document is the Design Review that the frozen IT design
([it-module-design.md](it-module-design.md), header) requires before an architectural change, here
IT reading Fleet's car list. It amends that design in §0, §2.12, §3, §5 (FR-21), §7, §9.2, §11, §12
and §17. Each amendment is listed in §8 below. The review that checked this document is recorded
in §10.

**This delivery:** the phone form, the record behind it, its photos, its one grant and the car
list. **Not this delivery:** reading, listing and deleting reports, and the IT dashboard. These
come together, after the owner approves the dashboard's own sample (§9).

## 1. The owner's request and the adopted defaults

### 1.1 What the owner decided

- The request (2026-11-08): «I need to create a new form for specific users to use on Mobile to
  inform about the car status — firstly he will choose the car number (included search in the
  dropdown) and the date is default today but can change it — the things that i need to check on
  it: الشاشة · 8 كاميرات: 1- أمام المركبة 2- يمين خلف 3- يسار خلف 4- خلف المركبة 5- كابينه السائق
  6- كابينة الأخصائيين 7- داخل الخزينة 1 8- داخل الخزينة 2 · DVR · جهاز الأتصال (موتورولا) · Notes
  and uploading photo».
- Where it lives: «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند الـ IT يعنى هما اللى هيتحكموا
  فيها — والشاشة بتاعت الفورم نفسها هنخصصها عادى كدور». The reports and their dashboard belong to
  IT. The form is a screen granted through a role like any other. Fleet («الحركة») only supplies
  the car list.
- The sample (a phone, in light and dark themes) was approved with one change: «زرارين يعمل ولا
  يعمل خليهم على نفس الصف مش تحت البند وصغر عرضهم». The two answers now sit on the item's own row
  and are narrow.
- Standing rules: no data is mandatory beyond what he names; formal Arabic on screen; soft delete
  only; existing data is not changed. For car pickers he has said «اكواد السيارات … لازم لازم
  تظهر كلها» (recorded in `VehicleCodeCombobox.tsx`).
- Labels are the owner's own, in formal spelling: «كابينة السائق» (not «كابينه») and «جهاز الاتصال
  (موتورولا)» (not «الأتصال»). «DVR» stays in Latin letters, as he wrote it. The screen is titled
  «فحص أجهزة السيارة» because Fleet already uses «حالة السيارة» for a car being active or out of
  service.

### 1.2 Defaults adopted without his answer

Each question was put to him with a recommendation. They are recorded here as defaults, each with
its trade-off, and the next message to the owner names them so he can overturn any.

1. **Two answers per item, «يعمل» / «لا يعمل».** The alternative, a third answer «غير موجود» for a
   device a car does not have, would make the counts more honest. It was not chosen because the
   owner listed two states. A device the car lacks is left unanswered. Adding a third answer later
   adds one value to the item enum and touches no stored report.
2. **Up to five photos per report.** The alternative was one photo, as the owner's «uploading
   photo» reads. Several were recommended because several cameras can fail at once. Five keeps the
   storage bounded (§7).
3. **Every active car is offered.** The alternatives were every car of any status (an
   out-of-service car in the workshop could then be checked) or only cash-in-transit and ATM cars.
   Active cars match Fleet's car pickers. A car in the workshop is checked once it is active again.
4. **More than one report per car per day.** The alternative was one report per car per day, with
   a second report replacing the first. Several are allowed because a car can be checked at
   dispatch and again at return. "The latest" report of a car (used by the dashboard) is the one
   with the latest `checkDate`, then the latest filing time.

## 2. What the user sees

The form is a phone screen outside the console frame (no sidebar, no top bar). It uses the frame
of the Operations captain's screen («يوم القائد»), the phone page a crew captain works from today:
a sticky header with a back arrow to the home page, the title «فحص أجهزة السيارة» with «تقنية
المعلومات» under it, one column no wider than `max-w-2xl`, and `min-h-dvh`. That frame moves from
`operations/mobile/CaptainShell.tsx` to a shared `PhoneShell`, which both screens use (§6.3).

After sign-in, every user lands on the home page (`WelcomePage`). Its «starting pages» card lists
the first six pages of the user's menu. A user whose only grant is this form finds it there as
their only page.

1. **«كود السيارة»** is a single-car dropdown with search, the same one Fleet's forms use. Opening
   it lists every active car by code, in Fleet's code order. Typing narrows the list, and codes
   that start with the typed text come first. Arabic-Indic digits are read as Western digits. A
   code with a space («كورولا 1») is one car. This is the one required field. Pressing «إرسال
   التقرير» without a car shows the shared missing-fields banner, whose lead reads «لم يتم إرسال
   التقرير.» instead of «لم يتم الحفظ.», followed by the missing fields as usual, and marks the box
   «حقل مطلوب».
2. **«التاريخ»** is a date box filled with today in Cairo (`cairoYmd(new Date())`). It can be
   changed to an earlier day. A later day is refused, by the box's `max` and by the server. If the
   user empties the box, the banner lists «التاريخ» as missing, like the car.
3. **The items**, in the owner's order: a card «الشاشة»; a card «الكاميرات» with eight numbered
   rows; a card «DVR»; a card «جهاز الاتصال (موتورولا)». Each row carries its label at the start
   and, on the same row at the end, two narrow buttons: «يعمل» (✓) and «لا يعمل» (✕). Nothing is
   chosen at first. Tapping the chosen button again clears it. A chosen «يعمل» is green and a
   chosen «لا يعمل» is red, and the icon tells them apart without the colour. An item left
   unanswered is filed as unanswered («لم يُفحص»). A long label wraps beside its buttons; the
   buttons never drop under it.
4. **«ملاحظات»** is one text box for the whole report. It is optional, at most 1000 characters.
5. **«الصور»** is optional, up to five photos. On a touch screen there are two buttons,
   «تصوير بالكاميرا» and «اختيار من الجهاز» (the shared `PhotoSourceButtons`). On any screen, a
   dashed box «اضغط لإضافة صورة» opens the file dialog, so a computer can add photos too. Each photo
   shows as a row with its thumbnail and a ✕ to drop it before sending. Before upload the phone
   re-encodes each photo as a JPEG whose longest edge is at most 1600 px. Re-encoding also strips
   the photo's location data. If the browser cannot decode a photo (for example a HEIC file), the
   original is sent when it is a JPEG, PNG or WebP of 10 MB or less, and is otherwise refused with
   a message.
6. **A bar fixed at the bottom** shows «تم فحص n من 11» and, when there are any, «· m لا يعمل».
   Under it is a full-width «إرسال التقرير» button. The page is padded by the bar's height plus the
   phone's bottom safe area, so the bar never covers the last photo row.
7. **After sending**, the screen shows «تم إرسال التقرير» with the car, the day, «x يعمل · y لا
   يعمل», and the number of photos, plus a «تقرير لسيارة أخرى» button. That button clears the form
   and keeps the day. If a photo failed to upload, the summary says how many, and «إعادة رفع الصور»
   sends them again to the same report.
8. **While the form is being filled**, the car, the day, the answers and the notes are kept as a
   draft in the tab's `sessionStorage`. A phone that unloads the tab while the camera app is open
   then brings them back. Photos are not kept, because of their size. The draft is cleared once the
   report is sent.

## 3. The record — `it_vehicle_checks`

`{ vehicleId, vehicleCode, branchId, checkDate, items: { screen, camera1 … camera8, dvr, radio },
notes?, photos: [{ fileId, fileName, mime, size, uploadedAt }], reportedByUserId, reportedByName,
clientRequestId }` plus the platform's `baseFields` (soft delete, `createdBy`, `updatedBy`,
`schemaVersion`) and timestamps.

- `vehicleId` is Fleet's id. `vehicleCode` and `branchId` are the car's code and branch **at
  filing**, so a renamed, moved or disposed car keeps its old reports readable and under the
  branch the car had then. `branchId` is the data-scope anchor (`branchField`) for the readers to
  come. A car with no branch (Fleet's type allows it on old records) is filed with none (§7).
- `checkDate` is the Cairo calendar day the check is for, stored as that day's UTC midnight (the
  date-only convention, `ymdToUtcDate`). It is never later than today in Cairo.
- `items` is a fixed set of eleven keys, defined in one contract constant
  (`IT_VEHICLE_CHECK_ITEMS`) that also holds their order and labels. Each value is `works`,
  `notWorking` or `null`. `null` means unanswered. It exists only because no answer is mandatory,
  and it is also how a device the car does not have is recorded (§1.2, default 1). The eight
  cameras, in order: front, right-rear, left-rear, rear, driver's cabin, specialists' cabin, inside
  safe 1, inside safe 2.
- `notes` is trimmed. An empty note is absent.
- `photos` holds at most five references to platform Files. Their category is
  `it-vehicle-check-photos`: JPEG, PNG or WebP, at most 10 MB each, private, moduleId `it`.
- `reportedByUserId` and `reportedByName` are the reporter's user id and display name at filing.
  They follow the IT actor fields (`issuedByUserId`, `assignedByUserId`) and the snapshot names
  that the asset and line histories keep. `createdBy` holds the same user. No `ownerUserField` is
  declared, because the default `own` scope already matches `createdBy`.
- `clientRequestId` is a UUID that the form makes once per report. It has a unique index, so a
  repeated send of the same report (a lost answer on mobile data, or a double tap) returns the
  report that already exists instead of filing a second one. This is the per-entity form of API
  Standards §6's idempotency: the platform has no inbound `Idempotency-Key` store.
- No other unique index: several reports per car per day are allowed (§1.2, default 4). Indexes
  are `{ vehicleId, checkDate: -1, createdAt: -1 }` (the latest per car) and `{ branchId,
  checkDate: -1 }` (a scoped list). They are built before the first write (`collectionReady`),
  because production runs with `autoIndex` off.
- A report's car, day, answers and notes never change. Only photos are added: by the reporter,
  within 24 hours of filing, up to five in all. A wrong report is corrected by filing a new one,
  since the latest one counts. Deleting the wrong one (a soft delete) comes with the dashboard,
  under IT's delete grant (§9).
- The record stores a user id, never an `employeeId`. The workforce reset
  (`apps/api/src/workforce-reset/targets.ts`) purges or keeps every collection that names an
  employee, so it has nothing to do here.

## 4. Grants

There is one resource, `itVehicleCheck`, labelled «فحص أجهزة السيارات» in the roles screen. The
label is plural because the resource covers every car's checks; the screen, which checks one car,
is singular. The page is `it.vehicle-checks`, route `/it/vehicle-checks/new`.

| Key | What it allows |
|---|---|
| `itVehicleCheck.create` | the phone form: list the active cars, file a report, add photos to one's own report within 24 hours of filing |

- The `view` and `delete` keys come with the dashboard that uses them (§9). No screen in this
  delivery reads a report, so none is granted.
- The form's grant implies no other IT or Fleet grant. The car list is IT's own endpoint under
  `itVehicleCheck.create`, so the reporter needs neither `fleetVehicle.view` nor `itAsset.view`.
  `fleetVehicle.view` would open Fleet's registry, including chassis, engine and licence image.
- **The car list and filing ignore the reporter's data scope.** This is a design decision, not the
  owner's. It follows from default 3 («every active car») and from how roles are assigned: the
  roles screen offers `own` as the default scope, and `own` over cars means "cars this user
  created", which is no car at all. A branch-scoped role would also hide the cars of other
  branches that a reporter may be sent to check. Scope still governs READING reports when the
  dashboard adds it: each record keeps the car's branch. The next message to the owner states this
  so he can ask for branch-limited reporting instead.
- No role is seeded. On deploy, as for every new key, only super-admin holds it
  (`syncPermissionRegistry`), until an admin builds the role («نخصصها عادى كدور»).
- A navigation row in the IT category, «فحص أجهزة السيارة» → `/it/vehicle-checks/new`, under
  `itVehicleCheck.create`, with the `vehicle` glyph. No other IT row uses it.

## 5. The Fleet boundary (amends IT §3 and §9.2)

IT §3 said "IT never imports HR or Fleet services", and §9.2 said IT reads nothing of Fleet's.
This form needs Fleet's car list. So IT gets one import surface,
`apps/api/src/modules/it/fleet-boundary.ts`. It does not re-export the whole repository, as
[`operations/fleet-boundary.ts`](../../apps/api/src/modules/operations/fleet-boundary.ts) and
[`gold/fleet-boundary.ts`](../../apps/api/src/modules/gold/fleet-boundary.ts) do. It exports two
read functions built on `fleetVehicleRepository`. Neither applies a data scope:

- `listActiveVehicleCodes({ page, pageSize }): Promise<Paginated<{ id, code }>>` returns active,
  non-deleted cars through `listVehicles`, `sortBy: 'code'`, ascending. That is Fleet's code order;
  the generic `list()` would silently sort by creation date.
- `findVehicleForCheck(id): Promise<{ id, code, branchId, status } | null>` returns `null` for a
  missing or deleted car. IT decides what a non-active `status` means.

IT never writes a Fleet collection and imports nothing else of Fleet's. A static spec enforces
this: no file under `apps/api/src/modules/it/` other than `fleet-boundary.ts` may import from
`modules/fleet`. Vehicles still never enter `it_assets`. A tracker SIM on a mobile line still names
its car in text (FR-19 is unchanged).

Alternatives set aside:
- **Name the car in text, as FR-19 does.** The owner asked for a dropdown of cars with search, and
  a typed code would give no list and no check that the car exists.
- **An IT copy of the car list, fed by Fleet's events** (§3's "id + event subscription"). This
  would add a collection, a subscription and a back-fill, all to mirror about two hundred rows,
  and the copy could go stale.
- **Re-export the whole repository, as Operations and Gold do.** This would hand IT Fleet's write
  methods, protected only by a comment.

## 6. How it works

### 6.1 API (under `/api/v1/it/vehicle-checks`, every route under `itVehicleCheck.create`)

| Method and path | Answer | Refusals |
|---|---|---|
| `GET /vehicles?page=&pageSize=` | **200**, one page of `{ id, code }` (pageSize at most `MAX_PAGE_SIZE`, 100) | **400** `VALIDATION_FAILED` for a bad page or a pageSize over 100 |
| `POST /` | **201** with the new report; **200** with the existing one when the caller already filed this `clientRequestId` | **400** `VALIDATION_FAILED` (the schema, including a day after today in Cairo); **404** `NOT_FOUND` for a missing or deleted car; **422** `IT_VEHICLE_NOT_ACTIVE`; **409** `IT_VEHICLE_CHECK_REQUEST_REUSED` when another user filed with that `clientRequestId` |
| `POST /:id/photos` (multipart `file`) | **200** with the report | **404** `NOT_FOUND` when the report is missing, deleted or not the caller's (its existence is not revealed); **422** `IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED` more than 24 hours after filing; **422** `IT_VEHICLE_CHECK_PHOTO_LIMIT` at five photos; **422** `FILE_TOO_LARGE` or `FILE_TYPE_NOT_ALLOWED` (the category's rules) |

The new codes go in the central catalog, `packages/contracts/src/errors/index.ts` (API Standards
§5).

**The car list loads in full**, by
[ADR-037](../03-decisions/ADR-037-vehicle-code-pickers-list-every-active-car.md), which supersedes
[ADR-019](../03-decisions/ADR-019-reference-pickers-search-not-load-all.md) rules 4 and 5 for
vehicle-code pickers. The owner requires a car picker to show every code («لازم لازم تظهر كلها»).
The form walks the pages with Fleet's `fetchWholeCatalog` and ranks in the browser with Fleet's
`rankVehicleCodes`.

**Filing.** The service handles a report in this order:
1. Look up `clientRequestId`, unscoped. If found, the same reporter gets **200** with that report,
   whatever has changed since (the car may be inactive now, or Cairo's day may have turned), and
   another user gets **409**.
2. `findVehicleForCheck`: `null` means **404**; a status other than `active` means **422**.
3. Create the report: the car's code and branch, the reporter, the answers (a missing key becomes
   `null`), the trimmed note.
4. If the insert hits the unique `clientRequestId` index, two sends raced. The service re-reads
   the report and answers as in step 1.
5. Audit `create`.

**Photos.** The service handles one photo in this order:
1. Read the report, unscoped, with `createdBy` equal to the caller and not deleted. If there is
   none, answer **404**.
2. If it was filed more than 24 hours ago, answer **422** (window closed). If it has five photos,
   answer **422** (limit). These run before the file is stored, so a refused photo stores nothing.
3. Store the file through `fileService.upload`.
4. One atomic conditional update adds the photo only if the report is still the caller's, not
   deleted, under five photos and inside the window. It stamps `updatedBy` and bumps the version.
5. If that update misses (a racing upload or a deletion got there first), soft-delete the stored
   file (best effort, as the custody signed copy does), re-read the report, and answer with the
   first rule it now breaks: not found, then window, then limit.
6. Audit `update`.

Two racing uploads therefore cannot leave six photos.

**Files.** The category is `it-vehicle-check-photos` («صور فحص أجهزة السيارات» / "Vehicle device
check photos"): JPEG, PNG and WebP, 10 MB, no retention, private. The entity authorizer
`it/vehicleCheck` answers a write only for the report's own reporter holding
`itVehicleCheck.create`, unscoped. It answers no read until the dashboard. The upload route
reuses IT's single-file intake (`signedCopyUpload`, 15 MB outer cap; the category's 10 MB is the
real limit).

**Audit and realtime.** Audit entries use the literal entity ref `{ moduleId: 'it', entityType:
'vehicleCheck' }`. Every audited entity must be classified in the realtime registry. With no screen
that reads reports yet, `it.vehicleCheck` goes in `REALTIME_EXCLUDED_ENTITIES`, with the reason "no
screen until the dashboard". It leaves that list in the change that builds the dashboard, as the
attendance-device entry does.

### 6.2 Contracts (`packages/contracts/src/modules/it.ts`)

```ts
export const IT_VEHICLE_CHECK_ITEMS = ['screen', 'camera1', 'camera2', 'camera3', 'camera4',
  'camera5', 'camera6', 'camera7', 'camera8', 'dvr', 'radio'] as const;   // the owner's order
export const IT_VEHICLE_CHECK_ANSWERS = ['works', 'notWorking'] as const;
export const IT_VEHICLE_CHECK_MAX_PHOTOS = 5;
export const IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS = 24;
export const IT_VEHICLE_CHECK_NOTES_MAX = 1000;
export const IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY = 'it-vehicle-check-photos';

export const CreateItVehicleCheckSchema = z.object({
  vehicleId: objectId,
  checkDate: ymd.refine((d) => d <= cairoYmd(new Date()), 'checkDate is after today in Cairo'),
  items: z.object(/* each key: z.enum(IT_VEHICLE_CHECK_ANSWERS).nullable().default(null) */).strict(),
  notes: z.string().trim().max(IT_VEHICLE_CHECK_NOTES_MAX).optional(),   // '' is dropped by the service
  clientRequestId: z.string().uuid(),
}).strict();

export interface ItVehicleOptionDto { id: string; code: string }
export interface ItVehicleCheckPhotoDto { fileId: string; fileName: string; mime: string; size: number; uploadedAt: string }
export interface ItVehicleCheckDto {
  id: string; version: number; vehicleId: string; vehicleCode: string; branchId: string | null;
  checkDate: string /* YYYY-MM-DD */; items: Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;
  notes: string | null; photos: ItVehicleCheckPhotoDto[];
  reportedByUserId: string; reportedByName: string; clientRequestId: string; createdAt: string;
}
```

`objectId` and `ymd` are the helpers `it.ts` already uses. The list query is the shared
`PaginationQuerySchema`. The labels are not in contracts: the web's i18n holds them, keyed by
item.

### 6.3 Web

- **`shared/ui/PhoneShell.tsx`** is the captain's frame, moved. It takes `title`, `subtitle`,
  `backTo`, `backLabel` and a `footer` slot. When a footer is given, the content is padded by the
  footer's height plus `env(safe-area-inset-bottom)`. `AppVersion` stays at the foot of the content.
  `CaptainShell` becomes a thin wrapper that passes the Operations defaults (`backTo:
  '/operations'`, the `operations.mobile.backToConsole` label).
  - `mobile-quality.spec.tsx` keeps every assertion. The ones that read `CaptainShell.tsx`'s source
    (`max-w-2xl`, `min-h-dvh`, no `min-h-screen`, `aria-label=`) now read `PhoneShell.tsx`.
  - A new `apps/web/src/modules/it/mobile/it-mobile-quality.spec.tsx` applies the same rules to
    `apps/web/src/modules/it/mobile/`: no width of 400 px or more, `dvh`, the primary action
    `min-h-12`, a label on every icon-only control, no AppShell, Arabic-only JSX text except «DVR».
  - The no-browser-storage rule exempts exactly one file, `vehicle-check-draft.ts`.
- **The car dropdown** is the shared `Combobox` with a new `density: 'touch'`. It is sizes only:
  16 px text (so iOS does not zoom), 48 px rows, a 40 px clear button, and a list capped at 17rem
  so it ends above a phone keyboard when the field sits near the top of the screen. The list comes
  from a hook over `GET /it/vehicle-checks/vehicles` through `fetchWholeCatalog` (pageSize
  `MAX_PAGE_SIZE`), refetched when the box opens on a list older than a minute. Ranking uses
  `rankVehicleCodes`, and digits are folded by Fleet's `asciiDigits`. IT web already imports Fleet's
  libs (`fleet-report-print`, `fleet-sheet`).
- **The answer control** (`VehicleCheckAnswer.tsx`) is a radio group of two narrow buttons. A
  second tap on the chosen button clears it.
- **Photos.** A new `shared/lib/image-downscale.ts` exports `downscaleToJpeg(file, { maxSide: 1600,
  quality: 0.82 }): Promise<Blob | null>`. It decodes with `createImageBitmap(file, {
  imageOrientation: 'from-image' })` and returns `null` when the browser cannot decode the file.
  Fleet's `fuel-card-thumb.ts` is not touched: its blur hides a card's PIN, and that path stays as
  it is. `uploadPhotosInOrder(reportId, files)` in the IT lib uploads one file at a time and returns
  each file's outcome. The failed `File`s are kept so «إعادة رفع الصور» can send them again.
- **The draft** uses Fleet's `writeDraft` and `clearDraft` (`lib/draft-storage.ts`) under the key
  `ecms.it.vehicleCheck.draft.v1`. It holds the car id, the day, the answers, the notes and the
  `clientRequestId`: a tab restored after a send that got no answer resends as the same report. It
  is read when the page mounts and cleared on success or on «تقرير لسيارة أخرى».
- **The shared missing-fields banner** (`shared/ui/required-fields.tsx`) gains an optional `lead`.
  Its default stays «لم يتم الحفظ.».
- **Labels.** The i18n keys go under `it.vehicleCheck.*`, in Arabic and English. The resource is
  «فحص أجهزة السيارات» / "Vehicle device checks". The page and the nav row are «فحص أجهزة السيارة»
  / "Vehicle device check", sortOrder 100, after the IT catalogs, with the icon `vehicle` (already
  in `app-icon.tsx`).

## 7. Risks and limits

- **Storage.** For illustration only, not a measurement: 200 cars × 1 report a day × 3 photos ×
  about 300 KB comes to about 65 GB a year, and about 110 GB at five photos. The server does not
  decode images, so a client that skips downscaling can store up to 10 MB per photo, 50 MB per
  report. No retention is set: the files are kept, as the custody papers are. The bound is the
  grant, given only to the people named in the role. There is no per-day cap; the dashboard will
  show the volume.
- **Sensitive photos.** Two cameras look inside the car's safe. The photos are private Files. In
  this delivery only their reporter can write them, and no one can read them through the API until
  the dashboard brings `itVehicleCheck.view`.
- **A wrong report stays until the dashboard.** The reporter cannot delete. Until IT's delete
  grant arrives, a wrong report is corrected by filing again, and the latest one counts.
- **A car with no branch** is filed with no branch. When the dashboard reads under a branch scope,
  only organization-wide readers will see those reports.
- **Photos taken before the tab is unloaded are lost.** The draft keeps everything else (§2 item
  8). The reporter takes them again.
- **No earliest day.** Only a day later than today is refused. The owner set no limit.
- **API Standards §6's `Idempotency-Key`** is not implemented as a platform store today; this
  entity's `clientRequestId` gives the same guarantee for its one create.

## 8. Amendments to the frozen IT design

- §0: vehicles still never enter `it_assets`; the checks read Fleet's list through the boundary.
- §1: the vehicle-code picker is the exception to "server-side search" (ADR-037).
- §2.12: the record, in short.
- §3: IT imports Fleet only through `it/fleet-boundary.ts`, and only to read.
- §5: FR-12 names the same exception; FR-21 is added.
- §7: the form's row.
- §9.2: the boundary.
- §11: the dashboard is planned.
- §12: the API row.
- §17: the trail entry.

## 9. Delivery plan

One PR. Every step leaves `npm run typecheck`, `npm run lint` and the workspace's tests green (the
contracts, then `apps/api`, then `apps/web`). The full gate runs at the end: the repository's CI
steps plus `node scripts/check-formal-arabic.mjs`, `node scripts/check-page-registry.mjs` and
`node scripts/gen-permission-matrix.mjs --check`.

**Step 1: contracts.**

| File | Change |
|---|---|
| `packages/contracts/src/modules/it.ts` | add §6.2 |
| `packages/contracts/src/errors/index.ts` | add `IT_VEHICLE_NOT_ACTIVE`, `IT_VEHICLE_CHECK_REQUEST_REUSED`, `IT_VEHICLE_CHECK_PHOTO_LIMIT`, `IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED` |
| `packages/contracts/src/modules/it.spec.ts` | the schema: missing keys become `null`, an unknown key or answer is refused, `notes` over 1000 is refused, a non-UUID request id is refused, tomorrow in Cairo is refused while today passes at 00:30 Cairo (UTC still on yesterday) |

**Step 2: API**, with the counts that pin the grant and the page.

| File | Change |
|---|---|
| `apps/api/src/modules/it/fleet-boundary.ts` | create (§5) |
| `apps/api/src/modules/it/fleet-boundary.spec.ts` | create: no other IT file imports `modules/fleet` |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.model.ts` | create (§3), with the three indexes |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.repository.ts` | create: `branchField: 'branchId'`, `collectionReady` (imported from `../mobile-lines/ensure-collection`), `findByClientRequestId`, `findOwnLive(id, userId)`, `pushPhoto(id, userId, photo, filedAfter)` (the atomic update of §6.1) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.service.ts` | create: `listVehicles`, `file`, `addPhoto` (§6.1) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check-files.ts` | create: the category and the `it/vehicleCheck` authorizer |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.controller.ts`, `vehicle-check.routes.ts`, `index.ts` | create |
| `apps/api/src/modules/it/it.mappers.ts` | add `toItVehicleCheckDto` (IT's mappers live here) |
| `apps/api/src/modules/it/it.module.ts` | `declarePermissions('it', 'itVehicleCheck', …, ['create'])`, the page `it.vehicle-checks` (route `/it/vehicle-checks/new`, sortOrder 100), the route `/it/vehicle-checks`, the collection `it_vehicle_checks`, the file authorizer |
| `apps/api/src/platform/realtime/realtime-registry.ts` | add the exclusion |
| `apps/api/src/platform/kernel/page-registry.spec.ts` | the pinned counts: one more page, one more permission, `it` one more page |
| `apps/api/tests/integration/it-vehicle-checks.spec.ts` | create; cases below |

**Step 3: web**, with the nav row: its spec checks that the row has a route.

| File | Change |
|---|---|
| `apps/web/src/shared/ui/PhoneShell.tsx` | create (§6.3) |
| `apps/web/src/modules/operations/mobile/CaptainShell.tsx` | becomes the wrapper |
| `apps/web/src/modules/operations/mobile/mobile-quality.spec.tsx` | re-point the frame assertions at `PhoneShell.tsx` |
| `apps/web/src/shared/ui/Combobox.tsx` | `density: 'touch'` |
| `apps/web/src/shared/ui/required-fields.tsx` | optional `lead` |
| `apps/web/src/shared/lib/image-downscale.ts` (+ `.spec.ts`) | create; the spec covers the size arithmetic |
| `apps/web/src/modules/it/api/it-api.ts`, `it-queries.ts` | the car list, `fileVehicleCheck`, `uploadVehicleCheckPhoto` |
| `apps/web/src/modules/it/lib/vehicle-check-form.ts` (+ `.spec.ts`) | create: counts, the payload, clear-on-second-tap, the default day, the banner's fields |
| `apps/web/src/modules/it/lib/vehicle-check-photos.ts` (+ `.spec.ts`) | create: `uploadPhotosInOrder`, the type and size check, the fallback rule |
| `apps/web/src/modules/it/mobile/vehicle-check-draft.ts` (+ `.spec.ts`) | create: read, write, clear, the key |
| `apps/web/src/modules/it/mobile/VehicleCheckPage.tsx`, `VehicleCheckAnswer.tsx`, `VehicleCheckPhotos.tsx`, `VehicleCheckSent.tsx` | create |
| `apps/web/src/modules/it/mobile/it-mobile-quality.spec.tsx` | create (§6.3) |
| `apps/web/src/modules/it/mobile/vehicle-check-page.spec.tsx` | create: a static render shows the 11 labels in order, «DVR», «إرسال التقرير», the date box, and the banner lead «لم يتم إرسال التقرير.» when the car is missing |
| `apps/web/src/modules/it/routes.tsx` | the route outside `AppShell`, under `RequirePermission itVehicleCheck.create` |
| `apps/web/src/modules/it/it-routes.spec.ts` | the path list |
| `apps/web/src/modules/it/it-api-contract.spec.ts`, `it-i18n.spec.ts` | the new endpoints and keys, if their lists are pinned |
| `apps/web/src/platform/localization/i18n.ts` | the `it.vehicleCheck.*` keys, added only |
| `apps/web/src/shared/ui/Combobox` and `required-fields` specs (existing, or created next to them) | `touch` sizes; `lead` given and the default unchanged |
| `apps/api/src/seed-navigation.ts` | the IT row |
| `apps/api/src/seed-navigation.spec.ts`, `apps/api/tests/integration/auth-seed-login.spec.ts` | the row count (`SEEDED_APPLICATIONS`) |

**Step 4: docs.** `docs/12-planning/it-module-design.md` (§8 above), this document's §10, and
`CHANGELOG.md` under `[Unreleased]` → `### Added`.

**The integration spec `it-vehicle-checks.spec.ts`:**

- **Grants.**
  - Without `itVehicleCheck.create`, all three routes answer 403.
  - So they do for a user who holds only `fleetVehicle.view`.
- **Car list.**
  - A role holding only `create`, assigned with `own` scope, gets every active car in Fleet's code
    order, across two pages.
  - Out-of-service, disposed and deleted cars are absent.
  - A pageSize of 101 is refused.
- **Filing.**
  - Filing on a car of another branch works. The report carries the car's code and branch; a car
    with no branch gives `branchId: null`.
  - Missing item keys are stored as `null`, a note of spaces is absent, and the reporter's name is
    snapshotted.
  - A missing or deleted car answers 404, and an out-of-service car 422.
  - Tomorrow in Cairo is refused (400). Today passes at 00:30 Cairo, with the clock pinned.
- **Idempotency.**
  - A repeated `clientRequestId` answers 200 with the same id, even after the car went inactive.
  - The same id from another user answers 409.
  - Two concurrent first sends give one 201 and one 200, and a single stored report.
- **Photos.**
  - Up to five photos are accepted, and the sixth answers 422 (limit).
  - A photo 24 hours and one minute after filing (clock pinned) answers 422 (window).
  - A photo on another user's report, or on a deleted one, answers 404, and nothing is stored.
  - A branch-scoped reporter adds photos to a report on another branch's car.
  - Six concurrent uploads leave exactly five photos, and the loser's file is soft-deleted.
  - A file over 10 MB or of another type is refused.
- **Audit.** Audit rows exist for `create` and `update`, with the literal entity ref.
- **Files.** The file authorizer refuses a read, and refuses a write by a non-reporter or by a user
  without `create`.

**Next delivery: the dashboard**, after its sample is approved. It adds `itVehicleCheck.view` and
`.delete`; the reads it needs (the latest report per car, faults per device, active cars with no
recent report, the reports list with photos); the photo bytes for readers; and the realtime topic.
Not planned: notifications or automatic tickets for «لا يعمل», a per-car equipment profile, and
showing the car's Motorola serial on the form. None was asked for.

## 10. Review

To be completed by the review (design-review skill, Full preset).
