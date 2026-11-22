# Hand-off — package `fixes-web` (answer 4 + small fixes a, b, c)

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR). Not committed by this package.

## Status

Done. Every owned file edited, specs written and run one at a time under the lock, eslint + prettier
clean on all seven files, `tsc --noEmit -p apps/web` shows NO error in a fixes-web file (the only
errors left are the HUB's: `tab-period.tsx` ×8, `fleet-dashboard-fixtures.ts` ×1,
`fleet-dashboard-period-fixtures.ts` ×1). `scripts/check-formal-arabic.mjs` green. No `zz-*` left.

## Files changed (the work = `git diff 53594fd2 -- <file>`)

- `apps/web/src/shared/ui/states/ErrorState.tsx` — answer 4. `diagnostic.code` is never printed (any
  locale). With a `requestId`: one quiet `<p data-error-reference="true" class="text-xs text-slate-400
  dark:text-slate-500">{t('common.error.reference')}: <bdi dir="ltr" class="font-mono">req_…</bdi></p>`.
  No requestId (or `''`), a TypeError, or `null` → no line. Still gates on `hasError(error)`. The
  `font-mono` now sits on the `bdi` only, so `ERROR_ID_AS_FIGURES` (`[&_td_.font-mono]`, VehiclesListPage)
  keeps restyling the id inside the dark tables. (Prettier also wrapped the old over-long title line.)
- `apps/web/src/shared/ui/states/error-state.spec.tsx` — NEW (12 tests).
- `apps/web/src/modules/fleet/lib/licence-months.ts` — fix a: `ar-EG-u-nu-latn` for the month name AND
  the count → «أكتوبر 2026 (12)». Readers unchanged: VehiclesListPage, LicensingPage, NoticesPage
  (its `/ \([^)]*\)$/` count-strip is digit-agnostic).
- `apps/web/src/modules/fleet/lib/month-window.spec.ts` — +4 tests.
- `apps/web/src/modules/fleet/pages/VehicleDetailPage.tsx` — fix b: page-local `latinNumber` (`en-US`),
  `latinDate` / `latinDateTime` (`ar-EG-u-nu-latn` / `en-GB`, same `dateStyle: 'medium'` /
  `timeStyle: 'short'` as the shared helpers, «—» for null/invalid) on every figure and date of the
  body: alarm caption (over/remaining km), «آخر صيانة» date (both paths) and its «عند … كم», «آخر قراءة
  عداد» and «أعلى قراءة … كم», maintenance interval, licence expiry, joined date, created/updated
  footer. `printReport` rows keep the shared `formatDate` (print sheet unchanged). `format.ts`
  untouched; the import is now `formatDate, localized` only. Fix c: `useHistoryCounts` counts accidents
  with `{ vehicleCodes: [code], page: 1, pageSize: 1 }` gated on `code !== ''` (odometer/maintenance
  rule); doc comment updated. Violations still count by id (not in the owner's list).
- `apps/web/src/modules/fleet/fleet-vehicle-profile-alarm.spec.tsx` — pins re-pointed to Latin, each with
  the Arabic-Indic form asserted gone; +3 tests (reading tile with «أعلى قراءة 120,500 كم», overdue
  caption, source check).
- `apps/web/src/modules/fleet/fleet-vehicle-history-links.spec.tsx` — +2 tests (accidents by code).

## i18n — `.wip-notes/followups/i18n/fixes-web.json`

`set`: `common.error.reference` = ar «الرقم المرجعي», en "Reference" (new key; the login message already
names it «الرقم المرجعي»). `remove`: none.

## RED until the HUB merges fixes-web.json — `error-state.spec.tsx`, exactly these 3 tests

1. `the reference words … > «الرقم المرجعي» in Arabic, “Reference” in English` (translate returns the key)
2. `a server failure with a reference … > Arabic: the friendly message and «الرقم المرجعي», …`
3. `a server failure with a reference … > English: “Reference” and the same id, no «INTERNAL»`

The other 9 are green now. Checked: with the key merged (a scratch `zz-` spec mocking `translate` with
the two values, then deleted) all 12 pass — including "the only Latin on the Arabic panel is the id".

## HUB ACTION — a file in no package's list goes red: `pages/vehicles-licence-state.spec.tsx`

Its D25 block pins the car record's reading tile in Arabic-Indic (`const km = (n) => formatNumber(n, 'ar')`),
which fix b changes on purpose. Red now, exactly 2 tests:
- `D25 … > a chain that went backwards: 4,980 under «آخر قراءة عداد», «أعلى قراءة 5,000 كم» under it`
- `D25 … > a healthy chain: the one reading, and the tile’s own hint`

Ready patch (re-point to Latin, at least as strict: adds `km(4980) === '4,980'` and `not.toContain` of the
Arabic-Indic forms): `.wip-notes/followups/handoff/fixes-web-vehicles-licence-state.patch`
→ `cd /home/user/egycash && git apply .wip-notes/followups/handoff/fixes-web-vehicles-licence-state.patch`
(`git apply --check` clean). Verified: the patched copy run as a scratch spec = 20/20 green; prettier clean.

## Spec runs (web, one file per run, under the lock; logs in the scratchpad `followups/fixes-web/`)

| spec | result |
| --- | --- |
| shared/ui/states/error-state.spec.tsx (new) | 9/12 — the 3 above red until merge; 12/12 with the key simulated |
| fleet/lib/month-window.spec.ts | 6/6 |
| fleet/fleet-vehicle-profile-alarm.spec.tsx | 10/10 |
| fleet/fleet-vehicle-history-links.spec.tsx | 14/14 |
| shared/lib/errors.spec.ts | 22/22 |
| fleet/fleet-figures-font.spec.ts | 12/12 |
| fleet/pages/vehicles-licence-state.spec.tsx | 18/20 — the 2 D25 above (HUB patch → 20/20) |
| fleet/fleet-vehicle-card-census.spec.tsx | 79/79 |
| fleet/fleet-alarm-permission.spec.tsx | 9/9 |

## Screenshots (dark, 1920, Chrome 153, real pages over a seeded cache; the merged key served)

`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/fixes-web/shots/`
- `error-state-reference-dark-1920.png` — the car page failing with a real `INTERNAL` envelope: «تعذّر
  التحميل», «تعذّر على الخادم إتمام هذا الطلب.», «الرقم المرجعي: req_7f3c9a12-…», no code.
- `car-page-dark-1920.png`, `car-page-dark-1920-full.png` — every figure and date Latin («120,000 كم»,
  «أعلى قراءة 120,500 كم», «متبقٍ 1,250 كم», «عند 111,750 كم», «10,000 كم», dates, footer); the page
  text holds no Arabic-Indic digit; «3 حادث» from the by-code count (the by-id 2 was seeded too).
- `licence-month-options-open-dark-1920.png` — «السيارات» · «انتهاء الترخيص» open: «نوفمبر 2026 (2)»,
  «ديسمبر 2026 (3)», «يناير 2027 (1)» …

## Seen, NOT touched (not in the owner's list)

- VehiclesListPage's title count «١٥ سيارة» (`t('fleet.vehicles.count', { count: formatNumber(…, locale) })`,
  l.853) is still Arabic-Indic — visible in the month-options picture.
- The car record counts violations by id while its link opens by code (already in the plan).

## Housekeeping note

My first scratch vite start (09:25) used the app's default dep cache and re-optimized
`apps/web/node_modules/.vite/deps` once; I stopped it at once and reran on my own `cacheDir`. If another
package's running dev server then served stale deps, a restart of that server clears it.
