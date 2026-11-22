## What & why

The owner's answers of 22 November to the six items left open after #759 («أرقام الفترة» شيله ·
اجمالى العهدة · لا سيبها زى ما هى · صلحها · امسحها · صلحهم), built exactly as answered and
nothing else:

1. **«لوحة تحكم الحركة»: the tab «أرقام الفترة» (key `period`) is removed.** Eleven tabs remain,
   ending «التراخيص والتجديدات» · «ملخصات»; «ملخصات» was not named and is byte-for-byte unchanged
   (`git diff` of `tab-summaries.tsx` is empty). An old `?tab=period` link opens «نظرة عامة»
   (`readTab` already falls back to the first visible tab). Every figure that tab showed either
   has a home on another tab or is dropped and told to the owner (list below). The server read
   `GET /fleet/dashboard/period` lost the two parts only that tab read — `visits` (by check-in
   day) and `accidents.openRemaining` — and with them `visitStates` / `stateCounts`, which nothing
   else called. 26 words only that tab read are removed from ar and en.
2. **«نظرة عامة»: «رصيد العهدة النقدية» → «إجمالي العهدة»** (en "Custody fund total"): the value of
   one key; same figure, same links.
3. **«سجل العهدة» keeps «2 سيارات»**: no change anywhere.
4. **The shared `ErrorState` shows an Arabic reader no English at all.** It never prints the
   server's error code («INTERNAL» …) in either language. In Arabic, a message with no Arabic
   letter (the server's own English for a code the friendly table does not word yet, a client
   `Error`) gives way to the general line («حدث خطأ ما…»); toasts are unchanged. When the server
   sent a request id, one quiet line stays for support: in Arabic «الرقم المرجعي» and the shared
   `CopyIdButton` («نسخ الرقم المرجعي») — the id on the clipboard, in the tooltip and in
   `data-request-id`, never in the text; in English "Reference:" and the id (a `bdi dir="ltr"`,
   `whitespace-nowrap font-mono`) with the same button. On the Fleet dark tables
   `ERROR_ID_AS_FIGURES` now sizes the whole line (`[data-error-reference]`), so the name and the id
   are one size. New key `common.error.reference`.
5. The mistaken page (artifact) was deleted outside the repository; nothing to build.
6. The small fixes:
   - a. `monthCountOptions`: `ar-EG-u-nu-latn` → «أكتوبر 2026 (12)» on «السيارات», «التراخيص»
     and «الإخطارات».
   - b. The car page: page-local Latin helpers for every figure and date of the page body
     («آخر قراءة عداد», «أعلى قراءة … كم» included, and the record counts grouped, «1,234 قراءة»);
     the print sheet (its two dates in the shared ar-EG digits, as the registry's print) and the
     shared `format.ts` unchanged — told to the owner as a question.
   - c. The car record counts «الحوادث» with `vehicleCodes: [code]`, the filter its link sends (as
     odometer and maintenance already did, #753 D20(d)), so the number equals the opened list.
   - d. `EmployeeName`: the margin moves to a span in the page's direction and the code is a
     `bdi dir="ltr"` inside it — the gap between name and code in both directions, for every
     reader (the daily «تعديل» dialog, «السائقون», «مخالفات السيارات», the dashboard's
     «المخالفات المرورية والتسويات»). `FixedCrewDialog` keeps its approved face.
   - e. `ROSTER_NOTE_MAX = 500` (the API's `PlanFleetRosterRowSchema.notes.max(500)`) on the daily
     desk dialog and the daily phone notes sheet.
   - f. `MISSION_BOX` gains `[&_select]:!truncate` and both desk boards pass the chosen mission's
     name as the select's `title` (`CatalogSelect` gets an optional `title`, default the aria
     label). No width changed: scrollWidth − clientWidth is 0 before and after at 1280, 1366 and
     1920 on both boards, every column width identical.
7. **«الطقم الثابت» has no page header at any width** (owner, over a picture of it: «الجزء اللى
   فوق دا شيله بتاع العنوان واللى فوقه»; it reverses answer 2 ج). `FixedRosterPage` drops
   `PageHeader` — the breadcrumbs «الحركة › الطقم الثابت», the title and its divider — and keeps
   only `<h1 className="sr-only">`; the board's first row (the car count + Excel pill on a
   computer, the search + Excel button on a tablet and a phone) is the top of the page. The page
   container (`fullHeight`), the sticky rows and the save bar are unchanged; the daily «تعيين
   السيارات» is untouched.

## ما يجب أن يعرفه صاحب الطلب

1. «أرقام الفترة»: شلنا التبويب من شريط «لوحة تحكم الحركة»، و«ملخصات» زي ما هي بالظبط. لو حد فتح رابط قديم للتبويب ده هيفتح على «نظرة عامة».
2. «الكيلومترات المقطوعة» موجودة في «العدادات والكيلومترات» باسم «إجمالي الكيلومترات» (ومعاها «مؤكدة حتى» و«لم تُغلق القراءة بعد»)، وبتاعة الشهر في «نظرة عامة».
3. «متوسط الكيلومترات للسيارة» موجود في «العدادات والكيلومترات» باسم «متوسط لكل سيارة».
4. «قراءات تحتاج مراجعة» موجودة في «العدادات والكيلومترات» بنفس الاسم.
5. «قراءات لكام سيارة من كام» موجودة تحت «متوسط لكل سيارة»، بس النسبة المئوية اللي كانت جنبها اتشالت.
6. «زيارات الصيانة» بتاريخ دخول الورشة (العدد واللي خرجت واللي لسه في الورشة ونسبتها) اتشالت خالص، مفيش تبويب تاني بيعدّ بتاريخ الدخول. الأقرب ليها «خرجت من الورشة» في «الصيانة والورش» (بتاريخ الخروج) و«في الورشة الآن».
7. «الحوادث»: العدد والمفتوحة منها والحوادث اللي من غير تاريخ موجودين في «الحوادث ومطالبات التأمين» («حوادث الفترة»).
8. «المتبقي» بتاع الحوادث المفتوحة لوحدها اتشال؛ في «الحوادث ومطالبات التأمين» فيه «إجمالي المتبقي» لكل حوادث الفترة المفتوحة والمقفولة («مبالغ ملفات حوادث الفترة»). ونسبة «المفتوحة منها» اتشالت.
9. «مصروف التشغيل» موجود في «الوقود والمصروفات» بنفس الاسم، وبتاع الشهر في «نظرة عامة».
10. «إيصالات الكارت» موجودة في «مصروف التشغيل حسب النوع» في «الوقود والمصروفات» باسم «وقود من الكارت». «إيصالات العهدة» كرقم واحد موجودة في تبويب «العهدة» باسم «مصروفات العهدة» للي عنده صلاحية العهدة؛ واللي معندوش الصلاحية دي هيلاقيها متقسمة بس في «مصروف التشغيل حسب النوع» («وقود من العهدة» و«كاوتش» و«غسيل» و«صيانة») من غير رقم إجمالي لوحده. شريط «كارت ثم عهدة» اتشال، والنسبة بقت لكل نوع في «مصروف التشغيل حسب النوع».
11. «فواتير التوكيل» (المبلغ وعدد الصفوف و«بانتظار الفاتورة») موجودة في «الوقود والمصروفات» بنفس الاسم؛ نسبة «الصفوف المسجّلة قيمتها» اتشالت.
12. «البيانات متاحة من …» بتفضل تظهر في «الوقود والمصروفات» و«العهدة»، والجملة اللي بتقول إن مصروف التشغيل وفواتير التوكيل ما بيتجمعوش موجودة في «الوقود والمصروفات».
13. كارت «رصيد العهدة النقدية» في «نظرة عامة» بقى اسمه «إجمالي العهدة»، نفس الرقم ونفس الرابط.
14. «سجل العهدة»: سيبنا «2 سيارات» زي ما هي، ما اتغيرش حاجة.
15. رسالة الغلط: مفيش أي كلام إنجليزي هيظهر فيها بالعربي تاني. كود الغلط اتشال، ولو السبب اللي جاي من السيرفر لسه ملوش جملة عربي هتظهر الجملة العامة «حدث خطأ ما. يُرجى المحاولة مجددًا.» بدل الجملة الإنجليزي. تحت الرسالة سطر صغير «الرقم المرجعي» وجنبه زرار نسخ: الرقم نفسه مش مكتوب على الشاشة، بس لما تدوس الزرار بيتنسخ عشان تبعته للدعم الفني. التنبيهات اللي بتطلع بعد الحفظ ما اتغيرتش؛ لو شفت فيها جملة إنجليزي في غلط نادر قولنا.
16. الصفحة اللي اتعملت بالغلط اتمسحت.
17. «شهر انتهاء الترخيص» في «السيارات» و«التراخيص»، وشهور «حسب الشهر» في «الإخطارات»: الأرقام بقت إنجليزي زي باقي السيستم.
18. صفحة السيارة: كل الأرقام والتواريخ بقت أرقام إنجليزي، ومنها «آخر قراءة عداد» وسطر «أعلى قراءة»، والأعداد اللي في سجل السيارة بقت بفاصلة زي باقي الصفحة («1,234 قراءة»). ورقة «طباعة التقرير» ما اتغيرتش: تاريخ الانضمام وانتهاء الترخيص فيها لسه بالأرقام العربي زي ورقة طباعة «السيارات»؛ لو عايزهم إنجليزي قولنا.
19. «الحوادث» في سجل السيارة بقت بتتعد بكود السيارة زي الرابط بالظبط، فالرقم بقى نفس عدد اللي بيفتح (ومعاه حوادث الدفتر القديم اللي على نفس الكود).
20. «تعديل» في «تعيين السيارات»: بقى فيه مسافة بين اسم السواق وكوده. اتصلحت في المكان المشترك، فالمسافة اتظبطت كمان في «مخالفات السيارات» و«السائقون» وتبويب «المخالفات المرورية والتسويات» في «لوحة تحكم الحركة».
21. ملاحظات «تعيين السيارات» على الكمبيوتر والموبايل: بقى ليها حد أقصى 500 حرف زي «الطقم الثابت».
22. «نوع المهمة» على الكمبيوتر في «تعيين السيارات» و«الطقم الثابت»: الاسم الطويل بيتقفل بثلاث نقط، ولما تقف عليه بالماوس يظهر الاسم كله، وعرض الجدول زي ما هو على اللابتوب والشاشة الكبيرة.
23. «الطقم الثابت»: شلنا الجزء اللي فوق كله، «الحركة › الطقم الثابت» والعنوان «الطقم الثابت» والخط اللي تحتهم، على الكمبيوتر والتابلت والموبايل. ده عكس اللي اخترته قبل كده في السؤال 2 (ج). الصفحة دلوقتي بتبدأ على طول بسطر عدد السيارات وزرار التصدير لإكسل على الكمبيوتر، وبالبحث وزرار الإكسل على التابلت والموبايل، والجدول والكروت خدوا المساحة اللي كان واخدها العنوان. «تعيين السيارات» زي ما هي.
24. حاجات صغيرة لاحظناها ومش في اللي طلبته فما لمسناهاش: عدد السيارات فوق جدول «السيارات» و«التراخيص» وعدد «الإخطارات» لسه بالأرقام العربي زي «١٥ سيارة»؛ و«المخالفات» في سجل السيارة لسه بتتعد بالسيارة مش بكودها زي الرابط، فممكن الرقم يختلف عن اللي بيفتح؛ وكلام العدد في سجل السيارة زي «3 حادث» و«14 عمليات» مش مظبوط نحويًا. لو عايز أي حاجة فيهم تتصلح قولنا.

## Scope

- Type: feat (Fleet), owner follow-ups of 22 November.
- contracts: `packages/contracts/src/modules/fleet-dashboard.ts` (+ spec) — `period` out of
  `FLEET_DASHBOARD_TABS`, `TAB_READS`, `TAB_SECTIONS`; `FLEET_DASHBOARD_PERIOD_TABS`, the `visits`
  section, its gate, `FleetDashboardPeriodVisitsDto` and `accidents.openRemaining` deleted.
- api: `period.service.ts` (no `visits`; `accidents` = `{ count, open, undated, totals }`),
  `maintenance.service.ts` (`visitStates` deleted), `maintenance.repository.ts` (`stateCounts`
  deleted); unit and integration specs (dashboard, parity, performance, maintenance breakdown).
- web, answer 1/2: `FleetDashboardPage.tsx`, `lib/fleet-dashboard-{links,tabs,url}.ts`
  (`kmText` moved to `fleet-dashboard-tabs.ts`; `periodLinks.visits` / `opexCustody` deleted),
  `tab-km`, `tab-distribution`, `km-chart`, `tab-maintenance`, `dash-shell` (comments/imports);
  `tab-period.tsx`, `period-tabs.tsx` and `fleet-dashboard-period-tabs.spec.tsx` deleted; the
  shared filter-bar cases of the deleted spec moved to the new
  `fleet-dashboard-period-filters.spec.tsx`; the two dashboard fixtures.
- web, answer 4 and a–f: `ErrorState.tsx` (+ new `error-state.spec.tsx`; it now uses the shared
  `CopyIdButton`), `VehiclesListPage.tsx` (`ERROR_ID_AS_FIGURES` sizes the whole reference line;
  `fleet-figures-font.spec.ts`), `licence-months.ts`, `VehicleDetailPage.tsx`, `EmployeeName.tsx`,
  `CatalogSelect.tsx`, `RosterAssignDialog.tsx`,
  `roster/{roster-parts,RosterDeskBoard,RosterTouchBoard,FixedDeskBoard,FixedCrewDialog}.tsx`, and
  their specs.
- web, the fixed roster's header: `FixedRosterPage.tsx` (no `PageHeader`, an `sr-only` h1),
  comments in `FixedDeskBoard.tsx` / `FixedTouchBoard.tsx`; `fleet-fixed-roster.spec.tsx`,
  `fleet-fixed-roster-touch.spec.tsx` and `lib/fixed-roster-model.spec.ts` re-pointed from «one
  title on top» to «no page header, a hidden h1, the board's first row on top» (desk, phone,
  portrait, landscape and the short phone). Design doc §4.5b + revision 1.26.
- i18n: 26 keys removed (ar + en), `fleet.dash.overview.kpi.custody.title` re-valued,
  `common.error.reference` added. CHANGELOG `[Unreleased]` entry.
- Follow-on edits: `dash-shell.tsx` (the `PageRead` doc no longer names `PeriodTab`),
  `vehicles-licence-state.spec.tsx` (D25 re-pointed to Latin digits),
  `roster-optional-props.spec.tsx` (one test title: NotesSheet is uncapped only by default), and the
  two calendar-expired api specs below.
- Not touched: data (no migration), permission keys and their order, every endpoint but R2's two
  fields, «ملخصات».

## Review checklist (Development Workflow §4)

- [x] Layer rules respected (thin controller, logic in service, data access in repository) — R2's
      section list lives in the service; the deleted repository method had no other caller.
- [x] No cross-module imports; features imported via `index.ts` only — no new import across
      modules.
- [x] Permissions declared + route `authorize(...)` present; frontend gated with `<Can>` — no key
      added or removed; `FLEET_DASHBOARD_{NOW,PERIOD,PAGE,SCOPE}_KEYS` pinned to their recorded
      members and order; `gen-permission-matrix --check` green.
- [x] Zod validation at every new boundary; types inferred, not duplicated — no new boundary; the
      DTO shrank (a `@ts-expect-error` sample fails tsc if `visits` or `openRemaining` return).
- [x] Mutations audited; events named per convention; reliable tier where business-critical — no
      mutation changed.
- [x] Tests: unit for rules, integration for endpoints (happy + authZ + validation) — contracts,
      service and integration specs re-pointed (a maintenance clerk's R2 is `['exits']`); new web
      specs for every fix; performance ceilings lowered to the measured 36 / 39.
- [x] ar + en translations; RTL-safe layout — every key in both; the name/code gap fixed with a
      `bdi` in the page's direction; Latin digits.
- [x] Docs updated in this PR (permission matrix, DB design, CHANGELOG, ADR if architectural) —
      CHANGELOG; `fleet-module-design.md` §4.5b (no page header on «الطقم الثابت») + revision 1.26;
      the permission matrix and DB design are unchanged (no key, no schema); no doc named the
      removed tab.

## Verification

The CI gate in CI order (`CI=true`), run alone on the final tree:

| step | result |
|---|---|
| clean room (no `zz-*` under `apps/`) | 0 files |
| `check-secrets` | rc 0 |
| contracts build | rc 0 |
| lint (root, `apps/api`, `apps/web`) | rc 0 |
| typecheck (every workspace) | rc 0 |
| `gen-permission-matrix --check` | rc 0 — unchanged |
| `check-flag-expiry` · `check-page-registry` · `automation-templates` | rc 0 |
| `check-formal-arabic` | rc 0 |
| contracts tests | 53 files, 1,343 tests passed |
| api tests (integration included) | 699 files, 12,003 tests passed |
| web tests | 606 files, 14,257 tests passed |
| build | rc 0 |
| `dependency-audit` | rc 0 |

Also, each alone before the gate: the specs that were red until the i18n merge (shell 55,
overview 45, blocks 28, error-state 12, vehicles-licence-state 20) and every dashboard spec that
imports the fixtures. Dark pictures for the owner: the strip without «أرقام الفترة» (1920, 1366),
an old link opening «نظرة عامة», the «إجمالي العهدة» card, an error state with «الرقم المرجعي»,
the licence-month options, the car page, the daily dialog's gap (before / after), the notes cap
(desk and phone: 630 letters typed, 500 kept), the mission ellipsis and its hover on both boards.

## Notes for reviewers

- The greps for the removed names hit only absence guards on purpose: `'FLEET_DASHBOARD_PERIOD_TABS'
  in …`, `'visitStates' in …`, `'stateCounts' in …`, `not.toHaveProperty('openRemaining')`,
  `'opexCustody' in P`, the shell / census specs' `REMOVED_TAB` and the 26 removed keys. The
  literal «أرقام الفترة» is nowhere in `apps/` or `packages/`.
- `fleet-dashboard-performance.spec.ts`: `CEILING.r2` 38 → 36 and `CEILING_FILTERED_R2` 42 → 39,
  each equal to its measurement (lower only); the old one-query margin for the conditional
  `latestChainDates` (never asked on that fixture) is gone, and the comment says so.
- `vehicles-licence-state.spec.tsx` D25 pinned the reading tile in Arabic-Indic digits; it is
  re-pointed to Latin and also asserts the Arabic-Indic form is gone.
- `fleet-daily-roster.spec.tsx` mocks `shared/ui/Dialog` and `fleet-roster-touch.spec.tsx`
  mocks `RosterBottomSheet`, the same in-place stand-ins the fixed and optional-props specs use
  (the real ones portal to `document.body`, which the node run has none of).
- Two api specs outside this work had expired on the calendar and are fixed at the date, not
  loosened: `roster-direct-call.spec.ts` planned the fixed day 2026-11-20, which became the past on
  21 November and tripped the past-day guard (`PAST_DATE`) before FR-5 / FR-7 were reached — it
  now plans tomorrow (UTC, the service's own day); `hr-attendance.spec.ts` «averages hours over the
  days that HAVE hours» used `recentWorkday() + 1`, a Friday (`weekend`) whenever the run is on a
  Sunday — it now takes the next workday (`workdayAfter`, skipping the weekend and the seeded
  holidays). Every assertion is unchanged.
- Seen, not in the owner's list, not touched, and asked in told item 24: the title counts of
  «السيارات» (`VehiclesListPage`), «التراخيص» (`LicensingPage`) and «الإخطارات» (`NoticesPage`)
  are still Arabic-Indic (`formatNumber(…, locale)`); the car record still counts violations by id
  while its link opens by code; the record chips' number agreement («3 حادث», «14 عمليات»). The
  print sheet's two dates keep the shared ar-EG digits (told item 18, asked).
- `ErrorState` only: toasts still read `errorMessage` as before, so a toast for a code the Arabic
  table does not word still shows the server's English (told item 15 says so). The Arabic table's
  `BUSINESS_RULE` entry does not match the real code `BUSINESS_RULE_VIOLATION`; mapping it would
  change toasts too, so it is left for a separate follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
