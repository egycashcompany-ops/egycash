# IT — Vehicle device checks («فحص أجهزة السيارة», FR-21)

**Status:** the owner approved the phone sample on 2026-11-08 with one change and said to build it
(«طبق PR ولما CI يخضر أدمج»). Four smaller questions went unanswered, so the recommendations put to
him are adopted as defaults (§1.2). This document is the Design Review that the frozen IT design
([it-module-design.md](it-module-design.md), header) requires before an architectural change, here
IT reading Fleet's car list. It amends that design in §0, §2.12, §3, §5 (FR-21), §7, §9.2, §11, §12
and §17. Each amendment is listed in §8 below. §10 records the fresh-context review that checked
this document.

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
notes?, photos: [{ clientPhotoId, fileId, fileName, mime, size, uploadedAt }], reportedByUserId,
reportedByName, clientRequestId }` plus the platform's `baseFields` (soft delete, `createdBy`, `updatedBy`,
`schemaVersion`) and timestamps.

- `vehicleId` is Fleet's id. `vehicleCode` and `branchId` are the car's code and branch **at
  filing**, so a renamed, moved or disposed car keeps its old reports readable and under the
  branch the car had then. `branchId` is the data-scope anchor (`branchField`) for the readers to
  come. A car with no branch (Fleet's type allows it on old records) is filed with none (§7).
- `checkDate` is the Cairo calendar day the check is for, stored as that day's UTC midnight (the
  date-only convention, `ymdToUtcDate`). It is never later than today in Cairo.
- `items` is a fixed set of eleven keys, defined in one contract constant
  (`IT_VEHICLE_CHECK_ITEMS`) that holds their order; their labels live in the web's i18n (§6.3). Each value is `works`,
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

IT never writes a Fleet collection and imports nothing else of Fleet's. An ESLint
`no-restricted-imports` rule enforces this: no file under `apps/api/src/modules/it/` other than
`fleet-boundary.ts` may import from `modules/fleet` (the payroll→attendance seam is the precedent). Vehicles still never enter `it_assets`. A tracker SIM on a mobile line still names
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
| `POST /:id/photos` (multipart: `file`, and `clientPhotoId`, a UUID) | **200** with the report; **200** unchanged when that `clientPhotoId` is already on the report | **400** `VALIDATION_FAILED` for a malformed id, a missing `file` part or a missing `clientPhotoId`; **404** `NOT_FOUND` when the report is missing, deleted or not the caller's (its existence is not revealed); **422** `IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED` more than 24 hours after filing; **422** `IT_VEHICLE_CHECK_PHOTO_LIMIT` at five photos; **422** `FILE_TOO_LARGE` or `FILE_TYPE_NOT_ALLOWED` (the category's rules) |

The new codes go in the central catalog, `packages/contracts/src/errors/index.ts` (API Standards
§5).

**The car list loads in full**, by
[ADR-037](../03-decisions/ADR-037-vehicle-code-pickers-list-every-active-car.md), which supersedes
[ADR-019](../03-decisions/ADR-019-reference-pickers-search-not-load-all.md) rules 4 and 5 for
vehicle-code pickers. The owner requires a car picker to show every code («لازم لازم تظهر كلها»).
The form walks the pages with Fleet's `fetchWholeCatalog` and ranks in the browser with Fleet's
`rankVehicleCodes`.

**Filing.** The service (`file`) handles a report in this order:
1. Look up `clientRequestId`, unscoped. If found, the same reporter gets **200** with that report,
   whatever has changed since (the car may be inactive now, or Cairo's day may have turned), and
   another user gets **409**.
2. `findVehicleForCheck`: `null` means **404**; a status other than `active` means **422**.
3. Create the report: the car's code and branch, the reporter, the answers (a missing key becomes
   `null`), the trimmed note (absent when empty).
4. `BaseRepository.create` turns a duplicate key into `ConflictError`. When that conflict is on
   `clientRequestId`, two sends raced: the service re-reads the report and answers as in step 1.
5. Audit `create`.

**Photos.** The service (`addPhoto`) handles one photo in this order:
1. Read the report, unscoped, with `createdBy` equal to the caller and not deleted. If there is
   none, answer **404**.
2. If `clientPhotoId` is already among its photos, answer **200** with the report and store
   nothing. A retry of a photo whose answer was lost does not use up a second slot.
3. If it was filed more than 24 hours ago, answer **422** (window closed). If it has five photos,
   answer **422** (limit). These checks run before the file is stored, so a refused photo stores
   nothing.
4. Store the file through `fileService.upload`, with the display name
   `vehicle-check-<checkDate>-<vehicleCode>-<n>.jpg`.
5. One atomic conditional update adds `{ clientPhotoId, fileId, fileName, mime, size, uploadedAt }`
   only if the report is still the caller's, not deleted, under five photos, inside the window, and
   without that `clientPhotoId`. It stamps `updatedBy` and bumps the version.
6. If that update misses (a racing upload or a deletion got there first), soft-delete the stored
   file (best effort, as the custody signed copy does), re-read the report, and answer with the
   first rule it now meets: not found **404**; the same `clientPhotoId` **200**; window **422**;
   limit **422**.
7. Audit `update`.

Two racing uploads therefore cannot leave six photos.

**Files.** The category is `it-vehicle-check-photos` («صور فحص أجهزة السيارات» / "Vehicle device
check photos"), created on first use with `fileCategoryService.ensure`:
`IT_VEHICLE_CHECK_PHOTO_MIME_TYPES` (JPEG, PNG, WebP), `IT_VEHICLE_CHECK_PHOTO_MAX_MB` (10), no
retention, private. The entity authorizer `it/vehicleCheck` answers a write only for the report's
own reporter holding `itVehicleCheck.create`, unscoped. It answers no read until the dashboard.
The upload route reuses IT's single-file intake (`signedCopyUpload` from
`apps/api/src/modules/it/assets/receipt.controller.ts`; its 15 MB outer cap answers 422
`FILE_TOO_LARGE` too, but the category's 10 MB is the limit a photo meets first).

**Audit and realtime.** Audit entries use the literal entity ref `{ moduleId: 'it', entityType:
'vehicleCheck' }`. Every audited entity must be classified in the realtime registry. With no screen
that reads reports yet, `it.vehicleCheck` goes in `REALTIME_EXCLUDED_ENTITIES`, with the reason "no
screen until the dashboard". It leaves that list in the change that builds the dashboard, as the
attendance-device entry does.

### 6.2 Contracts (`packages/contracts/src/modules/it.ts`)

```ts
import { cairoYmd, isYmd } from '../common/cairo-date';   // with it.ts's existing imports

const ymd = () => z.string().refine(isYmd, 'Expected a calendar day, YYYY-MM-DD'); // refuses 2026-02-30

export const IT_VEHICLE_CHECK_ITEMS = ['screen', 'camera1', 'camera2', 'camera3', 'camera4',
  'camera5', 'camera6', 'camera7', 'camera8', 'dvr', 'radio'] as const;   // the owner's order
export type ItVehicleCheckItem = (typeof IT_VEHICLE_CHECK_ITEMS)[number];
export const IT_VEHICLE_CHECK_ANSWERS = ['works', 'notWorking'] as const;
export type ItVehicleCheckAnswer = (typeof IT_VEHICLE_CHECK_ANSWERS)[number];
export const IT_VEHICLE_CHECK_MAX_PHOTOS = 5;
export const IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS = 24;
export const IT_VEHICLE_CHECK_NOTES_MAX = 1000;
export const IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY = 'it-vehicle-check-photos';
export const IT_VEHICLE_CHECK_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IT_VEHICLE_CHECK_PHOTO_MAX_MB = 10;

const answer = z.enum(IT_VEHICLE_CHECK_ANSWERS).nullable().default(null);
export const CreateItVehicleCheckSchema = z.object({
  vehicleId: objectId(),
  checkDate: ymd().refine((d) => d <= cairoYmd(new Date()), 'checkDate is after today in Cairo'),
  items: z.object(Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((k) => [k, answer])) as
    Record<ItVehicleCheckItem, typeof answer>).strict().default({}),
  notes: z.string().trim().max(IT_VEHICLE_CHECK_NOTES_MAX).optional(),   // '' is dropped by the service
  clientRequestId: z.string().uuid(),
}).strict();
export const ItVehicleCheckIdParamSchema = z.object({ id: objectId() }).strict();
export const ItVehicleCheckPhotoFieldsSchema = z.object({ clientPhotoId: z.string().uuid() }).strict();

export interface ItVehicleOptionDto { id: string; code: string }
export interface ItVehicleCheckPhotoDto {
  clientPhotoId: string; fileId: string; fileName: string; mime: string; size: number; uploadedAt: string;
}
export interface ItVehicleCheckDto {
  id: string; version: number; vehicleId: string; vehicleCode: string; branchId: string | null;
  checkDate: string /* YYYY-MM-DD */; items: Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;
  notes: string | null; photos: ItVehicleCheckPhotoDto[];
  reportedByUserId: string; reportedByName: string; clientRequestId: string; createdAt: string;
}
```

The car list's query is the shared `PaginationQuerySchema`. The labels are not in contracts.

### 6.3 Web

- **`apps/web/src/shared/ui/PhoneShell.tsx`** is the captain's frame, moved. It takes `title`,
  `subtitle`, `backTo`, `backLabel` and an optional `footer`.
  - When a footer is given, it is fixed at the bottom with `pb-[env(safe-area-inset-bottom)]`. The
    content gets a fixed bottom padding of `calc(8rem + env(safe-area-inset-bottom))`: the count
    line and the 48 px button never wrap, so the bar's height is known.
  - `AppVersion` stays at the foot of the content.
  - `CaptainShell` becomes a thin wrapper that passes the Operations defaults (`backTo:
    '/operations'`, the `operations.mobile.backToConsole` label). The IT page passes `backTo: '/'`
    and «الرجوع إلى الصفحة الرئيسية» / "Back to home".
  - `mobile-quality.spec.tsx` keeps every assertion. The ones that read `CaptainShell.tsx`'s source
    (`max-w-2xl`, `min-h-dvh`, no `min-h-screen`, `aria-label=`) now read `PhoneShell.tsx`.
  - A new `apps/web/src/modules/it/mobile/it-mobile-quality.spec.tsx` applies the Operations
    spec's rules, unchanged, to the files of `apps/web/src/modules/it/mobile/` and reads
    `PhoneShell.tsx` for the frame rules. The rules: no width of 400 px or more; `dvh`; the
    primary action `min-h-12` (in `VehicleCheckPage.tsx`); a label on every icon-only control; no
    `AppShell`; no Latin run of four or more letters in JSX text («DVR», three letters, passes as
    it does today).
  - The no-browser-storage rule exempts exactly one file, `vehicle-check-draft.ts`.
- **The car dropdown** (`apps/web/src/modules/it/mobile/VehicleCheckCarPicker.tsx`) is the shared
  `Combobox` with a new `density: 'touch'`. It is sizes only, and it wins over `tallList` when both
  are given (the IT picker passes no `tallList`):
  - 16 px text, so iOS does not zoom;
  - 48 px rows;
  - a 40 px clear button;
  - a list capped at 17rem, so it ends above a phone keyboard when the field sits near the top.

  The list comes from `fetchItVehicleCheckCars` / `useItVehicleCheckCars` (named so as not to trip
  Fleet's registry census, `vehicle-code-selectors.spec.ts`, which greps for `listVehicles`,
  `useVehicles` and `useAllVehicles`). These walk `GET /it/vehicle-checks/vehicles` through
  `fetchWholeCatalog` (pageSize `MAX_PAGE_SIZE`), and the list is refetched when the box opens on
  a list older than a minute. Ranking uses `rankVehicleCodes`, and digits are folded by
  `asciiDigits` from `apps/web/src/shared/lib/format.ts`. IT web already imports Fleet's libs
  (`fleet-report-print`, `fleet-sheet`).
- **The answer control** (`VehicleCheckAnswer.tsx`) is a radio group of two narrow buttons. A
  second tap on the chosen button clears it.
- **Photos.**
  - A new `apps/web/src/shared/lib/image-downscale.ts` exports `fitWithin(width, height, maxSide)`:
    the longest side brought to `maxSide`, the ratio kept, never enlarged, at least 1 px. This is a
    copy of Fleet's `thumbSize` rule.
  - It also exports `downscaleToJpeg(file, { maxSide: 1600, quality: 0.82 }): Promise<Blob |
    null>`. It decodes with `createImageBitmap(file, { imageOrientation: 'from-image' })` and
    returns `null` when the browser cannot decode the file.
  - Fleet's `fuel-card-thumb.ts` is not touched: its blur hides a card's PIN, and that path stays as
    it is.
  - `apps/web/src/modules/it/lib/vehicle-check-photos.ts` holds the photo rules and
    `uploadPhotosInOrder(reportId, photos)`, the several-file form of Fleet's `saveThenAttachPhoto`
    (a failed upload is an outcome, never a throw). Each photo carries its own `clientPhotoId` and
    gets one outcome: `uploaded`, `failed` (a network error or a 5xx; kept for «إعادة رفع الصور»),
    or `refused` (a 4xx, with its code; never retried). The upload runs one photo at a time.
- **The draft** (`apps/web/src/modules/it/mobile/vehicle-check-draft.ts`) writes and clears with
  Fleet's `writeDraft` and `clearDraft` (`apps/web/src/modules/fleet/lib/draft-storage.ts`), under
  the key `ecms.it.vehicleCheck.draft.v1`. It reads with its own guarded reader, since Fleet's
  reader is shaped for the roster.
  - The draft holds `{ v: 1, vehicleId, vehicleCode, checkDate, items, notes, clientRequestId }`.
    It is read when the page mounts, and cleared on success and on «تقرير لسيارة أخرى».
  - Each field is accepted only when valid, and dropped otherwise: non-JSON or a wrong `v` drops
    the draft. An item outside the keys or answers becomes unanswered. A day that is not a date, or
    is after today, becomes today. Notes are cut to 1000. A `clientRequestId` that is not a UUID
    gets a new one.
  - A `vehicleId` missing from the active car list clears the car and gets a new
    `clientRequestId`.
- **Outcomes on the form** (all texts are i18n keys under `it.vehicleCheck.*`; the request id rule
  is what keeps a resend the same report):

| Outcome | What the reporter sees | The form | `clientRequestId` |
|---|---|---|---|
| 201 / 200 | the sent view (§2 item 7) | cleared but for the day | new one |
| no answer, a network error or a 5xx | toast «تعذّر إرسال التقرير. حاول مرة أخرى.» | kept | **kept**, so a resend is the same report |
| 404 car | toast «هذه السيارة لم تعد مسجلة.» | car cleared, car list refetched | new one |
| 422 `IT_VEHICLE_NOT_ACTIVE` | toast «هذه السيارة ليست نشطة الآن.» | car cleared, car list refetched | new one |
| 400 on `checkDate` | toast «لا يمكن اختيار يوم بعد اليوم.» | day set back to today | new one |
| 409 `IT_VEHICLE_CHECK_REQUEST_REUSED` | toast «تعذّر إرسال التقرير. حاول مرة أخرى.» | kept | new one |
| a photo refused 422 (limit or window) | on the sent view, «لم تُرفع n صور:» with the reason | that photo dropped from the retry list | — |
| a photo the browser cannot decode | the original is sent when it is JPEG/PNG/WebP and at most 10 MB; otherwise toast «نوع هذه الصورة غير مدعوم.» or «الصورة أكبر من 10 ميجابايت.» | not attached | — |

- **The shared missing-fields banner** (`apps/web/src/shared/ui/required-fields.tsx`) gains an
  optional `lead`. Its default stays «لم يتم الحفظ.».
- **Labels** (i18n, `it.vehicleCheck.*`, Arabic / English):
  - the items: «الشاشة» / Screen;
  - the cameras: «أمام المركبة» / Front; «يمين خلف» / Right rear; «يسار خلف» / Left rear; «خلف
    المركبة» / Rear; «كابينة السائق» / Driver's cabin; «كابينة الأخصائيين» / Specialists' cabin;
    «داخل الخزينة 1» / Inside safe 1; «داخل الخزينة 2» / Inside safe 2;
  - «DVR» / DVR; «جهاز الاتصال (موتورولا)» / Radio (Motorola); the card «الكاميرات» / Cameras;
  - the answers: «يعمل» / Works; «لا يعمل» / Not working;
  - the resource «فحص أجهزة السيارات» / "Vehicle device checks";
  - the page and the nav row «فحص أجهزة السيارة» / "Vehicle device check": sortOrder 100 (after
    the IT catalogs, 90), last in the IT rail, with the icon `vehicle` (already in `app-icon.tsx`).

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

One PR. After each step, `npm run typecheck`, `npm run lint` and every workspace's tests pass.
The PR then passes `.github/workflows/ci.yml`. That workflow already runs the secrets check, the
permission matrix, the flag expiry, the page registry, the automation templates, the formal-Arabic
check, the three test suites, the build and the dependency audit.

**Step 1: contracts.**

| File | Change |
|---|---|
| `packages/contracts/src/modules/it.ts` | Modify: add §6.2 |
| `packages/contracts/src/errors/index.ts` | Modify: add `IT_VEHICLE_NOT_ACTIVE`, `IT_VEHICLE_CHECK_REQUEST_REUSED`, `IT_VEHICLE_CHECK_PHOTO_LIMIT`, `IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED` |
| `packages/contracts/src/modules/it.spec.ts` | Modify. The schema: missing keys become `null`; an unknown key or answer is refused; `notes` over 1000 is refused; a non-UUID request id is refused; 2026-02-30 is refused; tomorrow in Cairo is refused, while today passes at 00:30 Cairo (UTC still on yesterday; `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime`) |

**Step 2: API**, with the counts that pin the grant and the page.

| File | Change |
|---|---|
| `apps/api/src/modules/it/fleet-boundary.ts` | Create (§5) |
| `eslint.config.js` | Modify: a `no-restricted-imports` rule for `apps/api/src/modules/it/**` forbidding `**/fleet/**` with `it/fleet-boundary.ts` ignored (the payroll→attendance seam is the precedent) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.model.ts` | Create (§3), with the three indexes; photos carry `clientPhotoId` |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.repository.ts` | Create: `branchField: 'branchId'`, `collectionReady` (imported from `../mobile-lines/ensure-collection`), `findByClientRequestId`, `findOwnLive(id, userId)`, `pushPhoto(id, userId, photo, filedAfter)` (the atomic update of §6.1) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.service.ts` | Create: `listActiveVehicleCodes`, `file`, `addPhoto` (§6.1) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check-files.ts` | Create: `vehicleCheckPhotoCategory()` (the ensure) and `vehicleCheckFileAuthorizer` (`it/vehicleCheck`) |
| `apps/api/src/modules/it/vehicle-checks/vehicle-check.controller.ts`, `vehicle-check.routes.ts` (`buildItVehicleChecksRouter`), `index.ts` | Create |
| `apps/api/src/modules/it/it.mappers.ts` | Modify: add `toItVehicleCheckDto` (IT's mappers live here) |
| `apps/api/src/modules/it/it.module.ts` | Modify: `declarePermissions('it', 'itVehicleCheck', { en: 'Vehicle device checks', ar: 'فحص أجهزة السيارات' }, ['create'], [], 'it.vehicle-checks')`, spread into `itPermissions`; the page `it.vehicle-checks` (route `/it/vehicle-checks/new`, sortOrder 100); the route `/it/vehicle-checks`; the collection `it_vehicle_checks`; the file authorizer |
| `apps/api/src/platform/realtime/realtime-registry.ts` | Modify: the exclusion |
| `apps/api/src/platform/kernel/page-registry.spec.ts` | Modify: pages 83 → 84, permissions 314 → 315, assigned 285 → 286, `it` 9 → 10 (unassigned stays 29), a comment line per movement as the spec does |
| `apps/api/tests/integration/it-vehicle-checks.spec.ts` | Create; cases below |

**Step 3: web.** The nav row (`seed-navigation.ts`) lands with the web route, because
`it-routes.spec.ts` fails on an `/it` row with no declared route.

| File | Change |
|---|---|
| `apps/web/src/shared/ui/PhoneShell.tsx` | Create (§6.3) |
| `apps/web/src/modules/operations/mobile/CaptainShell.tsx` | Modify: becomes the wrapper |
| `apps/web/src/modules/operations/mobile/mobile-quality.spec.tsx` | Modify: the frame assertions read `PhoneShell.tsx` |
| `apps/web/src/shared/ui/Combobox.tsx` | Modify: `density: 'touch'`, its classes in an exported `COMBOBOX_DENSITY` map |
| `apps/web/src/shared/ui/Combobox.spec.tsx` | Create: the `touch` entry of `COMBOBOX_DENSITY` (16 px text, 48 px rows, 40 px clear, the 17rem list); a static render of the closed box with `touch` carries the text class |
| `apps/web/src/shared/ui/required-fields.tsx` | Modify: optional `lead` |
| `apps/web/src/shared/ui/required-fields.spec.tsx` | Modify: `MissingFieldsBanner` with a `lead` and a missing list renders that lead; without it, «لم يتم الحفظ.» as before |
| `apps/web/src/shared/lib/image-downscale.ts`, `image-downscale.spec.ts` | Create; the spec covers `fitWithin`: longest side ≤ the max, ratio kept, no upscaling, at least 1 px |
| `apps/web/src/modules/it/api/it-api.ts`, `it-queries.ts` | Modify: `fetchItVehicleCheckCars` / `useItVehicleCheckCars`, `fileVehicleCheck`, `uploadVehicleCheckPhoto` |
| `apps/web/src/modules/it/lib/vehicle-check-form.ts`, `vehicle-check-form.spec.ts` | Create: counts, the payload, clear-on-second-tap, the default day, the missing fields (car, day), the outcome table of §6.3 as a pure function |
| `apps/web/src/modules/it/lib/vehicle-check-photos.ts`, `vehicle-check-photos.spec.ts` | Create: `uploadPhotosInOrder` (with a fake upload: order, one at a time, the three outcomes), the type and size check, the decode-failure rule |
| `apps/web/src/modules/it/mobile/vehicle-check-draft.ts`, `vehicle-check-draft.spec.ts` | Create: write, read, clear, the key, and every drop rule of §6.3 |
| `apps/web/src/modules/it/mobile/VehicleCheckPage.tsx`, `VehicleCheckCarPicker.tsx`, `VehicleCheckAnswer.tsx`, `VehicleCheckPhotos.tsx`, `VehicleCheckSent.tsx` | Create |
| `apps/web/src/modules/it/mobile/it-mobile-quality.spec.tsx` | Create (§6.3) |
| `apps/web/src/modules/it/mobile/vehicle-check-page.spec.tsx` | Create: a static render shows the 11 labels in order, «DVR», «إرسال التقرير» and the date box; the page's source passes `lead` to the banner |
| `apps/web/src/modules/it/routes.tsx` | Modify: the route outside `AppShell`, under `RequirePermission itVehicleCheck.create` |
| `apps/web/src/modules/it/it-routes.spec.ts` | Modify: the path list |
| `apps/web/src/modules/it/it-api-contract.spec.ts` | Modify: a `vehicle checks` block reading `apps/api/src/modules/it/vehicle-checks/vehicle-check.routes.ts` against the three client calls |
| `apps/web/src/platform/localization/i18n.ts` | Modify: the `it.vehicleCheck.*` keys of §6.3, added only. `it-i18n.spec.ts` needs no edit: it scans the literal `t('it.…')` keys, which must exist here. |
| `apps/api/src/seed-navigation.ts` | Modify: the IT row |
| `apps/api/src/seed-navigation.spec.ts` | Modify: `toHaveLength(133)` → 134 |
| `apps/api/tests/integration/auth-seed-login.spec.ts` | Modify: `SEEDED_APPLICATIONS` 133 → 134, the IT figure in the breakdown 16 → 17, and `toContain('/it/vehicle-checks/new')` |

**Step 4: docs.** `docs/12-planning/it-module-design.md` already carries every amendment of §8;
verify it and add nothing. Add a line to this document's §10 if the build changed anything. Add a
`CHANGELOG.md` entry under `[Unreleased]` → `### Added`.

**The integration spec `it-vehicle-checks.spec.ts`** uses the IT harness of `it-mobile-lines.spec.ts`
(an in-process app on a replica set). Cars are planted through Fleet's raw collection, which is
how a car with no branch gets in, since Fleet's schema requires one.

- **Grants.**
  - A user without `itVehicleCheck.create` gets 403 on all three routes.
  - They also answer 403 to a user who holds only `fleetVehicle.view`.
- **Car list.**
  - A role holding only `itVehicleCheck.create`, assigned with `own` scope, gets every active car
    in Fleet's code order, walking pages of 2.
  - Out-of-service, disposed and deleted cars are absent.
  - A pageSize of 101 answers 400.
- **Filing.**
  - A branch-scoped reporter files on another branch's car: 201. The report carries that car's
    code and branch.
  - A car with no branch gives `branchId: null`.
  - Missing item keys are stored as `null`, a note of spaces is absent, and the reporter's name is
    snapshotted.
  - A missing or deleted car answers 404 `NOT_FOUND`. An out-of-service car answers 422
    `IT_VEHICLE_NOT_ACTIVE`.
  - Tomorrow in Cairo answers 400. With `Date` faked to 00:30 Cairo and a fresh login, today
    answers 201.
- **Idempotency.**
  - A repeated `clientRequestId` answers 200 with the same id, even after the car went out of
    service.
  - The same id from another user answers 409 `IT_VEHICLE_CHECK_REQUEST_REUSED`.
  - Two concurrent first sends give one 201 and one 200, and one stored report.
- **Photos.**
  - Five photos are accepted. The sixth answers 422 `IT_VEHICLE_CHECK_PHOTO_LIMIT` and stores no
    file.
  - A report whose `createdAt` is back-dated 24 hours and one minute in the raw collection answers
    422 `IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED` and stores no file.
  - A photo on another user's report, or on a deleted one, answers 404 and stores no file.
  - A branch-scoped reporter adds photos to a report on another branch's car.
  - The same `clientPhotoId` sent twice gives one photo and two 200s.
  - Six concurrent uploads leave exactly five photos. The others answer 422
    `IT_VEHICLE_CHECK_PHOTO_LIMIT`, and no live file remains from them.
  - An 11 MB JPEG (above the category's 10 MB, under the 15 MB intake cap) answers 422
    `FILE_TOO_LARGE`. A PDF answers 422 `FILE_TYPE_NOT_ALLOWED`. Neither stores a file.
- **Audit.** Audit rows exist for `create` and `update`, with the literal entity ref.
- **Files.** Called directly, `vehicleCheckFileAuthorizer` refuses every read. It refuses a write
  by a non-reporter, and a write by the reporter without `itVehicleCheck.create`.

**Next delivery: the dashboard**, after its sample is approved. It adds `itVehicleCheck.view` and
`.delete`; the reads it needs (the latest report per car, faults per device, active cars with no
recent report, the reports list with photos); the photo bytes for readers; and the realtime topic.
Not planned: notifications or automatic tickets for «لا يعمل», a per-car equipment profile, and
showing the car's Motorola serial on the form. None was asked for.

## 10. Review

Fresh-context reviewers read only this document and the files it names, none of the conversation.
The review took three rounds on 2026-11-08 (`.claude/skills/design-review`, every stage run, none
by fallback):

1. **The first draft** got 73 findings: 1 Blocker, 26 Major, 46 Nit. It was read for its scope,
   for whether a newcomer understands it, for its design, its structure and its writing.
2. **The revision** got 53. It was read again for scope, plus for readiness to build, for accuracy
   against the code, and for its writing.
3. **The plan** got 37, on one more readiness, accuracy and writing pass.

Findings dropped under the review's rules (they contradicted the owner, an ADR, or the code):
none.

What changed because of the review:
- **Scope.** Only the form's endpoints and its one grant ship now. Reading, deleting and the
  realtime topic wait for the dashboard.
- **Honest record.** The unanswered questions are recorded as defaults with their trade-offs. The
  scope bypass is recorded as a design decision, not the owner's.
- **Fleet boundary.** It is two read functions, and one of them returns the car's status, so a
  missing car (404) and an inactive one (422) are told apart. An ESLint rule keeps the boundary
  the only door.
- **The car picker.** It loads every active car, under ADR-037 (new), which records the owner's
  rule and supersedes ADR-019 rules 4 and 5 for vehicle-code pickers. IT §1 and FR-12 name the
  exception.
- **Repeats are safe.** A repeated send (`clientRequestId`) and a repeated photo (`clientPhotoId`)
  return what exists instead of filing twice.
- **Photos.** Refusals run before a file is stored. One atomic update guards the five-photo and
  24-hour limits, so racing uploads cannot exceed them.
- **The phone frame.** It is shared (`PhoneShell`), and the Operations spec keeps its assertions.
- **Downscaling** is a new helper. The fuel-card thumbnail, whose blur hides a PIN, is left
  alone.
- **The draft** keeps the request id, and it has rules for every field it restores.
- **Missing pieces were added**: a refusal table with status codes, the form's response to each
  outcome, risks and limits, links, and IT §3.
- **The plan** names every file and its change. It moves each pinned count in the step that moves
  it, and it lists the integration cases.

Accepted (true, changes nothing):
- The phone-quality rules exist twice in tests, once per module folder. The component they guard
  exists once.
- `API Standards §6`'s platform `Idempotency-Key` store does not exist. It is noted in §7, and
  this entity has its own guard.

Declined (Nit):
- An earliest allowed day. The owner set none.
- A per-day cap on reports. The grant bounds who files.

Open: none. The owner still has to confirm the defaults of §1.2 and the scope decision of §4; the
next message to him names them.
