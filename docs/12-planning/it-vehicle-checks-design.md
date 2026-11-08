# IT — Vehicle device checks («فحص أجهزة السيارة», FR-21)

**Status:** Approved by the owner on the sample (2026-11-08); amends the frozen IT design
([it-module-design.md](it-module-design.md)) in §0, §2.12, §5 FR-21, §7, §9.2, §11, §12 and §17.
**Scope of this delivery:** the phone form, the record behind it, its photos, its grants and the
server reads the coming dashboard will use. The IT dashboard for these reports is a separate
delivery, built after the owner approves its own sample.

## 1. The owner's decisions

- The request (2026-11-08): «I need to create a new form for specific users to use on Mobile to
  inform about the car status — firstly he will choose the car number (included search in the
  dropdown) and the date is default today but can change it — the things that i need to check on
  it: الشاشة · 8 كاميرات: 1- أمام المركبة 2- يمين خلف 3- يسار خلف 4- خلف المركبة 5- كابينه السائق
  6- كابينة الأخصائيين 7- داخل الخزينة 1 8- داخل الخزينة 2 · DVR · جهاز الأتصال (موتورولا) · Notes
  and uploading photo».
- Where it lives: «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند الـ IT يعنى هما اللى هيتحكموا
  فيها — والشاشة بتاعت الفورم نفسها هنخصصها عادى كدور». The reports and their dashboard are IT's;
  the form is a screen granted through a role like any other. Fleet («الحركة») only supplies the
  car list.
- The sample (phone, light and dark) was approved with one change: «زرارين يعمل ولا يعمل خليهم على
  نفس الصف مش تحت البند وصغر عرضهم» — the two answers sit on the item's own row, narrow. Then:
  «طبق PR ولما CI يخضر أدمج».
- Four questions were put with a recommendation each and left unanswered when the owner said to
  build, so the recommendations are adopted (he can change any of them later):
  1. each item is answered «يعمل» or «لا يعمل» — no third answer;
  2. several photos per report (at most five);
  3. the car list offers every ACTIVE car;
  4. a car may be checked more than once a day; each report stands alone, and the dashboard
     reads the latest.
- His standing rules apply: no data is mandatory beyond what he names (here only the car — the
  date comes filled in); formal Arabic on screen; soft delete only; existing data is not changed.
- Labels are the owner's, in their formal spelling: «كابينة السائق» (not «كابينه»), «جهاز الاتصال
  (موتورولا)» (not «الأتصال»). The screen is titled «فحص أجهزة السيارة»: Fleet already uses «حالة
  السيارة» for a car being active or out of service.

## 2. What the user sees

A phone screen outside the console frame (no sidebar, no top bar), in the frame the Operations
captain's day uses (`operations/mobile/CaptainShell.tsx`): a sticky header with a back arrow to the
home page, the title «فحص أجهزة السيارة» and «تقنية المعلومات» under it, the content in one column
no wider than `max-w-2xl`, `min-h-dvh`. A user whose only grant is the form lands on the home page
after sign-in and finds the form there as their one page (the welcome card lists the user's first
pages), one tap away.

1. **«كود السيارة»** — a single-car dropdown with search. Opening it lists active cars by code;
   typing narrows the list on the server (ADR-019). A code with a space («كورولا 1») is one car,
   matched as Fleet matches it (`normalizeVehicleCode` / `sameVehicleCode`). Required: pressing
   «إرسال التقرير» without a car shows the shared missing-fields banner, worded «لم يتم إرسال
   التقرير.», and marks the box «حقل مطلوب».
2. **«التاريخ»** — a date box filled with today in Cairo (`cairoYmd(new Date())`), which can be
   changed to an earlier day; a day after today is refused (the box's `max`, and the server).
3. **The items**, in the owner's order: a card «الشاشة»; a card «الكاميرات» with eight numbered
   rows; a card «DVR»; a card «جهاز الاتصال (موتورولا)». Each row carries its label at the start
   and, on the same row at the end, two narrow buttons «يعمل» (✓) and «لا يعمل» (✕) — a radio
   group; nothing is chosen at first; a chosen «يعمل» is green, a chosen «لا يعمل» red, and the
   icon says which without the colour. An item left unanswered is filed as unanswered
   («لم يُفحص»). A long label wraps beside its buttons; the buttons never drop under it.
4. **«ملاحظات»** — one text box for the whole report (optional, at most 1000 characters).
5. **«الصور»** — optional, up to five: «تصوير بالكاميرا» or «اختيار من الجهاز» (the shared
   `PhotoSourceButtons`), each photo shown as a row with its thumbnail and a ✕ to drop it before
   sending. The phone shrinks each photo before upload (longest edge 1600 px, JPEG) so a camera
   picture travels as a few hundred kilobytes.
6. **A bar fixed at the bottom**: «تم فحص n من 11» and, when any, «· m لا يعمل»; under it the full
   width «إرسال التقرير».
7. **After sending**: «تم إرسال التقرير» with the car, the day, «x يعمل · y لا يعمل» and the
   number of photos, and «تقرير لسيارة أخرى», which clears the form and keeps the day. If a photo
   failed to upload, the summary says how many, and «إعادة رفع الصور» sends them again to the same
   report.

## 3. The record — `it_vehicle_checks`

`{ vehicleId, vehicleCode, branchId, checkDate, items: { screen, camera1 … camera8, dvr, radio },
notes?, photos: [{ fileId, fileName, mime, size, uploadedAt }], reportedByUserId, reportedByName }`
plus the platform's `baseFields` (soft delete, `createdBy`, `updatedBy`, `schemaVersion`) and
timestamps.

- `vehicleId` is Fleet's id; `vehicleCode` and `branchId` are the car's code and branch **when the
  report was filed**, so a renamed, moved or disposed car keeps its old reports readable and in the
  branch they were made in. `branchId` is the data-scope anchor (`branchField`); `ownerUserField`
  is `reportedByUserId`, so an `own` scope sees one's own reports.
- `checkDate` is the Cairo calendar day the check is for, stored as that day's UTC midnight (the
  date-only convention, `ymdToUtcDate`); never after today in Cairo.
- `items` is a fixed set of eleven keys, a contract constant (`IT_VEHICLE_CHECK_ITEMS`) that holds
  the order and the labels; each value is `works`, `notWorking` or `null` (unanswered). The eight
  cameras are, in order: front, right-rear, left-rear, rear, driver's cabin, specialists' cabin,
  inside safe 1, inside safe 2.
- `notes` is trimmed; empty is absent.
- `photos` holds at most five references to platform Files (category `it-vehicle-check-photos`,
  JPEG/PNG/WebP, 10 MB each, private, moduleId `it`).
- `reportedByName` is the reporter's display name at filing (the `actorName` precedent of the
  history collections).
- No unique index: several reports per car per day are allowed (decision 4). Indexes:
  `{ vehicleId, checkDate: -1, createdAt: -1 }` for "the latest per car", `{ branchId, checkDate:
  -1 }` for the scoped list. Built before the first write (`collectionReady`), as production runs
  with `autoIndex` off.
- A report is a record of what was seen: it is not edited. A wrong report is deleted (soft) and
  filed again.
- No `employeeId` path: the workforce reset leaves the collection alone (the reporter is a user
  id, not an employee).

## 4. Grants

One resource, `itVehicleCheck` (Arabic «فحص أجهزة السيارات»), page `it.vehicle-checks`:

| Key | What it allows |
|---|---|
| `itVehicleCheck.create` | the phone form: list the active cars, file a report, add photos to one's own report |
| `itVehicleCheck.view` | read reports and their photos (the coming dashboard), within the reader's data scope |
| `itVehicleCheck.delete` | delete a report (soft) |

- The form's grant does not imply any other IT or Fleet grant: the car list is IT's own endpoint
  under `itVehicleCheck.create`, so the reporter needs neither `fleetVehicle.view` (which would open
  Fleet's registry: chassis, engine, licence image) nor `itAsset.view`.
- **The car list and filing are not limited by the reporter's data scope.** The owner chose «every
  active car»; a role assigned with a branch or `own` scope must still list and report any active
  car. The scope governs READING reports (`view`), not filing them. The record still takes the
  car's branch, so a branch-scoped IT reader sees the reports of the cars in their branch.
- No role is seeded. On deploy, as for every new key, only super-admin holds the three keys
  (`syncPermissionRegistry`) until an admin builds the role («نخصصها عادى كدور»).
- A navigation row in the IT category, «فحص أجهزة السيارة» → `/it/vehicle-checks/new`, under
  `itVehicleCheck.create`, with a glyph no other IT row uses.

## 5. The Fleet boundary (amends IT §9.2)

IT §9.2 said IT reads nothing of Fleet's. This form needs Fleet's car list, so IT gets ONE
read-only import surface, `apps/api/src/modules/it/fleet-boundary.ts`, re-exporting
`fleetVehicleRepository` — the reviewed pattern Operations and Gold already use
(`operations/fleet-boundary.ts`, `gold/fleet-boundary.ts`). IT resolves active cars and their code
and branch through it and never writes a Fleet collection. Vehicles still never enter `it_assets`;
a tracker SIM on a mobile line still names its car in text (FR-19 is unchanged).

## 6. API (under `/api/v1/it/vehicle-checks`)

| Method and path | Grant | What it does |
|---|---|---|
| `GET /vehicles?search=&page=&pageSize=` | `create` | active, non-deleted cars `{ id, code }`, ordered by code; `search` matches the code as Fleet does (a code with a space is one code; digits in any script), codes that start with the term first. Paginated (API Standards §4), never the whole registry (ADR-019). |
| `POST /` | `create` | file a report: `{ vehicleId, checkDate: 'YYYY-MM-DD', items: { key: 'works' \| 'notWorking' \| null } (missing keys are null), notes? }`. Refuses a car that is not found, deleted or not active, and a day after today in Cairo. Answers the report. |
| `POST /:id/photos` | `create` | one photo (multipart `file`), only by the report's reporter, while it has fewer than five; Files category `it-vehicle-check-photos`. An upload that fails after the file is stored removes the file (no orphan). Answers the report. |
| `GET /` | `view` | the reports, newest first, within the reader's scope: `vehicleId`, `from` / `to` (days), `faulty` (any item «لا يعمل»), `branchId`, `reportedBy`; paginated. |
| `GET /:id` | `view`, or the reporter | one report. |
| `GET /:id/photos/:fileId` | `view`, or the reporter | the photo's bytes. |
| `DELETE /:id` | `delete` | soft delete. |

Every write is audited with the literal entity ref `{ moduleId: 'it', entityType: 'vehicleCheck' }`
(`create`, `update` for an added photo, `delete`), and the realtime topic `it.vehicleCheck` (opened
by `itVehicleCheck.view`) tells open screens to refetch. The photos' file authorizer is
`it/vehicleCheck`: read = `itVehicleCheck.view` within scope, or the reporter; write = the reporter
holding `itVehicleCheck.create`.

## 7. Delivery plan

One PR, contracts → API → web, with the checks the repository already runs.

1. **Contracts** (`packages/contracts/src/modules/it.ts` + spec): `IT_VEHICLE_CHECK_ITEMS` (keys,
   order), `IT_VEHICLE_CHECK_ANSWERS`, `IT_VEHICLE_CHECK_MAX_PHOTOS = 5`,
   `IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY`, the create / list / id schemas, the car-option and
   report DTOs.
2. **API** (`apps/api/src/modules/it/vehicle-checks/`): model, repository (`collectionReady`,
   `branchField`, `ownerUserField`), service (create, list, get, add photo, photo bytes, soft
   delete, audit), controller, routes, photo files + authorizer, mapper; `it/fleet-boundary.ts`;
   the manifest (`declarePermissions`, page, route, collection, file authorizer); realtime topic;
   navigation row. Integration spec `it-vehicle-checks.spec.ts`: a form-only role files on a car
   outside its scope, cannot read others' reports, cannot add a sixth photo or a photo to another's
   report; refused cars and days; the viewer's scope; soft delete; the car search with a spaced
   code.
3. **Web** (`apps/web/src/modules/it/`): API client and queries; the phone frame (a copy of the
   captain's frame, which its own spec pins); the page; the car dropdown over the IT endpoint
   (shared `Combobox`, phone sizing through an additive prop); the two-answer row control; the
   photo list with downscaling; the success view; the route outside the console frame; i18n keys
   (formal Arabic); realtime invalidation; the shared missing-fields banner gains an optional
   `lead` wording (default unchanged). Specs: the pure helpers (counts, payload, photo sizing,
   dates), a static render of the page, the phone-quality rules the captain's screens follow (no
   width over 360 px, `dvh`, thumb-sized primary action, labels on icon buttons, Arabic-only text).
4. **Census and docs**: page registry, navigation counts, IT route/i18n/API-contract specs,
   realtime registries; `it-module-design.md` (§0, §2.12, §5 FR-21, §7, §9.2, §11, §12, §17);
   CHANGELOG.

## 8. Not in this delivery

- The IT dashboard (latest status per car and device, the most-failing device, cars not checked,
  the reports list with photos) — its sample comes first.
- Notifications or automatic tickets for a «لا يعمل» item — not asked for.
- A per-car equipment profile (which cars have which devices) — every car is offered all eleven
  items; decision 1 keeps two answers.
- Showing the car's registered Motorola serial on the form — not asked for.
