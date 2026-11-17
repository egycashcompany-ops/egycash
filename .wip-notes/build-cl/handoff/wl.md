# WL hand-off (web — «التراخيص والتجديدات» + LicensingPage + the period bar): done, NOT committed

Tree /home/user/egycash-dash (21995fd4f + C0 + the parallel A1/WC edits), plan build-cl/plan.md §7 (D14–D18, D20). An earlier
cut-off WL run (ended ~09:56) had written every owned file, the spec, wl.json and a shim; it stopped before this note. This run
re-read all of it against DECISIONS §11, the plan, ZL (/home/user/egycash/apps/web/src/zz-licences-tab.tsx) and the approved
pictures, kept it, and finished it (changes of this run listed under «This run»). C0's `C0-STUB(WL)` (old body) is gone: the
file is rewritten.

## Files (owned)
- REWRITE apps/web/src/modules/fleet/components/fleet-dashboard/tab-licences.tsx — `export const LicencesTab = (props:
  MixedTabProps)`, wrapper `data-dash-tab-body="licences"`. TabHead (doc icon, `t('fleet.dash.shell.tab.licences')` = HUB's new
  «التراخيص والتجديدات», `live={false}`, sub `fleet.dash.licences.sub` (CHANGED) or `.subNow` for a reader with no period band,
  RefreshTools). «الآن» band when any of licenceVehicles / licenceDrivers / papers is permitted; period band when
  `props.period.enabled && sectionPermitted('licenceSpend', can)`. The old four cards and every old helper are gone.
- NEW …/tab-licences-now.tsx — `LicencesNowBand`: BandHead «الآن» (LiveChip only), ReadBand over `props.nowPending`
  (skeleton / error face of R1), SectionError per failed section, six KPIs (`data-lic-kpi=carsExpired|carsExpiring|papers|
  driversExpired|driversExpiring|missing`, `data-lic-tone`), grid `grid-cols-1 sm:2 lg:3 min-[1800px]:6` (cars row over
  drivers row), each card under its own section. K1: ≤3 CarChips of the expired rows + «و N أخرى» (N = `expired` − chips),
  one car → its «منتهٍ منذ …» in red; foot + «· وخارج الخدمة N» only when > 0. K2/K4: two-line title «… / خلال {W}» (W =
  the section's `warnDays` through the counted noun), «ومن {W+1} إلى 60 يومًا: N ←» (`data-lic-soon=cars|drivers`, hidden
  when W ≥ 60 or the builder gives null), settings foot. K3 papers: «تأمينات N» | «ضرائب N» (no total) → `papersOpen`. K5:
  ≤3 names (people map) → each file, truncating «…» inside the one-line sub (full names in `title`), «و N أخرى» never
  shrinks; one driver → «منتهٍ منذ …». K6: «رخصة غير مسجّلة N» (`fleet.dash.now.licenceNotRecorded`, linked) + «بلا ملف سائق:
  N» plain. Notes: fuel pointer (`data-lic-note="fuel"`, only when `tabLink('fuel', …)` is not null) and the HR-branch note
  (`data-lic-note="hr-branch"`, drivers shown AND narrowed — a branch or «كل فروعي»). Then the chart and the two tables.
- NEW …/tab-licences-chart.tsx — `LicenceMonthChart` (D15): the server's 12 keys in order, two columns per slot (cars
  `TONE.brand.bar`, drivers `bg-brand-400 dark:bg-brand-300`), value on top, never a month total; «هذا الشهر» = word under
  the axis label + faint slot band (`data-lic-this-month`), never a shade; readout (`data-lic-readout`) month · «هذا الشهر»
  · «N سيارات» · «N سائقين» (dual forms); legend; foot «عمودا الشهر لا يُجمعان. ما انتهى قبل هذا الشهر …» (the first
  sentence only when both series are drawn); column links `vehicleLicenceMonth(key)` / `driverLicenceMonth(key)`
  (`data-lic-month`, `data-lic-series`); a series only with its section; phone: scrolls inside the card from this month
  (end fade). Axis: `licenceMonthTicks` (kit `custodyTicks`, whole steps; 21 → 0…25).
- NEW …/tab-licences-tables.tsx — `CarLicencesTable` (D16: chip = `list.length + more`, CarChip + make, licence class,
  expiry day in red/amber/neutral, ONE-spelling state pill, papers column only with `sectionPermitted('papers')` = the
  board's reader — violet «تأمينات لم تُستلم» / «ضرائب لم تُستلم» for 'open' only, «—» else; «فتح» → `vehicle(id,
  'licenceVehicles.row')`; «عرض الباقي (N)» → `vehicleLicencesWithin60()` only when `more` > 0) and `DriverLicencesTable`
  (DriverIdentity from `useFleetPeopleMap` — «—» muted when the person is not on Fleet's list; licence type; «الملف موقوف»
  (`fleet.roster.reason.profileInactive`) on `active:false`; «فتح» → `driver(profileId, 'licenceDrivers.row')`; «عرض الباقي
  (N)» → `driverLicencesWithin60()`). Shared colgroup; table from 768 px, blocks below. Markers `data-lic-car=<vehicleId>`
  (`</tr>`), `data-lic-car-block` (`</li>`), `data-lic-driver=<profileId>`, `data-lic-active`, `data-lic-suspended`.
- NEW …/tab-licences-period.tsx — `LicencesPeriodBand` (D17): BandHead «خلال الفترة» (sky, RangeChip, `CompanyWide` while
  narrowed, line `periodSub`), `<PeriodFilterBar … periodOnly />`, ReadBand over R2; row `xl:[2fr|3fr]` [«مصروفات التراخيص في
  الفترة» (`data-lic-spend="card"`, sky, tag «بيوم المذكرة», `licenceSpend.total` → `periodLinks(data).licenceSpend(
  'licenceSpend.total')`, well «عدد المذكرات» / «السيارات» (the register's own `fleet.licenseExpenses.stats.memos/cars`)
  plain, foot «عرض مذكرات الفترة» → `licenceSpend('licenceSpend.screen')`) | «تفصيل مصروفات الفترة» (`data-lic-block="split"`,
  chip total, groups by kind (renewal/extension) and by payment (visa/cash) — register words
  `fleet.licenseExpenses.kinds.*` / `.paidBy.*`, brand bars, amount + one-decimal `shareText`, NO link)]; `licenceSpend` failed
  → SectionError; under the row the custody note + `tabLink('custody', 'licenceSpend.custody.tab')` «العهدة» (plain note when
  null).
- NEW …/tab-licences-words.tsx — `useLicenceWords`, `Counted` / `useCountedText` (five forms with a dual, custody pages'
  `custodyPlural`), `licenceTone` + `DATE_TONE`, `DayPhrase` («منتهٍ اليوم» reuses `fleet.dash.licences.expiredToday`), `Money`,
  `Day` (tone REPLACES the neutral colour), `FOOT`, `EndLine`, `LICENCE_NOW_SECTIONS`, `nowView`, `spendView`, `narrowedView`.
- …/period-filter-bar.tsx — additive `periodOnly?: boolean` (default false; every other tab unchanged): the preset + custom
  dates + range chip only; type / operation / codes controls and chips not drawn, their lists never asked for
  (`data-period-only="true"` on the card). NEW pure helpers `isClearedFor(f, periodOnly)` / `clearedFor(f, periodOnly)`:
  on a period-only bar «مسح الفلاتر» rests at the default period and brings back the default period ONLY — the type /
  operation / codes the other tabs hold stay in the address bar (it would be wrong to wipe filters the bar does not show).
- apps/web/src/modules/fleet/pages/LicensingPage.tsx — D20: `paper=insurance|tax` (`openPaperOf`, anything else ignored)
  keeps only rows whose `paperStage(row, paper) === 'open'` (the rule the dashboard counts with), with the other filters;
  `REMEMBERED_FILTERS += 'paper'`; `clearFilters` sets `paper: null`; `hasFilters` includes it; ONE removable violet chip
  (`data-licensing-paper=<paper>`, `fleet.licensing.paperOpen.{insurance,tax}` + «×», aria «إزالة …»). Stats bar unchanged.
- NEW apps/web/src/modules/fleet/fleet-dashboard-tab-licences.spec.tsx — 65 cases through the real page (`renderDashboard`
  over seeded caches: R1 key, the page's R2 key, `['fleet','people']`).
- apps/web/src/modules/fleet/pages/licensing-screen.spec.tsx — 8 new `paper=` cases (open insurance only; tax by its own
  squares; = the rule's count; unknown value ignored; narrows WITH the other filters; one removable chip; counts as a filter
  (reset offered, «no match» when emptied); remembered / cleared / read in LP's own source). Two pre-existing lines were
  only re-wrapped by prettier (the file was not prettier-clean at 100 columns).

## This run (on top of the cut-off run)
1. K5 «رخص سائقين منتهية» names ≤ 3 (plan D14; the cut-off run had 2) — names in a `min-w-0 truncate` box with the full
   names in `title`, the day phrase and «و N أخرى» `shrink-0` (the Card clips: at six columns three names do not fit;
   measured: «كمال عبد الرحيم، رامي فوزي عبد ا… و1 أخرى» at 1920, all three whole at 1366). Separator by locale («، » / «, »).
2. BUG FIXED: the tables' expiry day was ALWAYS neutral white — `Day` set `text-slate-700 dark:text-slate-200` and the tone
   class was appended; the kit's `cn` merges nothing, so the stylesheet kept slate. `Day` now takes `tone` that replaces the
   neutral colour (verified in the browser: red rgb(248,113,113) / amber rgb(251,191,36) dark, red-600 / amber-700 light).
3. period-filter-bar: the period-only reset logic moved into `isClearedFor` / `clearedFor` (pinned in the spec, unit + the
   tab's SSR `disabled`).
4. Spec: new cases (three-name cap + truncation; period-only reset; the day's colour alone), one title corrected.

## Self-check (temporary shim, deleted from the tree; copies in build-cl/wl-shim/)
`wl-shim-tmp.spec.tsx` (mocks i18n with wl.json + its `change` + HUB's two bar words; `nowLinks` += the five L names;
`periodLinks().licenceSpend`; `tabBadges` without a 0 licences badge) + `wl-shim-fdp.tmp.tsx` (= current FDP with
`MIXED_PANELS.licences = LicencesTab`, `NOW_PANELS` − licences, `MIXED_PERIOD_SECTIONS.licences = ['licenceSpend']`, no
`UNBUILT_TABS` filter): **65/65 green**. Mutations (build-cl/wl-shim/mutate.py): 18/20 caught + the date-colour mutation
caught; the 2 survivors are equivalent (`soon line at 60`: the builder already returns null at W ≥ 60; `fuel line always`:
renders an empty notes div). Without the shim the spec fails until HUB lands its L names / FDP wiring / words (expected).

## Look (temporary Vite harness, port 5331; files deleted from the tree; `git ls-files --others --ignored
--exclude-standard -- apps/web | grep '/zz-'` prints nothing)
Copies + shots in build-cl/wl-harness/ (company-1920, branch-1920, many-1920, c-1366, light-1536, tab-768, phone-375 +
crops). Words, order, tones, brand columns (drivers two steps lighter), «هذا الشهر» band + word, tables, papers tags,
«فتح», period row, custody note match lic-dark / lic-branch-dark; «الشركة كلها» on the period band only under the branch,
HR note under the branch; `scrollWidth − clientWidth = 0` at 375/768/1366/1536/1920; phone: KPIs stacked, tables as blocks,
chart scrolls inside its card. The only console error: a 404 on the first load (favicon; no API behind the harness).

## Checks
- eslint + prettier: clean on all 10 owned files; `git diff --check` clean.
- `npx vitest run src/modules/fleet/pages/licensing-screen.spec.tsx`: 44/44 green; fleet-dashboard-period-tabs.spec (the
  default bar): 20/20 green.
- web tsc: WL's errors are ONLY the 10 HUB-pending L-name uses (`papersOpen` ×2, `vehicleLicenceMonth`,
  `driverLicenceMonth`, `driver` ×3, `driverLicencesWithin60`, `periodLinks().licenceSpend` ×2 — all `TS2339/2551 Property
  … does not exist`). The other errors are WC's L names, FDP (`LicencesTab` still in NOW_PANELS) and the overview spec (WC).
- check-formal-arabic green; build-cl/wl-shim/check-wl.mjs on wl.json: 75 new, 1 change, 51 dropRead, 0 problems
  (placeholders, formal Arabic, no Latin, no Arabic digits, no collision, every old `fleet.dash.licences.*` key accounted for).

## L names coded against (HUB adds them — plan §8)
```ts
nowLinks(echo).papersOpen(paper: 'insurance' | 'tax')        // /fleet/licensing?paper=…, metric `papers.${paper}`
nowLinks(echo).vehicleLicenceMonth(ym: string)               // vehicles?status=active&licenseMonths=ym, 'licenceVehicles.month'
nowLinks(echo).driverLicenceMonth(ym: string)                // drivers?licExpFrom=ym-01&licExpBefore=<last day>&branch, 'licenceDrivers.month'
nowLinks(echo).driverLicencesWithin60()                      // drivers?licExpBefore=today+60&branch, 'licenceDrivers.more'
nowLinks(echo).driver(profileId: string, metric: string)     // /fleet/drivers/:profileId (a record)
periodLinks(data).licenceSpend(metric: string)               // license-expenses?from&to (no set)
```
Metrics passed: `driver(…, 'licenceDrivers.expiredDriver' | 'licenceDrivers.row')`, `vehicle(…, 'licenceVehicles.expiredCar' |
'licenceVehicles.row')`, `licenceSpend('licenceSpend.total' | 'licenceSpend.screen')`. Existing builders still used:
vehicleLicencesExpired/Expiring/Soon/Within60, vehicle, driverLicencesExpired/Expiring/Soon/NotRecorded.
**Tab links — names differ from plan §8 on purpose:** `props.tabLink('fuel', 'fuelCards.tab')` and `props.tabLink('custody',
'licenceSpend.custody.tab')` (plan: 'licences.fuelTab', 'licenceSpend.custodyTab'). The links spec requires `<section>.<…>`
with a GATED section — `licences` is a tab, not a section — and the house form for a tab link is `<section>.tab` /
`<section>.<x>.tab` (overview `licenceVehicles.tab`, WC `opex.custody.tab`). HUB: use these names in LC/LS pins.
Old builders with no WL reader left: `nowLinks.licensing` (L:434, replaced by `papersOpen`), `visitDay` (L:440),
`accidentsRecent` (L:455), `visitsRecent` (L:461) — delete per plan (check tab-accidents' `accidentDay` is the periodLinks one).

## FDP / T wiring HUB applies (proven in the shim)
`MIXED_PANELS.licences = LicencesTab` (it is `(props: MixedTabProps) => JSX.Element` — today's tsc error at FDP:168 is it
sitting in NOW_PANELS); `NOW_PANELS` − licences; `MIXED_PERIOD_SECTIONS.licences = ['licenceSpend']`; the mixed branch hands
`nowPending` for the 'now' read; `period.enabled` false for a reader with no permitted PERIOD section (a licensing-only reader:
papers card alone, no period band, no R2). T: licences badge n = expired cars + expired drivers, hidden at 0.

## FX / PFX (HUB) — what the shared specs need (the tab spec seeds its own figures)
- `NOW_DTO.licenceVehicles`: `list` rows with `typeName`, `licenceClass` (LocalizedString|null), `papers` (null or stages,
  one 'open'), `expiresAt` 'YYYY-MM-DD', `months` 12 keys from today's month; `licenceDrivers`: `months` (same keys),
  `list {rows, more}` with ≥1 `active:false`; `['fleet','people']` seeded for names where a spec reads them.
- `PERIOD_DTO.licenceSpend` {count, cars, visa, cash, renewal, extension, total} with renewal+extension = visa+cash = total.
- VCC (fleet-vehicle-card-census.spec.tsx :181-187, :508-513): the old `tab-licences.tsx` pins are gone. New pins:
  tab-licences-now.tsx `<CarChip\n code={row.code}\n link={links.vehicle(row.vehicleId, 'licenceVehicles.expiredCar')}` and
  tab-licences-tables.tsx `<CarChip code={row.code} link={links.vehicle(row.vehicleId, 'licenceVehicles.row')} />`; «every
  licence row's code box» → rows `data-lic-car="` up to `</tr>` (and phone `data-lic-car-block="` up to `</li>`). The drivers
  table draws no car code (a vehicle-less reader sees no MARK on the tab — holds).
- RFC (remembered-filters-coverage :96 `LicensingPage.tsx`, []): passes as is — `paper` is read AND remembered.
- TP (target-params): optional `/fleet/licensing?paper=` block; LP exports `openPaperOf` (its own spec pins the behaviour).
- Readers of dropped keys outside WL: `fleet.dash.licences.latestNone` (link-census spec), `fleet.dash.licences.unregistered`
  (now-tabs spec) — both HUB specs being re-pinned for the retired card; drop the keys after.

## Words — build-cl/i18n/wl.json (= WL.json)
75 new keys (`fleet.dash.licences.*` incl. count.{car,driver,day}.{one,two,few,many,other}, + `fleet.licensing.paperOpen.
{insurance,tax}`), ar + en; `change`: `fleet.dash.licences.sub` → «تراخيص السيارات ورخص السائقين وأوراق التأمينات والضرائب الآن،
ومصروفات التراخيص في الفترة.»; `dropRead`: 51 old `fleet.dash.licences.*` keys (the exact list is in the JSON); kept:
`fleet.dash.licences.expiredToday`. Reused: `fleet.dash.now.licenceNotRecorded`, `fleet.licensing.columns.{insurance,tax}`,
`fleet.licensing.stats.{insuranceOut,taxOut}`, `fleet.licenseExpenses.{kinds,paidBy,stats}.*`,
`fleet.roster.reason.profileInactive`, `fleet.dash.shell.tab.{fuel,custody,licences}` (custody + licences are HUB's), `common.remove`.
No new word was added in this run.

## Deviations / notes
- Tab-link metric names (above). Plan §7.13 listed `kpi.expiring.*`, `cars.paper.*`, `drivers.col.*`, `suspended`, `more`
  names; the JSON uses `kpi.carsExpiring.first` / `kpi.driversExpiring.first` / `kpi.within`, reuses the board's
  `stats.insuranceOut/taxOut` for the paper tags and the roster's «الملف موقوف», and `showRest` for «عرض الباقي (N)».
- A driver whose person is missing from `/fleet/people` (e.g. left HR) shows «—» muted with no code (the today tab does not
  wrap in `WithExitedDrivers` either).
- The LicensingPage count beside the filters keeps its existing Arabic-Indic digits (untouched code; spec reads it as is).

## Told (for the owner's list) — unchanged from plan §11 items 2, 4–15; add if wanted
- «رخص سائقين منتهية» names up to 3 files; on a narrow card the names end in «…» (hover shows them) and «و N أخرى» counts the
  rest.

## Open hand-offs
- HUB: the six L names + tab-link metric names above; FDP/T wiring; FX/PFX; VCC/LC/LS/NT/SH re-pins; i18n merge of wl.json
  (+ `fleet.dash.shell.tab.custody`, the changed `.tab.licences`, `tabShort.licences` drop).
- INT: real-page pictures at 5315 should look at the K5 truncation at 1920 with ≥3 expired drivers and the coloured days.
