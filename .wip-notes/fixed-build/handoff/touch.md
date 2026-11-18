# hand-off — touch (web)

## STATUS (2026-11-18): DONE, nothing committed by touch

Files (touch's work = `git diff 2b9467a3 -- <these>`), all NEW:
- `apps/web/src/modules/fleet/components/roster/FixedTouchBoard.tsx` — `FixedTouchBoard(FixedTouchBoardProps)`,
  design.md §2 T-1…T-11 on the daily `RosterTouchBoard`'s structure, minus the h1, the stepper, the
  past-day banner, the tabs, the unavailable list, `WorkshopGroup`, the reason-arrival logic and the
  clear confirm. Written for the shell's `PageContainer fullHeight` (no outer padding; the sticky
  header bleeds `-mx-4 px-4 sm:-mx-6 sm:px-6`, the bottom bar `-mx-4 sm:-mx-6`).
- `apps/web/src/modules/fleet/components/roster/fixed-touch-parts.tsx` — `FixedRowBadges`
  («في الورشة» + «معيّنة»/«بلا طقم», the daily `RowBadges` face), `fixedCardMenu(t)` (⋮ «تعديل» /
  «إفراغ الطقم», clear only with `hasDriver`), `fixedTouchFacts(m, armed)` (no flags — Q1),
  `editTitle` («تعديل · {code}»), `missionNotice` (catalog failed / empty line), `NOTE_MAX = 500`,
  `carSelector`, and the daily's three banners as components (`PendingBanner`, `TargetBanner`,
  `SlotHint`, same markup and hooks as the daily inline ones).
- `apps/web/src/modules/fleet/fleet-fixed-roster-touch.spec.tsx` — 77 cases (renders
  `FixedRosterScreen` at phone / portrait / landscape and short).

Hooks on the markup: `data-fixed-touch={layout}`, `data-first-row`, `data-car` (the card),
`data-cars-column`, `data-drivers-panel`, `data-touch-header` (+ `data-sticky`), `data-touch-bottom`,
`data-export="fixed-roster"`, `data-fixed-badges`; the daily pieces keep their own hooks.

Runs (each alone under the flock lock):
- `fleet-fixed-roster-touch.spec.tsx` 77/77 green; together in one run with
  `fleet-roster-picker.spec.tsx` 18/18 (it loads again now that FixedTouchBoard exists — its fixed
  half is green) and the daily `fleet-roster-touch.spec.tsx` 43/43 (unedited).
- `npm run typecheck -w apps/web`: clean (0 errors, the whole app, desk's files included).
- eslint + prettier clean on the three files; `scripts/check-formal-arabic.mjs` clean.
- No assertion needs the HUB's i18n merge: every word is asserted through `t(key)` (before the merge
  `fleet.fixedRoster.poolEmpty` renders and compares as its key; after it, as the Arabic).

## i18n — none
`i18n/touch.json` is `{}`: the touch board uses only existing keys and core's
`fleet.fixedRoster.poolEmpty`.

## To core — D5 browser result: PASS, no fallback needed
Real `FixedRosterPage` in a copy of the AppShell frame (topbar 56px, `main` flex column
overflow-y-auto, the fade-in wrapper, a 64px rail from lg), headless Chrome, DSF 2, light and dark,
with a restored draft so the bar shows:
- 390×844 phone: the filter row sticks at `main`'s top after a scroll (offset 0), the bottom bar sits
  at `main`'s bottom (0) at the top, mid-scroll and the end; no sideways scroll (document and `main`
  overflow-x 0); 1 h1, 1 `data-export="fixed-roster"` (in the first row); no stepper / date box.
- 820×1180 portrait: the header (first row + filter row) sticks (0); bar at the bottom (0); same
  counts; no sideways scroll.
- 1180×820 landscape: `main` does not scroll (scrollHeight = clientHeight); the cars column scrolls
  inside (2761 / 405px); the floating bar 16px above the bottom, as the daily's `pb-4`; same counts.
- 844×390 short (portrait layout, short): nothing on top is sticky (the header scrolls away), the
  bottom bar still sticks (0).
Keep `<PageContainer fullHeight>` at every width as it is.

## To the HUB
1. fleet-vehicle-card-census: NO SKIPPED entry needed. The sweep (`DRAWS_A_CODE`) matches the column
   keys / `.vehicleCode` / the code chips; the touch files draw the code only through the daily
   `CarCard` (`{row.code}`, no hover card — touch has no hover), exactly like the daily
   `RosterTouchBoard` / `RosterCarCard`, which are not listed either. If the census ever catches
   them, the reason is the daily cards' one: "touch cards — the code has no hover card".
2. Owner pictures: a ready harness is saved OUTSIDE the tree, in
   `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/touch-harness/`
   (`zz-fixed-touch.html`, `zz-fixed-touch-main.js` = the real `FixedRosterPage` over a seeded cache
   inside the shell's frame; `?dark=1`, `?draft=1` (a restored draft), `?viewer=1`; `cdp.mjs` = a
   small Chrome DevTools driver, `zz-jobs*.mjs` = the jobs used). To use: copy the two zz files into
   `apps/web/`, `cd apps/web && npx vite --port 5179 --strictPort --host 127.0.0.1`, start
   `google-chrome --headless=new --remote-debugging-port=9333 --no-sandbox --no-proxy-server
   --user-data-dir=<scratch> --hide-scrollbars about:blank`, then `node cdp.mjs 9333 <jobs.json> <out>`;
   delete the two zz files afterwards (gate step 00). The `?page=daily` switch draws `RosterPage`
   but seeds no day — seed one before using it for the daily shots.
   Touch shots already taken (phone / portrait / landscape / short, light + dark, top / scrolled /
   end; phone pool sheet, picker sheet, ⋮ menu, notes sheet, mission sheet, viewer; landscape with a
   target): `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/shots/`
   (`fixed-landscape-*-scrolled/end` were taken before the landscape `-mb-4`, the bar 32px up there).
3. Nothing needed in another package's file.

## Decisions taken here (where design / plan were silent or differed)
- The drivers SHEET (phone / portrait) has the title «السائقون», no subtitle, then the planner's
  hint and the search — no `DriversHeading` (design T-5 and this package's task; plan §4.3 lists
  the heading for "touch sheet/landscape"). The count is on the button that opens it. The
  landscape panel has the heading «السائقون (n)» in the tabs' place. If the owner wants the count
  inside the sheet too, it is one line (`<DriversHeading label=… count={m.pool.length} />` before
  the search in the pool sheet's toolbar).
- The picker sheet's title stays the daily's «تعيين السيارة {code}» (D10), its toolbar the search
  alone; the mission and notes sheets take «تعديل · {code}»; notes subtitle «ملاحظات», cap 500.
- The bottom bar reaches the screen's foot: the phone / portrait board takes back the container's
  bottom padding (`-mb-6`), landscape takes back 16 of its 32px (`-mb-4`) so the floating bar sits
  16px up, as the daily's `pb-4`.
- A workshop car's CARD has no rose face (the daily cards have none either; the rose row tint is the
  desk's); its «في الورشة» badge says it, in code order, unlocked (T10).
- The edited cars' amber card / dot reads `m.unsavedIds` for every reader (a viewer with a restored
  draft sees the amber, as the desk's `data-tint`), but no bar and no control (D13).
- Empty board: «لا توجد سيارات» (`data-empty="board"`); the term alone finds nothing: «لا توجد سيارة
  بهذا الكود»; filters hide everything: «لا توجد نتائج».
- «إفراغ الطقم» (⋮) and ✕ on a seat also drop a landscape target on that car (the daily's ✕ rule).
