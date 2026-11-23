# Review fixes — verdict per finding

Base 783c4dae; on top of the HUB commit 8f183cc7. The work is still
`git diff 783c4dae -- . ':!.wip-notes'`.

| id | severity | verdict |
|---|---|---|
| code-F1 | minor | **Fixed.** Real: each listed case passed the old guard. |
| code-F2 | minor | **Fixed.** Real gap: only the API spec pinned the equality. |
| code-F3 | nit | **Fixed.** Real: «١٢٫٥» printed «12٫5». |
| code-F4 | nit | **Fixed.** Real: the spec cut a tag at its first `/>`. |
| look-LOOK-1 | major | **Fixed** (text only). Real: the docs added the drivers twice. |
| look-LOOK-2 | minor | **Fixed** (text only, as proposed). Real: the company count is groups. |
| look-LOOK-3 | nit | **Handled in the pictures.** Real, and it predates this work: shot 05 is 1920×1080. |
| look-LOOK-4 | nit | **Not changed.** Real, but out of scope (English words that predate this work). |
| order-F1 | major | **Fixed.** Same as LOOK-1. |
| order-F2 | minor | **Fixed.** The 14 dark pictures are taken in this step. |
| order-F3 | minor | **Fixed** (text). Real: the eight screens changed too. |
| order-F4 | nit | **Fixed** (text). Real: there are ten go-live values. |
| order-F5 | nit | **Fixed** (text). Real: three count lines, and dates. |
| order-F6 | nit | **Kept as disclosed.** The edit is comments only; reverting would leave a false comment. |
| order-F7 | nit | **Not real now.** `apps/web/zz-look/` was already gone when this step began; my own zz files are removed at the end. |
| order-F8 | nit | **Not changed.** Real, but out of scope: only the digits were asked for. |

## code-F1 — the guard, widened (`fleet-latin-figures.spec.ts`, 25 tests)

I planted the reviewer's missed cases in a `zz-probe.tsx`, and every one now fails the guard. The
probe is deleted.

- **(b)** now refuses any quoted Arabic tag that does not end in `-u-nu-latn` (`ar-SA`,
  `ar-u-nu-arab`, `ar-EG-u-nu-arab`), not only `ar-EG`. It also refuses a numbering system other
  than `latn` (`numberingSystem: 'arab'` or one held in a variable, and `'en-u-nu-arab'`).
  - Plain `'ar'` stays with (c), because Fleet compares `locale === 'ar'` everywhere.
  - The NAME_ONLY check now also asserts that each of the five tags is plain `'ar-EG'`.
- **(c)** now reads every digit-writing call: `Intl.NumberFormat`, `DateTimeFormat`,
  `RelativeTimeFormat`, `DurationFormat` and `toLocale(String|DateString|TimeString)`.
  - The first argument must be a quoted tag, a choice between quoted tags, or a `const`/`let`
    that the file binds to one of those. This is how `lib/licence-months.ts` `tag` passes.
  - It refuses no argument, `undefined`, plain `'ar'`, `locale`, `lang`, `intlLocale(locale)`,
    `TAGS[locale]` and `` `ar-${x}` ``.
  - `Intl.PluralRules('ar')` writes no digits and is left alone.
- **(d)** now catches `fromCharCode`/`fromCodePoint` given a hex or decimal Arabic-Indic or
  Persian code point (`1632 + d`), or another character's code point
  (`'٠'.charCodeAt(0) + d`, `zero.codePointAt(0)`). The Latin `fromCharCode(65 + i)` passes.
- **(e)** now also reads every quoted string in Fleet code that is a catalogue key, from any
  namespace (29 non-Fleet keys today, `common.list.count` among them), plus non-`fleet.*` key
  families built as `` `prefix.${x}` `` (there are none today).
- **(h)**, new: no Arabic-Indic or Persian digit, «٪», «٫» or «٬» may be written into Fleet code,
  whether as a literal, a `٠`/`\u{6F0}` escape, a `0x0660` code point, or an HTML entity
  (`&#x660;`, `&#1632;`).
  - Six lines are allowed, by their exact text. Each READS input: the notice-setup fold ×2, the
    plate's digits in `notice-render.ts` ×2, and the letter's two typed-mark folds from F3.
  - The test asserts that each allowed line is still present and still reads: the figure sits in
    a regex character class or lookaround, or in `- 0x0660`.
- **(i)**, new: Fleet may not import a shared component that writes digits in the reader's
  locale.
  - The guard finds these components by reading `shared/` with rules (a) and (b), plus a closure
    over imports, rather than from a fixed list. Today they are `Pagination`, `ListView`,
    `FileUpload` (incl. `FileUploadList`), the `shared/ui` barrel, and the national-id dialog.
  - One import is allowed: `ReconcileUploadCard.tsx` takes `FileUpload`. The test asserts that the
    card renders it only under `file === null ? (`, never renders `FileUploadList`, and writes the
    picked file's size in `en-US`.
  - `platform/` is not read. Its `AppShell` is the chrome around every module, not a Fleet
    screen.
- **(g)** has a synthetic positive and a negative for each new rule.

## code-F2 — the record's count equals the board (`fleet-violations-split.spec.tsx`, +2 tests)

- The `page()` harness gained `codes` and `client`. `codes` seeds the rollup and the drivers list
  under the keys the two halves ask with, and opens `?codes=X&dcodes=X`.
- **Test 1** uses the record test's data: 2026 «×3», plus the old book's 2025 «×1» and one fine.
  - The «إجمالي السيارة» lines read [3, 2], which sum to the record's figure of 5.
  - The drivers' badge equals Σ `driverCount` = 1.
  - Σ «إجمالي الشركة» + the badge = 5, and Σ «إجمالي السيارة» + the badge ≠ 5. This last check
    pins the LOOK-1 arithmetic.
- **Test 2** reads the query cache back.
  - There is exactly one rollup query, `{year:'', vehicleCodes:'200'}`.
  - There is exactly one drivers list. Its params keys are exactly
    `kind, pageSize, paged, sort, sortBy, sortDir, vehicleCodes`, so there is no
    year/collected/from/to/driver/amount/type/set.
  - That list is the seeded one, with data.

## code-F3 — the letter's typed marks

- In `custody-paper-letters.ts`, `reasonOf` runs `asciiDigits`, then replaces «٫» with «.» and
  «٬» with «,», but only between two digits (two named regexes; both lines are allowlisted in
  guard (h)).
- New spec: 'نظير ١٢٫٥ طن و ١٬٢٠٠ لتر' prints '12.5 طن و 1,200 لتر'. The letter text has no
  `[٠-٩۰-۹٫٬]`, and it is identical to the same reason typed in Latin. A lone «٫» outside a figure
  prints as typed.
- (d)'s old `ARABIC_DECIMAL` is now part of (h), with the allowlist by exact line.

## code-F4 — one tag reader

- NEW `apps/web/src/modules/fleet/fleet-source-scan.ts`. It is not a spec, like
  `roster-spec-sources.ts`, and exports `fleetSources`, `stripComments`, `zoomableTags`
  (brace-aware) and `OPTS_IN_LATIN`.
- Its split pattern is `/<(?:ZoomableImage)\b/u`, so the guard's (f) does not read the helper's
  own source as a tag.
- `image-zoom-preview.spec.tsx` and the guard both use it. The zoom spec gained a test where a tag
  holds `fallback={<Icon />}` and `onLoad={() => a > b}` before `latinFigures`, and the next tag
  keeps its own props.

## Text fixes (LOOK-1/order-F1, LOOK-2, order-F3, F4, F5)

- `pr-body.md`:
  - English item 4 and Arabic item 4 now read: the sum of «إجمالي السيارة» = «إجمالي الشركة» +
    the drivers' count. Each driver's fine is already inside «إجمالي السيارة».
  - Arabic item 4 also says that the small count next to the reset button counts lines
    (سنة × سيارة), not violations (LOOK-2).
  - Item 2 is reworded (order-F3).
  - Item 6 now says "ten values" (order-F4).
  - Item 7 is the widened guard.
  - The letter item and the told item 7 add «١٢٫٥» → «12.5».
  - The known-limit note is replaced, and a Deviations note covers the review.
  - The told list is still Arabic script only, 14 items.
- `CHANGELOG.md`:
  - The same count arithmetic.
  - "kilometres and dates"; "the three count lines of each group" (order-F5).
  - The letter's marks and the guard's wider rules.
- `docs/12-planning/fleet-module-design.md` §12: the guard's rules (b)-(i), the reader file, and
  the new exceptions (the six reading lines, the reconcile picker).
- Count comments use the board's labels:
  - `pages/VehicleDetailPage.tsx`: «إجمالي السيارة».
  - `fleet-vehicle-history-links.spec.tsx`: the describe comment.
  - `handoff/p2.md:164`.

## Not changed

- LOOK-4: the English words on Arabic Fleet screens («PIN», «ISSI», «TETRA», «JPEG …», «Excel» /
  «PDF») predate this work.
- order-F8: «اعرض آخر 12 شهر» (it should be «شهرًا»). This belongs to the optional §7 follow-up.
- order-F6: the `formal-arabic.spec.ts` comment stays, and it is listed in Deviations.

## Files changed in this step

- `apps/web/src/modules/fleet/fleet-latin-figures.spec.ts`
- NEW `apps/web/src/modules/fleet/fleet-source-scan.ts`
- `apps/web/src/modules/fleet/image-zoom-preview.spec.tsx`
- `apps/web/src/modules/fleet/fleet-violations-split.spec.tsx`
- `apps/web/src/modules/fleet/lib/custody-paper-letters.ts` and its spec
- `apps/web/src/modules/fleet/pages/VehicleDetailPage.tsx` (comment)
- `apps/web/src/modules/fleet/fleet-vehicle-history-links.spec.tsx` (comment)
- `CHANGELOG.md`
- `docs/12-planning/fleet-module-design.md`
- `.wip-notes/digits/pr-body.md`
- `.wip-notes/digits/handoff/p2.md`
- `.wip-notes/digits/handoff/fix.md`
- `.wip-notes/digits/owner-shots-list.md`

## Gate (alone, under the lock, first run green; HEAD f975c0ca = the parent's WIP of these fixes)

clean room 0 · secrets 0 · contracts build 0 · lint 0 (172 s) · typecheck 0 · perm 0 · flags 0 ·
pages 0 · autotpl 0 · formal 0 · contracts 54 files / 1,374 tests · api 711 / 12,234 · web 618 /
14,622 (+14: guard +10, split +2, zoom +1, letters +1) · build 0 · audit 0 · git status 0. Summary:
/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits/gate-out/summary.txt

## The owner's pictures (plan §6 items 1-14; 15 skipped)

Dark, Arabic, device scale 2, 1440×900 unless noted, the real pages served by Vite on 5318 with a
mocked API (the review's harness, copied to `apps/web/zz-look/`, now deleted). In
/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits/owner-shots/;
captions in `.wip-notes/digits/owner-shots-list.md`.

- 19 files: 01-14, plus 07b (the settle letter), 10b/10c (the dialog's hint, then the zero-km
  warning), 11b (the PDF sheet) and 13b (the counter warning).
- A text scan of every page found no Arabic-Indic digit or mark.
- Car 200's record reads «1,234 قراءة · 14 عملية · 3 حوادث · 7 مخالفات · سائق نشط» (1440×1700).
- 05 is at 1920×1080 (LOOK-3). Its «إجمالي السيارة» lines are 1, 3, 3, its «إجمالي الشركة» lines
  are 0, 3, 2, the drivers' badge is 2 and the group count is 3, so 7 = 5 + 2.
- The mock was changed in three places:
  - the drivers list now carries `outstandingAmount`, so «إجمالي السائقين» is not «—»;
  - the licence image is a neutral drawing with no figures, because the insurer form used before
    shows its Arabic-Indic hotline;
  - 08's reason is typed in Latin, so no Arabic-Indic digit appears even in the input box (the
    fold itself is pinned by the letters spec).
- 06 is clipped to the data table.
- Internal (not for the owner): Operations' shipment receipt viewer still reads «١٠٠٪»
  (/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits/internal-shots/internal-ops-receipt.png).
- The fuel PDF shows the mock's all-zero card numbers. The PIN is masked on the board.
