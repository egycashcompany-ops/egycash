# hand-off — HUB (integration)

TEMPORARY (inside `.wip-notes/`). Written 2026-11-18. Status: DONE — gate run 2 green, commit 035ef175.

## Done
- i18n merge (`apps/web/src/platform/localization/i18n.ts`): 19 keys ×2 (core 13 + desk 6; touch
  `{}`, api `{}`), en after `'fleet.fixedRoster.counter.uncrewed'`, ar after the same key, each
  block headed by a one-line comment. Script: scratch `fixed-build/merge-i18n.mjs`.
- Dead keys removed (ar + en), each grep-checked as unreferenced in the whole repo:
  `fleet.fixedRoster.subtitle`, `.summary`, `.driversHint`, `.removeDriver`, `.unsaved`.
- Census specs re-pointed at `components/roster/FixedDeskBoard.tsx`:
  - `fleet-sort-arrows.spec.tsx` «offers both rosters the code and the state» (the rank and
    DEFAULT_SORT loops stay on `pages/FixedRosterPage.tsx`);
  - `fleet-vehicle-card-census.spec.tsx` WIRED entry (pins
    `<VehicleHoverCode vehicleId={row.vehicleId} code={row.code} focusable={false}`) and the
    hover-only list; no SKIPPED entry for the touch cards (touch: the sweep does not catch them);
  - `lib/vehicle-code-selectors.spec.ts` sorted list.
- `lib/roster-board.ts`: the one stale comment («as the fixed roster badges him») → «badged «سيارة
  أخرى»». Comment only (core's hand-off item 3).
- `fleet-fixed-roster.spec.tsx` (desk's): the «five forms, no Latin letter» case asserted on the
  UNFILLED template (`{{count}} سيارات` holds the Latin `count`) — it now fills the placeholder
  (`{ count: 7 }`) and also refuses braces. The claim is kept (and tightened).
- `CHANGELOG.md` [Unreleased] → ### Changed: the entry at the top of the section.
- `docs/12-planning/fleet-module-design.md`: §4.5b rewritten as built; row 1.25 (2026-11-18).
- PR body draft: `.wip-notes/fixed-build/pr-body.md` (Verification filled after the gate).

## Gate notes
- Step 04 (`npm run lint`) ran its ROOT eslint over `.wip-notes/fixed-build/workflow.js` (a
  workflow script with harness globals) and stopped there (`&&`), so apps/api and apps/web were
  never linted. `.wip-notes/` does not exist in the PR (removed before it), so the gate's lint
  step mirrors CI with `--ignore-pattern ".wip-notes/**"` on the root pass; apps/api and apps/web
  are linted exactly as `npm run lint` does.

## Gate run 1 (HEAD d508fcd7, 08:54–09:25 UTC) — summary-run1.txt in scratch gate-out/
- 00 cleanroom 0 · 01 0 · 03 0 · 04 lint rc=1 (the `.wip-notes/fixed-build/workflow.js` problem
  above — apps were never reached) · 05–11 0 · 12 api rc=1: ONE case, 1/11759, in
  `src/modules/atm/register/import/read-register-workbook.spec.ts` «ExcelJS read directly WOULD
  spill this fixture (control)» — `TypeError … reading 'sheets'` inside ExcelJS's stream reader
  under the full-suite load (a race in the CONTROL leg: a worksheet entry parsed before
  `xl/workbook.xml`). Not this PR's code (ATM, untouched); passes 3/3 alone
  (`--maxWorkers=1`, logs `atm-workbook-{1,2,3}.log`). · 13 web 0 (596 files, 14039 tests) ·
  14 build 0 · 15 audit 0 · 99 git-status 0 lines (the parent's WIP commit d2e8b7af holds the tree).
- Lint re-run alone with the notes folder ignored on the root pass: rc 0 (one pre-existing
  warning in HR's ChangeCodeDialog.tsx).
- gate.sh step 04 now mirrors CI without the notes folder (see «Gate notes»).

## Owner pictures (dark, DSF 2) — scratch fixed-build/owner/
fixed-dark (desk company 1920), fixed-branch-dark (desk, 8 cars: «8 سيارات», the held-off driver
under «معيّنون على سيارات أخرى»), fixed-edit-dark (the pen dialog «تعديل · 150»), fixed-tablet-dark
(1180×820), fixed-tablet-portrait-dark (820×1180), fixed-phone-dark (390×844),
fixed-phone-sheet-dark (the drivers sheet: no date, no «متاح», «سيارة أخرى»), fixed-draft-dark (the
save bar), fixed-1366-dark (5 full rows — told 25); the daily twins daily-dark, daily-branch-dark,
daily-tablet-dark, daily-tablet-portrait-dark, daily-phone-dark, daily-phone-sheet-dark,
daily-1366-dark (the daily unchanged: stepper, «السائقون المتاحون / غير المتاحين», «متاح», its count
«8 سيارة» as before). Harness: scratch fixed-build/owner-harness/ (zz files copied into apps/web
only while shooting, removed after).

## Gate run 2 (HEAD d2e8b7af, 09:31 UTC) — summary.txt in scratch gate-out/
Every step rc 0: 00 cleanroom 0 lines · 01 · 03 · 04 lint (183s) · 05 typecheck · 06 · 07 · 08 ·
09 · 10 formal · 11 contracts (53 files) · 12 api (689 files, 1436s — the ATM control case passed)
· 13 web (596 files, 14039 tests) · 14 build · 15 audit · 99 git-status 0 lines.

## Commit
`035ef175` (signed, author Mohamed Hatem, committer Claude) — EMPTY: the parent's WIP commit
d2e8b7af had already recorded every build file, so `git add -A -- . ':!.wip-notes'` staged
nothing; the commit carries the build's message and marks the green gate. Not pushed.
