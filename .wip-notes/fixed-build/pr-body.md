## What & why

The owner asked for the fleet screen «الطقم الثابت» (`/fleet/fixed-roster`) in the look of the merged
daily roster «تعيين السيارات» («واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى»), approved the
sample with the answers «1 ب / 2 ج», then said the page was still not built («انت لسه معملتش بيدج
الطاقم الثابت»). This PR builds it.

The screen is now the daily board without a day: no date, no stepper, no «يوم سابق», no
availability words, no absence or leave. It keeps the fixed screen's own data, rules, permissions,
draft key and Excel file.

- **Answer 1 (ب):** no flag on this screen for a standing member who can no longer drive (no amber
  seat, no «الملف موقوف» / «رخصة منتهية» / «ليس على وظيفة سائق» on a seat, a list row, the touch
  picker, the drivers sheet or the pen dialog). No new contract field.
- **Answer 2 (ج):** `PageContainer fullHeight` + `PageHeader` («الطقم الثابت» under «الحركة») on
  top at every width, with no `actions`: the old `ExportSheetButton` is gone. The one Excel
  control per width is the daily `ExcelPill` (computer toolbar row) or `ExcelButton` (touch
  first row). One title per width.
- **Computer (≥ 1280 px)** — `FixedDeskBoard`: the toolbar row (Arabic plural car count + Excel
  pill), the dark filter bar (code filter, counters with «بلا طقم» yellow, reset; no «كل
  المهمات»), the dark table (bold white code with the hover card, status, mission, the daily
  seats, notes clamped to 3 lines, pinned «إجراءات» with pen / swap / «إفراغ الطقم»), the drivers
  panel («السائقون (n)», free drivers first, held-off drivers under «معيّنون على سيارات أخرى» with
  the blue «سيارة أخرى»), the pen dialog in the daily DriverSlot look, the floating save bar and
  the discard confirm. Under 1366 px a seat's name may take a second line, so the whole table fits
  a 1280 screen with nothing under «إجراءات».
- **Tablet / phone (< 1280 px)** — `FixedTouchBoard`: the daily cards and sheets, always in code
  order, the workshop car in place and unlocked, the seat picker (with the drivers on other cars
  by code), the drivers sheet, the mission / notes / filters sheets, the save bar; a landscape
  tablet splits cars 60 % / drivers 40 %.
- **One model above both boards** (`lib/fixed-roster-model.ts`): the real `useDraftBoard`
  (`FIXED_ROSTER_DRAFT_KEY`, no date), «تراجع» (50 steps, in memory, lapsing on a new board), every
  edit through the existing `fixed-roster-board.ts` rules plus the new pure `swapDrivers`, all
  gated by `fleetRoster.plan`.
- **The refused save** keeps the draft and says why in Arabic (`lib/fixed-save-refusal.ts`), as
  a toast titled «تعذّر حفظ الطقم الثابت» with the reason under it (the shared toast cuts its
  title to one line; the reason wraps whole): the driver by name (from the people list the screen
  already loads) and the holding car by code, or «سيارة أخرى ليست في هذه الشاشة» when that car is
  outside the reader's scope. Never an id, never the server's English. For that, the server's
  refusals gain read-side `details` (`FIXED_CREW_DRIVER_HELD`, `FIXED_CREW_HOLDER` only in scope,
  `FIXED_CREW_VEHICLE_NOT_ACTIVE`, `FIXED_CREW_PROFILE_INACTIVE`, `FIXED_CREW_NOT_A_DRIVER`,
  `FIXED_CREW_MISSION_INACTIVE`). Status and error code are unchanged, and so is the English
  message, except that a holding car outside the caller's scope is now «a vehicle outside your
  scope» in it instead of its internal id. No rule moved; no names in the body.
- **A driver held on a car off this board** (another branch's, out of service, deleted) is the
  daily board's «سيارة أخرى»: listed under «معيّنون على سيارات أخرى», never counted, never
  dragged, and never offered by a seat's list (touch picker, landscape target) or the pen dialog.
  No edit here can release him, so a save that seated him could only be refused.
- **The daily «تعيين السيارات» is unchanged.** Its shared pieces gain optional props only, each
  defaulting to today's output (`ExcelPill`/`ExcelButton` `name`, `DriversButton` `label`,
  `DriverSlotPicker`/`SeatCell` `emptyLabel`, `SeatCell` `nameClassName`,
  `AvailableList` `freeBadge`/`emptyLabel`,
  `MissionSheet` `title`/`notice`, `NotesSheet` `title`/`subtitle`/`maxLength`, `CarCard`
  `workshopLock`/`badges`/`menu`), the new `DriversHeading` export, and `export` keywords on
  existing constants. `roster-optional-props.spec.tsx` pins the daily defaults, and every daily
  spec passes unedited.

Design: `docs/12-planning/fleet-module-design.md` §4.5b (rewritten as built) and revision 1.25.

## ما يجب أن يعرفه صاحب الطلب

1. الشاشة اتعملت بنفس شكل «تعيين السيارات» الجديد بالظبط على الكمبيوتر والتابلت والموبايل، بس من غير تاريخ ولا أيام: مفيش أسهم يوم قبل/بعد، ومفيش «يوم سابق». الطقم الثابت ملوش يوم، بيفضل زي ما هو لحد ما تغيّره. وتحت العنوان على اليمين بقى مكتوب عدد العربيات اللي ظاهرة بعد الفلتر، زي اليومي.
2. زراير «حفظ» و«إلغاء» نزلت تحت في الشريط اللي بيظهر بس لما يكون فيه تعديل مش محفوظ، زي التعيين اليومي، ومعاها أرقام العربيات اللي اتعدلت (تدوس على رقم يوديك للعربية) وزرار «تراجع» بيرجّع آخر تعديل. ولو عدّلت أكتر من عربية ودوست «إلغاء» هيسألك الأول. ولو قفلت الصفحة وفتحتها التعديلات اللي مش محفوظة بترجع، بس «تراجع» بيبدأ من جديد.
3. خانة «كل المهمات» اللي جنب «كود السيارة» اتشالت على الكمبيوتر زي ما طلبت في التعيين اليومي؛ مربعات المهمات نفسها هي الفلتر. على الموبايل والتابلت فلتر المهمة موجود جوه «عوامل التصفية».
4. على الموبايل والتابلت بقى فيه كروت للعربيات بدل الجدول، وخانة «ابحث بكود السيارة…» تحت العنوان وجنبها زرار التحميل، وزرار السواقين (على الموبايل أيقونة ورقم بس) بيفتح قايمة السواقين من تحت. والكروت دايمًا بترتيب أرقام العربيات، من غير ترتيب بالحالة زي اللي كان في الجدول.
5. بما إن السحب مش شغال باللمس: تدوس على خانة السواق تطلعلك قايمة تختار منها، وفيها كمان السواقين اللي على عربيات تانية برقم عربيتهم — تختار واحد منهم يتنقل لعربيتك. أو تختار السواق الأول من قايمة «السائقون» وبعدين تدوس على الخانة.
6. ضفنا زرار التبديل (السواق الأول يبقى التاني والعكس) زي التعيين اليومي، على الكمبيوتر في عمود «إجراءات» وعلى الموبايل بين الخانتين.
7. لما تنقل سواق من عربية لعربية، الخانة الجديدة بيظهر تحتها «سيُنقل من السيارة 214 عند الحفظ» لحد ما تحفظ.
8. سلة «إفراغ الطقم» فاضلة زي ما هي: بتفضّي السواقين الاتنين مرة واحدة، والمهمة والملاحظات بيفضلوا، ومن غير سؤال (لو غلطت عندك «تراجع» أو «إلغاء»). وعلى الموبايل والتابلت موجودة بنفس الاسم في قايمة النقط التلاتة.
9. قايمة السواقين بقت بشكل التعيين اليومي (الاسم وتحته الكود)، والكود بقى تحت الاسم في خانات العربية كمان. مفيش كلمة «متاح» جنب كل واحد، لأن الشاشة دي مش بتسأل مين فاضي النهارده. السواقين اللي ملهمش طقم ثابت بقوا أول القايمة، وبعدهم عنوان «معيّنون على سيارات أخرى» وتحته السواق المتثبت على عربية مش ظاهرة في الشاشة (فرع تاني أو عربية خارج الخدمة) ومكتوب جنبه «سيارة أخرى» بالأزرق، نفس الكلمة اللي اليومي بيكتبها (اليومي بيكتبها بالأصفر، وهنا فاضلة بالأزرق زي السامبل اللي اعتمدته). ولو مفيش ولا سواق من غير طقم هيكتب «لا يوجد سائقون بلا طقم ثابت» بدل الجملة القديمة اللي كان فيها «في هذا التاريخ».
10. العربية اللي في الورشة صفها بقى بلون وردي خفيف زي التعيين اليومي، بس طقمها الثابت بيتعدل عادي (مش مقفولة زي اليومي). وعلى الموبايل فاضلة في مكانها برقمها، مش متجمعة تحت ومقفولة.
11. رقم العربية بقى أبيض عريض زي التعيين اليومي، من غير اللون الخاص بكل عربية. لو عاوز الألوان دي ترجع قولي.
12. كل الأرقام بقت أرقام إنجليزي (1، 2، 3) زي باقي الشاشات الجديدة، بدل (١، ٢، ٣) اللي كانت في المربعات.
13. اللي غايب النهارده أو في إجازة مش هيظهر هنا، لأن ده يوم؛ هيفضل ظاهر في «تعيين السيارات» («غائب من الطاقم الثابت») وفي لوحة الحركة.
14. لما تقف على اسم سواق أو رقم عربية، الكارت اللي بيطلع بيقول عربية النهارده وسواقين النهارده من التعيين اليومي، مش الطقم الثابت — زي ما هو دلوقتي.
15. زرار التحميل بقى تحت العنوان على الشمال، في نفس السطر اللي فيه عدد العربيات، نفس زرار التعيين اليومي وباقي الشاشات الجديدة: مكتوب عليه «تصدير» وجنبها كلمة إكسيل بالحروف الإنجليزي زي ما هي هناك. زرار واحد بس، ومفيش زرار تاني في العنوان. الملف نفسه زي ما هو: اللي ظاهر بالفلتر، ثمان أعمدة.
16. لو الحفظ اترفض (مثلًا حد تاني ثبّت نفس السواق على عربية تانية وانت لسه بتعدّل، أو سواق ملفه اتوقف وهو في طقم العربية اللي بتعدلها)، رسالة الرفض بقت بالعربي: فوق «تعذّر حفظ الطقم الثابت» وتحتها السبب كامل، وفيه اسم السواق ورقم العربية اللي ماسكاه، ومن غير أي رقم داخلي. ولو العربية دي مش من العربيات اللي تقدر تشوفها، الرسالة بتقول «سيارة أخرى ليست في هذه الشاشة (فرع آخر أو سيارة محذوفة)» بدل رقمها. التعديل نفسه مش بيضيع، بيفضل مستني لحد ما تصلّحه أو تلغيه.
17. الصلاحيات زي ما هي: اللي معاه تخطيط بس هو اللي يعدّل، واللي بيتفرج بس مش هيشوف عمود «إجراءات» ولا شريط الحفظ. والفرع اللي فوق بيحدد العربيات، والسواقين من الشركة كلها.
18. على الموبايل والتابلت «تعديل» اللي في قايمة النقط التلاتة بقى للملاحظات بس، زي التعيين اليومي؛ المهمة بتتغير من الزرار اللي جنب رقم العربية، والسواقين من خاناتهم. على الكمبيوتر القلم لسه بيفتح الشباك اللي فيه الأربع حاجات مع بعض.
19. مربع «بلا طقم» فوق بقى لونه أصفر زي «بلا سائق» في التعيين اليومي، والوردي بقى للورشة بس. ولو دوست عليه يفلتر زي ما هو.
20. شباك «تعديل» على الكمبيوتر بقى شكل خانات السواقين فيه زي التعيين اليومي: السواق المختار اسمه وكوده وجنبه علامة ✕، والخانة الفاضية فيها زرار «اختيار سائق» يفتح القايمة. نفس القواعد: السواق التاني مستني الأول، ونفس الشخص مينفعش في الخانتين.
21. الملاحظات في الجدول بقت تظهر في تلات سطور بالكتير، ولو أطول تقف عليها تشوفها كلها (دلوقتي كانت سطر واحد بنفس الطريقة). كده الملاحظة الطويلة مش بتكبّر الصف، وعلى شاشات الكمبيوتر الصغيرة الجدول كله داخل من غير ما حاجة تستخبى تحت عمود «إجراءات». وعلى شاشة 1280 بالذات، اسم السواق الطويل في خانته بينزل على سطرين بدل ما يوسّع الجدول (من 1366 وأكبر بيفضل سطر واحد).
22. عدد العربيات اللي تحت العنوان بقى مكتوب بالعربي الصح حسب الرقم: «سيارة واحدة»، «سيارتان»، «3 سيارات»، «11 سيارة». ده في الشاشة دي بس، و«تعيين السيارات» فاضل زي ما هو.
23. الرقم اللي جنب «السائقون» (فوق القايمة، وعلى زرار السواقين في الموبايل والتابلت) بقى عدد السواقين اللي ملهمش طقم ثابت بس، زي اليومي؛ اللي متثبتين على عربيات مش ظاهرة بيبانوا تحت «معيّنون على سيارات أخرى» ومش محسوبين فيه.
24. السواق المتثبت على عربية مش ظاهرة في الشاشة (فرع تاني أو عربية خارج الخدمة) بيبان في قايمة «السائقون» تحت «معيّنون على سيارات أخرى» بس، زي اليومي: مش بيتسحب، ومش بيطلع في قايمة أي خانة ولا في شباك «تعديل»، لا على الكمبيوتر ولا على الموبايل والتابلت. السبب إن الحفظ كان هيترفض دايمًا، لأن العربية اللي ماسكاه مش في الشاشة عشان تفضّيها. لو لازم يتنقل، يتشال من طقم عربيته الأول.
25. العنوان «الطقم الثابت» وفوقه «الحركة» فاضل فوق في كل المقاسات زي ما اخترت (ج)، فعلى شاشة الكمبيوتر الصغيرة (1280 و1366) بيبان حوالي 5 صفوف كاملة بدل 7 في اليومي، وعلى التابلت وهو بالعرض كارتين بدل تلاتة.
26. زي ما اخترت (ب): مفيش أي علامة في الشاشة دي على سواق ملفه موقوف أو رخصته منتهية أو مش على وظيفة سائق — لا في الخانة ولا في القايمة ولا في شباك «تعديل»؛ ده بيبان في «تعيين السيارات» بس. ولو الحفظ اترفض بسبب كده، الرسالة بتقول ليه (البند 16).

## Scope

- Phase: Fleet — «الطقم الثابت» redesign (design rev 1.25)
- Type: feat
- API: `apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts`: the refusals carry
  `details`, and the new exported `FIXED_CREW_REFUSAL` names the six codes; the held-driver 409
  no longer puts an out-of-scope holder's vehicle id in its message. Ten new integration specs sit
  at the end of the «fixed crew» describe in `tests/integration/fleet.spec.ts`.
  `packages/contracts/src/modules/fleet.ts` changes comments only.
- Web, new files:
  - `lib/fixed-roster-model.ts`, `lib/fixed-save-refusal.ts`, `fixed-roster-spec-sources.ts`
  - `components/roster/FixedDeskBoard.tsx`, `fixed-desk-cells.tsx`, `FixedDriversPanel.tsx`,
    `FixedCrewDialog.tsx`, `FixedTouchBoard.tsx`, `fixed-touch-parts.tsx`
  - specs: `lib/fixed-roster-model.spec.ts`, `lib/fixed-save-refusal.spec.ts`,
    `components/roster/roster-optional-props.spec.tsx`, `fleet-fixed-roster-touch.spec.tsx`
- Web, rewritten: `pages/FixedRosterPage.tsx` is now the shell (URL, model, header, board pick).
  `fleet-fixed-roster.spec.tsx` is now the screen + computer spec.
- Web, changed: `lib/fixed-roster-board.ts` gains `swapDrivers` and fixes stale docs. The daily
  pieces gain optional props or `export` only (`RosterDeskBoard`, `roster-desk-parts`,
  `roster-desk-cells`, `roster-drivers`, `roster-touch-parts`, `RosterCarCard`,
  `DriverSlotPicker`). `lib/roster-board.ts` changes one stale comment only.
- Shared specs re-pointed at `components/roster/FixedDeskBoard.tsx` (the fixed columns moved out
  of the page): `fleet-sort-arrows`, `fleet-vehicle-card-census`, `lib/vehicle-code-selectors`.
- i18n (ar + en): 20 new keys:
  - `fleet.fixedRoster.poolEmpty`
  - 13 × `fleet.fixedRoster.refusal.*` (the toast's `title` and twelve reasons)
  - the five forms of `fleet.fixedRoster.carCount.*`
  - `fleet.fixedRoster.matchedRows`
- i18n removed: five keys nothing reads any more (`fleet.fixedRoster.subtitle`, `.summary`,
  `.driversHint`, `.removeDriver`, `.unsaved`).
- Docs: `CHANGELOG.md` ([Unreleased] → Changed) and `docs/12-planning/fleet-module-design.md`
  (§4.5b + row 1.25).
- Not changed: the fixed crew's rules, endpoints, permissions and data (soft delete only, no
  migration, no new field). `EmployeeName.tsx`, `RosterPage.tsx`, `RosterTouchBoard.tsx`,
  `RosterAssignDialog.tsx` and every daily spec are untouched.

## Review checklist (Development Workflow §4)

- [x] Layer rules respected (thin controller, logic in service, data access in repository) — the
      refusal details are built in the service where each refusal already was; the web model
      lives in `lib/`, the boards only draw it
- [x] No cross-module imports; features imported via `index.ts` only
- [x] Permissions declared + route `authorize(...)` present; frontend gated with `<Can>` — no new
      permission; every edit, the save bar and «إجراءات» read `fleetRoster.plan` (`useCan`)
- [x] Zod validation at every new boundary; types inferred, not duplicated — no new boundary; the
      payload is still `SaveFleetFixedRosterSchema` (the model spec parses it)
- [x] Mutations audited; events named per convention; reliable tier where business-critical —
      the save path is unchanged
- [x] Tests: unit for rules, integration for endpoints (happy + authZ + validation)
- [x] ar + en translations; RTL-safe layout (formal Arabic check clean; Latin digits)
- [x] Docs updated in this PR (CHANGELOG, design §4.5b + rev 1.25; no permission matrix, DB or
      ADR change)

## Verification

Ran the full gate locally in CI order with `CI=true` (`npm ci` skipped: `node_modules` were
already installed), alone, on the tree with the review fixes (the last commit of this PR):

| Step | Result |
|---|---|
| no `zz-*` scratch under `apps` | 0 files |
| `node scripts/check-secrets.mjs` | rc 0 |
| `npm run build -w packages/contracts` | rc 0 |
| `npm run lint` (root, apps/api, apps/web) | rc 0 |
| `npm run typecheck --workspaces --if-present` | rc 0 |
| `node scripts/gen-permission-matrix.mjs --check` | rc 0 |
| `node scripts/check-flag-expiry.mjs` | rc 0 |
| `node scripts/check-page-registry.mjs` | rc 0 |
| `node scripts/automation-templates.mjs` | rc 0 |
| `node scripts/check-formal-arabic.mjs` | rc 0 |
| `npm run test -w packages/contracts` | rc 0 — 53 files, 1334 tests |
| `npm run test -w apps/api` | rc 0 — 689 files, 11759 tests |
| `npm run test -w apps/web` | rc 0 — 596 files, 14044 tests |
| `npm run build` | rc 0 |
| `node scripts/dependency-audit.mjs` | rc 0 |

One API case is timing-dependent under the full suite's load and failed in two of the five full
runs made for this PR (each time passing alone, and passing in the other runs):
`src/modules/atm/register/import/read-register-workbook.spec.ts` › «ExcelJS read directly WOULD
spill this fixture (control)», a `TypeError` inside ExcelJS's own stream reader. The ATM module
is untouched here; it may come back in CI.

What the new and moved specs prove:
- **The daily screen is unchanged.** The daily specs run unedited and pass: fleet-daily-roster,
  fleet-roster-touch, fleet-roster-filter-row, fleet-roster-licence, fleet-roster-picker,
  roster-shared, roster-board, roster-layout, daily-roster-board, roster-view, useDraftBoard and
  draft-storage. `roster-optional-props.spec.tsx` pins the daily defaults of every new optional
  prop.
- **The fixed screen:**
  - `fleet-fixed-roster.spec.tsx`: the screen and the computer, 66 cases (the 1280 seat name).
  - `fleet-fixed-roster-touch.spec.tsx`: phone, portrait, landscape and short, 77 cases.
  - `lib/fixed-roster-model.spec.ts`: the model, 57 cases (a held-off driver is never offered to a
    seat; the refusal toast is title + reason).
  - `lib/fixed-save-refusal.spec.ts`: every refusal, 22 cases. This includes the real-catalog case:
    each Arabic line has no Latin letter, and the five plural forms read «سيارة واحدة / سيارتان /
    3 سيارات / 11 سيارة / 100 سيارة»; and the real shared Toaster drawing the longest line whole
    under its one-line title.
  - `components/roster/roster-optional-props.spec.tsx`: 25 cases, `SeatCell`'s `nameClassName`
    among them.
- **The API:** ten new cases in `tests/integration/fleet.spec.ts` › «fixed crew» (the
  out-of-scope case also pins both 409 messages). The whole file passes, 408/408.
- **In a browser** (Chromium, dark, DSF 2: the whole real app — shell, routes, both pages — over
  a mock API, 20 cars in two branches, two 24-letter names in one row):
  - Computer at 1920, 1366 and 1280: one h1, one `data-export="fixed-roster"`, no stepper, no
    sideways scroll; the table frame does not scroll at 1280 (858 in 858; the daily, unchanged,
    is 952 in 858 there). No raw key, no Latin word but «Excel» (and the shell's «ECMS», «EN»,
    «⌘K»), no Eastern digit, no truncated text except the notes' designed three-line clamp.
  - Tablet (1024×768, 768×1024) and phone (375): the same checks; the pen dialog, the phone's
    drivers sheet and seat picker list no held-off driver as a pick (the sheet lists him under
    «معيّنون على سيارات أخرى»).
  - The daily screen in the same harness still shows its stepper, its tabs, «متاح», the amber
    «سيارة أخرى» and its own count («8 سيارة»).

## Notes for reviewers

- **The daily screen.** Every change to a shared roster piece is an optional prop whose default is
  today's exact output, or an `export` keyword. `roster-optional-props.spec.tsx` renders each piece
  without the prop (daily facts) and with it (fixed behaviour). The daily specs ran unedited.
- **Held-off drivers (D1, changed in review).** A driver the server holds on a car that is not on
  this board is listed, not counted in «السائقون (n)», not draggable, and — since the review — not
  offered by any seat's list or the pen dialog either (`availableFor` leaves him out when a seat is
  being filled; `dialogCandidates` is the free pool plus the car's own crew). The first build let
  the pen dialog and the touch seat list pick him while the desk seat picker did not, and every
  such save was refused: one rule for the whole screen now, the daily one. The held-driver refusal
  stays reachable (another planner's save in between) and keeps its Arabic line. The 409's English
  message no longer ends with an out-of-scope holder's vehicle id («a vehicle outside your scope»);
  the in-scope message is word for word as before, and a spec pins both.
- **The refusal toast (review L1).** The shared Toaster draws its title on one truncated line, so
  the reason (driver, holding car) is the toast's description, which wraps: title
  `fleet.fixedRoster.refusal.title` «تعذّر حفظ الطقم الثابت». The Toaster itself is unchanged;
  `fixed-save-refusal.spec.ts` draws the real Toaster with the longest line and checks it.
- **1280 px (review L2, told 21).** With two 24-letter names in one row the table was 899 px in an
  858 px frame at 1280×800. `SeatCell` gains an optional `nameClassName` (none by default: the
  daily seat is as before, and no new width rule enters the daily files) through which the fixed
  board's `FIXED_SEAT_NAME` (`fixed-desk-cells.tsx`) lets a seat's name take a second line below
  1366 px; measured in
  the browser it is now 858 in 858 at 1280 and 944 in 944 at 1366, with about 25 px of slack at
  1280 for a classic scrollbar. The drivers panel keeps the daily laptop width.
- **Kept on purpose:** `lib/vehicle-colour.ts` (and its spec) has no production importer after
  told item 11; it stays so the per-car colours can come back if the owner asks («لو عاوز الألوان
  دي ترجع قولي»).
- **Left for later (the daily screen, unchanged by rule):** (a) the daily «تعديل» dialog's name and
  code still touch in Arabic (`EmployeeName` puts `ms-2` on a left-to-right code); fixed locally
  here (`FixedCrewDialog`) so the daily stays as approved; (b) the daily notes have no 500-letter
  cap; (c) the desk mission select (shared `MISSION_BOX`) clips a mission name longer than about
  «نقل أموال (يومي)» on both screens; (d) no realtime event refreshes this screen
  (`fleet.fixedCrew` and `fleet.maintenanceVisit` invalidate `['fleet','roster']`, not
  `['fleet','fixed-roster']`) — before adding it, `readDraft` should overlay only the reader's own
  rows, or a live refresh would carry another planner's change back in this reader's draft. All
  four predate this PR; candidates for the open owner items.
- **Refusal literals.** The six codes are plain strings on both sides, pinned by specs on each
  side; `fixed-save-refusal.spec.ts` also reads the API service source to check they match. No
  contract change.
- **API spec placement.** The new API specs sit LAST in the fixed-crew describe on purpose: two
  «AUDIT» tests above read `/fleet/drivers?pageSize=100` as one page.
- **Decisions where the design was silent:**
  - The notes clamp drops `block` (it would undo `line-clamp-3` in Tailwind 3.4).
  - The pen dialog's mission list is the active missions plus the car's own, the cell's rule.
  - Amber unsaved rows and cards show for every reader, as on the daily board; only a planner
    gets the bar.
  - The pen hook is `data-edit-row={row.code}` (the daily hook), not the vehicle id.
  - The drivers sheet on touch has no count heading; the count is on the button.
  - The workshop CARD has no rose face, as the daily cards; its «في الورشة» badge says it.
- **Header cost (answer 2 ج, told to the owner):** about 5 full rows at 1280×800 / 1366×768
  instead of the daily 7, and 2 cards on a landscape tablet instead of 3.
- **`fullHeight` (D5).** `PageContainer fullHeight` was checked in a browser at 390×844,
  820×1180, 1180×820 and 844×390, light and dark. The sticky rows and the bottom bar hold, and
  nothing scrolls sideways.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
