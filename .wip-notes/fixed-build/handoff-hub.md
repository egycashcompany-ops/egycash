# hand-off — HUB (integration)

TEMPORARY (inside `.wip-notes/`). Written 2026-11-18. Status: IN PROGRESS (see the end).

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
