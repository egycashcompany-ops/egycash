export const meta = {
  name: 'arabic-digits-survey',
  description: 'Read-only inventory of every figure shown in Latin digits to an Arabic reader (money excepted), then a gap critic and an implementation plan',
  phases: [
    { title: 'Sweep', detail: 'one reader per area of the code, read-only' },
    { title: 'Critic', detail: 'find sites and mechanisms the sweep missed' },
    { title: 'Plan', detail: 'design, packages with file ownership, specs, pictures, owner questions' },
  ],
}

const COMMON = `Repository: /home/user/egycash (ECMS monorepo: apps/web is React/Vite/Tailwind, RTL, Arabic + English; apps/api is Express + Mongoose; packages/contracts is shared Zod + helpers).

THIS IS A READ-ONLY TASK. Do not edit, create, move or delete any file. Do not run tests, builds, typecheck, lint or npm (the machine has 16 GB and no swap; another run may be going). Use Read, Grep, Glob and read-only shell (grep, rg, sed -n, cat, wc, find).

THE OWNER'S NEW RULE (22 November 2026): when the user's language is Arabic, EVERY figure shown to the user is written in Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩): counts, quantities, dates, times, durations, odometer readings and kilometres, percentages, years, months, day numbers, page numbers, chart axis/tooltip labels, figures on print sheets. EXCEPT MONEY (currency amounts, balances, prices, costs, fines' amounts, fund figures), which stays in Latin digits grouped with an ASCII comma (1,000), because «١٬٠٠٠» reads as «١٠٠٠». English stays exactly as it is.

What the code does today (verify, do not trust):
- apps/web/src/shared/lib/format.ts: formatNumber / formatDate / formatDateTime use 'ar-EG' in Arabic (Arabic-Indic digits); formatMoney / formatAmount / formatMoneyParts use 'ar-EG-u-nu-latn' (Latin).
- apps/web/src/platform/localization/i18n.ts translate(): fills {{name}} with String(value), so a raw JS number passed as a param shows LATIN digits inside Arabic text.
- Several places force Latin on purpose: 'ar-EG-u-nu-latn' for non-money figures, 'en-US' / 'en-GB' / 'en' locales, latinNumber / LATIN_DATE style helpers, toFixed, String(n), template strings, {n} straight in JSX, manual date/time strings (padStart, toISOString().slice), date-fns/dayjs format, chart tick formatters.

YOUR JOB: an exhaustive inventory, for the scope below, of every place where an Arabic reader would see
 (A) a NON-MONEY figure in LATIN digits (must become Arabic-Indic), or
 (B) a MONEY amount in ARABIC-INDIC digits (must become Latin),
and, classified but NOT to be changed (the owner will be asked):
 (C) identifiers: codes (car code, employee code, ATM id, branch code), phone numbers, national ids, plate numbers, serials, request/reference ids, card numbers (masked), file names, QR/seal values — report each KIND once with one example site, not every occurrence;
 (D) typed input values and editable fields;
 (E) Excel/CSV export cells.
For each A/B site: file and line, the screen (page name), the Arabic label shown next to it as the user sees it, the category (count|date|time|duration|reading|percent|year|month|quantity|chart|print|money|other), the mechanism that decides the digits today, and the smallest correct change. When one helper drives many sites, report the HELPER once (helpers[]) with its callers (file:line) instead of repeating each call as a site; still list a site separately when it bypasses helpers.
Also report: specs (*.spec.ts / *.spec.tsx) that pin today's digits (file:line and what they assert) — they will need re-pointing; and risks (a font that lacks Arabic-Indic glyphs, tabular alignment, a displayed value parsed back into a number, a URL or clipboard value, text sorting, a value compared in a test by its Latin text).
Be exhaustive within the scope: sweep it file by file, not just by a few greps. Quote the Arabic label exactly.`

const SITE = {
  type: 'object',
  properties: {
    file: { type: 'string' }, line: { type: 'number' }, screen: { type: 'string' }, label: { type: 'string' },
    category: { type: 'string' }, kind: { type: 'string', enum: ['A', 'B'] }, mechanism: { type: 'string' }, change: { type: 'string' },
  },
  required: ['file', 'line', 'screen', 'label', 'category', 'kind', 'mechanism', 'change'],
}
const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string' },
    helpers: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, behaviour: { type: 'string' },
      kind: { type: 'string' }, callers: { type: 'array', items: { type: 'string' } } },
      required: ['name', 'file', 'behaviour', 'callers'] } },
    sites: { type: 'array', items: SITE },
    identifiers: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, example: { type: 'string' } }, required: ['kind', 'example'] } },
    inputs: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, note: { type: 'string' } }, required: ['file', 'note'] } },
    exports: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, note: { type: 'string' } }, required: ['file', 'note'] } },
    specs: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, asserts: { type: 'string' } }, required: ['file', 'asserts'] } },
    risks: { type: 'array', items: { type: 'string' } },
    filesSwept: { type: 'number' },
    notes: { type: 'string' },
  },
  required: ['scope', 'helpers', 'sites', 'identifiers', 'specs', 'risks', 'filesSwept', 'notes'],
}

const SCOPES = [
  { key: 'fleet-pages', scope: 'apps/web/src/modules/fleet/pages/** (every page of the Fleet module «الحركة»).' },
  { key: 'fleet-rest', scope: 'apps/web/src/modules/fleet/** EXCEPT pages/ — components/** (fleet-dashboard tabs, roster boards, custody, fuel, alarms, dialogs, print sheets), lib/**, api/**, hooks. Note VehiclesListPage-style figure fonts (ERROR_ID_AS_FIGURES, fleet-figures-font) and whether the figures font has Arabic-Indic glyphs.' },
  { key: 'hr', scope: 'apps/web/src/modules/hr/** (attendance incl. views/view-format.ts and view-charts.tsx and DailySheetPage, leave, recruitment, training, contracts, payroll, loans, medical, performance, settlement, announcements, notification rules, settings).' },
  { key: 'operations', scope: 'apps/web/src/modules/operations/**.' },
  { key: 'atm', scope: 'apps/web/src/modules/atm/** — note that docs/12-planning/atm-efficiency-register.md D7 records an earlier owner decision of Latin digits in both languages for the efficiency register (register-labels.ts); report every place that decision drives, as its own group.' },
  { key: 'it-gold-org-admin', scope: 'apps/web/src/modules/it/**, apps/web/src/modules/gold/** (gold-format.ts, gold-print.ts), apps/web/src/modules/organization/**, apps/web/src/modules/system-admin/** (ActiveUsersPage etc.).' },
  { key: 'platform-shared', scope: 'apps/web/src/platform/** and apps/web/src/shared/** (translate(), format.ts, relative-time.ts, tables, pagination, date pickers, charts, toasts, WelcomePage, notifications bell, approvals, layout), plus apps/web/src/styles.css and the tailwind config: which font families render figures and whether each carries Arabic-Indic glyphs (tabular figures?). ALSO, across ALL of apps/web/src: list every call of t(...) / translate(...) that passes a MONEY value as a raw number param (these would wrongly turn Arabic-Indic if translate() localized numbers), and estimate how many calls pass raw non-money numbers (count by module, give 10 examples).' },
  { key: 'api', scope: 'apps/api/src/** and packages/contracts/src/**: every user-facing text built on the SERVER that carries figures — notifications, emails, SMS, automation templates, server-built print/PDF, Excel/CSV exports, Arabic error messages with numbers, contracts-side shared formatters/labels (e.g. asciiDigits, any Arabic text builder). The A/B rule applies to what reaches an Arabic reader.' },
]

phase('Sweep')
const results = await parallel(SCOPES.map(s => () =>
  agent(`${COMMON}\n\nSCOPE: ${s.scope}`, { label: `sweep:${s.key}`, phase: 'Sweep', schema: SWEEP_SCHEMA })
    .then(r => (r ? { ...r, key: s.key } : null))))
const ok = results.filter(Boolean)
const missing = SCOPES.filter(s => !ok.find(r => r.key === s.key)).map(s => s.key)
if (missing.length) log(`Sweep returned nothing for: ${missing.join(', ')}`)
log(`Sweep: ${ok.reduce((n, r) => n + r.sites.length, 0)} sites, ${ok.reduce((n, r) => n + r.helpers.length, 0)} helpers`)

const covered = ok.map(r => ({ scope: r.key, helpers: r.helpers.map(h => `${h.name} @ ${h.file}`), sites: r.sites.map(x => `${x.file}:${x.line}`) }))

phase('Critic')
const critic = await agent(`${COMMON}\n\nYOU ARE THE COMPLETENESS CRITIC. Eight readers swept the code by area (scopes: ${SCOPES.map(s => s.key).join(', ')}${missing.length ? `; these returned NOTHING and are wholly uncovered: ${missing.join(', ')}` : ''}). Below is what they listed (helpers and file:line of sites). Find what they MISSED across all of apps/web/src and the server's user-facing text: run your own sweeps by mechanism — 'nu-latn', 'en-US', 'en-GB', toLocaleString(, toLocaleDateString(, toLocaleTimeString(, Intl.NumberFormat(, Intl.DateTimeFormat(, Intl.RelativeTimeFormat, toFixed(, String( of numbers in display, .toString() of numbers, padStart( for times/dates, toISOString().slice shown to a reader, template strings with numbers in display text, {count} / {n} / {total} / {length} / .length straight in JSX, t(...) params with raw numbers, chart tickFormatter / label formatters, progress "x / y", pagination "page x of y", file sizes, durations ("3 د"), percent signs, km, kilograms (gold weights), print sheets, window.print HTML builders, PDF builders. Also check modules nobody was assigned (e.g. apps/web/src/modules/* folders not in the scope list) and apps/web/src/main.tsx/store. Return ONLY sites/helpers NOT already listed, in the same schema (scope: 'critic'). In notes, list any mechanism you judge systematic enough to fix centrally.\n\nALREADY LISTED:\n${JSON.stringify(covered)}`,
  { label: 'critic', phase: 'Critic', schema: SWEEP_SCHEMA })

const all = critic ? [...ok, { ...critic, key: 'critic' }] : ok

phase('Plan')
const plan = await agent(`${COMMON.split('YOUR JOB:')[0]}\n\nYOU ARE THE PLANNER. Below is the full inventory from nine read-only reviewers (JSON). Verify the load-bearing claims yourself in the code before relying on them (helpers, translate(), format.ts, fonts). Then write an implementation plan in Markdown, for a later multi-agent build where each package owns a disjoint set of files. Cover:
1. The approach: what changes centrally (for example, translate() mapping a NUMBER param to Arabic-Indic digits in Arabic — but only if money is never passed raw, else list the exceptions to convert first; shared helpers to add or change in shared/lib/format.ts such as a count/percent/time/date formatter; whether formatNumber needs ungrouped years) versus per site; how money stays Latin everywhere (and every B site where money shows Arabic-Indic today becomes Latin).
2. Exactly which sites change, grouped into packages with STRICT FILE OWNERSHIP (no file in two packages), each package with its files, its changes and its specs to re-point/add. Keep packages balanced (about 6–10 packages). A HUB package last owns shared i18n/CHANGELOG/design docs only.
3. Two narrow Fleet items that ride in the same PR: (a) apps/web/src/modules/fleet/pages/VehicleDetailPage.tsx useHistoryCounts: the «المخالفات» count must count exactly what its link opens (/fleet/violations?codes=<code>&dcodes=<code>, both halves, old-book rows with vehicleId null and vehicleCode = the car's code included) — read the violations list API, its query params (does it accept vehicleCodes / codes / dcodes?), and say the exact query to use, or an API change if none matches; (b) the record counts' Arabic number agreement («3 حادث», «14 عمليات», keys fleet.vehicle.count.*): find the project's existing convention for Arabic counted nouns (grep for an Arabic plural helper, Intl.PluralRules, _one/_two/_few/_many keys, and docs/12-planning/atm-settlements-phase1.md §9.9 LIVE-8) and specify the exact Arabic text for n = 0, 1, 2, 3–10, 11–99, 100+ for each of the five rows (readings «قراءة», maintenance visits/operations, accidents «حادث», violations «مخالفة»), in formal Arabic, with Arabic-Indic digits.
4. Risks and how each is handled (fonts without Arabic-Indic glyphs and tabular alignment; values parsed back; URLs/clipboard/CSV must stay Latin; sorting; charts).
5. Specs to re-point (count and the main files) and new specs to add, including a guard spec that fails if a non-money figure is formatted with Latin digits in Arabic again (state how, e.g. a source scan for 'nu-latn' outside the money helpers, with an allowlist).
6. The DARK pictures to take for the owner (page, width, what each shows) — about 12–18, the most-used screens first.
7. Open questions for the owner, each with a recommended answer: identifiers (codes, phones, national ids, plates), Excel cells, typed inputs, the ATM register's D7 «Latin in both languages», anything else the inventory shows is genuinely ambiguous.
8. An estimate of the size (files, sites, specs).
Be concrete (file paths and line numbers). Return the Markdown plan as your final text.\n\nINVENTORY:\n${JSON.stringify(all)}`,
  { label: 'plan', phase: 'Plan' })

return { inventory: all, missing, plan }
