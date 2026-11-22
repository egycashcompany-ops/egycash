# Owner follow-ups (2026-11-22) — build spec

TEMPORARY NOTES — remove `.wip-notes/` before the PR.

## The owner's answers (verbatim) to the six open items

Asked (2026-11-18, after #759):
1. «أرقام الفترة» و«ملخصات»: تشيلهم ولا يفضلوا؟
2. اسم الكارت في «نظرة عامة»: «رصيد العهدة النقدية» ولا «إجمالي العهدة»؟
3. «سجل العهدة»: «سيارتين» بدل «2 سيارات»؟
4. رسالة الغلط اللي بتطلع فيها كلمة إنجليزي («INTERNAL» في ErrorState): أصلّحها؟
5. الصفحة اللي اتعملت بالغلط (artifact): أمسحها؟
6. الحاجات الصغيرة المتسجّلة: أصلّحها؟

Answered (2026-11-22):
- «أرقام الفترة» شيله  → REMOVE the fleet dashboard tab «أرقام الفترة» (key `period`). «ملخصات» (key `summaries`) was NOT
  named: it STAYS as it is.
- اجمالى العهدة → the overview card «رصيد العهدة النقدية» is renamed «إجمالي العهدة» (same figure, same link).
- لا سيبها زى ما هى → «سجل العهدة» keeps «2 سيارات» (no change).
- صلحها → the shared ErrorState must never show the raw English/Latin error code («INTERNAL» etc.) to an Arabic user.
- امسحها → done by the parent (the artifact is deleted).
- صلحهم → fix all the recorded small items:
  a. Arabic-Indic digits in the «شهر انتهاء الترخيص» option counts (shared `monthCountOptions`, `ar-EG` digits, three
     screens incl. the notices month options) → Latin digits like the rest of the system;
  b. the car page (VehicleDetailPage) figures written with `formatNumber` in Arabic-Indic digits → Latin digits, the
     whole page consistently (incl. the reading tile and its «أعلى قراءة» line);
  c. the car record's «الحوادث» count is by vehicle id while its link reads `vehicleCodes` (old-book rows under the code)
     → count by the same rule as the link (as #753 D20(d) did for maintenance), so the number equals the opened list;
  d. daily «تعيين السيارات» «تعديل» dialog: the employee name and code touch in Arabic (`EmployeeName` puts `ms-2` on a
     left-to-right code) → put the gap back (the fixed screen fixed it locally in FixedCrewDialog — prefer one shared fix
     in EmployeeName if every other reader still looks right, else fix the daily dialog locally);
  e. the daily roster notes have no 500-letter cap → the same 500 cap as the fixed screen (the API limit);
  f. the desk mission select (shared `MISSION_BOX`) clips a mission name longer than about «نقل أموال (يومي)» on
     both the daily and the fixed screen → show the whole name (or a proper ellipsis with the full name on hover)
     without breaking the 1280 fit of either table.

## Rules

- Do what the owner said; nothing else. Removing «أرقام الفترة»: every figure that lived ONLY there either already
  has a home on another tab (list it) or is dropped (tell the owner, Egyptian Arabic, Arabic script only). No dead
  link anywhere (link census, hub cards, badges, URL state `?tab=period` → falls back to the default tab), no unused
  server section left behind if nothing reads it (period.service sections only that tab read; keep anything another
  tab or «ملخصات» reads), i18n keys only it read are removed. «ملخصات» untouched.
- Formal Arabic in the UI; Latin digits; ar + en keys; soft delete only; no data change.
- Owner sees DARK pictures only, before the PR: the bar without «أرقام الفترة», the overview card, an error state,
  the licence-month options, the car page, the daily dialog gap, the notes cap, the mission name.

## Standing owner rules

Tell him before a PR (summary + dark pictures). Egyptian Arabic, Arabic script only, no English. Never print PINs;
mask card numbers. Squash-merge on green unless he objects; then unsubscribe, delete the check-in, restart the branch.
