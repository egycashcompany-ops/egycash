# Review-fix step — hand-off (2026-11-18)

Work = `git diff` of the working tree (then the commit «fix(fleet): «الطقم الثابت» — review fixes»).

Per finding:
- code-F1 (minor) FIXED — daily rule: held-off driver never offered to a seat. `availableFor` drops
  `away` when target !== null; `dialogCandidates` = pool + own crew; FixedCrewDialog no longer
  draws a «سيارة أخرى» badge (nothing to draw). Specs: model spec (new case + updated), desk spec
  CrewCandidates case. Told 24 rewritten; told 16 example changed (race / switched-off profile).
- code-F2 / decisions-F6 FIXED — out-of-scope holder message: «a vehicle outside your scope …»,
  in-scope message byte-for-byte; spec asserts both messages (service-level, same body text).
- code-F3 / decisions-F3 FIXED — comments: daily-roster-board.ts heldOffBoard doc, roster-board.ts
  DRAG_TYPE, i18n.ts counters comment, fixed-roster-board.ts availableDrivers doc.
- code-F4 REJECTED (out of scope, predates PR; needs readDraft overlay first) — noted in pr-body.
- look-L1 (major) FIXED — toast.error(title, reason); new key refusal.title (ar «تعذّر حفظ الطقم
  الثابت», en «Fixed crews not saved»); 11 reasons lost the «تعذّر الحفظ: » prefix, generic = «تعديلاتك
  باقية …». Spec draws the REAL Toaster (useToasts mocked) with the longest line.
- look-L2 / decisions-F1 FIXED — SeatCell optional `nameClassName` (none by default); FixedDeskBoard
  passes `FIXED_SEAT_NAME` from fixed-desk-cells.tsx (a first try put the max-[1365px] literal in
  roster-desk-cells.tsx and broke the daily spec's «no third band» count — moved out). 1280×800: 899>858 before → 858=858 after (two 24-letter names). Panel narrowing was
  tried and dropped (clipped the search placeholder).
- look-L3 FIXED — touch NotesSheet subtitle = fleet.nav.fixedRoster.
- look-L4 FIXED (text) — told 9 says the colour is blue here, amber on the daily.
- look-L5 REJECTED (pre-existing, shared MISSION_BOX = daily change) — pr-body «Left for later».
- decisions-F2 FIXED (reworded) — «(فرع آخر أو سيارة محذوفة)»: the unnamed line is reached for
  another branch's car or a soft-deleted car (an in-scope out-of-service car is named by code).
- decisions-F4 FIXED (note) — vehicle-colour.ts kept on purpose (told 11), pr-body note.
- decisions-F5 FIXED (note) — pr-body «Left for later»: EmployeeName gap, daily notes cap.
- decisions-F7 — zz files were already gone at the start; harness recreated
  (apps/web/zz-vite-real-fx.config.mjs: the REAL app over a mock API, port 5317), removed again;
  a copy is in scratch owner-shots/harness/.

Pictures: scratch owner-shots/*.png (19), list in owner-shots-list.md.

Gate (gate.sh, alone, CI=true): run 1 — 13 web rc=1 (my first L2 try broke the daily
«no third band» spec; fixed by moving the literal to fixed-desk-cells.tsx); run 2 — 12 api rc=1, the
known ATM ExcelJS flake (read-register-workbook control case; passes alone 17/17); run 3 — every
step rc 0 (contracts 53/1334, api 689/11759, web 596/14044), 99 = 22 lines (the uncommitted build).
Commit: 01dab3a482679422980eec3b34fddcf5d54a44ec (signed; author Mohamed Hatem, committer Claude),
«fix(fleet): «الطقم الثابت» — review fixes». Not pushed.
