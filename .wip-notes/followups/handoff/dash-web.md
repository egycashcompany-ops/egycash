# Hand-off — package `dash-web` (web side of answers 1 and 2)

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR).

## Status

Done. Ran after dash-api's "contracts built 2026-11-22T08:54:50Z" (dist: eleven tabs, no
`FLEET_DASHBOARD_PERIOD_TABS`, no R2 `visits`, no `accidents.openRemaining`). No commit made (the
parent's WIP commit 1af79a8f already holds this package's edits).

## Files changed (dash-web's own list only)

- `pages/FleetDashboardPage.tsx`: no `FLEET_DASHBOARD_PERIOD_TABS`, `PeriodTab` import, `PeriodTabKey`,
  `isPeriodTab` or PeriodTab branch; `NOW_PANELS: Record<Exclude<FleetDashboardTab, MixedTabKey>, …>`;
  header comment = eleven tabs, «ملخصات» the one old tab kept, R2 = the mixed panels' period parts.
- `lib/fleet-dashboard-tabs.ts`: `kmText` moved here (same `en-US` whole, comma-grouped format).
- `components/fleet-dashboard/tab-km.tsx`, `tab-distribution.tsx`, `km-chart.tsx`: `kmText` imported
  from `../../lib/fleet-dashboard-tabs` (no import of `./tab-period` left anywhere but period-tabs.tsx
  and the period fixtures, both HUB's). tab-km + tab-maintenance: header comments no longer name the
  old tab.
- `lib/fleet-dashboard-links.ts`: `periodLinks.visits()` and `periodLinks.opexCustody()` deleted
  (`custodySpend` stays; `opex(metric, source?)` unchanged); header + T6.x doc comments rewritten to
  name the tabs that draw each link.
- `lib/fleet-dashboard-url.ts`: header comment; `readTab` doc says an old link to the removed tab
  opens the first visible tab (behaviour unchanged — `readTab` already falls back).
- Specs: shell, link-census, links, gates, blocks, refresh, tab-overview, tab-accidents,
  `shared/lib/remembered-filters-coverage.spec.ts`; `fleet-dashboard-period-tabs.spec.tsx` DELETED.
- NEW `fleet-dashboard-period-filters.spec.tsx`: the period-tabs spec's filter-bar cases that are not
  about the removed tab (the one filter state, the bar in maintenance / km / accidents, «مخصص»,
  the custom-range warning, the echoed set's chips, the 403-free controls), re-pointed from
  `?tab=period` to the mixed panels (mostly `km`), plus a loop that the bar stands once in each of the
  seven mixed panels with the address bar's period and the echoed range. Nothing of the old spec that
  still has a subject was dropped.

## i18n

`/home/user/egycash/.wip-notes/followups/i18n/dash-web.json` — `{ remove: [26 keys], set: {…} }`:
- remove: `fleet.dash.shell.tab.period`, `fleet.dash.filters.rangeHead`, `fleet.dash.period.today`,
  `fleet.dash.period.km.{title,average,confirmedThrough,noneConfirmed,open,invalid,coverage}`,
  `fleet.dash.period.visits.{title,split,note,bar}`, `fleet.dash.period.accidents.{title,split,undated,bar}`,
  `fleet.dash.period.opex.{title,split,note,bar}`, `fleet.dash.period.dealership.{title,pending,note,bar}`.
  Each was grepped: no reader outside tab-period.tsx / period-tabs.tsx / the deleted spec.
- set: `fleet.dash.overview.kpi.custody.title` = ar «إجمالي العهدة», en "Custody fund total".
- KEEP (not in the JSON): `fleet.dash.period.dataFrom` (tab-fuel-period:93, tab-custody-period:66)
  and `fleet.dash.period.notSummed` (tab-fuel-period:585, fuel spec). The shell spec asserts both stay.

## Spec runs (each alone, under the lock)

| spec | result |
|---|---|
| fleet-dashboard-shell.spec.tsx | 54 / 55 — 1 RED until HUB merge (below) |
| fleet-dashboard-link-census.spec.ts | 24 passed |
| fleet-dashboard-links.spec.ts | 57 passed |
| fleet-dashboard-gates.spec.ts | 46 passed |
| fleet-dashboard-blocks.spec.tsx | 27 / 28 — 1 RED until HUB merge (below) |
| fleet-dashboard-refresh.spec.ts | 26 passed |
| fleet-dashboard-tab-overview.spec.tsx | 44 / 45 — 1 RED until HUB merge (below) |
| fleet-dashboard-tab-accidents.spec.tsx | 45 passed |
| fleet-dashboard-period-filters.spec.tsx (NEW) | 9 passed |
| fleet-dashboard-tab-km / -distribution / -fuel / -custody / -maintenance | 58 / 49 / 56 / 47 / 43 passed |
| fleet-dashboard-now-tabs.spec.tsx | 15 passed |
| shared/lib/remembered-filters-coverage.spec.ts | 151 passed |
| lib/fleet-dashboard-km-chart.spec.ts | 20 passed |
| extra (unchanged, mount the page): target-params / tab-today / tab-violations / tab-licences | 60 / 41 / 45 / 67 passed |

RED until the HUB merge — exactly these three, nothing else:
1. shell › "drops every word only the removed tab read — each key reads as itself in both languages":
   `translate('ar'|'en', key) === key` for the 26 removed keys (red while i18n.ts still holds them).
2. tab-overview › "K6 «إجمالي العهدة» …": ar value «إجمالي العهدة», en "Custody fund total", the card
   text has «إجمالي العهدة» and the page has no «رصيد العهدة النقدية» (red until the value changes).
3. blocks › "mounts no period-only tab …": no file under `apps/web/src` imports `…/period-tabs` or
   `…/tab-period`; today it lists exactly `modules/fleet/components/fleet-dashboard/period-tabs.tsx` and
   `modules/fleet/fleet-dashboard-period-fixtures.ts` (green once HUB deletes the two files and drops
   the fixtures' `PeriodTab` import).

## tsc (`flock $L npx tsc --noEmit -p apps/web`) — errors ONLY in HUB files

- `components/fleet-dashboard/tab-period.tsx` l.278, 282, 286, 293, 298, 341, 376, 474 (R2 `visits`,
  `links.visits`, `accidents.openRemaining`, `links.opexCustody`) — goes with the file.
- `fleet-dashboard-fixtures.ts` l.718 and `fleet-dashboard-period-fixtures.ts` l.335:
  `openRemaining` excess property. After that is dropped, expect the same for `visits`
  (fixtures l.681-682, period-fixtures l.277-278): TS reports one excess property per literal.
eslint and prettier --check on every dash-web file: clean. `check-formal-arabic`: green.

## To HUB

1. DELETE `components/fleet-dashboard/tab-period.tsx` and `components/fleet-dashboard/period-tabs.tsx`
   (nothing in dash-web reads them any more; `kmText` lives in `lib/fleet-dashboard-tabs.ts`).
2. `fleet-dashboard-period-fixtures.ts`: drop the `PeriodTab, type PeriodTabProps` import (l.36),
   `renderPeriodTab` (l.693-733) and then the imports it alone used (`createElement`,
   `configureStore`, `Provider`, `MemoryRouter`, `QueryClientProvider`, `renderToStaticMarkup`,
   `localeSlice`, `authSlice`, `MeDto`, `CLEARED`; `Locale` stays — `renderPeriod` types its
   `locale` with it). `renderPeriod` / `periodClient` stay: the new period-filters spec and the
   census/shell specs import `renderPeriod`, `PERIOD_FULL`, `PERIOD_YEAR`, `FROM_30`, `KM_TOTAL`.
   Drop `visits` (l.277-278), `openRemaining` (l.335), header l.1-2 and l.10
   («أرقام الفترة» / visits by check-in day).
3. `fleet-dashboard-fixtures.ts`: drop `visits` (l.681-682 and its comment «أرقام الفترة») and
   `openRemaining` (l.718).
4. NOT in any package's list: `components/fleet-dashboard/dash-shell.tsx` l.91-93, the `PageRead` doc
   ("The four old period tabs get the same read through `PeriodTab`") — stale; dash-api suggested
   text in its hand-off §6. It is the only non-HUB code hit of `PeriodTab` left.
5. Census-grep hits in dash-web specs that are ABSENCE GUARDS (keep them):
   - shell.spec: `REMOVED_TAB = 'period'` + `REMOVED_NAME` (the Arabic name spelled apart, so the
     literal «أرقام الفترة» is nowhere in apps/), `PAGE` not containing `PeriodTab` /
     `FLEET_DASHBOARD_PERIOD_TABS` / `period-tabs`, and the 26 removed `fleet.dash.period.*` keys.
   - link-census.spec: `REMOVED_TAB = 'period'` (no `tab=period` href; no `visits.*` metric).
   - links.spec: `'opexCustody' in P` / `'visits' in P` false.
   - blocks.spec: `\bPeriodTab\b`, `isPeriodTab`, the `period-tabs|tab-period` import scan.
   - refresh.spec: page not containing `PeriodTab` / `period-tabs`.
   - tab-accidents.spec: no `accidents.openRemaining` link.
   No literal `tab=period` or «أرقام الفترة» in any dash-web file.
6. Generic comments left as they are (true of the mixed panels): "the period tabs share it"
   (tab-maintenance l.1213, tab-fuel-period, tab-custody-period, tab-accidents, tab-violations),
   dash-kit l.437, fleet-dashboard-queries l.5, target-params spec titles "(T6.5 …)" — not dash-web's.

## Dark screenshots (vite + Chrome 153 headless, the real page over the dashboard fixtures, every key)

Folder: `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/dash-web/shots/`
The harness previewed the HUB's i18n merge for the custody title only (a vite transform in a zz-
config; i18n.ts untouched), so the card shows «إجمالي العهدة» as it will after the merge.
- `dash-web-bar-1920-dark.png` (full page) + `dash-web-bar-1920-strip-dark.png` (the bar): eleven
  pills, «ملخصات» last, no «أرقام الفترة»; strip overflow 0, page overflow 0.
- `dash-web-bar-1366-dark.png`, `dash-web-bar-1366-strip-dark.png` (start) and
  `dash-web-bar-1366-strip-end-dark.png` (scrolled to its end: «العهدة · التراخيص والتجديدات ·
  ملخصات»); the strip scrolls 405px with its cue, as before; page overflow 0.
- `dash-web-old-link-opens-overview-1920-dark.png`: `/fleet?tab=period&period=last30` → «نظرة عامة»
  pressed, panel `overview`.
- `dash-web-overview-kpi-row-1920-dark.png` (the six KPI cards) and
  `dash-web-overview-custody-card-1920-dark.png`: «إجمالي العهدة» · 159,974.54 ج.م. · «فتح لوحة
  العهدة»; no «رصيد العهدة النقدية» on the page.
Harness: `…/followups/dash-web/harness/` (cdp.mjs, jobs, results.json). The zz- files under apps/web
are deleted; vite and Chrome stopped; `git ls-files --others --ignored --exclude-standard -- apps |
grep /zz-` is empty.
