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
