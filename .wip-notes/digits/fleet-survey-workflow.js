export const meta = {
  name: 'fleet-latin-digits-survey',
  description: 'Read-only: find every Arabic-Indic digit an Arabic reader sees in the Fleet module (screens, papers, server text), then a gap critic and a Fleet-only build plan',
  phases: [
    { title: 'Sweep', detail: 'five read-only readers over Fleet' },
    { title: 'Critic', detail: 'mechanisms and sites the sweep missed' },
    { title: 'Plan', detail: 'Fleet-only design, packages with file ownership, specs, pictures' },
  ],
}

const COMMON = `Repository: /home/user/egycash (ECMS monorepo: apps/web React/Vite/Tailwind, RTL, Arabic + English; apps/api Express + Mongoose; packages/contracts shared Zod + helpers).

THIS IS A READ-ONLY TASK. Do not edit, create, move or delete any repository file. Do not run tests, builds, typecheck, lint or npm (16 GB, no swap). Use Read, Grep, Glob and read-only shell (grep, rg, sed -n, cat, wc, find). Tiny node -e Intl probes are fine.

THE OWNER'S RULE (23 November 2026), Fleet module «الحركة» ONLY: in the Fleet screens and Fleet papers, EVERY figure an Arabic reader sees is written in LATIN (English) digits 0-9, never Arabic-Indic ٠-٩: counts, quantities, dates, times, durations, odometer readings and km, percentages, years, months, page numbers, chart labels, money, figures on print sheets and Word/PDF papers (including the custody letters that copy his own Word papers). His words: «اى ارقام خليها بالانجلش حتى لو عربى», «انا عاوزك تعدل حاجات الحركة فقط». English is unchanged. Every OTHER module (HR, ATM, operations, gold, IT, organization, system-admin, platform home) must NOT change behaviour. Identifiers (codes, phones, plates, national ids) and Excel numeric cells are already Latin and stay as they are.

What the code does today (verify): apps/web/src/shared/lib/format.ts formatNumber / formatDate / formatDateTime / formatBusinessDateTime use 'ar-EG' in Arabic, i.e. Arabic-Indic digits; formatMoney / formatAmount / formatMoneyParts use 'ar-EG-u-nu-latn' (Latin). 'ar-EG-u-nu-latn' gives Latin digits with ASCII grouping «154,320.5», percent «85‎%‎», dates «07‏/11‏/2026». translate() in platform/localization/i18n.ts fills {{x}} with String(value) (Latin for a raw number). Fleet already has many Latin helpers (latinNumber, LATIN_DATE, en-US formatters) — a previous read-only survey of Fleet's LATIN sites is at .wip-notes/digits/old-fleet-inventory.json (read it; it lists Fleet helpers and their callers — useful to know which Fleet helpers are already Latin).

YOUR JOB: an exhaustive inventory, for the scope below, of every place where an Arabic reader of a FLEET screen or FLEET paper would see an ARABIC-INDIC digit (or a figure formatted with 'ar-EG' without nu-latn, an Arabic-digit mapping helper such as ai / aiAmount / toArabicDigits / readerDigits, a hard-coded ٠-٩ in source or in an Arabic catalogue value of a fleet.* key, Intl.* / toLocale*String with 'ar' / 'ar-EG' / the UI locale, a shared component that formats internally). For each site: file and line, the screen (page name) or paper, the Arabic label next to it as the reader sees it, the category (count|date|time|duration|reading|percent|year|month|quantity|chart|print|paper|money|other), the mechanism, and the smallest correct change that makes it Latin in Arabic and leaves English byte-identical. When one helper drives many sites, report the HELPER once with its callers (file:line). Also: specs (*.spec.ts/tsx) that pin today's Arabic-Indic digits in Fleet (file:line, what they assert) — they will be re-pointed; and risks (a value parsed back from displayed text, a spec that finds a cell by its text, bidi of dates with '-', a font). Be exhaustive within the scope: go file by file, not just a few greps. Quote Arabic labels exactly.`

const SITE = { type: 'object', properties: {
  file: { type: 'string' }, line: { type: 'number' }, screen: { type: 'string' }, label: { type: 'string' },
  category: { type: 'string' }, mechanism: { type: 'string' }, change: { type: 'string' } },
  required: ['file', 'line', 'screen', 'label', 'category', 'mechanism', 'change'] }
const SCHEMA = { type: 'object', properties: {
  scope: { type: 'string' },
  helpers: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, behaviour: { type: 'string' },
    callers: { type: 'array', items: { type: 'string' } } }, required: ['name', 'file', 'behaviour', 'callers'] } },
  sites: { type: 'array', items: SITE },
  specs: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, asserts: { type: 'string' } }, required: ['file', 'asserts'] } },
  risks: { type: 'array', items: { type: 'string' } },
  filesSwept: { type: 'number' }, notes: { type: 'string' } },
  required: ['scope', 'helpers', 'sites', 'specs', 'risks', 'filesSwept', 'notes'] }

const SCOPES = [
  { key: 'fleet-pages', scope: 'apps/web/src/modules/fleet/pages/** — every Fleet page (registry «السيارات», licensing «التراخيص», notices «الإخطارات», car page, drivers, odometer, maintenance, alarms, accidents, violations, fuel, custody, receipts, licence expenses, contracts, dealership, roster, fixed roster, settings, dashboard page …), including their print buttons and the print sheets they open.' },
  { key: 'fleet-components', scope: 'apps/web/src/modules/fleet/components/** — dashboard tabs (fleet-dashboard/**), roster boards (roster/**), custody parts, fuel boards/dialogs, alarm cards, hover cards, dialogs, panels (CompanyViolationsPanel, DriverViolationsPanel …), charts.' },
  { key: 'fleet-lib-papers-i18n', scope: 'apps/web/src/modules/fleet/lib/**, apps/web/src/modules/fleet/api/**, any Fleet hooks, and every Fleet PAPER (print HTML builders, Word/docx builders such as custody-paper-format.ts / custody-paper-letters.ts, vehicle-print, fleet-report-print, notice-render, license-expense-memo …). ALSO the Arabic catalogue in apps/web/src/platform/localization/i18n.ts: every fleet.* key (and any shared key that only Fleet uses) whose ARABIC value hard-codes Arabic-Indic digits (e.g. «٩٩+», «(١)») — list each key and value.' },
  { key: 'shared-in-fleet', scope: 'Shared and platform pieces that Fleet screens render: grep apps/web/src/modules/fleet/** for imports from shared/** and platform/**, then read each imported component/helper that shows a figure (DataTable, NumberedPager, MultiSelect, ColumnFilterSelect, FilterChips, DateRangePicker / date fields that DISPLAY a value, StatusBadge, ErrorState, toasts, PageHeader, EmptyState, relative-time, plural.ts, CopyIdButton, Dialog …). For each: does it show Arabic-Indic digits to an Arabic reader today? Which Fleet screens use it (file:line)? Which other modules use it? Propose the smallest way to make it Latin ON FLEET SCREENS ONLY without changing other modules (for example an optional prop or a Fleet-local wrapper), or say it already shows Latin.' },
  { key: 'fleet-api', scope: 'apps/api/src/modules/fleet/** and packages/contracts/src/modules/fleet*.ts and any server code that builds Fleet user-facing text: notifications/alerts about Fleet (licence expiry, maintenance alarms, custody), emails, server-built prints/PDF/Word, Excel TEXT cells (dates as text), Arabic error messages with numbers, go-live notes. Report Arabic-Indic digits reaching an Arabic reader of Fleet, and server-side Arabic-digit helpers.' },
]

phase('Sweep')
const res = await parallel(SCOPES.map(s => () =>
  agent(`${COMMON}\n\nSCOPE: ${s.scope}`, { label: `sweep:${s.key}`, phase: 'Sweep', schema: SCHEMA }).then(r => (r ? { ...r, key: s.key } : null))))
const ok = res.filter(Boolean)
const missing = SCOPES.filter(s => !ok.find(r => r.key === s.key)).map(s => s.key)
if (missing.length) log(`No result from: ${missing.join(', ')}`)
log(`Sweep: ${ok.reduce((n, r) => n + r.sites.length, 0)} sites, ${ok.reduce((n, r) => n + r.helpers.length, 0)} helpers`)

phase('Critic')
const covered = ok.map(r => ({ scope: r.key, helpers: r.helpers.map(h => `${h.name} @ ${h.file}`), sites: r.sites.map(x => `${x.file}:${x.line}`) }))
const critic = await agent(`${COMMON}\n\nYOU ARE THE COMPLETENESS CRITIC for the Fleet module. Five readers swept it (scopes: ${SCOPES.map(s => s.key).join(', ')}${missing.length ? `; NOTHING came back for ${missing.join(', ')}, so cover those wholly` : ''}). Find what they MISSED: sweep all of apps/web/src/modules/fleet/** (non-spec) by mechanism — formatNumber(, formatDate(, formatDateTime(, formatBusinessDateTime(, 'ar-EG' without nu-latn, numberLocale / intlLocale style locals, toLocaleString(, toLocaleDateString(, toLocaleTimeString(, Intl.NumberFormat(, Intl.DateTimeFormat(, Intl.RelativeTimeFormat, any helper that maps 0-9 to ٠-٩, U+0660–U+0669 literals, i18n fleet.* Arabic values with ٠-٩, shared components imported by Fleet that format internally, the Fleet server text. Return ONLY sites/helpers NOT already listed, same schema (scope 'critic'). In notes, say which mechanisms are systematic.\n\nALREADY LISTED:\n${JSON.stringify(covered)}`,
  { label: 'critic', phase: 'Critic', schema: SCHEMA })
const all = critic ? [...ok, { ...critic, key: 'critic' }] : ok

phase('Plan')
const plan = await agent(`${COMMON.split('YOUR JOB:')[0]}\n\nYOU ARE THE PLANNER. Below is the inventory (JSON) from six read-only reviewers. Verify the load-bearing claims in the code before relying on them. Write a Markdown build plan for a later multi-agent build where each package owns a disjoint set of files:
1. Approach: how Fleet gets Latin digits everywhere in Arabic WITHOUT changing any other module — e.g. one Fleet-local figures module (apps/web/src/modules/fleet/lib/fleet-figures.ts or reuse/extend an existing Fleet Latin helper) exporting Latin twins of formatNumber / formatDate / formatDateTime (same options and output shape as the shared ones, only the numbering system Latin: 'ar-EG-u-nu-latn'), percent, decimals; every Fleet call site switched to it; shared components either already Latin or given an opt-in prop/wrapper used only by Fleet (say exactly which). Do not change shared defaults.
2. The full list of changes grouped into 4–7 packages with STRICT FILE OWNERSHIP (no file in two packages), each with files, changes, specs to re-point and specs to add. A HUB package last owns i18n.ts (fleet.* values), CHANGELOG, docs/12-planning/fleet-module-design.md, the PR body. Packages write i18n changes as JSON fragments in .wip-notes/digits/i18n/<pkg>.json ({"set":{"key":{"ar":"…","en":"…"}},"remove":[…]}) for the HUB to merge.
3. Two Fleet items in the same PR:
   (a) apps/web/src/modules/fleet/pages/VehicleDetailPage.tsx useHistoryCounts: the «المخالفات» count must equal what its link opens (/fleet/violations?codes=<code>&dcodes=<code>, both halves, old-book rows with vehicleId null and vehicleCode = the car's code). The earlier planner proposed useViolationRollup(undefined, [vehicleCode], enabled) and summing row.totalCount — verify against CompanyViolationsPanel / DriverViolationsPanel and the API (violation.repository.ts, violation.service.ts) that this equals what the two halves show (the company half's count column and the drivers half's rows), or give the exact correct query.
   (b) Arabic number agreement on the car record counts (keys fleet.vehicle.count.odometer|maintenance|accidents|violations, today «3 حادث», «14 عمليات»): use the project's helper apps/web/src/shared/lib/plural.ts (pluralKey) and the house style already used by fleet.custody.count.* (check i18n.ts); give the exact Arabic values for one/two/few/many/other, formal Arabic, digits LATIN («3 حوادث», «14 عملية», «قراءة واحدة», «قراءتان»), and keep «سجل نظيف» for 0 accidents; English unchanged.
4. Risks and handling (values parsed back, specs finding cells by text, bidi, print fits).
5. Specs: re-point list, new specs, and a Fleet guard spec that fails if a Fleet non-spec source formats with the shared Arabic-digit helpers or 'ar-EG' without nu-latn, or a fleet.* Arabic catalogue value contains ٠-٩ (with an allowlist if any must stay).
6. DARK pictures for the owner (about 10–14, Fleet only, Arabic, dark theme): which page, width, what each shows — include «السيارات» title count, «التراخيص», «الإخطارات», the car page with the record counts and «المخالفات» count equal to the opened list, the car print sheet's two dates, a custody paper, the dashboard, odometer, fuel, roster.
7. Anything genuinely ambiguous to ask the owner (keep it minimal; he has answered: all digits Latin in Fleet, identifiers and Excel unchanged).
8. Size estimate.
Be concrete (paths, lines). Return the Markdown plan as your final text.\n\nINVENTORY:\n${JSON.stringify(all)}`,
  { label: 'plan', phase: 'Plan' })

return { inventory: all, missing, plan }
