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
4. **The shared `ErrorState` never prints the server's error code** («INTERNAL» …) in either
   language. When the server sent a request id, one quiet «الرقم المرجعي: req_…» line stays (the
   id in a `bdi dir="ltr"`, `font-mono` kept for the Fleet tables' restyle), so a screenshot still
   finds the request in the API log. New key `common.error.reference`.
5. The mistaken page (artifact) was deleted outside the repository; nothing to build.
6. The small fixes:
   - a. `monthCountOptions`: `ar-EG-u-nu-latn` → «أكتوبر 2026 (12)» on «السيارات», «التراخيص»
     and «الإخطارات».
   - b. The car page: page-local Latin helpers for every figure and date of the page body
     («آخر قراءة عداد», «أعلى قراءة … كم» included); the print sheet and the shared `format.ts`
     unchanged.
   - c. The car record counts «الحوادث» with `vehicleCodes: [code]`, the filter its link sends (as
     odometer and maintenance already did, #753 D20(d)), so the number equals the opened list.
   - d. `EmployeeName`: the margin moves to a span in the page's direction and the code is a
     `bdi dir="ltr"` inside it — the gap between name and code in both directions, for every
     reader (the daily «تعديل» dialog, «السائقون», «مخالفات السيارات», the dashboard's
     «المخالفات»). `FixedCrewDialog` keeps its approved face.
   - e. `ROSTER_NOTE_MAX = 500` (the API's `PlanFleetRosterRowSchema.notes.max(500)`) on the daily
     desk dialog and the daily phone notes sheet.
   - f. `MISSION_BOX` gains `[&_select]:!truncate` and both desk boards pass the chosen mission's
     name as the select's `title` (`CatalogSelect` gets an optional `title`, default the aria
     label). No width changed: scrollWidth − clientWidth is 0 before and after at 1280, 1366 and
     1920 on both boards, every column width identical.

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
10. «إيصالات الكارت» موجودة في «مصروف التشغيل حسب النوع» في «الوقود والمصروفات»، و«إيصالات العهدة» موجودة في تبويب «العهدة» باسم «مصروفات العهدة» (ومتقسمة حسب النوع في «الوقود والمصروفات»). شريط «كارت ثم عهدة» اتشال، والنسبة بقت لكل نوع في «مصروف التشغيل حسب النوع».
11. «فواتير التوكيل» (المبلغ وعدد الصفوف و«بانتظار الفاتورة») موجودة في «الوقود والمصروفات» بنفس الاسم؛ نسبة «الصفوف المسجّلة قيمتها» اتشالت.
12. «البيانات متاحة من …» بتفضل تظهر في «الوقود والمصروفات» و«العهدة»، والجملة اللي بتقول إن مصروف التشغيل وفواتير التوكيل ما بيتجمعوش موجودة في «الوقود والمصروفات».
13. كارت «رصيد العهدة النقدية» في «نظرة عامة» بقى اسمه «إجمالي العهدة»، نفس الرقم ونفس الرابط.
14. «سجل العهدة»: سيبنا «2 سيارات» زي ما هي، ما اتغيرش حاجة.
15. رسالة الغلط: الكلمة الإنجليزي (كود الغلط) مش هتظهر لحد تاني. اللي بيفضل تحت الرسالة سطر صغير «الرقم المرجعي» عشان الدعم الفني يلاقي الطلب، والرقم ده نفسه حروف وأرقام بالإنجليزي لأنه رقم الطلب عندهم.
16. الصفحة اللي اتعملت بالغلط اتمسحت.
17. «شهر انتهاء الترخيص» في «السيارات» و«التراخيص»، وشهور «حسب الشهر» في «الإخطارات»: الأرقام بقت إنجليزي زي باقي السيستم.
18. صفحة السيارة: كل الأرقام والتواريخ بقت أرقام إنجليزي، ومنها «آخر قراءة عداد» وسطر «أعلى قراءة». ورقة الطباعة زي ما هي.
19. «الحوادث» في سجل السيارة بقت بتتعد بكود السيارة زي الرابط بالظبط، فالرقم بقى نفس عدد اللي بيفتح (ومعاه حوادث الدفتر القديم اللي على نفس الكود).
20. «تعديل» في «تعيين السيارات»: بقى فيه مسافة بين اسم السواق وكوده. اتصلحت في المكان المشترك، فالمسافة اتظبطت كمان في «مخالفات السيارات» و«السائقون» وتبويب «المخالفات» في «لوحة تحكم الحركة».
21. ملاحظات «تعيين السيارات» على الكمبيوتر والموبايل: بقى ليها حد أقصى 500 حرف زي «الطقم الثابت».
22. «نوع المهمة» على الكمبيوتر في «تعيين السيارات» و«الطقم الثابت»: الاسم الطويل بيتقفل بثلاث نقط، ولما تقف عليه بالماوس يظهر الاسم كله، وعرض الجدول زي ما هو على اللابتوب والشاشة الكبيرة.

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
- web, answer 4 and a–f: `ErrorState.tsx` (+ new `error-state.spec.tsx`), `licence-months.ts`,
  `VehicleDetailPage.tsx`, `EmployeeName.tsx`, `CatalogSelect.tsx`, `RosterAssignDialog.tsx`,
  `roster/{roster-parts,RosterDeskBoard,RosterTouchBoard,FixedDeskBoard,FixedCrewDialog}.tsx`, and
  their specs.
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
      CHANGELOG; the permission matrix and DB design are unchanged (no key, no schema); no doc
      named the removed tab.

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
- Seen, not in the owner's list, not touched: the vehicles list's title count is still
  Arabic-Indic (`VehiclesListPage`), and the car record still counts violations by id while its
  link opens by code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
