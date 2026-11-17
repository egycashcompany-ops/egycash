# «الطقم الثابت» in the design of «تعيين السيارات» — gap map (design sample, not production)

Order (owner, 2026-11-17): «اعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى». A SAMPLE of `/fleet/fixed-roster`
(FixedRosterPage) drawn in the merged daily roster's design (desktop board, tablet and phone layouts), keeping every
function the standing-crew screen has today. Read-only analysis: tree `/home/user/egycash-fx` (detached, HEAD b1cc9d360,
`git status --porcelain` empty before and after), no tracked file touched, nothing published.

Inputs: `fixed-crew/fixed-functions.md` (= **FF**, functions F1–F53, notes N1–N11, candidate Q-1..Q-4),
`fixed-crew/daily-design.md` (= **DD**, desk D1–D20, touch T1–T21, §5 colours, §6 words, §7 day-only parts, §8 reuse),
`DECISIONS.md` (§0 house rules, §11 B1 car 150, the initials fix #711, the 2026-11-17 sample entry), the reference shots
`fixed-crew/ref/*.png` and `fixed-crew/now/*.png` (looked at: daily-1920, daily-1920-edited, daily-375, daily-768,
daily-768-picker, now-1920), and the code re-read for this map (lines below are in the sample tree).

Short forms — fixed side: **P** pages/FixedRosterPage.tsx · **B** lib/fixed-roster-board.ts · **V** lib/roster-view.ts ·
**SV** apps/api/…/fixed-roster/fixed-roster.service.ts · **Q** api/fleet-queries.ts · **C** contracts fleet.ts.
Daily side (all under apps/web/src/modules/fleet/): **RP** pages/RosterPage.tsx · **DB** components/roster/RosterDeskBoard.tsx ·
**DC** roster-desk-cells.tsx · **DP** roster-desk-parts.tsx · **PA** roster-parts.tsx · **DR** roster-drivers.tsx ·
**TB** RosterTouchBoard.tsx · **TP** roster-touch-parts.tsx · **CC** RosterCarCard.tsx · **BS** RosterBottomSheet.tsx ·
**RB** lib/roster-board.ts · **I** platform/localization/i18n.ts (Arabic block).

**DECIDED 2026-11-17 — the owner answered «1 ب / 2 ج» (DECISIONS.md, last entry). Q1 (ب): this screen shows NO flag
for a standing member who can no longer drive — no amber seat frame, no «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة
منتهية» in seats, pool, touch picker or pen dialog; those flags are the daily «تعيين السيارات»'s only, and the screen
behaves as today (a refused save keeps the draft with today's toast, T-16). Q2 (ج): the OLD page header returns on
top at every width — the real `PageHeader` exactly as FixedRosterPage renders it (title «الطقم الثابت», breadcrumbs
«الحركة» → /fleet › «الطقم الثابت»; NO subtitle — PageHeader has none by owner decision, `page-header-has-no-subtitle.spec.ts`), with NO Excel action (Excel stays the toolbar pill / the touch button: one per
width); no «الطقم الثابت» box in the stepper's place; the touch boards' own h1 goes (one title per width). The lines
below are updated to these decisions; §13/§14 stay as the log of the passes made before the answer; §15 records the
update of the sample, §16 the review round on it. The build uses Q1 (ب) and Q2 (ج).**

Classes used on every line: **KEPT** (function and look stay) · **RESTYLED** (function stays, the daily's look) ·
**MOVED** (function stays, another place) · **DROPPED** (only where the daily roster has no equivalent AND the owner
loses nothing) · **NEW** (a daily element with a real meaning for a standing crew) · **Q** (a question for the owner) ·
**T-n** (an item of the told list, §11).

---

## 0. The answer in one paragraph

The standing crew becomes the daily board without the day. On a computer: the OLD page header on top (Q2 ج — the real `PageHeader`,
«الحركة › الطقم الثابت» + the title «الطقم الثابت», no action in it), then the daily's toolbar («20 سيارة» · Excel pill;
nothing in the day stepper's place), the dark filter bar on one line («كود السيارة» with its
truck icon · the counters «إجمالي · صيانة · بطقم · بلا طقم · one chip per mission» with ‹ › on overflow · the red reset),
the boards' dark table with the same seven columns, the daily seat (green disc, name, employee code, bin, «+ اختيار
سائق», «عيّن السائق الأول أولاً», the move strip «سيُنقل من السيارة 214 عند الحفظ»), the owner's action box (pen · NEW
swap · «إفراغ الطقم»), amber unsaved rows and rose workshop rows, the daily drivers panel with ONE list «السائقون (11)»
(no «غير المتاحين» tab, no licence block), and the floating unsaved bar (edited codes · «تراجع» · «إلغاء» · «حفظ»). On a
tablet and a phone: the daily's cards, car-code search, sticky filter row, bottom sheets (picker with «معيّنون على
سيارات أخرى», drivers, filters, mission, note) and the three shapes of the unsaved bar. What makes it a STANDING board
and not the day: no date anywhere, no past, the workshop never locks a car (seats, pen, swap, mission all live on a car
in the workshop), the bin empties the two seats only (mission and note stay), the pool is one undivided company-wide
list, and the day's flags (absence, «غياب الطاقم الثابت», «جاهزة», «بلا سائق», «تشغيل») do not appear. The one thing a
standing member can carry that the board cannot show today — a switched-off profile, a person no longer on a driving
job, an expired licence — stays unshown here, as today (Q1 ب: those flags are the daily's only).

## 1. Rules this map follows (derived, each checked in code)

1. **No day.** No stepper, no «اليوم», no past banner, no day word in any text the board writes (FF F1; C:1897-1910).
   The only day words left are inside the shared hover cards («السائقون اليوم», «السيارة المعيّنة اليوم»), which
   are today's daily board by design (FF N7) — T-14 — and the shared `DriverSlotPicker`'s empty line «لا يوجد سائقون
   متاحون في هذا التاريخ», reached only when the pool is empty (DriverSlotPicker.tsx:116; build hand-off, §10; the
   sample's pool is never empty in a shot). [C13]
2. **The workshop is context, never a lock.** Every daily lock keyed on `inMaintenance` (DC:226-227 seat, DB:326-333
   mission disabled, DB:381-408 pen/swap hidden, CC:473-476 card/pill/menu, TP:380 group) is NOT carried over: the fixed
   rules have no workshop branch (B:52-117, SV:12-13 «no FR-5 workshop refusal»).
3. **One pool, undivided, company-wide.** No unavailable half, no reason chips, no licence block, no «متاح» verdict
   (FF F2, F17; SV:128-145). The pool = server drivers minus everyone the draft seats (B:119-143).
4. **The fixed words stay where they differ from the day's:** «بطقم» / «بلا طقم» (counters, badge), «إفراغ الطقم» (bin),
   «تعديل · 150» (pen, dialog title), «تم حفظ الطقم الثابت» (toast), «الطقم الثابت» (screen). The daily's words are used
   where the meaning is the same (seats, picker, move, bar, filters, search, sheets).
5. **Who can edit** = `fleetRoster.plan`, with no date floor (P:507). Daily `mayPlan = plan && date >= today` (RP:140)
   loses its date half here.
6. **Latin digits everywhere** (`num` = en-US, PA:19-20); figures in Azeret Mono; words in Cairo; formal Arabic.
7. **The daily's look is copied exactly** (sizes, tones, bands 1280/1440/1536/1750, sticky rules), so a reader moving
   between the two screens meets one design; nothing fixed-only is added (Q1 ب: no flags; Q2 ج: the
   screen's existing header, not a new element).

## 2. Desktop (≥1280px) — element by element

Frame: `PageContainer fullHeight` + `BOARD_FRAME` (DB:432-433): toolbar · dark filter bar · grid `table | drivers panel`
· floating unsaved bar. The page never scrolls; the table and the panel scroll inside themselves (FF F48 KEPT).

| # | Daily element (DD) | «الطقم الثابت» in that design | Behaviour | Class | F# |
|---|---|---|---|---|---|
| FD1 | D1 frame, no title/breadcrumbs | Same frame UNDER the old page header (Q2 ج): `PageContainer fullHeight` + the REAL `PageHeader` exactly as P:1066-1076 renders it — title «الطقم الثابت» (`fleet.nav.fixedRoster`), breadcrumbs «الحركة» (`fleet.module.title`, link /fleet) › «الطقم الثابت» — with NO `actions` (P's header Excel icon is not drawn: Excel is the toolbar pill, FD3). The header costs ≈109px: whole rows under it 1280×800 → 5, 1366×768 → 5, 1536×864 → 6, 1920×1080 → 9 (the daily: 7 · 7 · 8 · 11); the page never scrolls, no sideways scroll. (Touch landscape keeps the header on screen too — its cost there is on the §3 landscape line.) | — | KEPT (Q2 ج) | F46, F48 |
| FD2 | D2 toolbar count | «20 سيارة» bold 14px at the START edge, `role=status`, title «عدد الصفوف بعد الفلاتر» — the rows ON SCREEN. | Moves with filters; «إجمالي» chip stays the whole board. | NEW | — |
| FD3 | D3 Excel pill | At the END edge: the boards' pill «تصدير Excel» (title «تحميل ملف إكسيل (كل ما أظهره الفلتر)»), spinner while busy, failure toasted. | The fixed file, unchanged: the rows on screen (filtered + sorted, unsaved edits included), named after the screen + today, 8 columns م · كود السيارة · في الورشة (نعم/لا) · الحالة (معيّنة / بلا طقم) · نوع المهمة · السائق الأول · السائق الثاني · ملاحظات (P:881-909). | MOVED (header icon → toolbar pill) · T-15 | F45 |
| FD4 | D4 day stepper | NONE, and NOTHING in its slot (Q2 ج: the page header names the screen; the Q2 (أ) «الطقم الثابت» pin box of the first sample is gone). The toolbar row is the daily's without the stepper: «20 سيارة» at the start, the Excel pill at the end. | — | DROPPED (day) | F1 |
| FD5 | D5 past-day banner | NONE — a standing crew has no past; it is always editable for a planner. | — | DROPPED (no fixed function lost) | F1 |
| FD6 | D6 dark filter bar | `DARK_FILTER_BAR` box, ONE row: «كود السيارة» → counters → the `FilterBar`'s red reset, an ICON-only square at the bar's end with title/aria «مسح عوامل التصفية» (only while `q`, `mission` or `view` is set; daily-1920-dark-filtered.png, FilterBar:98-131) — today's labelled red button goes. [C1] | Reset clears `q, mission, view` in one update (P:706). | RESTYLED | F35, F41 |
| FD7 | D7 «كود السيارة» | `FilterWithIcon` truck (emerald) 12rem + `VehicleCodeFilter` (multi-pick, typing inside, «150 - 151»), options = every car on the board, matches the CODE only, URL `q`. The «كل المهمات» select beside it is REMOVED, as on the daily (DB:10-11): the mission chips are its control, `?mission=` links still narrow, touch keeps «نوع المهمة» in the filters sheet (FT17). | — | RESTYLED (160px → 12rem) · MOVED («كل المهمات» → chips) · T-3 | F36, F37 |
| FD8 | D8 counters | `DeskCounters` (DP:293-401): 36px chips, label 12px + figure 14px bold Azeret on ONE line, ring when applied, ‹ › at both ends when the row overflows. Order: «إجمالي» (brand) · «صيانة» (rose) · «بطقم» (emerald) · «بلا طقم» (yellow, the daily's «بلا سائق» hue `COUNTER_TONES.unmanned` — rose stays the workshop's; review L4, told T-19) · one chip per ACTIVE mission type, zero ones too, hue hashed from the catalog id. Latin digits (fixes N3). | «إجمالي» clears `mission`+`view`; a state chip SETS `view` (desk only sets, as both boards do today); a mission chip toggles in `mission`. Counts the whole DRAFT, never the filtered rows; filters AND. | RESTYLED · T-12 | F38, F39, F40 |
| — | D8 counters «تشغيل», «جاهزة», «بلا سائق», «غياب الطاقم الثابت» | NOT on this board (day verdicts: availability, licence on the day, mission with nobody — FF F52; S:1777-1781 keeps «تشغيل» out on purpose). | — | not adopted (day) | — |
| FD9 | D9 table | `DARK_TABLE` + `BOARD_TABLE_FILL`, rounded-2xl `#111827`, head `#0c121e` 13px bold, sticky head, centred cells, Cairo words, Azeret figures. Columns in the fixed order: كود السيارة · الحالة · نوع المهمة · السائق الأول · السائق الثاني · ملاحظات · إجراءات. Sort arrows on «كود السيارة» and «الحالة» (asc → desc → off; a new column joins the order); «الحالة» ranks workshop → crewed → uncrewed. Default order = the fleet's (150 upward, worded codes, «الملاكى» last). Loading skeleton / error + retry inside the table; empty «لا توجد سيارات». | — | RESTYLED | F43, F47 |
| FD10 | D10 code cell | Code bold 14px Azeret `dir=ltr`, plain (the car's own hashed colour chip goes, P:476-497) + `VehicleHoverCode` car card on hover only, not a Tab stop: code, make (150 = «مرسيدس اسيليو 915»), «نشطة», plate, branch («المهندسين»), operation, «السائقون اليوم», licence end + state. | — | RESTYLED · T-11 | F6, F7 |
| FD11 | D11 «الحالة» | Badges `sm`, one line each, stacked and centred: «في الورشة» (info/sky) when `inMaintenance`, then «معيّنة» (success) when a driver sits in either seat, else «بلا طقم» (neutral). Never «—» (a standing row always says crewed or not). | — | KEPT (words, tones) · RESTYLED (stacked, nowrap) | F8 |
| — | D11 day badges «رخصة منتهية» (car), «غائب من الطاقم الثابت», «الطاقم الثابت غير متاح», «مخطَّط لها سائق غير متاح» | Not on this board (day facts; the fixed DTO has none, C:1897-1910). | — | not adopted (day) | F52 |
| FD12 | D12 «نوع المهمة» | `CatalogSelect` tight in the 9.5rem box (9rem on a laptop), Cairo words, empty option «بدون نوع مهمة», keeps an archived current value; **enabled on a workshop car** (the daily disables it, DB:326). Reader without plan: the name, «—» when none or unknown. | Edits the draft through `applyEdit` (P:853-861); one «تراجع» step. | RESTYLED (11rem → 9.5rem) | F9, F25 |
| FD13 | D13 seat cell ×2 | The daily seat (DC:107-400), 11–15rem box: **filled** = green person disc 20px + name 12.5px bold (two lines past 24 letters) + employee code 11px Azeret + bin 14px «إزالة من هذه الخانة»; the driver card on the name (hover, not focusable); draggable for a planner, faded while dragged. **Empty** = dashed box + «+ اختيار سائق» (brand) → `DriverSlotPicker` over the free pool. **Seat 2 with no seat 1** = grey «عيّن السائق الأول أولاً», not a drop target (`data-drop-disabled=needsFirstDriver`). **Reader without plan** = «بدون سائق», no bin, no picker. **Drop target** = brand border + ring. **Moved here, unsaved** = amber strip under the seat «⇄ سيُنقل من السيارة 214 عند الحفظ» (from the SAVED board's seat, RB:750-759). **Problem** = NONE (Q1 ب): the daily seat is handed empty flag sets, so no amber frame and no «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» — a switched-off or expired standing member sits in his seat like anyone (as today). **Workshop** = NO lock: the seat is drawn and behaves as on any car (the daily's «في الورشة — غير قابلة للتعيين» is not used). | Drop rules = the fixed ones (B:52-117): other seat of the same car = swap; another car = move (old car releases, re-seated if it lost seat 1; the target's occupant goes back to the pool); same seat = nothing; every drop lands except seat 2 with no seat 1. Bin on seat 1 of a two-man crew promotes seat 2 (B:182-217). | RESTYLED · NEW (move strip, code under the name) · T-5, T-6, T-7 | F3, F4, F5, F10, F11, F20, F21, F22 |
| FD14 | D14 «ملاحظات» | 12px, 5–8rem (3.125rem floor on a laptop), wraps balanced, held to THREE lines with the whole note in its hover title (today's rule is one line + title; a 500-letter note must never set a row's height — review L1/C3); «—» when none. Written in the pen dialog. | — | RESTYLED (one line → three lines, title kept) | F12 |
| FD15 | D15 «إجراءات» | The owner's box, pinned to the end edge with the shaded edge while the table overflows; column exists only for a planner. **Pen** (blue `#58a8e8`) «تعديل» on EVERY row, workshop cars too → the fixed dialog. **Swap** (indigo) «تبديل السائق الأول والثاني» when both seats are filled, workshop cars too. **Bin** (red `#e86870`) «إفراغ الطقم» when either seat is filled: both seats in ONE edit, mission and note stay, no confirm (as today; «تراجع» undoes it). | — | RESTYLED · NEW (swap) · T-6, T-8 | F13, F23, F24 |
| FD16 | D16 row tints | Opaque, so the pinned cell inherits: unsaved amber (`#fffbeb` / dark `#261919`, hover `#301911`) outranks workshop rose (`#fff1f2` / dark `#291021`). Unsaved = exactly the rows «حفظ» would send (both sides of a move). | Clears on save or cancel. | RESTYLED (amber) · NEW (rose = context only) · T-10 | F28 |
| FD17 | D17 drivers panel | The daily aside (rounded-2xl `#111827`, 20rem; 24rem from 1750; 18.25rem on a laptop). Header: ONE plain heading «السائقون (11)» (13px emerald + count, in the daily tabs' 44px row — no segmented track, no lone raised pill; review L2), then the 36px search «ابحث بالاسم أو الكود أو الرقم» (panel-local). List rows = the daily's face: green disc 36px + name 15px semibold + code; the driver card on the name (hover); draggable for a planner (no button). Badges: **none** on a free driver (no «متاح» — «free today» is not this board's question); no licence or profile flag either (Q1 ب). The free drivers come FIRST; a driver whose standing car is not on this board follows under the daily's grey section «معيّنون على سيارات أخرى (n)» with «سيارة أخرى» in the daily's info (blue) tone — the daily's badge for a car it cannot name (review L5; told T-9). Still draggable / pickable as today (the save is then refused, T-16). A term that finds nobody free but finds somebody in the section prints no empty line (the daily's rule, review C2). Empty pool: «لا يوجد سائقون بلا طقم ثابت» (NEW word, fixes N2; true also when no driver exists at all [C2]); search miss: «لا يوجد سائق مطابق للبحث». While the board loads or failed: the list is blank (the table carries the state). No «غير المتاحين» tab, no reason chips, no licence block / links (day). | Pool derived from the draft (a drag removes, a clear returns). | RESTYLED · T-9 | F2, F17, F18, F19 |
| FD18 | D18 floating unsaved bar | Only for a planner with unsaved edits: amber dot + «تغييرات غير محفوظة» + count + «السيارات المعدَّلة:» + the edited codes (amber, dotted; a code → its row, centred, lifting only the filter that hides it — the three fixed views, a `filtersHiding` written for them; on touch it also clears a typed code that hides the car [C7]) · «↶ تراجع» (last edit, up to 50) · «إلغاء» (every edit; asks first when more than one car: «إلغاء التغييرات» + «إلغاء كل التغييرات غير المحفوظة؟ تعود هذه السيارات كما حُفظت آخر مرة:» + codes) · brand «حفظ» (spinner; «تراجع»/«إلغاء» disabled while saving). | «حفظ» sends the changed rows only; success → cache replaced, draft dropped, toast «تم حفظ الطقم الثابت»; refusal → draft kept, nothing re-read, error toast as today. «إلغاء» also clears the tab's stored draft. | MOVED (strip end → bar) · NEW (codes, «تراجع», confirm) · T-2 | F26, F27, F29, F30, F31, F32, F33 |
| FD19 | D19 pen dialog | The fixed dialog's fields, rules and words: «تعديل · 150», hint «نوع المهمة والطقم والملاحظات — تُحفظ معًا», «نوع المهمة» (catalog; «تعذّر تحميل أنواع المهمات» / «لا توجد أنواع مهمات في الكتالوج بعد»), «السائق الأول»/«السائق الثاني» drawn as the daily dialog's DriverSlot (review L6): a chosen seat = name + code row with ✕; an empty seat = «اختيار سائق» opening a list (free pool + this car's own two; never the other seat's person; the «سيارة أخرى» badge only — no «رخصة منتهية», Q1 ب); seat 2 disabled with «عيّن السائق الأول أولاً»; ✕ on seat 1 of a two-man crew moves seat 2 up; «لا يمكن أن يحمل الخانتين نفس الشخص», «ملاحظات» (3 rows, 500), «إلغاء»/«حفظ», no outside-click close. | Its «حفظ» = ONE «تراجع» step (a dialog saved unchanged adds none). | KEPT (rules) · RESTYLED (seats) · T-20 | F24 |
| FD20 | D20 clear-row confirm | NOT adopted: its words are the day's («سيتم مسح مهمة اليوم وسائقي هذه السيارة لهذا التاريخ…») and its action clears mission and note too; the fixed bin stays immediate and seat-only (FD15). | — | not adopted | F23 |

Width bands (DB:81-126, 492): ≥1750 panel 24rem gap 16px · 1536–1749 panel 20rem gap 12px (approved look) · 1440–1535
panel 18.25rem, mission box 9rem, notes floor 3.125rem · 1280–1439 cell gutters 4px, gap 8px, row icons 2px apart, and
(this board only, review L1) the panel 17.75rem with its rows' side padding 16 → 12px, so a name keeps its 1440 room: at
1280 the table now fits its frame (the daily lets it scroll 45px under the pinned «إجراءات»; with a note on most standing
cars that slid notes under the pin). All RESTYLED from the fixed «xl one fifth,
under the table below 1280» (F19, F49).

## 3. Tablet and phone (<1280px) — element by element

Layouts (LY:23-45; one board picked by width, the draft and undo live above it so a rotate keeps them):
- **every touch width** — the old page header on top (Q2 ج), scrolling away with the cards.
- **1024–1279 landscape** — first row (car search 20rem · Excel 44px at the end), filter row (filters button ·
  red reset · counters), grid cars 3fr / drivers 2fr (the panel always visible: target or pending banner, else the
  dashed hint; search; list), floating bar. A mouse still drags a driver onto a seat. The split view is fixed in height,
  so the header STAYS on screen here (it does not scroll away as on portrait / phone): whole cards without scrolling
  1024×768 → 2 (cars column 439px) and 1180×820 → 2 (491px), drivers rows 4 / 5 — the daily on the same figures 3 / 3
  cars (548 / 600px) and 6 / 7 rows. Told the owner (س2); shooter `extra-landscape` reads both boards (V-R2-2).
- **768–1023 portrait** — sticky header: car search + Excel row, filter row + green «السائقون (11)» button; cards
  with the two seats side by side and the swap between; strip bar. The car search starts 24px under the page header's
  line (its mb-6, as every width and today's page): the sticky block takes `-mt-3` against its own `pt-3`, which it
  keeps once stuck at top-0 (V-R2-3).
- **<768 phone** — the search + Excel row scrolls away; only the filter row sticks; compact (icon-only) filter / reset /
  drivers buttons; seats stacked with the bracket and the turned swap; phone two-row bar.
- **any touch under 500px tall** — nothing on top sticks; only the bar stays.

| # | Daily element (DD) | «الطقم الثابت» | Class | F# |
|---|---|---|---|---|
| FT1 | T1 title | The board's own h1 GOES: the old page header (the real `PageHeader`, «الحركة» → /fleet › «الطقم الثابت», title 24px) sits on top at every touch width and scrolls away with the cards (Q2 ج) — one title per width. | KEPT (name, in the header) | F46 |
| FT2 | T2 day stepper | NONE. | DROPPED (day) | F1 |
| FT3 | T3 Excel 44px | Green download icon, title «تحميل ملف إكسيل (كل ما أظهره الفلتر)», where the daily keeps it: the END edge of the board's first row — beside the car search now that the h1 is gone (landscape: search 20rem · gap · Excel; portrait inside the sticky header; phone scrolls away). The header carries no Excel (one per width). The cards on show (typed code included) in drawn order = the fleet order. | MOVED | F45 |
| FT4 | T4 car-code search | «ابحث بكود السيارة…» 48px, ✕ 48px; board state only (not URL, not remembered), ANDed with `q` / missions / view; Arabic-Indic digits folded; several codes. Counters keep counting the whole board. | NEW · T-4 | F36 |
| FT5 | T5 filters button | «عوامل التصفية» + funnel (icon only on a phone); brand when on, badge = codes + missions + view → FT17. | MOVED (code picker and mission select into the sheet) | F36, F37 |
| FT6 | T6 red reset | Only while filtered (typed code included); clears `q, mission, view` and the typed code. | RESTYLED | F41 |
| FT7 | T7 counter chips | 48px, two lines (label 11px over figure 15px bold), same four + mission chips, one sideways line, no arrows; a pressed state chip lets go on a second tap; the applied chip is scrolled into sight. | RESTYLED | F38, F39, F40 |
| FT8 | T8 drivers button | Solid emerald 48px, people icon, «السائقون» + count (pool length) — phone and portrait → FT16. | NEW (touch) | F19 |
| FT9 | T9 car card | rounded-2xl card: code 22px extrabold Azeret + amber dot when unsaved · mission pill (its hue; dashed «بدون نوع مهمة» when none; chevron for a planner; «—» for a reader with none) → mission sheet · badges «في الورشة» / «معيّنة» or «بلا طقم» · ⋮ menu: «تعديل» (note sheet) and red «إفراغ الطقم» (only with a seat filled; immediate). Unsaved card amber. **A workshop car is a full, editable card in its code place** (not the daily's compact locked card). | RESTYLED (COPY, see §10) | F8, F9, F13, F23, F25, F28 |
| FT10 | T10 seat row | ≥56px: avatar (green person / dashed brand + / grey lock), caption «السائق الأول»/«السائق الثاني» 11px, name 15px semibold (`unbrokenName`), code 12px; ✕ 44px «إزالة من هذه الخانة»; amber move strip; no flag badge and no amber frame (Q1 ب); brand ring when it is the target. Tap empty → picker (landscape: makes it the target); tap filled → picker with the occupant row. Seat 2 with no seat 1: grey «عيّن السائق الأول أولاً», not tappable. Reader: «بدون سائق». | RESTYLED | F3, F10, F21, F22 |
| FT11 | T11 swap | 44px round, indigo ⇄ (turned on a phone, with the bracket), when both seats are filled — workshop cars too. | NEW · T-6 | F20 (swap within a car) |
| FT12 | T12 notes | Strip «ملاحظات: …» + pen → note sheet (planner, workshop cars too) / plain text (reader). | RESTYLED | F12, F24 |
| FT13 | T13 workshop group | NOT adopted: the daily folds the workshop's cars at the end because nothing can be done on them; here they keep and change their crew, so they stay in code order as full cards. «صيانة» chip still narrows to them. | not adopted · T-10 | F4 |
| FT14 | T14 bottom sheet | `BottomSheet` as is (scrim, handle, 88dvh, ≤42rem centred from 768, swipe/Escape close). | KEPT (reuse) | — |
| FT15 | T15 picker sheet | Title «تعديل · 171», subtitle the seat «السائق الثاني» (+ « · name» on a filled seat). Toolbar: the search only (no tabs). List: the free pool (no badge at all — no «متاح», no «رخصة منتهية», Q1 ب), then «معيّنون على سيارات أخرى (27)» — drivers the draft seats on OTHER cars of this board, each with that car's code badge, then the ones held by a car off the board with «سيارة أخرى» in the same info tone (review L5) — a tap MOVES him (old car releases him; the move strip appears on the seat). Occupant row with «إزالة من هذه الخانة» on a filled seat. Same rules as a drop. | NEW (moves without a drag) · T-5 | F20, F21 |
| FT16 | T16 drivers (pool) sheet | Title «السائقون», hint «اختر سائقًا، ثم اختر له خانة في إحدى السيارات.» (no date subtitle). Driver first: a tap chooses him → emerald banner «يُعيَّن الآن: {name} — اختر له خانة في إحدى السيارات.» + ✕; the next seat tap places him. | NEW · T-5 | F19, F20 |
| FT17 | T17 filters sheet | «عوامل التصفية»: «كود السيارة» code buttons grid (5 columns, 7 from 768), «نوع المهمة» rows «كل المهمات» + pills with counts; footer red reset + brand «عرض النتائج (n)». Writes `q`, `mission`. | MOVED (F36/F37 on touch) | F36, F37, F42 |
| FT18 | T18 mission / note / confirm sheets | Mission: title «تعديل · 150», «نوع المهمة», radio rows 56px with hue pills + «بدون نوع مهمة» (enabled on a workshop car); carries the fixed dialog's two catalog lines «تعذّر تحميل أنواع المهمات» / «لا توجد أنواع مهمات في الكتالوج بعد» (the daily sheet has neither, TP:469-520 [C4]). Note: title «تعديل · 150», «ملاحظات», textarea 4 rows, the fixed 500-letter cap and «empty → no note» (F24; the daily sheet has no cap, TP:634-690 [C4]), «حفظ»/«إلغاء». Confirm: only «إلغاء التغييرات» (more than one car). All write the draft; each is one «تراجع» step. | RESTYLED (titles) | F9, F12, F24, F31 |
| FT19 | T19 landscape banners | Target «يُعيَّن الآن: السيارة 171 · السائق الثاني» + ✕; pending driver banner; dashed hint «اختر خانة في إحدى السيارات ثم السائق، أو اختر السائق أولًا ثم الخانة.» | NEW | F20, F21 |
| FT20 | T20 bar shapes | phone (two rows, full-width «حفظ» under the thumb + «تراجع» «إلغاء») · strip (portrait) · floating (landscape); sticky at the bottom, pushed to the foot when cards are few. | MOVED · NEW (undo) | F26, F27 |
| FT21 | T21 empty / loading / error | «لا توجد نتائج» (filters) or «لا توجد سيارة بهذا الكود» (typed code); `LoadingState`; `ErrorState` + retry; a board with no cars «لا توجد سيارات». | RESTYLED | F47 |

Hover cards on touch: none (no hover) — the same as today, where they need a mouse (F50). Sort on touch: none (the
cards follow the fleet order; the «صيانة» / «بطقم» / «بلا طقم» chips group by state); `sort` stays in the URL and the
remembered set for the computer (F42, F43).

## 4. States

| # | State | Computer | Tablet / phone |
|---|---|---|---|
| S1 | Arrival, planner, company view | FD1–FD17, no bar, «إجمالي» ringed. Picture `fixed-dark`. | Cards from 150, chips row sticky. |
| S2 | Reader without `fleetRoster.plan` | No «إجراءات» column, no bar, mission as text, empty seats «بدون سائق», no bins, no picker, pool rows not draggable, «سيارة أخرى» still shown (F15). | No ⋮, no ✕, no swap, pill not tappable, seats not tappable, drivers sheet read-only. |
| S3 | Loading | Table skeleton; pool list blank; the counters read 0 until the answer lands (both boards count an empty draft today — kept) [C15]. | `LoadingState`; lists say nothing. |
| S4 | Board read failed | Table error + «إعادة المحاولة» (re-reads); pool blank. (Shared `ErrorState` may print a raw code — known open item, DECISIONS 2026-11-17; the internal error shot uses a network failure.) | `ErrorState` + retry. |
| S5 | Empty | No active car in scope: «لا توجد سيارات». Pool empty: «لا يوجد سائقون بلا طقم ثابت» [C2]. Search finds nobody: «لا يوجد سائق مطابق للبحث». Filters hide every car: «لا توجد سيارات» (today's text, kept). | «لا توجد نتائج» / «لا توجد سيارة بهذا الكود». |
| S6 | Filtered | Chip ringed, red reset, toolbar count drops («3 سيارة»… as `fleet.vehicles.count` words it), counters unchanged. The filters read the DRAFT (today's fixed behaviour, P:692-703): a car crewed under «بلا طقم» leaves the narrowed table at once — the daily desk keeps the server's flags until «حفظ», its touch board behaves like this one; the bar's code brings the car back by lifting the view [C7]. | Same + funnel badge; typed code ANDed. |
| S7 | Editing | Drag over → brand ring; picker open (fixed panel, flips up near the bottom); pen dialog. | Target ring + banner (landscape); picker / mission / note sheets; pending driver banner. |
| S8 | Unsaved changes | Amber rows (both sides of a move), move strip on the receiving seat, bar with codes · «تراجع» · «إلغاء» · «حفظ»; counters and pool already reflect the draft. Reload: the draft comes back (this tab), the undo steps do not. Picture `fixed-edit-dark`. | Amber cards + dot, bar in its shape. |
| S9 | Saving | «حفظ» spinner, «تراجع»/«إلغاء» disabled. | Same. |
| S10 | Saved | Toast «تم حفظ الطقم الثابت», tints clear, bar leaves. | Same; target and pending cleared. |
| S11 | Save refused | Draft kept, board not re-read, bar stays; one error toast naming the server's reason and field (English today — T-16). | Same. |
| S12 | Gap — car with no crew | «بلا طقم» badge; seat 1 dashed «+ اختيار سائق»; seat 2 «عيّن السائق الأول أولاً»; counted in «بلا طقم»; bin hidden. A mission with nobody is still «بلا طقم» (V:59-82). | Same on the card. |
| S13 | Gap — one-man crew | Seat 2 dashed «+ اختيار سائق»; «معيّنة» (no rule says a car needs two). | Same. |
| S14 | Standing member absent today (leave, «تمام») | NOT shown — a day fact; the daily board says it («غائب من الطاقم الثابت», «الطاقم الثابت غير متاح») and the dashboard counts it. T-13. | Same. |
| S15 | Standing member with a switched-off profile / no longer on a driving job / expired licence | NOT shown (Q1 ب, as today): no amber frame, no «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» on the seat, in the pool or in the pen dialog — those flags are the daily «تعيين السيارات»'s. Any save that touches that car is refused for the first two («this driver’s fleet profile is inactive» / «this employee does not hold a driving seat», SV save checks); the licence is never checked by the save [C5]; the draft is kept with today's refusal toast (S11, T-16). Sample: 247 seat 2 «صبري أنور الفقي», 410 seat 2 «وائل رشاد عبد الغني», «حمدي عبد الستار رزق» in the pool — each drawn as any driver. | Same: name + code only. |
| S16 | Car in the workshop | «في الورشة» badge + rose row; seats, mission, pen, swap, bin all live. | Badge only; full card in place. |
| S17 | «سيارة أخرى» driver | Under «معيّنون على سيارات أخرى» after the free drivers, blue «سيارة أخرى» (review L5); can still be dragged/picked (today's behaviour; the save is then refused — 409 DUPLICATE, the server's English sentence with the driver's internal number and the holding car's code, T-16, review C1). | Same in the sheets. |
| S18 | Branch chosen in the top bar | Only that branch's cars (F16); the pool stays company-wide, so every driver fixed to another branch's car carries «سيارة أخرى» (F17, F18). Internal shot `fixed-branch-dark`. | Same. |

## 5. Every function of «الطقم الثابت» → its place in the new design (FF F1–F53)

| F | Function (FF) | Where it lives now | Class |
|---|---|---|---|
| F1 | One row per active car, no date anywhere | No stepper, no past, no day word; draft key unchanged (no date) | KEPT (FD4, FD5, FT2 drop the day pieces) |
| F2 | Pool has no unavailable half | One list (FD17, FT15, FT16), no tabs | KEPT |
| F3 | Two ordered seats; seat 2 needs seat 1 | Seat captions/columns; «عيّن السائق الأول أولاً»; promotion on clear | KEPT (FD13, FT10) |
| F4 | Workshop car keeps its crew, never refused | No lock anywhere (rule 2); rose row/badge only | KEPT (FD13, FD15, FT9, FT13) |
| F5 | One crew per driver, one person per car | `assignDriver` unchanged; picker excludes the target car's own crew | KEPT |
| F6 | Code in the car's own colour | Plain bold Azeret code, as the daily | RESTYLED (FD10, T-11) |
| F7 | Car card on hover of the code | `VehicleHoverCode` (same card) | KEPT (FD10); touch: none, as today |
| F8 | «الحالة»: «في الورشة» + «معيّنة»/«بلا طقم» | FD11 stacked badges; FT9 card badges | KEPT/RESTYLED |
| F9 | «نوع المهمة» in-cell select / text | FD12 (9.5rem, enabled on workshop); FT9 pill → FT18 sheet | RESTYLED |
| F10 | Seat cells: drop target, chip, bin, picker, locked texts | FD13 / FT10 | RESTYLED |
| F11 | Driver card on hover (seat and pool) | Same shared card on the seat name and the panel name (`hoverCard`) | KEPT |
| F12 | «ملاحظات» shown, edited in the dialog | FD14 wraps; FT12 strip → note sheet | RESTYLED |
| F13 | «إجراءات»: pen every row, crew bin when filled | FD15 (+ swap); FT9 ⋮ menu | RESTYLED + NEW swap |
| F14 | View = `fleetRoster.view`, edit = `fleetRoster.plan` | Same gates (rule 5) | KEPT |
| F15 | Viewer mode | S2 (actions column absent instead of «—») | RESTYLED |
| F16 | Cars follow scope + top-bar branch | Unchanged (server); S18 | KEPT |
| F17 | Pool company-wide | Unchanged; S18 | KEPT |
| F18 | «سيارة أخرى» badge | Pool row badge (warning), all layouts | KEPT |
| F19 | Pool panel: title + count, search, own scroll, page never scrolls | FD17 (desk), FT8/FT16 (phone, portrait), landscape panel | RESTYLED |
| F20 | Drag and drop: swap / move / nothing / never refused but seat 2 | FD13 drag; FT15 moves by tap; FD15/FT11 swap button; landscape mouse drag | KEPT + NEW touch paths |
| F21 | «+ اختيار سائق» picker | FD13 (same `DriverSlotPicker`); FT15 sheet | KEPT/RESTYLED |
| F22 | Seat bin promotes seat 2 | FD13 bin; FT10 ✕ | KEPT |
| F23 | Crew bin «إفراغ الطقم» (both seats) | FD15 bin; FT9 ⋮ red item; no confirm | KEPT |
| F24 | «تعديل» dialog, its rules | FD19 unchanged (desk); touch: pill + seats + note sheet (same rules: seat 2 locked, promotion, no same-person, pool + own) | KEPT / MOVED (touch) |
| F25 | Mission in the cell via `applyEdit` | FD12; FT18 | KEPT |
| F26 | Nothing written until «حفظ»; pair at the strip end | Bar (FD18, FT20) | MOVED · T-2 |
| F27 | «لديك تغييرات غير محفوظة»; disabled states; spinner | Bar: «تغييرات غير محفوظة», shown only while dirty; spinner; «إلغاء» off while saving | RESTYLED · T-2 |
| F28 | Unsaved rows amber | FD16 opaque amber; FT9 amber card + dot | RESTYLED |
| F29 | Payload = changed rows only | Unchanged (`changedRows`) | KEPT |
| F30 | Draft survives a reload | Unchanged (`useDraftBoard`, `ecms.fleet.fixedRoster.draft`) | KEPT |
| F31 | «إلغاء» clears memory and storage | Bar «إلغاء» (confirm when >1 car) | KEPT + NEW confirm |
| F32 | Save success: cache replaced, toast | Unchanged, toast «تم حفظ الطقم الثابت» | KEPT |
| F33 | Save refused: draft kept, not re-read, toast | Unchanged | KEPT · T-16 |
| F34 | Server write: transaction, versions, audit | Unchanged (server) | KEPT |
| F35 | One strip, one line | FD6 one line (save pair moved to the bar) | RESTYLED |
| F36 | «كود السيارة» picker, URL `q` | FD7; FT4 typed search + FT17 grid | RESTYLED |
| F37 | «كل المهمات» multi-select, URL `mission` | Desk: the mission chips (as the daily); touch: FT17 «نوع المهمة» | MOVED · T-3 |
| F38 | 16 chips = counters and filters | FD8 / FT7 | RESTYLED |
| F39 | Counters count the whole draft | Unchanged | KEPT |
| F40 | Filters AND; unknown `view` = whole board | Unchanged (`visibleFixedRows`, `readFixedView`) | KEPT |
| F41 | Red reset only when filtered | FD6 / FT6 | RESTYLED |
| F42 | Remembered `mission, q, sort, view` | Unchanged (touch's typed code is not remembered, as the daily) | KEPT |
| F43 | Fleet code order; sortable code/state | FD9 desk; touch cards in the fleet order | KEPT |
| F44 | Filters are display only | Unchanged | KEPT |
| F45 | Excel: rows on screen, 8 columns | FD3 pill / FT3 icon; same file | MOVED · T-15 |
| F46 | Title + breadcrumbs | The old header at every width (Q2 ج): the real `PageHeader`, «الحركة» → /fleet › «الطقم الثابت» + the title; the touch boards' own h1 goes (one title per width); no Excel in the header | KEPT (Q2 ج) |
| F47 | Table loading / error+retry / empty | FD9; FT21 | KEPT |
| F48 | Full-height page, inner scrolls | FD frame | KEPT |
| F49 | Narrow screens: none of its own | FT layouts | RESTYLED (replaced) · T-4 |
| F50 | Touch: no drag; hover needs a mouse | FT10/FT15/FT16/FT11 make every edit reachable by tap; hover cards still mouse-only | RESTYLED |
| F51 | No live refresh | Unchanged | KEPT |
| F52 | No gaps/absence/licence warnings today | Gaps drawn with existing elements (S12, S13); absence not shown (S14, T-13); standing problems not shown either (S15, Q1 ب) | KEPT |
| F53 | What the standing crew feeds | Unchanged (design only) | KEPT |

Notes N1–N11 (FF §11): N1, N5, N10 are code comments only (build hand-off, nothing on screen); N2 fixed by the new pool
word (T-9; the shared `DriverSlotPicker` empty line still says «في هذا التاريخ» — build hand-off, §10); N3 Latin digits
(T-12); N4 rose row + sky badge + rose chip = exactly the daily's trio (T-10); N6 kept (same as the daily); N7 told
(T-14); N8 told (T-16); N9 the three unused words stay unused (nothing new drawn from them); N11 undo adopted (T-2).

## 6. Lists

**KEPT** — no date anywhere (F1) · one undivided pool (F2) · ordered seats + seat-2 rule (F3) · workshop never locks
(F4) · exclusivity (F5) · car card (F7) · state words and tones (F8) · driver card (F11) · gates (F14) · branch scope
and company-wide pool (F16, F17) · «سيارة أخرى» (F18) · drop rules (F20) · picker (F21) · seat bin + promotion (F22) ·
crew bin semantics, no confirm (F23) · the pen dialog (F24) · `applyEdit` (F25) · payload, draft memory, cancel, save
success/refusal, server write (F29–F34) · counters arithmetic and AND (F39, F40) · remembered filters (F42) · order (F43)
· display-only filters (F44) · the Excel file (F45) · table states (F47) · full-height page (F48) · no live refresh
(F51) · what the crew feeds (F53) · toast «تم حفظ الطقم الثابت».

**RESTYLED** — code cell plain, colour chip gone (F6) · state badges stacked (F8) · mission box 9.5rem (F9) · the daily
seat with the employee code under the name (F10) · notes wrap (F12) · the action box with the daily colours (F13) ·
viewer without the actions column (F15) · the daily drivers panel with one list (F19) · counters 36px one line / 48px two
lines, Latin digits (F38) · dark filter bar one line (F35, F36, F41) · amber tint opaque (F28) · bar words (F27) ·
layouts for every width (F49, F50).

**MOVED** — «حفظ»/«إلغاء» + unsaved line → the bar (F26, F27) · Excel → toolbar pill / touch icon (F45) · title →
the old page header at every width, the touch h1 gone (F46, Q2 ج) · «كل المهمات» → mission chips on desk, filters sheet on touch (F37) · «كود
السيارة» on touch → typed search + filters sheet (F36) · the dialog's four facts on touch → pill, seats, note sheet (F24).

**DROPPED (with reason)** — none of the standing screen's functions. Two looks change and are told rather than dropped
silently [C6]: the car's own colour on the code is a look of F6 whose daily equivalent is the plain code cell (RESTYLED,
T-11, kept on request — a reader still finds a car by the code filter, the typed search and the bar's codes); the
title + breadcrumbs stay as today's page header (Q2 ج), so nothing is lost there.

**NOT ADOPTED from the daily (day-only or meaningless for a standing crew)** — day stepper, «اليوم», past banner and
read-only past (D4, D5, T2) · counters «تشغيل», «جاهزة», «بلا سائق», «غياب الطاقم الثابت» and the day badges (D8, D11) ·
«غير المتاحين» tab, reason chips, out-today seat badges (D17, T15) · licence block «منهم رخصة منتهية» + two links (D17) ·
the workshop lock on seat, pen, swap, mission, card and the folded workshop group (D13, D15, T9, T13) · the clear-row
confirm with its day words (D20) · the «متاح» badge on free drivers (D17, T15) · the projected-operation «حفظ» on an
untouched day, `liveFlags` (D18, RB:192).

**NEW (daily elements with a real standing-crew meaning)** — toolbar count (FD2) · move strip «سيُنقل من السيارة … عند
الحفظ» (FD13) · employee code under every name (FD13, FD17) · swap button (FD15, FT11) · workshop rose row as context
(FD16) · edited codes in the bar, «تراجع», confirm before throwing away more than one car (FD18) · car-code search
(FT4) · the touch picker with «معيّنون على سيارات أخرى» (FT15) · drivers sheet driver-first and the landscape target
(FT16, FT19) · filters sheet (FT17) · the three bar shapes (FT20). (The first sample's Q1 (أ) flags and Q2 (أ) box are
gone — the owner chose ب and ج.) One new WORD: «لا يوجد سائقون بلا طقم ثابت» (empty pool, replaces a day sentence) [C2].

## 7. Words on the sample (formal Arabic) — key → word → status

Fixed keys reused (I:22782-22818, 19001): `fleet.nav.fixedRoster` «الطقم الثابت» · `.driversTitle` «السائقون» ·
`.driverSearchPlaceholder` «ابحث بالاسم أو الكود أو الرقم» · `.driverSearchEmpty` «لا يوجد سائق مطابق للبحث» ·
`.needsFirstDriver` «عيّن السائق الأول أولاً» · `.removeDriver` «إزالة من هذه الخانة» · `.clearCrew` «إفراغ الطقم» ·
`.editHint` «نوع المهمة والطقم والملاحظات — تُحفظ معًا» · `.noMissionType` «بدون نوع مهمة» · `.noMissionTypesYet` ·
`.missionTypesFailed` · `.noDriver` «بدون سائق» · `.sameDriverTwice` · `.unassigned` «بلا طقم» · `.saved` «تم حفظ الطقم
الثابت» · `.noVehicles` «لا توجد سيارات» · `.counter.crewed` «بطقم» · `.counter.uncrewed` «بلا طقم».
Fixed key no longer drawn: `.unsaved` «لديك تغييرات غير محفوظة» (the bar says the daily's «تغييرات غير محفوظة», T-2).

Daily keys reused (DD §6): «كود السيارة», «مسح عوامل التصفية», «إجمالي», «صيانة», «الحالة», «نوع المهمة», «السائق
الأول», «السائق الثاني», «ملاحظات», «إجراءات», «في الورشة», «معيّنة», «اختيار سائق», «تبديل السائق الأول والثاني»,
«سيُنقل من السيارة {{code}} عند الحفظ», «{{count}} سيارة», «عدد الصفوف بعد الفلاتر», «تصدير Excel», «تحميل ملف إكسيل
(كل ما أظهره الفلتر)», «تغييرات غير محفوظة», «السيارات المعدَّلة:», «تراجع», «إلغاء», «حفظ», «إلغاء التغييرات», «إلغاء
كل التغييرات غير المحفوظة؟ تعود هذه السيارات كما حُفظت آخر مرة:», «ابحث بكود السيارة…», «عوامل التصفية», «كل
المهمات», «عرض النتائج ({{count}})», «سيارة أخرى», «معيّنون على سيارات أخرى», «يُعيَّن الآن: السيارة {{code}} · {{slot}}»,
«يُعيَّن الآن: {{name}} — اختر له خانة في إحدى السيارات.», «اختر سائقًا، ثم اختر له خانة في إحدى السيارات.», «اختر خانة
في إحدى السيارات ثم السائق، أو اختر السائق أولًا ثم الخانة.», «لا توجد نتائج», «لا توجد سيارة بهذا الكود», `common.edit`
«تعديل» (pen, ⋮, sheet titles «تعديل · 150»). NOT drawn (Q1 ب — the daily's only): `fleet.roster.reason.profileInactive` «الملف موقوف»,
`.notADriver` «ليس على وظيفة سائق», `fleet.roster.licenceExpired` «رخصة منتهية». Header (Q2 ج): `fleet.module.title`
«الحركة», `fleet.nav.fixedRoster` «الطقم الثابت».

Daily keys NOT drawn here (day words): «تعيين السيارة {{code}}», «تعديل التعيين», «إلغاء التعيين», «تم حفظ خطة اليوم»,
«لا يوجد سائقون متاحون في هذا التاريخ», «الجميع متاحون في هذا التاريخ», «متاح», «السائقون المتاحون», «غير المتاحين»,
every counter and badge of §2's not-adopted lines, the stepper and past-banner words.

NEW: `fleet.fixedRoster.poolEmpty` «لا يوجد سائقون بلا طقم ثابت» (formal, in the shape of «لا يوجد سائق مطابق للبحث»;
passes scripts/check-formal-arabic.mjs morphology — no بـي/هـي/هـت/اتـ prefix, no ما…ش) [C2]. `fleet.fixedRoster.subtitle` stays
undrawn (the Q2 (أ) box that used it as a hover title is gone; the page header has no subtitle by design). Only Latin letters on the page: the shell's «EN», the
pill's «Excel» (T-15) and «ATM» inside the owner's real mission name «ضم ATM» (catalog data, MISSION_TYPES) [C3].

## 8. Colours (dark first; light kept and checked internally)

Brand: pressed, «حفظ», drop ring, target ring, «+ اختيار سائق». Counters: «إجمالي» brand · «صيانة» rose · «بطقم» emerald ·
«بلا طقم» yellow (`COUNTER_TONES.unmanned`, the daily's gap hue; review L4) · missions the 8 hashed hues. Unsaved amber (rows `#261919`,
cards `UNSAVED_ROW` + amber-300 border, bar, codes, dot). Workshop rose row `#291021`; badge sky (info). Seat/pool discs
green-700/600.  (No problem frame: Q1 ب.) Actions: pen `#58a8e8`, swap indigo-400, bin `#e86870`. Drivers button
emerald-700/600. Reset red-50/red-950. Surfaces: board `#111827`, inputs `#080C14`, head `#0c121e`, page slate-950. The
panel's green tint and the green driver CHIP blocks of today go (the daily's neutral panel + green discs).

## 9. The sample's figure set (realistic; clock Tuesday 2026-11-17 10:00 Cairo)

Built from `apps/web/src/zz-fixed-data.ts` (same ids, names, makes, real 12 mission types), reduced to 3 branches and
20 active cars; people of the dropped branches re-homed (branch shows only on hover). Car 150 = «مرسيدس اسيليو 915»,
«المهندسين» (DECISIONS §11 B1); its standing crew = the people the daily reference shows on 150 today.

| code | make | branch | workshop | «نوع المهمة» | «السائق الأول» | «السائق الثاني» | «ملاحظات» |
|---|---|---|---|---|---|---|---|
| 150 | مرسيدس اسيليو 915 | المهندسين | — | نقل أموال (يومي) | سامر عادل منصور 3104 | محمود سعيد عبد الحميد 10234 | خط بنوك الدقي والمهندسين — التحرك الساعة 7:30 صباحًا |
| 152 | مرسيدس اسبرانتر 515 | المهندسين | — | نقل أموال (يومي) | محمد جمال الدين حسن 11063 | كريم نبيل عبد الحميد 3152 | — |
| 158 | مرسيدس اسبرانتر 515 | المهندسين | — | — (no crew row) | — | — | — |
| 163 | مرسيدس اسبرانتر 515 | المهندسين | في الورشة | نقل أموال (يومي) | خالد إبراهيم النجار 11190 | رامي سمير عوض 11236 | تعود إلى خط الدقي بعد خروجها من الورشة |
| 171 | مرسيدس اسبرانتر 516 | المهندسين | — | مسائي | أحمد فتحي السيد 10411 | — | — |
| 176 | تويوتا هاى اس | المهندسين | في الورشة | — | — | — | — |
| 214 | مرسيدس اسبرانتر 515 | المهندسين | — | نقل أموال (يومي) | هشام فتحي الدسوقي 3127 | طارق محمود فهمي 10947 | السائق الثاني بديل في أيام الجمعة، ويُراجع الطقم مع مشرف الفرع أول كل شهر |
| 205 | مرسيدس اسبرانتر 515 | مدينة نصر | — | محصنة | سعيد عبد الرحمن 10612 | أيمن صبري عبد الفتاح 11125 | — |
| 231 | مرسيدس اسيليو 915 | مدينة نصر | — | إيباج | وليد سعيد الشربيني 3166 | هاني جرجس ميخائيل 11702 [C19] | — |
| 247 | مرسيدس اسبرانتر 515 | مدينة نصر | — | نقل أموال (يومي) | مجدي فوزي عبد الرحيم 11352 | صبري أنور الفقي 12259 (switched-off profile: refused on save, drawn plain — Q1 ب) | — |
| 262 | تويوتا هاى اس | مدينة نصر | — | سفر | شريف عادل البنا 11284 | سيد محمود عثمان 11893 | — |
| 305 | مرسيدس اسيليو 915 | مدينة نصر | — | ضم ATM | مصطفى رمضان علي 10733 | ناصر حمدي العطار 12077 | تغذية ماكينات الصراف الآلي بمدينة نصر |
| 318 | مرسيدس اسبرانتر 516 | الإسكندرية | — | نقل أموال (يومي) | إسلام محمد الشربيني 10851 | عمرو حسن عبد الله 10902 | — |
| 340 | تويوتا لاند كروزر | الإسكندرية | في الورشة | سفر | ياسر عبد العزيز سالم 11018 | — | — |
| 376 | سوزوكى | الإسكندرية | — | إحتياطي سفر | — | — | — |
| 410 | مرسيدس اسبرانتر 515 | الإسكندرية | — | نقل أموال (يومي) | عماد صلاح الدين عيسى 11820 | وائل رشاد عبد الغني 11968 (expired licence: flagged on the daily only — Q1 ب) | — |
| 433 | تويوتا هاى اس | الإسكندرية | — | — | زكريا يحيى الصاوي 12186 | مدحت حلمي سليمان 11934 [C19] | — |
| 118 «الملاكى» | تويوتا لاند كروزر | المهندسين | — | مأمورية | عبد الله فتحي زايد 11637 | — | سيارة مأموريات الإدارة الإقليمية |
| 120 «الملاكى» | بيجو | مدينة نصر | — | — | عادل محمد قنديل 11409 | — | — |
| 133 «الملاكى» | سوزوكى | المهندسين | — | إحتياطى | — | — | — |
| 199 (خارج الخدمة, not on the board) | مرسيدس اسبرانتر 515 | المهندسين | — | نقل أموال (يومي) | إيهاب سمير الحسيني 12005 | — | — |

Counters (company): إجمالي 20 · صيانة 3 · بطقم 16 · بلا طقم 4 (158, 176, 376, 133) · نقل أموال (يومي) 7 · سفر 2 ·
إحتياطي سفر 1 · مسائي 1 · محصنة 1 · شلاتين 0 · إيباج 1 · بدون سائق 0 · ضم ATM 1 · إحتياطى 1 · أسوان 0 · مأمورية 1 (16
with a mission, 4 without: 158, 176, 433, 120). Branch «المهندسين»: 9 cars · صيانة 2 · بطقم 6 · بلا طقم 3.

Pool (company): «السائقون (11)» [C19] — حسام الدين علي منصور 11317, أشرف كمال يوسف 11466, نادر رأفت حنفي 11503, جمال
عبد الناصر حسين 11745, أسامة فاروق الجندي 11781, فتحي عبد المنعم شاهين 11856, إيهاب سمير الحسيني 12005 («سيارة أخرى» — car 199 out of service), رجب عبد الحكيم مرسي 12041, حمدي عبد الستار رزق
12113 (expired licence: a plain pool row here — Q1 ب), ممدوح شوقي البدري 12150, بدر الدين عاطف سالم 12221. Branch «المهندسين»: 28 = 10 free + 18
«سيارة أخرى» (17 on the other branches' cars + إيهاب) [C19]. «صبري أنور الفقي» (switched off) is never in the pool (SV:128-145).
Today's daily board for the hover cards (`ROSTER_TODAY`) = the standing crews, workshop cars without drivers, 247
without «صبري أنور الفقي» (a switched-off profile is unavailable on the day), 410 keeping «وائل رشاد عبد الغني» (the
licence rule only flags) [C8].

Edit scenario (`fixed-edit-dark`, 1920, company): (1) «+ اختيار سائق» on 158 seat 1 → «بدر الدين عاطف سالم»; (2) drag
«طارق محمود فهمي» from 214 seat 2 onto 171 seat 2 → strip «سيُنقل من السيارة 214 عند الحفظ», 214 seat 2 empty; (3) ⇄ on
205; (4) 433 mission «بدون نوع مهمة» → «مسائي». Result: amber 158 · 171 · 205 · 214 · 433; bar «تغييرات غير محفوظة» 5 ·
«السيارات المعدَّلة:» 158 · 171 · 205 · 214 · 433 · «تراجع» live; counters بطقم 17 · بلا طقم 3 · مسائي 2; pool 10 [C19].

Shots (dark, deviceScaleFactor 2) → `fixed-crew-samples/`. To the owner: `fixed-dark` (1920, company, planner; grown
from 1080 to ≈1205px tall so the drivers list shows to its end — «معيّنون على سيارات أخرى (1)» + «إيهاب … سيارة أخرى»,
told 9 — ending on the whole row 262), `fixed-branch-dark` («المهندسين»), `fixed-edit-dark` (the scenario; ≈1239px tall
so 214 — amber, seat 2 «اختيار سائق», where the moved driver comes from — and the list's end are in view), `fixed-tablet-dark` (768×1024 portrait),
`fixed-phone-dark` (375, the board from the header down, ending on the last whole card under 8000px — 12 cards, 150 → 305), `fixed-phone-sheet-dark` (375, picker on 171 seat 2 showing the free list and
«معيّنون على سيارات أخرى (27)» [C19; 26 board-seated + «إيهاب» held on 199, review L5]). Internal (extra/): 1180 landscape target, 1366, 1536, 1280 (pinned actions), 768
portrait + pool sheet, phone filters sheet, viewer, loading, error, empty pool, filtered («بلا طقم»), the car card on 150,
and every shot in light.

Checks for the shooter (as `ref/checks.txt` and `now/facts.json`): 20 rows / cards; counters as above before and after
the scenario; no Arabic-Indic digit; no Latin letters except «EN», «Excel» and the «ATM» of «ضم ATM» [C3]; no day word
outside the hover cards («اليوم», «التاريخ», «في هذا التاريخ», «خطة اليوم»); no two-letter initials drawn on the board
(every person mark is the person icon disc, DC:153, CC `Avatar`, DR `DriverFace`; if a helper ever draws initials it is
`lib/name-initials.ts`, DECISIONS #711) [C11]; no sideways page scroll at 1180/768/375; workshop rows editable (mission
select enabled, «+ اختيار سائق» on 176, pen + swap on 163); every `/api/v1/**` answered; car 150's card reads «مرسيدس اسيليو
915» and «المهندسين»; `git status --porcelain` empty in /home/user/egycash-fx.

## 10. Harness plan (git-excluded zz files only; Vite 127.0.0.1:5316 strictPort; the shared `zz-vite-fixed.config.mjs`)

Files: `apps/web/zz-fixed-sample.html`, `apps/web/src/zz-fixed-sample.tsx` (shell + board pick by `useRosterLayout`),
`zz-fixed-sample-desk.tsx`, `zz-fixed-sample-touch.tsx`, `zz-fixed-sample-model.ts` (the fixed model: draft via the
REAL `useDraftBoard(FIXED_ROSTER_DRAFT_KEY, …)`, the REAL `assignDriver/clearSlot/clearCrew/applyEdit/availableDrivers/
changedRows/findSeat`, `visibleFixedRows/readFixedView`, undo, counters as P:597-656, `transferFrom` as RB:750-759,
`filtersHiding` for the three fixed views), `zz-fixed-sample-data.ts` (the §9 set, typed by @ecms/contracts, plus a
zz-only `DAILY_LICENCE_EXPIRED` set feeding the DAILY board's answer only — Q1 ب: the standing screen draws no flag).

Import as is: `useRosterLayout` · `num`, `Count`, `CodeList`, `unbrokenName`, `EditsBar` (PA) · `ExcelPill`, `DeskCounters`
(DP) · `DriverSearch` (DR) · `BottomSheet` · `CarSearch`, `FilterButton`, `ResetChip`, `DriversButton`, `CounterChips`,
`ExcelButton`, `ConfirmSheet`, `FiltersSheet` (TP) · `SeatCell` with an adapter: `{...row, inMaintenance:false}` (so no
workshop lock; the badge and the rose tint read the real row), `facts.expired`/`facts.unavailable` EMPTY (Q1 ب —
no amber frame, no flag badge), `reasonLabel` never reached · `VehicleHoverCode`, `DriverSlotPicker`, `useDriverHoverCard`,
`CatalogSelect`, `VehicleCodeFilter`, `FilterWithIcon`, `DARK_TABLE`, `DARK_FILTER_BAR`, `BOARD_FRAME`,
`BOARD_TABLE_FILL`, `actionTone`/`ACTION_GROUP`, `Badge`, `InWorkshopBadge`, `DataTable`, `FilterBar`, `Dialog`,
the REAL `PageHeader` (Q2 ج, no `actions`), `SwapIcon`, row-action icons, `saveSheet`, the sort helpers.
Copy into zz (module-private or hard-wired to the day): the desk look constants (`ROW_TINTS`, `LAPTOP_*`, `TIGHT_CELL`,
`PINNED_*`, `ROSTER_TABLE`, `MISSION_BOX`, `useOverflowing`) · a fixed `StatusCell` (stacked «في الورشة» + «معيّنة»/«بلا
طقم») · the drivers panel shell (one heading, no tabs, no licence footer) and the list row face without «متاح» · the
car card (CC) without the workshop lock and with the fixed ⋮ words and badges · the mission and note sheets with the
title «تعديل · {code}», the catalog lines and the 500 cap [C4] · the touch picker list with the fixed badges and «معيّنون
على سيارات أخرى» · `EditCrewDialog` (P:110-322, not exported) with its rules verbatim and its two seats redrawn as the daily DriverSlot
(review L6) [C10] ·
the undo helpers (RB:110-169) retyped for `FleetFixedCrewRowDto`, `editStep` on the fixed `changedRows`.
The swap button = `assignDriver(rows, vehicleId, 'driver1EmployeeId', row.driver2EmployeeId)` — the fixed rule's
swap-within-a-car (B:52-117), no new rule [C10].
Not used: `RosterDeskBoard`, `RosterTouchBoard`, `useRosterBoard`, `DriversPanel`, `DriverTabs`, `UnavailableList`,
`RosterAssignDialog`, the steppers, `PastDayBanner`, `WorkshopGroup`.

Build hand-offs (not for the sample): an `emptyLabel` on `DriverSlotPicker` (its empty line is the day sentence,
DriverSlotPicker.tsx:116); a friendly Arabic line for the 409 DUPLICATE refusal naming the driver and the holding car
(review C1, T-16); a `label` prop on the touch `DriversButton` (its title / aria-label is the day word «السائقون المتاحون»;
here «السائقون», review N3); `EmployeeName` puts `ms-2` on its `dir="ltr"` code, so in Arabic the name and code touch —
the merged daily dialog too (the sample puts the gap back locally); an Arabic plural-aware car count («سيارة واحدة /
سيارتان / 3–10 سيارات / 11+ سيارة») and «عدد الصفوف بعد عوامل التصفية» for every board on `fleet.vehicles.count` /
`fleet.filters.matchedRows` (review N4); the daily's notes wrap without a cap (same 500-letter risk, review C3); NO server facts
for standing-member flags (Q1 ب — the owner declined them: the screen stays as today, the flags live on the daily
only); the stale comments N1, N5, N10.

**Build rules from the owner's answers (2026-11-17, «1 ب / 2 ج») — binding for the build:**
- Q1 (ب): FixedRosterPage shows NO flag for a standing member who can no longer drive — no amber seat frame, no
  «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» on a seat, a pool row, the touch picker, the drivers sheet or the
  pen dialog's driver list; no new contract field or server fact for it. A save the server refuses keeps the draft and
  shows today's refusal toast (T-16; the friendly Arabic 409 line above stays a separate hand-off).
- Q2 (ج): keep FixedRosterPage's `PageContainer fullHeight` + `PageHeader` (title `fleet.nav.fixedRoster`, breadcrumbs
  `fleet.module.title` → /fleet › `fleet.nav.fixedRoster`) on top at EVERY width, and REMOVE its `actions`
  (`ExportSheetButton`): Excel is the daily's `ExcelPill` in the toolbar row beside «20 سيارة» (desk) and the daily's
  `ExcelButton` at the end of the touch board's first row — one Excel control per width. No «الطقم الثابت» box in the
  stepper's place; the touch board draws no h1 of its own (one title per width).

## 11. Told list (للمالك — بالعامية، من غير ولا كلمة إنجليزي)

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

## 12. Decisions (the owner's answers «1 ب / 2 ج», 2026-11-17 — was «Questions»)

Q1 (ب) — no flag on this screen for a standing member who can no longer drive (the daily's only); Q2 (ج) — the old
page header returns on top at every width, no Excel in it, no StandingBox, one title per width. Told to the owner (للمالك
— بالعامية، من غير ولا كلمة إنجليزي), as in owner.md:

**س1 (ب) — السواق اللي في الطقم الثابت ومينفعش يسوق:**
- الشاشة دي مش هتعلّم عليه خالص، زي النهارده: لا إطار أصفر، ولا «الملف موقوف»، ولا «ليس على وظيفة سائق»، ولا «رخصة منتهية».
- شلت ده من كل حتة: خانات العربيات، وقايمة السواقين، وقايمة الاختيار على الموبايل، وشباك «تعديل».
- الحاجات دي بتبان في «تعيين السيارات» بس.
- لو حفظت تعديل على عربية فيها سواق ملفه موقوف، الحفظ هيترفض زي النهارده، والتعديل بيفضل مستني (البند 16).

**س2 (ج) — اسم الشاشة:**
- العنوان القديم رجع فوق زي الشاشة النهارده بالظبط: «الحركة › الطقم الثابت»، وتحته «الطقم الثابت» بخط كبير. ولو دوست على «الحركة» يوديك للوحة الحركة.
- ده على الكمبيوتر والتابلت والموبايل.
- الاسم اللي كان مكان التاريخ جنب زرار التحميل اتشال.
- على التابلت والموبايل العنوان الصغير اللي كان فوق الكروت اتشال، عشان الاسم ميتكررش مرتين.
- العنوان واخد حتة من فوق: على اللابتوب العادي الجدول بيبين 5 عربيات من غير ما تنزل (حوالي عربيتين أقل من غير العنوان)، وعلى الشاشة الكبيرة 9.
- وعلى التابلت وهو بالعرض العنوان بيفضل ثابت فوق، مش بيطلع لفوق مع الكروت: بتبان عربيتين من غير ما تنزل بدل 3 في التعيين اليومي، وقايمة السواقين بتبين 4 أو 5 سواقين بدل 6 أو 7.
- على التابلت وهو واقف وعلى الموبايل العنوان بيطلع لفوق أول ما تنزل، فمش بياخد مكان من الكروت.

---

## 13. Critic pass — «Critic corrections» (all applied above; each marked [Cn] where it lands)

Method: re-read FF (F1–F53, N1–N11, Q-1..Q-4) and DD (D1–D20, T1–T21, §5–§9) line by line against this map, and
re-checked in the sample tree: FixedRosterPage.tsx (whole), fixed-roster-board.ts (whole), roster-view.ts:240-376,
fixed-roster.service.ts (whole), fleet-queries.ts:725-760, contracts fleet.ts:1895-1950, RosterPage.tsx (whole),
RosterDeskBoard.tsx (whole), roster-desk-cells.tsx (whole), roster-desk-parts.tsx:50-101 + :403-543,
roster-parts.tsx:108-267, roster-drivers.tsx:1-500, RosterTouchBoard.tsx:1-470, RosterCarCard.tsx:1-215 + :453-560,
roster-touch-parts.tsx (words, sheets), DriverSlotPicker.tsx:95-148, DriverHoverCard.tsx / driver-card.ts heads, the
i18n words at I:22782-22818 and I:22983-23045, and the reference shots daily-1920-dark, -edited, -filtered, daily-375,
daily-768, daily-768-picker, now-1920.

| # | Finding | Evidence | Applied in |
|---|---|---|---|
| C1 | The daily's desk reset is an ICON-only red square at the bar's end (title/aria «مسح عوامل التصفية»), not the labelled button the fixed page draws today. | daily-1920-dark-filtered.png; DB:468-488 uses `FilterBar` (FilterBar:98-131) | FD6 |
| C2 | «جميع السائقين ضمن أطقم ثابتة» is false when the server sends no driver at all; «لا يوجد سائقون بلا طقم ثابت» is true in every empty case and mirrors «لا يوجد سائق مطابق للبحث». | B:119-143 (pool = server drivers − seated); SV:128-145 | FD17, S5, §6, §7, T-9 |
| C3 | The Latin-letter check would fail on the owner's real mission name «ضم ATM» (12-type vocabulary in the figure set; car 305). The daily ref checks passed only because their mock had 4 mission types. | zz-fixed-data.ts `MISSION_TYPES`; DD §10 | §7, §9 checks |
| C4 | Two dialog rules would be lost on touch: the daily mission sheet has no «تعذّر تحميل أنواع المهمات» / «لا توجد أنواع مهمات في الكتالوج بعد», and the daily note sheet has no 500-letter cap nor «empty → no note». | P:249-275, :236-239, :311-318; TP:469-520, :634-690 (no `maxLength`, no catalog states) | FT18, §10 |
| C5 | Q1 overstated the refusal: only a switched-off profile or a person off a driving seat makes the save of that car fail; the save never checks a licence. | SV save: `seatSet` + `switchedOff` checks, no licence check; B:52-117 comment («a driver whose profile has since been deactivated») | S15, Q1 text |
| C6 | The car's own colour was listed both RESTYLED and DROPPED. The daily HAS an equivalent (the plain code cell), so it is a restyle of F6 told in T-11 with an opt-out; nothing of the screen is dropped. | DB:270-290; P:476-497, :932-938; rule «dropped only if no daily equivalent AND nothing lost» | §6 DROPPED |
| C7 | Not said: this board's filters read the DRAFT, so a car crewed under «بلا طقم» leaves the narrowed table at once (the daily DESK keeps server flags until save — DD §9.1 — while its touch board behaves like this one). Kept; the bar's code brings the car back by lifting the view; on touch it also clears a hiding typed code. | P:692-703 (`visibleFixedRows(draft, …)`); RP:153-155; TB:257-277 | S6, FD18 |
| C8 | The hover cards' «today» data must stay true to the figure set: a switched-off profile is unavailable on the day, so the daily board today shows 247 without «صبري»; 410 keeps «وائل» (licence rule = flag). | roster.service projection (FF F53a); driver-card.ts head | §9 |
| C9 | In the touch picker's «معيّنون على سيارات أخرى» the daily row carries ONE badge (its licence-flagged drivers sit in their own block); here a flagged seated driver needs the code badge AND «رخصة منتهية». | DR:257-275 (`badge` picks licence over code), RB:770-800 (`flagged` vs `seated`) | FT15 |
| C10 | The copied dialog also needs `DriverSelect`/`DriverOption` (P:110-164); the swap button needs no new rule — it is `assignDriver` onto the other seat. | P:110-322; B:52-117 (`swapWithin`) | §10 |
| C11 | DECISIONS (#711) initials rule had no check: the design uses person-icon discs only, so the shooter asserts no initials appear; any future initials go through `lib/name-initials.ts`. | DC:153, CC `Avatar`, DR `DriverFace` | §9 checks |
| C12 | The Q2 box needed a word; the never-drawn fixed sentence «الطقم الثابت لكل سيارة — بلا تاريخ، ويظل كما هو حتى تغيّره» serves as its hover title — no new word. | I:22782 (`fleet.fixedRoster.subtitle`, FF N9) | FD4, §7 |
| C13 | Rule 1 missed a second surviving day sentence: the shared «+ اختيار سائق» popover's empty line. | DriverSlotPicker.tsx:116 | §1 rule 1 (and §10 hand-off) |
| C14 | Owner wording: T-15 said «تصدير إكسيل» while the pill reads «تصدير» + the Latin word (as on the daily); T-16 read as a promise for the sample — now an offer for the build; T-1 adds the new toolbar count; Q1 «السيرفر» is a loanword → «النظام». | DP:60-101 (`fleet.fuelCards.board.excel`); DECISIONS 2026-11-14 (no English words, also in Arabic letters where avoidable) | §11, §12 |
| C15 | S3 said the counters appear «only after the answer»; both boards count an empty draft while loading, so they read 0 — kept as is. | P:597-656; RB:579-649 | S3 |
| C16 | `CarCard` and `StatusCell` cannot be reused "with an adapter" as DD §8 hoped: the card's ⋮ words («تعديل التعيين»/«إلغاء التعيين»), its workshop lock and its badge row are inside the component, and `StatusCell` draws «—» where this board says «بلا طقم». Both are COPIED; `SeatCell` alone works with the `inMaintenance:false` adapter. | CC:120-201, :453-560; DC:37-95 | §10 |
| C17 | DD §9.6 (`?unavailable=` links open the «غير المتاحين» tab) has no counterpart here — this board has no `unavailable` key and no dashboard link lands on it with one; nothing to carry. | P:100 (remembered keys `mission, q, sort, view`) | (checked; no change) |
| C18 | FF candidate questions resolved: Q-1 «كل المهمات» → told (T-3, the owner's own word on the daily, DB:1-2); Q-2 title → Q2; Q-3 licence/profile flags → Q1; Q-4 undo → adopted and told (T-2). | FF §11 | §11, §12 |
| C19 | Figure realism: 6 one-man crews + 4 empty cars was 10 of 20 cars with a gap, not «a few». 231 and 433 get second drivers from the free pool (هاني جرجس ميخائيل, مدحت حلمي سليمان): one-man crews now 171, 340 and the two «الملاكى» 118/120; pool 13 → 11 (10 after the scenario); branch pool 28 = 10 free + 18 «سيارة أخرى»; picker section 24 → 26. Counters unchanged (20 · 3 · 16 · 4). | §9 arithmetic re-done: 38 server drivers (39 − «صبري»), 27 of them seated on the board | §0, FD17, §3, FT15, §9 |

Checked and holding (no change): every F1–F53 has a home in §5 and none is DROPPED; every D1–D20 and T1–T21 is either
mapped or listed as not adopted with its reason (§6); no element is added that the daily lacks except through Q1/Q2 and
the one empty-pool word; the workshop lock appears nowhere (FD12, FD13, FD15, FT9, FT11, FT12, FT13, FT18); the fixed
words where meanings differ (بطقم، بلا طقم، إفراغ الطقم، تعديل، تم حفظ الطقم الثابت) survive; viewer rules match the daily
(no actions column, no bar, «بدون سائق»); car 150 is «مرسيدس اسيليو 915» in «المهندسين»; the owner sections contain no
Latin letter and only the one deliberate Arabic-Indic example in T-12; tree `/home/user/egycash-fx` still clean.

## 14. Review pass on the built sample (2026-11-17) — each finding verified in the sample tree, fixed or rejected

| # | Verdict | What was done | Where |
|---|---|---|---|
| L1 | CONFIRMED, fixed | Probe at 1280: notes 62px, rows 120/153px, table 8px wider than its frame. Notes now held to three lines with the whole note in `title` (today's truncate + title); below 1440 the drivers panel is 17.75rem and its rows' side padding 12px (name room unchanged), so at 1280 the table fits (0px overflow), every row ≤ 71px and no note sits under the pinned «إجراءات». The mission box stays the daily's 9rem — 8.5rem was tried and cut «نقل أموال (يومي)». Shooter: `checkNotes` (≤ 3 lines, titled, nothing under the pin, no overflow) on 1920 / branch / 1280 / 1536 / light, a 1280 row-height and mission-fits check. | desk `MISSION_BOX`, notes cell, grid, `LAPTOP_POOL`; FD14, width bands; T-21 |
| L2 | CONFIRMED, fixed | The lone raised pill is now a plain heading in the same 44px row (13px emerald + count, no track, no shadow). Shooter checks `box-shadow: none`. | parts `DriversHead` |
| L3 | CONFIRMED, fixed | The Q2 name is a label (pin + 15px bold «الطقم الثابت», no border, no fill, an `h1`), like the touch h1. Shooter checks 0px border and a transparent fill. Q2 (أ) reworded. | parts `StandingBox`; FD4; س2 |
| L4 | CONFIRMED, fixed | «بلا طقم» counter → `COUNTER_TONES.unmanned` (the daily's «بلا سائق» yellow; its applied ring is yellow too); rose is the workshop's only. Told T-19. | model counters; FD8, §8 |
| L5 | CONFIRMED, fixed | Free drivers first; drivers a car off the board holds move under the daily's grey «معيّنون على سيارات أخرى (n)» with «سيارة أخرى» in the info (blue) tone — the daily's rule for a car it cannot name. In the picker they join the same section after the board-seated ones (27 = 26 + «إيهاب»). Still draggable / pickable (today's behaviour). Told in T-9 (no question needed: it is the daily's own idiom). | parts `FixedDriverList`; FD17, FT15, S17 |
| L6 | CONFIRMED, fixed | The pen dialog's two seats are drawn as the daily `DriverSlot`: name + code row with ✕, or «اختيار سائق» opening a list with «سيارة أخرى» / «رخصة منتهية» badges; the fixed rules unchanged (free pool + own two, never the other seat's person, seat 2 disabled with its hint, ✕ on seat 1 promotes seat 2). Found while looking: the real `EmployeeName` puts `ms-2` on a `dir="ltr"` code, so name and code touch (the merged daily dialog too, probe gap 0px) — the sample puts the 8px back locally; build hand-off. Told T-20. | parts `FixedDriverSlot`, `EditCrewDialog`; FD19, §10 |
| L7 | CONFIRMED, fixed (shot) | `fitRows` shortens the viewport by the cut part of the last row: `fixed-dark` 1920×1030, `fixed-edit-dark` 1920×1060, `fixed-branch-dark` already whole (9 rows). Checked. | shoot.mjs |
| L8 | CONFIRMED, fixed (shot) | The picker list is scrolled so the first row under the search rule is whole («رجب عبد الحكيم مرسي»), with the end of the free list and «معيّنون على سيارات أخرى (27)» in sight. Checked. | shoot.mjs |
| L9 | CONFIRMED, fixed | Phone drivers sheet titled «السائقون (11)». The gap under the title is the real `BottomSheet` header's own padding (no subtitle) — left as the real component draws it. Checked. | touch pool sheet |
| L10 | CONFIRMED, fixed | New internal shots `extra/fixed-1280-dark`, `fixed-1536-dark`, `fixed-1920-empty-pool-dark`, `fixed-375-empty-pool-dark` (switch `?nopool=1`: the server's drivers are only ones a crew holds). Light: checked in the shooter at 1920 and 375 (all checks) with no picture sent (DECISIONS: dark pictures only). | entry `NO_POOL`; shoot.mjs |
| C1 | CONFIRMED, fixed | Mock codes now the server's: 409 `DUPLICATE`, 400 `VALIDATION_FAILED`. Shooter F33 now also drops «إيهاب» on 158 and saves: draft kept, toast = the server's English sentence naming vehicle 199. T-16 extended (internal number instead of the name, plus the car code); hand-off: friendly Arabic refusal. | data `refusalOf`; shoot.mjs F33; T-16 |
| C2 | CONFIRMED, fixed | `FixedDriverList` mirrors the daily rule: a term that finds nobody free but somebody below prints no empty line; «لا يوجد سائق مطابق للبحث» only when nothing matches anywhere. Shooter: «سامر» → no line over «سامر عادل منصور · 150»; «zzz» → the line. | parts |
| C3 | CONFIRMED, fixed | Same fix as L1 (three lines + title). The daily's uncapped wrap → build hand-off. | desk notes; T-21 |
| C4 | CONFIRMED, told | The daily's touch ⋮ «تعديل التعيين» also opens the note sheet only (RosterCarCard.tsx:538), so the sample keeps the daily's touch shape; nothing of F24 is lost (mission pill, seats, note sheet each edit their fact). New T-18. | T-18 |
| N1 | CONFIRMED, told | T-2 (undo restarts after a reload), T-4 (cards always in code order, no sort on touch), T-9 (code under the name in the seats too). | §11 |
| N2 | CONFIRMED, fixed | Q1 (أ) reworded: amber frame; «الملف موقوف» / «ليس على وظيفة سائق» amber, «رخصة منتهية» red. | §12 |
| N3 | CONFIRMED, hand-off + told | The real `DriversButton` keeps its day title (reused as is); hand-off: a `label` prop. T-4 now says «زرار السواقين (على الموبايل أيقونة ورقم بس)». | §10, T-4 |
| N4 | CONFIRMED, hand-off | Shared keys of the merged daily (`fleet.vehicles.count`, `fleet.filters.matchedRows`); not changed in the sample; hand-off for an Arabic plural-aware count and «عوامل التصفية». | §10 |

Nothing rejected. The shooter's last full run: 354 checks passed, 0 failed (`fixed-crew-samples/checks.txt`).

## 15. The sample updated to the owner's answers (2026-11-17) — «1 ب / 2 ج»

First version kept: `fixed-crew-samples/v1/` (the six owner pictures as sent, the harness, shoot.mjs, owner.md,
checks.txt and this map as `gap-map.v1.md`).

| Answer | What changed in the zz files | Checked by (shoot.mjs, on EVERY sample shot: `answers`) |
|---|---|---|
| Q1 ب | data: `STANDING_FLAGS` / `StandingFlag` removed; one zz-only set `DAILY_LICENCE_EXPIRED` (410 «وائل», «حمدي») kept, feeding only `rosterToday` — the DAILY board's answer (hover cards, ref/ shots); `SWITCHED_OFF` («صبري») stays — the server's own rule (out of the pool, save of 247 refused). model: `expired` / `unavailable` / `reasonLabel` / `licenceExpired` gone; `driverFlags` → `{ held }`. desk: the daily `SeatCell` gets EMPTY flag sets (no amber frame, no badge). touch seat row: badges + amber frame removed. parts: pool row and pen-dialog option lose «رخصة منتهية». | none of «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» in the page text (sheets, dialogs, toasts included); no `[data-problem]`, `[data-driver-out]`, `[data-driver-licence]`; no seat with a `border-amber-400/500/600` frame; 247 / 410 seats and «حمدي» = name + code only (desk and phone); F33 refusal still keeps the draft (247 «profile is inactive», 158 «إيهاب» 409). |
| Q2 ج | desk: the REAL `PageHeader` (title + breadcrumbs, no `actions`) above `BOARD_FRAME`; `StandingBox` + `PinIcon` gone; toolbar = «20 سيارة» + Excel pill. touch: the same real `PageHeader` on top of the three layouts (scrolls away); the board's own h1 gone; the Excel button at the end of the first row beside the car search. | one `nav[aria-label=breadcrumb]` with «الحركة» → /fleet › «الطقم الثابت»; ONE on-screen «الطقم الثابت» title (the header's h1; the shell's side-menu link is not a title); no button/Excel inside the header and the header above the board's first row; exactly one `[data-export]` and one Excel-worded control; no `[data-standing-box]`; toolbar row = 2 children; phone Excel beside the search. |

Laptop fit (header ≈109px): whole rows under it — 1280×800: 5 · 1366×768: 5 · 1536×864: 6 · 1920×1080: 9 (the daily:
7 · 7 · 8 · 11); the page never scrolls, the table never sideways, notes ≤ 3 lines with nothing under the pinned
«إجراءات», no cut text — shooter `rowsFit` (≥ 5 / 5 / 6 / 9) + the existing checks. The desk owner shots also end the
drivers list on a whole row (`fitPanel`; the branch shot lost a sliver of «معيّنون على سيارات أخرى (18)»).

Phone picture: 750×7570 px (≤ 8000, so it reaches the owner at full size), the board from the header down to car 305
(12 cards), ending on a whole card. ref/ untouched (the daily as sent; `ref` is no longer part of `node shoot.mjs all`).

Figures re-checked after removing the flags — none moved: company إجمالي 20 · صيانة 3 · بطقم 16 · بلا طقم 4; «المهندسين»
9 · 2 · 6 · 3; pool 11 (branch 28 = 10 free + 18 «سيارة أخرى»); scenario بطقم 17 · بلا طقم 3 · مسائي 2 · pool 10; picker
10 free + 27. The flags were display only: no counter ever read them («بطقم» = a driver in either seat, V:59-82).

Shooter: 553 checks, 0 failed (`fixed-crew-samples/checks.txt`; the first version had 354, 5 of them on ref/). tsc on
the zz files clean, prettier clean, Vite on 5316 stopped, `git status --porcelain` 0 lines; harness copied to
`fixed-crew-samples/harness/`.


## 16. Review round 2 on the updated sample (2026-11-17) — each finding verified, then fixed or handed on

| # | Verdict | What was done | Where |
|---|---|---|---|
| V-R2-1 | CONFIRMED, fixed (shots) | With the header (≈109px) the 1920×1080 owner pictures lost 214 from `fixed-edit-dark` (the car the moved «طارق محمود فهمي» comes from) and the pool's «معيّنون على سيارات أخرى (1)» + «إيهاب سمير الحسيني» «سيارة أخرى» (told 9) from every desk picture. Shooter `growToShow` now grows the viewport (never shrinks) until the named rows and the list's end are whole, then on to the next whole table row: `fixed-dark` 1920×1205 (150 → 262, the whole pool), `fixed-edit-dark` 1920×1239 (150 → 247 with 214 amber, seat 2 «اختيار سائق», and the whole pool). The laptop rule is still read at 1920×1080 first (`rowsFit` ≥ 9). `fixed-branch-dark` unchanged (all 9 rows already in view). owner.md says the two pictures are taller than a usual screen, which shows 9 cars. | shoot.mjs `growToShow`, SHOTS fixed-dark / fixed-edit-dark; §9 shots line; owner.md «الصور» |
| V-R2-2 | CONFIRMED, told (no sample change) | Measured on the same figures: touch landscape keeps the header on screen (fixed-height split view). 1024×768 — sample 2 whole cars, 4 driver rows (cars column 439px) vs the daily 3 / 6 (548px); 1180×820 — 2 / 5 (491px) vs 3 / 7 (600px). owner.md س2 and §12 now say so in Egyptian Arabic (no Latin letters); the §3 landscape line and FD1 carry the numbers. Shooter `extra-landscape` reads both boards and checks the told numbers and that the header stays on screen with no page scroll. | owner.md; §3, FD1, §12; shoot.mjs extra-landscape |
| V-R2-3 | CONFIRMED, fixed | 768 portrait had 36px from the header line to the car search (PageHeader mb-6 + the sticky block's pt-3); every other width and today's page at 768 have 24px. The portrait sticky block takes `-mt-3`; it keeps its pt-3 once stuck at top-0 (probed: stuck at main's top, search 12px under it). Shooter `answers` now checks the 24px gap on every unscrolled sample shot (24 shots). | zz-fixed-sample-touch.tsx portrait `data-touch-header`; §3 portrait line; shoot.mjs `answers` |
| C-N1 | CONFIRMED, handed to the orchestrator | FixedRosterPage has no header subtitle and PageHeader has no subtitle prop by owner decision (`page-header-has-no-subtitle.spec.ts`); the last DECISIONS.md entry's «title, subtitle» is wrong. DECISIONS.md is the orchestrator's log and was not edited here. This map's decision banner now says «NO subtitle» explicitly; FD1 and §10 already drop the header `ExportSheetButton` (Excel stays the toolbar pill / touch button). | gap-map banner; DECISIONS.md (orchestrator) |

Shooter after this round: 591 checks, 0 failed (`fixed-crew-samples/checks.txt`). tsc on the zz files clean, prettier
clean, Vite on 5316 stopped, `git status --porcelain` 0 lines; harness copied to `fixed-crew-samples/harness/`. Figures
unchanged (company 20 · 3 · 16 · 4; «المهندسين» 9 · 2 · 6 · 3; pool 11 / branch 28; scenario 17 / 3 / مسائي 2, pool 10;
picker 10 + 27).
