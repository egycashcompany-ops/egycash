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
read functions built on `fleetVehicleRepository`:

- `listActiveVehicleCodes({ page, pageSize })` returns `{ id, code }` of active, non-deleted cars,
  in Fleet's code order (`sortBy: 'code'`).
- `findActiveVehicle(id)` returns `{ id, code, branchId }`, or nothing when the car is missing,
  deleted or not active.

IT never writes a Fleet collection and imports nothing else of Fleet's. Vehicles still never enter
`it_assets`. A tracker SIM on a mobile line still names its car in text (FR-19 is unchanged).

Alternatives set aside:
- **Name the car in text, as FR-19 does.** The owner asked for a dropdown of cars with search, and
  a typed code would give no list and no check that the car exists.
- **An IT copy of the car list, fed by Fleet's events** (§3's "id + event subscription"). This
  would add a collection, a subscription and a back-fill, all to mirror about two hundred rows,
  and the copy could go stale.
- **Re-export the whole repository, as Operations and Gold do.** This would hand IT Fleet's write
  methods, protected only by a comment. The two named functions keep the surface to what the form
  reads.

## 6. How it works

### 6.1 API (under `/api/v1/it/vehicle-checks`)

| Method and path | Grant | What it does |
|---|---|---|
| `GET /vehicles?page=&pageSize=` | `create` | One page of active cars `{ id, code }` in Fleet's code order, paginated per [API Standards §4](../04-standards/api-standards.md) (pageSize at most 100). The form walks the pages and holds the list. |
| `POST /` | `create` | File a report. Body: `{ vehicleId, checkDate: 'YYYY-MM-DD', items: { key: 'works' \| 'notWorking' \| null } (missing keys are null), notes?, clientRequestId }`. Returns **201** with the report. If the `clientRequestId` is known, returns **200** with the existing report: same reporter, nothing written. Refusals: **404** `VEHICLE_NOT_FOUND` for a missing or deleted car; **422** `VEHICLE_NOT_ACTIVE`; **422** `VALIDATION_ERROR` for a day after today in Cairo; **409** when another user already used the `clientRequestId`. |
| `POST /:id/photos` | `create` | Adds one photo (multipart `file`) and returns **200** with the report. Refusals: **404** when the report is not the caller's or is deleted (its existence is not revealed); **422** `PHOTO_LIMIT_REACHED` at five photos; **422** `PHOTO_WINDOW_CLOSED` more than 24 hours after filing; **422** `FILE_TOO_LARGE` or an unsupported type (the category's rules). |

**The car list loads in full.** This deviates from
[ADR-019](../03-decisions/ADR-019-reference-pickers-search-not-load-all.md) (pickers search the
server), deliberately. The owner has required that a car picker show every code («لازم لازم تظهر
كلها»), and Fleet's own `VehicleCodeCombobox` loads its whole registry for that reason. About two
hundred active cars at `{ id, code }` come to a few kilobytes. The form then reuses Fleet's
client-side ranking (`rankVehicleCodes`, `asciiDigits`). The alternative, a server search that
returns one page, would open the box on part of the list, the behaviour the owner rejected. The
endpoint itself stays paginated, so no call returns an unbounded answer.

**Filing and photos, in order.** The form files the report first, then uploads its photos one at a
time, in order. Each upload waits for the previous one. On the server, a photo is attached by one
conditional update: filter `{ _id, createdBy: caller, isDeleted: false, 'photos.4': { $exists:
false }, createdAt ≥ now − 24 h }`, `$push` the photo. When the filter misses, the service tells
which rule refused it. So two uploads that race cannot leave six photos. The file is stored before
that update. When the update misses, the service soft-deletes the stored file (best effort, as the
custody signed-copy upload does).

**Audit and realtime.** Filing is audited as `create` and an added photo as `update`, both with the
literal entity ref `{ moduleId: 'it', entityType: 'vehicleCheck' }`. Every audited entity must be
classified in the realtime registry. With no screen that reads reports yet, `it.vehicleCheck` goes
in `REALTIME_EXCLUDED_ENTITIES`, with the reason "no screen until the dashboard". It leaves that
list in the change that builds the dashboard, as the attendance-device entry does. The photo
file's authorizer, `it/vehicleCheck`, lets only the report's reporter write, while holding
`itVehicleCheck.create`. Reading the bytes comes with the dashboard.

### 6.2 Contracts

`packages/contracts/src/modules/it.ts` gains:

- `IT_VEHICLE_CHECK_ITEMS`: the keys, in order;
- `IT_VEHICLE_CHECK_ANSWERS`;
- `IT_VEHICLE_CHECK_MAX_PHOTOS = 5`;
- `IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS = 24`;
- `IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY`;
- the create schema;
- the car-option and report DTOs;
- the error codes.

### 6.3 Web

- **`shared/ui/PhoneShell`**: the captain's frame, moved. It takes the title, the subtitle, the
  back link and the back label, plus a footer slot for the fixed bar. `CaptainShell` becomes a thin
  wrapper with the Operations defaults. The phone-quality rules that pin the captain's screens move
  to one shared rule set, and the IT form's folder is added to it:
  - no fixed width wider than a 360 px phone;
  - `dvh`, never `vh`;
  - a thumb-sized primary action (at least 48 px);
  - a label on every icon-only control;
  - no Latin text, except the owner's «DVR».

  The rule "state lives on the server, not in browser storage" gets one exception: the form's
  `sessionStorage` draft (§2 item 8).
- **The car dropdown**: the shared `Combobox` over the IT car list. Its existing `density` setting
  gains a `touch` value: 16 px text, so iOS does not zoom; 48 px rows; a 40 px clear button; a list
  that ends above the phone keyboard.
- **The answer control**: a two-button radio group with the clear-on-second-tap behaviour, kept
  inside IT.
- **Photos**: the downscaling in Fleet's `fuel-card-thumb.ts` moves to
  `shared/lib/downscale-image.ts`, and the fuel-card thumbnail calls it. Fleet's
  `save-with-photo.ts` pattern (a failed upload is an outcome, not a throw) extends to several
  photos with a failure count.
- **The shared missing-fields banner** gains an optional `lead`. Its default stays «لم يتم الحفظ.».
- **i18n** keys go in formal Arabic and English.

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

## 8. Amendments to the frozen IT design

- §0: vehicles still never enter `it_assets`; the checks read Fleet's list through the boundary.
- §2.12: the record, in short.
- §3: IT imports Fleet only through `it/fleet-boundary.ts`, and only to read.
- §5: FR-21.
- §7: the form's row.
- §9.2: the boundary.
- §11: the dashboard is planned.
- §12: the API row.
- §17: the trail entry.

## 9. Delivery plan

One PR: contracts, then API, then web, with the checks the repository already runs.

1. **Contracts**, as in §6.2, with their spec.
2. **API**:
   - `apps/api/src/modules/it/vehicle-checks/`: model, repository (`collectionReady`,
     `branchField`), service, controller, routes, photo files and authorizer, mapper;
   - `it/fleet-boundary.ts`;
   - the manifest: `declarePermissions` with `create`, the page, the route, the collection, the
     file authorizer;
   - the realtime exclusion;
   - the navigation row.

   The integration spec `it-vehicle-checks.spec.ts` covers:
   - a role holding only `create`, assigned with `own` scope, lists every active car and files on
     a car outside any scope;
   - a repeated `clientRequestId` returns the same report, and another user's use of it is a 409;
   - a missing, deleted or inactive car, and a day after today, are refused;
   - photos: up to five, with the sixth refused; refused after the window; refused on another
     user's report (404); a file whose update misses is cleaned up;
   - two photo uploads racing cannot pass five.
3. **Web**, as in §6.3:
   - the API client;
   - the page and its parts;
   - the route outside the console frame;
   - realtime: nothing, since no reader exists yet.

   Specs: the pure helpers (counts, the payload, the draft, photo sizing, dates, clear-on-second-tap),
   a static render of the page, and the shared phone-quality rules over both folders.
4. **Census and docs**: the page registry, the navigation counts, the IT route, i18n and API-contract
   specs, the realtime registry, `it-module-design.md` (§8 above) and the CHANGELOG.

**Next delivery: the dashboard**, after its sample is approved. It adds `itVehicleCheck.view` and
`.delete`; the reads it needs (the latest report per car, faults per device, active cars with no
recent report, the reports list with photos); the photo bytes for readers; and the realtime topic.
Not planned: notifications or automatic tickets for «لا يعمل», a per-car equipment profile, and
showing the car's Motorola serial on the form. None was asked for.

## 10. Review

To be completed by the review (design-review skill, Full preset).
