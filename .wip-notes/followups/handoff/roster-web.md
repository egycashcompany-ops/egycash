# Hand-off — package `roster-web` (small fixes d, e, f)

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR).

## Status

Done. No commit. No i18n (`i18n/roster-web.json` = `{}`): no word added, changed or removed.
Nothing is red until the merge: every spec this package touched passes on its own.

## Files changed (roster-web's own list only)

- `components/EmployeeName.tsx` — d. The code is now
  `<span className="ms-2 font-figures text-xs text-slate-500"><bdi dir="ltr">{person.code}</bdi></span>`
  (the margin on an element in the page's direction, the code isolated inside it). Before, `ms-2` sat
  on the `dir="ltr"` code span, so the margin went to the code's left = the far side in Arabic.
  Readers that gain the gap: `RosterAssignDialog` (seat + pool options), `DriverFormDialog`
  («السائقون»), and through `DriverName`: `CompanyViolationsDetailLayer`, `DriverViolationsPanel`
  («مخالفات السيارات») and the dashboard's `tab-violations.tsx`. The unknown-id fallback is unchanged.
- `components/roster/roster-parts.tsx` — e. `export const ROSTER_NOTE_MAX = 500` (the API's
  `PlanFleetRosterRowSchema.notes.max(500)`), listed in the header.
- `components/RosterAssignDialog.tsx` — e. `<Textarea … maxLength={ROSTER_NOTE_MAX}>`. Prettier also
  joined the «حفظ» `<Button>` onto one line (the base file was not prettier-clean).
- `components/roster/RosterTouchBoard.tsx` — e. the daily `<NotesSheet maxLength={ROSTER_NOTE_MAX}>`.
  `NotesSheet`'s own default (uncapped) and the fixed `NOTE_MAX` are untouched.
- `components/CatalogSelect.tsx` — f. optional `title?: string | undefined`, default `ariaLabel`
  (every other caller unchanged).
- `components/roster/RosterDeskBoard.tsx` — f. `MISSION_BOX` += ` [&_select]:!truncate` (prefix
  `"mx-auto w-[9.5rem] max-[1535px]:w-36 "` kept, no width touched); new exported
  `missionTitle(missionName, missionTypeId)` = the chosen mission's name, `undefined` (→ the aria
  label) for no mission or a name the catalog does not give yet («—»); the daily cell passes
  `title={missionTitle(m.missionName, row.missionTypeId)}`.
- `components/roster/FixedDeskBoard.tsx` — f. the same `title={missionTitle(…)}` (imported beside
  `MISSION_BOX`).
- `components/roster/FixedCrewDialog.tsx` — header comment l.26-28 only (its own `NameAndCode` face
  and `gap-x-2` stay as approved).

## Specs (one vitest run at a time, under the lock) — all green

| spec | result |
| --- | --- |
| fleet-driver-card.spec.tsx (changed) | 24 passed |
| fleet-daily-roster.spec.tsx (changed) | 160 passed |
| fleet-roster-touch.spec.tsx (changed) | 45 passed |
| fleet-fixed-roster.spec.tsx (changed) | 67 passed |
| fleet-fixed-roster-touch.spec.tsx | 77 passed |
| components/roster/roster-optional-props.spec.tsx («uncapped by default» green) | 25 passed |
| fleet-catalogs-vehicles.spec.tsx | 56 passed |
| fleet-drivers.spec.tsx | 119 passed |
| components/roster/roster-shared.spec.tsx | 30 passed |
| fleet-needs-no-hr-grant.spec.ts | 6 passed |
| lib/fixed-roster-model.spec.ts | 57 passed |
| fleet-maintenance.spec.tsx, pages/receipts-screen.spec.tsx (CatalogSelect / EmployeeName readers) | 85, 41 passed |
| fleet-violations-split.spec.tsx, fleet-violations-period.spec.tsx, fleet-dashboard-tab-violations.spec.tsx (DriverName readers) | 125, 10, 45 passed |

`tsc --noEmit -p apps/web`: errors only in HUB files (tab-period.tsx ×8, the two dashboard fixtures
×1 each — dash-web's pending deletions), none in this package's files. eslint + prettier clean on
every file above. check-formal-arabic green.

What the specs pin:
- driver-card: in ar AND en, `EmployeeName` (card / `card={false}`) and `DriverName` draw
  `name<span class="ms-2 …"><bdi dir="ltr">HR-D1</bdi></span>`, the `ms-2` element has no `dir`, the
  old `… text-slate-500" dir="ltr">HR-D1` is gone; the card still on the name, none on an option, the
  unknown id unchanged; the source never puts `ms-2` on a `dir="ltr"` element.
- fixed-roster: the l.990 pin re-pointed (FixedCrewDialog still its own face + `gap-x-2`; the shared
  file holds the new markup and not the old); new case: the fixed mission select's `title` is the
  mission's name («نقل نقدية», and the long «نقل أموال (يومي) بين الفروع والبنوك»), still with its
  aria label; no mission → `title="151 · نوع المهمة"`; the drawn box carries `[&_select]:!truncate`
  and `w-[9.5rem] max-[1535px]:w-36`.
- daily-roster: `ROSTER_NOTE_MAX === 500`; `PlanFleetRosterRowSchema` takes 500 letters, refuses
  501; the rendered `RosterAssignDialog` has `maxlength="500"` and its mission select keeps the
  default `title="نوع المهمة"`; the dialog's seat / option source draws `EmployeeName`, and that
  renderer in the seat's `text-sm` box shows the gap markup in ar and en; MISSION_BOX starts with the
  pinned prefix, holds the truncate class, and its only width rules are `w-[9.5rem]`,
  `max-[1535px]:w-36` (l.1834 / l.1883 pins and the laptop-fit band census stay green); the daily
  select's `title` is the mission name (short and long), 151 keeps its label; `missionTitle` never
  returns «—».
- roster-touch: the daily `<NotesSheet` passes `maxLength={ROSTER_NOTE_MAX}`; a rendered sheet with
  that cap has `maxlength="500"`.

Two spec mechanics the HUB should know:
- The daily spec now mocks `shared/ui/Dialog` and the touch spec mocks `RosterBottomSheet` (the same
  in-place stand-ins `fleet-fixed-roster.spec.tsx` / `roster-optional-props.spec.tsx` use): the real
  ones portal to `document.body`, which node has none of. Closed, both draw nothing, so every
  existing render in those files is unchanged (all their tests green).
- `RosterAssignDialog` seeds its four fields in an effect on open, which a static render never runs,
  so a rendered dialog shows empty seats: the picked seat's gap is pinned on the shared renderer + the
  dialog's source, and measured in Chrome (below). Not a code change, a note.

Optional, not mine: `roster-optional-props.spec.tsx` l.377 is titled "is the daily «تعيين السيارة
150» · «تعديل التعيين», uncapped" — it tests NotesSheet's default; the daily touch board now passes
the cap. Still true of the component and green; a wording tweak only if the HUB wants it.

## Visual — dark, Chrome 153, both desk boards, mission «نقل أموال (يومي) بين الفروع والبنوك»

The table's scroller (`table.parentElement`, as `useOverflowing` reads it), 16 cars, planner,
classic scrollbars shown. BEFORE = this package's files untouched (measured first); AFTER = the change.

| board | width | before scrollWidth − clientWidth | after | before / after scrollWidth = clientWidth |
| --- | --- | --- | --- | --- |
| daily | 1280×800 | 0 | 0 | 835 / 835 |
| daily | 1366×768 | 0 | 0 | 921 / 921 |
| daily | 1920×1080 | 0 | 0 | 1375 / 1375 |
| fixed | 1280×800 | 0 | 0 | 835 / 835 |
| fixed | 1366×768 | 0 | 0 | 921 / 921 |
| fixed | 1920×1080 | 0 | 0 | 1375 / 1375 |

Every header width identical before and after (1280: 88.7 72.9 153 185 185 59.9 90.5; 1366: 89.6
73.6 154.5 186.8 186.8 138.3 91.4; 1920: 136.5 107.6 231 264.6 272 197.4 166); page overflow 0 at
every width; the select stays 144px (1280, 1366) / 152px (1920).

- The long name: before `text-overflow: clip` → hard cut «نقل أموال (يومى) ا»; after `ellipsis` →
  «نقل أموال (يوم…». Its text is 213.5px in a 110px (1280/1366) / 118px (1920) room.
- The approved «نقل أموال (يومي)» stays WHOLE (105.2px in 110px / 118px, no «…») on both boards at
  1280, 1366 and 1920.
- `title`: before «150 · نوع المهمة», after «نقل أموال (يومي) بين الفروع والبنوك»; a row with no
  mission keeps «153 · نوع المهمة». The native tooltip was captured in a HEADED Chrome under Xvfb
  (the X pointer warped over the select; headless screenshots never draw a native tooltip).
- Daily «تعديل» dialog (1920): the gap between name and code, measured from the name's text box to
  the code's box: OLD markup (rebuilt in the same open dialog) 0px on both seats → NEW 8px on both.
- Notes: the desk dialog took 501 letters typed in one go (CDP `Input.insertText`) as 500, and one
  more key was refused (still 500); the phone's notes sheet (390×844) likewise kept 500 of 501.

Screenshots (`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/roster-web/shots/`):
- before-{daily,fixed}-{1280,1366,1920}.png and …-mission.png (the 150 row) — the hard cut.
- after-{daily,fixed}-{1280,1366,1920}.png and …-mission.png — the «…», same widths.
- after-{daily,fixed}-{1280,1366,1920}-short-mission.png — «نقل أموال (يومي)» whole.
- after-daily-1920-mission-hover.png, after-fixed-1920-mission-hover.png — the hover shows the whole
  name.
- before-daily-dialog-gap.png (old markup) / after-daily-dialog-gap.png — the dialog's gap.
- after-daily-dialog-notes-cap.png (desk), after-phone-notes-cap.png (phone) — 500 letters kept.

The fill text in the two notes-cap shots is one letter repeated (a length test); for the owner's
picture the HUB may prefer a real sentence.

Harness (scratch, for the HUB's owner pictures):
`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/roster-web/harness/`
— `zz-roster.html` + `zz-roster-main.js` (copied into `apps/web/` for a run and removed after;
`?page=daily|fixed`, `?mission=short`, `?dark=1`; the daily day is tomorrow so the board is
plannable), `cdp.mjs` (adds `insertText` / `key` steps), `jobs.mjs` (widths), `jobs-dialog.mjs`,
`jobs-extra.mjs`, `jobs-short.mjs`, `hover.mjs` + `warp.py` (headed Chrome on Xvfb :77 for the
tooltip). Ports used: vite 5191, Chrome 9361 (headless) / 9362 (headed). All processes stopped; no
`zz-roster*` left under `apps/`.

## Open hand-offs

None needed from another package. For the HUB's told list (item 20): the shared gap fix also reaches
the dashboard's «المخالفات» tab (it draws drivers through `DriverName`) — the gap appears there too.
