# «الطقم الثابت» build spec (reconstructed 2026-11-18 after the machine was replaced)

TEMPORARY NOTES — remove `.wip-notes/` before the PR (squash folds it away).

The full scratchpad (gap-map.md 96 KB, fixed-functions.md, daily-design.md, the sample harness
zz-fixed-sample*.tsx, the six approved v2 dark pictures, DECISIONS.md) was lost when the cloud machine
was replaced on 2026-11-18 ~07:35 UTC. This file keeps everything that survived in the session's memory,
verbatim where possible. The design source of truth that still exists: the merged daily roster
«تعيين السيارات» in the code (RosterPage + roster components) — the fixed screen is "the daily roster's
look without a day", per the told list below.

## Order

- 2026-11-17 owner: «واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى» → sample (fleet «الطقم الثابت»,
  /fleet/fixed-roster, apps/web/src/modules/fleet/pages/FixedRosterPage.tsx) in the design of the merged daily
  roster «تعيين السيارات».
- Owner answers to the sample: «1 ب / 2 ج». Sample v2 applied them (591 checks passed).
- 2026-11-18 owner: «انت لسه معملتش بيدج الطاقم الثابت» → build it.

## Binding rules from the owner's answers («1 ب / 2 ج»)

- **Q1 (ب)**: FixedRosterPage shows NO flag for a standing member who can no longer drive — no amber seat frame,
  no «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» on a seat, a pool row, the touch picker, the drivers
  sheet or the pen dialog's driver list; no new contract field or server fact for it. Those flags live on the
  daily «تعيين السيارات» only. A save the server refuses keeps the draft and shows the refusal toast.
- **Q2 (ج)**: keep FixedRosterPage's `PageContainer fullHeight` + `PageHeader` (title `fleet.nav.fixedRoster`,
  breadcrumbs `fleet.module.title` → /fleet › `fleet.nav.fixedRoster`; PageHeader has no subtitle) on top at
  EVERY width, and REMOVE its `actions` (`ExportSheetButton`): Excel is the daily's `ExcelPill` in the toolbar row
  beside «20 سيارة» (desk) and the daily's `ExcelButton` at the end of the touch board's first row — one Excel
  control per width. No «الطقم الثابت» box in the day stepper's place; the touch board draws no h1 of its own
  (one title per width).
- Sample v2 measurement: the header costs ~109px: 5 whole rows at 1280×800/1366×768 (daily 7), 9 at 1920×1080;
  landscape tablet 2 cards vs daily 3 (told to the owner).

## How the sample was assembled (gap-map §10 — the harness plan, verbatim)

Import as is: `useRosterLayout` · `num`, `Count`, `CodeList`, `unbrokenName`, `EditsBar` (PA) · `ExcelPill`,
`DeskCounters` (DP) · `DriverSearch` (DR) · `BottomSheet` · `CarSearch`, `FilterButton`, `ResetChip`,
`DriversButton`, `CounterChips`, `ExcelButton`, `ConfirmSheet`, `FiltersSheet` (TP) · `SeatCell` with an adapter:
`{...row, inMaintenance:false}` (so no workshop lock; the badge and the rose tint read the real row),
`facts.expired`/`facts.unavailable` EMPTY (Q1 ب — no amber frame, no flag badge), `reasonLabel` never reached ·
`VehicleHoverCode`, `DriverSlotPicker`, `useDriverHoverCard`, `CatalogSelect`, `VehicleCodeFilter`,
`FilterWithIcon`, `DARK_TABLE`, `DARK_FILTER_BAR`, `BOARD_FRAME`, `BOARD_TABLE_FILL`, `actionTone`/`ACTION_GROUP`,
`Badge`, `InWorkshopBadge`, `DataTable`, `FilterBar`, `Dialog`, the REAL `PageHeader` (Q2 ج, no `actions`),
`SwapIcon`, row-action icons, `saveSheet`, the sort helpers.
(PA = roster-parts, DP = desk parts, DR = roster-drivers, TP = touch parts, RB = lib/roster-board.ts,
P = FixedRosterPage.tsx, B = the fixed rules / board lib, CC = the daily car card.)

Copy into the sample (module-private or hard-wired to the day — for the BUILD prefer exporting the real piece
with an optional prop, daily default unchanged): the desk look constants (`ROW_TINTS`, `LAPTOP_*`, `TIGHT_CELL`,
`PINNED_*`, `ROSTER_TABLE`, `MISSION_BOX`, `useOverflowing`) · a fixed `StatusCell` (stacked «في الورشة» +
«معيّنة»/«بلا طقم») · the drivers panel shell (one heading, no tabs, no licence footer) and the list row face
without «متاح» · the car card (CC) without the workshop lock and with the fixed ⋮ words and badges · the mission
and note sheets with the title «تعديل · {code}», the catalog lines and the 500 cap · the touch picker list with
the fixed badges and «معيّنون على سيارات أخرى» · `EditCrewDialog` (P:110-322, not exported) with its rules
verbatim and its two seats redrawn as the daily DriverSlot · the undo helpers (RB:110-169) retyped for
`FleetFixedCrewRowDto`, `editStep` on the fixed `changedRows`.
The swap button = `assignDriver(rows, vehicleId, 'driver1EmployeeId', row.driver2EmployeeId)` — the fixed
rule's swap-within-a-car, no new rule.
The fixed model: draft via the REAL `useDraftBoard(FIXED_ROSTER_DRAFT_KEY, …)`, the REAL
`assignDriver/clearSlot/clearCrew/applyEdit/availableDrivers/changedRows/findSeat`, `visibleFixedRows/readFixedView`,
undo, counters as FixedRosterPage today (P:597-656), `transferFrom` as RB:750-759, `filtersHiding` for the three
fixed views.
Not used: `RosterDeskBoard`, `RosterTouchBoard`, `useRosterBoard`, `DriversPanel`, `DriverTabs`,
`UnavailableList`, `RosterAssignDialog`, the steppers, `PastDayBanner`, `WorkshopGroup`.

## Build hand-offs (gap-map §10/§14/§16)

- an `emptyLabel` on `DriverSlotPicker` (its empty line is the day sentence, DriverSlotPicker.tsx:116);
- a friendly Arabic line for the 409 DUPLICATE refusal naming the driver and the holding car (review C1, T-16) —
  told item 16 said "when we build the screen we can make it Arabic with the driver's name and the car";
- a `label` prop on the touch `DriversButton` (its title / aria-label is the day word «السائقون المتاحون»; here
  «السائقون»);
- `EmployeeName` puts `ms-2` on its `dir="ltr"` code, so in Arabic the name and code touch — the merged daily
  dialog too (the sample put the gap back locally);
- an Arabic plural-aware car count («سيارة واحدة / سيارتان / 3–10 سيارات / 11+ سيارة») and «عدد الصفوف بعد عوامل
  التصفية» for every board on `fleet.vehicles.count` / `fleet.filters.matchedRows`;
- the daily's notes wrap without a cap (same 500-letter risk) — NOT in this build;
- NO server facts for standing-member flags (Q1 ب);
- stale comments N1, N5, N10 (in the fixed page / board lib).

## Told list (what the owner read — owner.md / gap-map §11, verbatim; every item must be true in the build)

1. الشاشة اتعملت بنفس شكل «تعيين السيارات» الجديد بالظبط على الكمبيوتر والتابلت والموبايل، بس من غير تاريخ ولا أيام: مفيش أسهم يوم قبل/بعد، ومفيش «يوم سابق». الطقم الثابت ملوش يوم، بيفضل زي ما هو لحد ما تغيّره. وتحت العنوان على اليمين بقى مكتوب عدد العربيات اللي ظاهرة بعد الفلتر، زي اليومي.
2. زراير «حفظ» و«إلغاء» نزلت تحت في الشريط اللي بيظهر بس لما يكون فيه تعديل مش محفوظ، زي التعيين اليومي، ومعاها أرقام العربيات اللي اتعدلت (تدوس على رقم يوديك للعربية) وزرار «تراجع» بيرجّع آخر تعديل. ولو عدّلت أكتر من عربية ودوست «إلغاء» هيسألك الأول. ولو قفلت الصفحة وفتحتها التعديلات اللي مش محفوظة بترجع، بس «تراجع» بيبدأ من جديد.
3. خانة «كل المهمات» اللي جنب «كود السيارة» اتشالت على الكمبيوتر زي ما طلبت في التعيين اليومي؛ مربعات المهمات نفسها هي الفلتر. على الموبايل والتابلت فلتر المهمة موجود جوه «عوامل التصفية».
4. على الموبايل والتابلت بقى فيه كروت للعربيات بدل الجدول، وخانة «ابحث بكود السيارة…» تحت العنوان وجنبها زرار التحميل، وزرار السواقين (على الموبايل أيقونة ورقم بس) بيفتح قايمة السواقين من تحت. والكروت دايمًا بترتيب أرقام العربيات، من غير ترتيب بالحالة زي اللي كان في الجدول.
5. بما إن السحب مش شغال باللمس: تدوس على خانة السواق تطلعلك قايمة تختار منها، وفيها كمان السواقين اللي على عربيات تانية برقم عربيتهم — تختار واحد منهم يتنقل لعربيتك. أو تختار السواق الأول من قايمة «السائقون» وبعدين تدوس على الخانة.
6. ضفنا زرار التبديل (السواق الأول يبقى التاني والعكس) زي التعيين اليومي، على الكمبيوتر في عمود «إجراءات» وعلى الموبايل بين الخانتين.
7. لما تنقل سواق من عربية لعربية، الخانة الجديدة بيظهر تحتها «سيُنقل من السيارة 214 عند الحفظ» لحد ما تحفظ.
8. سلة «إفراغ الطقم» فاضلة زي ما هي: بتفضّي السواقين الاتنين مرة واحدة، والمهمة والملاحظات بيفضلوا، ومن غير سؤال (لو غلطت عندك «تراجع» أو «إلغاء»).
9. قايمة السواقين بقت بشكل التعيين اليومي (الاسم وتحته الكود)، والكود بقى تحت الاسم في خانات العربية كمان. مفيش كلمة «متاح» جنب كل واحد، لأن الشاشة دي مش بتسأل مين فاضي النهارده. السواقين اللي ملهمش طقم ثابت بقوا أول القايمة، وبعدهم عنوان «معيّنون على سيارات أخرى» وتحته السواق المتثبت على عربية مش ظاهرة في الشاشة (فرع تاني أو عربية خارج الخدمة) ومكتوب جنبه «سيارة أخرى» بالأزرق، زي ما اليومي بيكتبها. ولو مفيش ولا سواق من غير طقم هيكتب «لا يوجد سائقون بلا طقم ثابت» بدل الجملة القديمة اللي كان فيها «في هذا التاريخ».
10. العربية اللي في الورشة صفها بقى بلون وردي خفيف زي التعيين اليومي، بس طقمها الثابت بيتعدل عادي (مش مقفولة زي اليومي). وعلى الموبايل فاضلة في مكانها برقمها، مش متجمعة تحت ومقفولة.
11. رقم العربية بقى أبيض عريض زي التعيين اليومي، من غير اللون الخاص بكل عربية. لو عاوز الألوان دي ترجع قولي.
12. كل الأرقام بقت أرقام إنجليزي (1، 2، 3) زي باقي الشاشات الجديدة، بدل (١، ٢، ٣) اللي كانت في المربعات.
13. اللي غايب النهارده أو في إجازة مش هيظهر هنا، لأن ده يوم؛ هيفضل ظاهر في «تعيين السيارات» («غائب من الطاقم الثابت») وفي لوحة الحركة.
14. لما تقف على اسم سواق أو رقم عربية، الكارت اللي بيطلع بيقول عربية النهارده وسواقين النهارده من التعيين اليومي، مش الطقم الثابت — زي ما هو دلوقتي.
15. زرار التحميل بقى تحت العنوان على الشمال، في نفس السطر اللي فيه عدد العربيات، نفس زرار التعيين اليومي وباقي الشاشات الجديدة: مكتوب عليه «تصدير» وجنبها كلمة إكسيل بالحروف الإنجليزي زي ما هي هناك. زرار واحد بس، ومفيش زرار تاني في العنوان. الملف نفسه زي ما هو: اللي ظاهر بالفلتر، ثمان أعمدة.
16. لو الحفظ اترفض (مثلًا سواق متثبت على عربية فرع تاني أو على عربية خارج الخدمة، أو سواق ملفه موقوف وهو في طقم العربية اللي بتعدلها)، رسالة الرفض لسه طالعة بالإنجليزي زي دلوقتي، وفيها رقم داخلي بدل اسم السواق ورقم العربية اللي ماسكاه، والصور مش بتوريها. التعديل نفسه مش بيضيع، بيفضل مستني. لما نبني الشاشة نقدر نخليها بالعربي وفيها اسم السواق ورقم العربية.
17. الصلاحيات زي ما هي: اللي معاه تخطيط بس هو اللي يعدّل، واللي بيتفرج بس مش هيشوف عمود «إجراءات» ولا شريط الحفظ. والفرع اللي فوق بيحدد العربيات، والسواقين من الشركة كلها.
18. على الموبايل والتابلت «تعديل» اللي في قايمة النقط التلاتة بقى للملاحظات بس، زي التعيين اليومي؛ المهمة بتتغير من الزرار اللي جنب رقم العربية، والسواقين من خاناتهم. على الكمبيوتر القلم لسه بيفتح الشباك اللي فيه الأربع حاجات مع بعض.
19. مربع «بلا طقم» فوق بقى لونه أصفر زي «بلا سائق» في التعيين اليومي، والوردي بقى للورشة بس. ولو دوست عليه يفلتر زي ما هو.
20. شباك «تعديل» على الكمبيوتر بقى شكل خانات السواقين فيه زي التعيين اليومي: السواق المختار اسمه وكوده وجنبه علامة ✕، والخانة الفاضية فيها زرار «اختيار سائق» يفتح القايمة. نفس القواعد: السواق التاني مستني الأول، ونفس الشخص مينفعش في الخانتين.
21. الملاحظات في الجدول بقت تظهر في تلات سطور بالكتير، ولو أطول تقف عليها تشوفها كلها (دلوقتي كانت سطر واحد بنفس الطريقة). كده الملاحظة الطويلة مش بتكبّر الصف، وعلى شاشات الكمبيوتر الصغيرة الجدول كله داخل من غير ما حاجة تستخبى تحت عمود «إجراءات».

Build change to item 16: the refusal line becomes Arabic, naming the driver and the holding car code (tell the owner).

## Approved pictures (lost locally; the owner has them in the chat)

v2, dark, 1920 DSF 2 unless said: fixed-dark (3840×2410, desk company), fixed-branch-dark (desk, one branch),
fixed-edit-dark (desk, the pen dialog), fixed-tablet-dark, fixed-phone-dark (750×7570), fixed-phone-sheet-dark
(phone drivers sheet). Daily references: daily-dark, daily-branch-dark, daily-tablet-dark, daily-phone-dark,
daily-phone-sheet-dark (shoot them again from the real daily screen).

## Standing owner rules (for every agent)

- Do what the owner says; nothing on your own. Tell him what will change before a PR (summary + DARK pictures only).
- Soft delete only; existing data unchanged. Formal Arabic in the UI; Egyptian Arabic to the owner, Arabic
  SCRIPT only (no English, no Latin-letter Arabic) in anything he reads. Samples only when he asks.
- Never print or copy PINs; card numbers stay masked.
- Squash-merge when CI is green unless he objects; then unsubscribe, delete the check-in, restart the branch.

## Open owner items (not this PR)

- retire «أرقام الفترة»/«ملخصات»?; overview card «رصيد العهدة النقدية» vs «إجمالي العهدة»; «سجل العهدة»
  «2 سيارات» → «سيارتين»; ErrorState raw «INTERNAL» small fix; delete the accidental artifact
  https://claude.ai/artifact/3sUFjosQJWS6kB5esVhibD?; follow-ups from #753: ar-EG digits in «شهر انتهاء الترخيص»
  options (3 screens), car page digits, car record accidents count by code.
