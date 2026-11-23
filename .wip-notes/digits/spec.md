# Owner answers 2026-11-22 (after #767 merged) — the work of the next PR

Owner's words (verbatim):
- On Q1 (print sheet's two dates) and Q2 (title counts on «السيارات», «التراخيص», «الإخطارات»):
  «اى حاجه قدام عامل السيستم عربى كل حاجه تبقى عربى»
- Q3 (violations count in the car record): «مش فاهم» → re-asked plainly → answer «أيوه صلحها»:
  the «المخالفات» count in «سجل السيارة» must count exactly what its link opens (incl. old-book
  rows on the car's code), like «الحوادث» in #767.
- Q4 (count grammar in the car record, «3 حادث», «14 عمليات»): «اه» → fix the Arabic number agreement.
- Scope question asked (AskUserQuestion) «الأرقام كمان؟ … في كل الشاشات؟» → answer:
  «كل الأرقام عربي ما عدا الفلوس (اقتراحي)» = in Arabic, every figure on every screen in
  Arabic-Indic digits (counts, dates, times, readings/km, percents …), MONEY stays Latin
  (1,000 — because «١٬٠٠٠» reads «١٠٠٠»). This reverts #767's a (licence months) and b (car page)
  to Arabic digits.

Open (to ask with the plan): identifiers (car codes, employee codes, phones, national ids, plates),
Excel numeric cells, typed input values, the ATM register's D7 «Latin in both languages».

Standing rules: summary + DARK pictures before the PR; Arabic-only messages to the owner; soft
delete; no data change; never print PINs; mask cards; memory rule (one vitest at a time).

Survey workflow: run wf_e3ea191c-e5c (read-only; copy of the script beside this file). Journal: /root/.claude/projects/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/subagents/workflows/wf_e3ea191c-e5c/journal.jsonl

## Owner answers 2026-11-22/23 (AskUserQuestion)
- Identifiers (car code 21, employee code, mobile, national id, plate, ATM code): «تفضل زي ما هي (اقتراحي)» → unchanged, as written.
- Excel exports' numbers: «تفضل زي ما هي (اقتراحي)» → real numeric cells, unchanged.

## !!! REVERSAL — owner answers 2026-11-23 (AskUserQuestion, three questions) — THIS IS THE RULE NOW
- On the thousands mark for big non-money figures: «لا اى ارقام خليها بالانجلش حتى لو عربى»
- On his own papers writing money in Arabic-Indic (custody Word letters, Form 1 wages): «اى ارقام بالانجلش»
- On gold weights: «اى ارقام بالانجلش»
=> EVERY figure is in LATIN (English) digits even in Arabic: counts, dates, times, readings, percents,
   years, money, papers (custody letters, Form 1, ID card …), gold weights. The earlier
   «كل الأرقام عربي ما عدا الفلوس» is superseded. The plan.md / survey (Arabic-Indic direction) is
   OBSOLETE except its helper map, the B sites (money in Arabic-Indic → Latin), the two Fleet items
   (violations count by rollup; plural agreement) and the risks on parse paths.
- Q1 print-sheet dates → Latin. Q2 title counts on «السيارات»/«التراخيص»/«الإخطارات» → Latin.
- Identifiers and Excel stay as they are (already Latin numbers); Excel text dates that come from
  formatDate will follow the shared helper → Latin (consistent with «اى ارقام بالانجلش»; tell owner).

## Owner 2026-11-23: «انا عاوزك تعدل حاجات الحركة فقط» => FLEET ONLY. Other modules (HR Form 1, gold, ATM, ops, shared defaults) untouched.

Fleet-only Latin survey: run wf_ee99103d-d7c (task wg2p99bee); script copy fleet-survey-workflow.js; journal /root/.claude/projects/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/subagents/workflows/wf_ee99103d-d7c/journal.jsonl

BUILD workflow: run wf_ef70aa41-c58 (task w10l021t9), BASE 783c4dae; script copy build-workflow.js; journal /root/.claude/projects/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/subagents/workflows/wf_ef70aa41-c58/journal.jsonl. Resume with resumeFromRunId. Do not touch the tree while gate.sh runs (pgrep -f gate.sh).
