# HUB hand-off — integration (plan §2 HUB, §5.3)

Base 783c4dae. Ran after P1-P5 (WIP 227d624d holds the packages' work).

## Hand-offs applied

- P1: nothing to merge (step 0 had put `fleet.licenseImage.zoomPercent`); guard (a) keeps the
  `components/ZoomableImage.tsx: ['formatNumber']` allowlist and asserts it is still needed; (f) is
  in the guard as well as in `image-zoom-preview.spec.tsx`.
- P2: `i18n/p2.json` merged — the four flat `fleet.vehicle.count.{odometer,maintenance,accidents,
  violations}` keys removed in both languages (8 lines). Nothing reads them: VehicleDetailPage and
  OdometerPage both go through `pluralKey`; `activeDriver` / `accidentsClean` kept.
- P3: `fleet.odometer.emptyMonth.action` and `fleet.odometer.sameAsPrevious` written in Latin (with
  the rest of the Arabic catalogue edits). The guard reads imports, not the bare word
  `formatNumber` (AlarmBadge's injected prop).
- P4: nothing.
- P5: `platform/localization/formal-arabic.spec.ts` comments only (:86-88, :126) — the letters no
  longer build digits or «٫» from code points; only the tatweel is. Tell-the-owner items are in the
  PR body (letters in English UI too; reprints Latin). Pictures: not taken in this step.

## i18n

- English block diffed against 783c4dae: only −4 flat keys, +20 plural entries with the same text,
  +1 `zoomPercent`. No English value changed.
- Arabic-only: 17 `fleet.*` values with Arabic-Indic digits → Latin (dashboard top/bottom 5, licence
  image hint 10 MB, odometer emptyMonth 12, sameAsPrevious 0, settings intervalHint 0,
  odometerMissingReadingDaysHint 1-30, nine go-live values). One fleet comment «+٢» → «+2».
  `fleet.licenseImage.zoomLevel` keeps '{{value}}٪' (Operations).

## Guard

`apps/web/src/modules/fleet/fleet-latin-figures.spec.ts`, 15 tests, (a)-(g) as §5.3. Extras within
the intent: (a) also catches namespace imports, re-exports and dynamic imports; (c) also refuses
`toLocaleString(undefined…)`, `Intl.X()` with no locale, and a conditional landing on plain 'ar';
(d) also refuses the `٫` escape; (f) parses the opening tag with brace depth and refuses
`latinFigures={false}`. Comment strip avoids `'image/*'` and `https://`. Probed with a planted
`zz-probe.tsx` (shared formatDate, `toLocaleString()`, `'ar-EG'`, `fromCharCode(0x0660+n)`, a
viewer without the prop): (a)(b)(c)(d)(f) all failed as they should; the probe was deleted.

## Other edits (deviations, all comment/title-only)

- `lib/license-expense-memo.ts` comment «٥ سيارات / ١٣ سيارة» → «5 / 13» (the code writes Latin).
- `lib/odometer-range.spec.ts` describe title «اعرض آخر ١٢ شهر» → «12».

## Docs

- CHANGELOG `[Unreleased] › Changed`, newest first.
- `docs/12-planning/fleet-module-design.md`: §12 «Figures: Latin digits in both languages
  (2026-11-23)» + revision 1.27. §10-H3 untouched.
- PR body: `.wip-notes/digits/pr-body.md`.

## Gate (alone, under the lock, first run green)

clean room 0 · secrets 0 · contracts build 0 · lint 0 · typecheck 0 · perm 0 · flags 0 · pages 0 ·
autotpl 0 · formal 0 · contracts 54 files / 1,374 tests · api 711 / 12,234 · web 618 / 14,608 ·
build 0 · audit 0. Summary:
/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits/gate-out/summary.txt

## Not done here

- The owner's dark pictures (plan §6) and the internal Operations «١٠٠٪» picture.
- P5's optional «٫»/«٬» fold in the letter's typed reason (left as the known limit; a `٫` literal
  in code would also trip guard (d)).
