export const meta = {
  name: 'fleet-latin-digits-build',
  description: 'تنفيذ: كل الأرقام في الحركة بالإنجليزي حتى بالعربي، وعدد المخالفات في سجل السيارة، وصيغة العدد، ثم الفحص الكامل والمراجعة والصور الغامقة',
  phases: [
    { title: 'التجهيز', detail: 'ملف الأرقام المشترك للحركة والكلمات الجديدة' },
    { title: 'التنفيذ', detail: 'خمس حزم بالتوازي' },
    { title: 'الدمج', detail: 'الكلمات والحارس والسجل والفحص الكامل حتى ينجح' },
    { title: 'المراجعة', detail: 'مراجعة الكود والشكل والطلبات' },
    { title: 'تصليح الملاحظات', detail: 'التصليح والفحص الكامل والصور الغامقة' },
  ],
}

const W = '/home/user/egycash'
const N = W + '/.wip-notes/digits'
const SP = '/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits'
const BASE = '783c4dae'
const DIFF = `git -C ${W} diff ${BASE} -- . ':!.wip-notes'`

const COMMON = `
CONTEXT. ECMS monorepo. TREE = ${W} (branch claude/fleet-progress-status-yvgr3f; ${BASE} has the same tree as main aabe8993; on top only WIP commits adding the temporary folder .wip-notes/; node_modules installed; contracts built). packages/contracts Zod, apps/api Express+Mongoose (integration specs on mongodb-memory-server), apps/web React 18 + Vite + Tailwind, RTL Arabic, light + dark.
THE ORDER (read fully before anything): ${N}/spec.md — the owner's words; THE RULE NOW is the «REVERSAL» section and the last line: in the FLEET module «الحركة» ONLY, every figure an Arabic reader sees is in LATIN digits 0-9 (counts, dates, readings, percents, money, papers incl. the custody Word letters); nothing outside Fleet changes behaviour; identifiers and Excel numeric cells unchanged; plus (a) the car record's «المخالفات» count equals what its link opens and (b) Arabic number agreement on the car record counts. THE BUILD SPEC is ${N}/fleet-plan.md (verified by a planner; follow it exactly, section by section; where the code disagrees with it, trust the code, do the correct thing within the same intent and write the deviation in your hand-off). Ignore ${N}/plan.md (obsolete, the opposite direction). The inventory ${N}/fleet-inventory.json lists every site with file:line.
NOTES LIVE IN THE TREE: hand-offs in ${N}/handoff/<id>.md, i18n fragments in ${N}/i18n/<id>.json as {"set":{"<key>":{"ar":"…","en":"…"}},"remove":["…"]}. Screenshots and big logs go to ${SP}/. The parent may make signed WIP commits at any time: the work = \`${DIFF}\`; never revert, reset or amend those commits.
RULES: edit only inside ${W}. Never push, never open or touch a PR, never publish anything. Do NOT commit unless your step says so. Do not edit apps/web/src/shared/lib/format.ts, translate() or any shared/platform component; outside apps/web/src/modules/fleet/** touch only what the plan names. Formal Arabic in the UI (scripts/check-formal-arabic.mjs). No English shown to Arabic users. Never print card numbers or PINs. Soft delete only; no data change. Keep layering rules, permission keys and spec conventions. Never skip/disable a test or weaken a spec (re-point to exact strings). New committed files never zz-; zz-* scratch is git-excluded and must be gone at the end.
MEMORY RULE (16 GB, no swap, other agents run in parallel): EVERY vitest run and EVERY typecheck goes through one machine-wide lock, e.g. \`cd ${W}/apps/web && flock /tmp/ecms-heavy.lock npx vitest run <one spec file>\`, \`cd ${W} && flock /tmp/ecms-heavy.lock npm run typecheck -w apps/web\`, API specs \`cd ${W}/apps/api && flock /tmp/ecms-heavy.lock npx vitest run <file> --maxWorkers=1\`. One spec file per run (a few files of the same package in one run is fine). eslint/prettier on single files need no lock. If the harness refuses a file write, put the text in your final answer instead.`

phase('التجهيز')
const step0 = await agent(`${COMMON}

YOUR JOB (STEP 0, alone, short): (1) create apps/web/src/modules/fleet/lib/fleet-figures.ts exactly as the plan §1.1 (latinNumber, latinDate, latinDateTime; header comment with the owner's words). (2) In apps/web/src/platform/localization/i18n.ts ADD (do not remove anything yet) the new keys the packages need: fleet.licenseImage.zoomPercent (ar and en '{{value}}%'), and the five plural forms .one/.two/.few/.many/.other of fleet.vehicle.count.odometer|maintenance|accidents|violations in ar (the plan §3(b) table, formal Arabic, Latin digits via {{count}}) and en (each form = today's English string exactly) — check how fleet.custody.count.* is laid out and how shared/lib/plural.ts pluralKey builds key names, and match it; keep the four flat keys for now. (3) Run eslint/prettier on the two files and the formal-Arabic check (node scripts/check-formal-arabic.mjs), and the typecheck of apps/web under the lock. Write ${N}/handoff/step0.md (what you added, exact key names). Do not commit. Report.`, { label: 'تجهيز', phase: 'التجهيز' })

const PKGS = [
  { id: 'p1', text: `P1 FIGURES and IMAGE VIEWERS (plan §2 P1): the fleet-figures spec, ZoomableImage latinFigures opt-in prop (default = today, Operations unchanged), the nine Fleet hosts, DriverLicenseImage/ReceiptImageCell/DealershipImageCell dates, image-zoom.ts comment, image-zoom-preview.spec.tsx additions (keep the Operations «١٠٠٪» case). Your i18n fragment p1.json only if step 0 missed something.` },
  { id: 'p2', text: `P2 CAR RECORD and REGISTRY SCREENS (plan §2 P2 and §3): VehicleDetailPage (lift the local Latin helpers to lib/fleet-figures, print sheet dates, useHistoryCounts with useViolationRollup summing totalCount, plural countTag with pluralKey and latinNumber), VehiclesListPage, LicensingPage, NoticesPage, DriversListPage, DriverProfilePage, AttendancePage, AccidentsPage, AccidentTransferLogDialog, and their specs (fleet-vehicle-history-links incl. the 3(a)/3(b) tests, fleet-vehicle-profile-alarm, licensing-screen, fleet-drivers), plus the API integration spec apps/api/tests/integration/fleet-vehicle-violation-count.spec.ts (read nearby integration specs for the harness; run it alone with --maxWorkers=1 under the lock). i18n fragment p2.json: only "remove" of the four flat fleet.vehicle.count.* keys (the HUB removes them last) and anything step 0 missed.` },
  { id: 'p3', text: `P3 ODOMETER, WORKSHOP, ALARMS, MAKES (plan §2 P3): OdometerPage (incl. the toolbar count through the same pluralKey forms as the car record), MaintenancePage, MaintenanceAlarmsPage, RecordOdometerDialog, MaintenanceDialogs, VehicleTypesTable, and their specs (fleet-odometer, fleet-maintenance, fleet-maintenance-alarms, fleet-workshop-odometer-warning, optionally fleet-maintenance-integration).` },
  { id: 'p4', text: `P4 VIOLATIONS and REGISTER SHEETS (plan §2 P4): CompanyViolationsPanel, CompanyViolationsDetailLayer, DriverViolationsPanel, DealershipPage, DealershipInvoiceDialog, ReceiptsPage, CustodyPage, FuelCardsPage, FuelChargingPage, LicenseExpensesPage, VehicleContractsExport, and their specs (fleet-violations-split, receipts-screen; registers-parity must stay valid).` },
  { id: 'p5', text: `P5 CUSTODY LETTERS (plan §2 P5): custody-paper-format.ts (drop ai/aiAmount/AR_ZERO/AR_DECIMAL, tatweelDate Latin), custody-paper-letters.ts (grouped amounts, Latin serials and date lines, typed reason folded with asciiDigits), comments in custody-paper-wording.ts and CustodyChargeDialog.tsx, and the specs (custody-paper-format, custody-paper-letters incl. the typed-reason test and the inverted «Latin digits only» guard, custody-papers, custody-fund-dialogs, custody-papers-setup).` },
]

phase('التنفيذ')
const built = await parallel(PKGS.map(p => () => agent(`${COMMON}

STEP 0 REPORT: ${JSON.stringify(step0)}

YOUR JOB: package ${p.id}. ${p.text}
You own ONLY the files your package lists in the plan (plus new spec files you create). A file outside your list needs a change → write it in ${N}/handoff/${p.id}.md for the HUB; do not edit it. Do not edit i18n.ts (fragments only). Also sweep every file you own for any Arabic-Indic figure the plan missed (formatNumber/formatDate from shared, 'ar-EG' without -u-nu-latn on digits, toLocale*String, ٠-٩ literals) and fix it the same way. Update the comments in your files that state the old Arabic-digit rule. Run eslint + prettier on your files and specs, then your specs and the existing specs of files you touched (under the lock, one file per run), then the apps/web typecheck under the lock. Notes to ${N}/handoff/${p.id}.md (files changed, deviations from the plan, spec results, open hand-offs). Do not commit. If a file you own already holds edits from an earlier cut-off run, read them first and finish. Report files changed, specs and results, open hand-offs.`, { label: 'تنفيذ:' + p.id, phase: 'التنفيذ' })))

phase('الدمج')
const hub = await agent(`${COMMON}

STEP 0: ${JSON.stringify(step0)}
PACKAGES: ${JSON.stringify(built)}

YOUR JOB (HUB + INTEGRATION, plan §2 HUB and §5.3): (1) apply every hand-off in ${N}/handoff/*.md; (2) merge every ${N}/i18n/*.json into i18n.ts, remove the four flat fleet.vehicle.count.* keys in both languages once nothing reads them, and do the Arabic-only catalogue edits of the plan (every fleet.* Arabic value with ٠-٩ to Latin; keep fleet.licenseImage.zoomLevel '{{value}}٪' for Operations); check every English value is unchanged; (3) write the guard apps/web/src/modules/fleet/fleet-latin-figures.spec.ts exactly as §5.3 (a)-(g); (4) CHANGELOG.md entry (house style, newest [Unreleased] section) and docs/12-planning/fleet-module-design.md subsection «Figures: Latin digits in both languages (2026-11-23)» with a revision line (match the doc's revision style); (5) PR body draft ${N}/pr-body.md with the sections of the last PR (read the merged #767 style from \`git log -1 --format=%B aabe8993\` and the CHANGELOG): What & why / ما يجب أن يعرفه صاحب الطلب (numbered, Egyptian Arabic, ARABIC SCRIPT ONLY — no Latin letters at all; Latin numerals are fine; include the plan §7 tell-items: Excel text dates now Latin in the same order, his custody letters now print English digits, the browser date boxes follow the browser language, the insurer form's printed box cannot change, the odometer screen count wording changed with the car record, nothing outside «الحركة» changed) / Scope / Review checklist (Development Workflow §4) / Verification / Notes for reviewers; end the body with exactly these three lines after a line with ---:
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
(6) Run the FULL gate ALONE: wait until no other vitest/tsc runs (pgrep -f vitest; pgrep -f tsc), then \`flock /tmp/ecms-heavy.lock bash ${N}/gate.sh\` (summary in ${SP}/gate-out/summary.txt). Fix every failure inside scope, re-run the failing step alone, then the whole gate again, until every rc is 0 and the clean-room line is 0. (7) Commit everything (the work and the .wip-notes notes) as ONE signed commit: GIT_AUTHOR_NAME="Mohamed Hatem" GIT_AUTHOR_EMAIL="hatem27slama78@gmail.com" GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git commit -S -m "feat(fleet): every figure in Latin digits, the car record's violations count and count wording" with a short body and the trailers
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
Never push. If the tree or WIP commits already hold a hub run's edits from a cut-off earlier run, read them first and finish. Report: commit sha, gate results per step, files changed, items not done.`, { label: 'دمج', phase: 'الدمج' })

phase('المراجعة')
const FIND = { type: 'object', properties: {
  verdict: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor', 'nit'] }, file: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['id', 'severity', 'claim', 'fix'] } } },
  required: ['verdict', 'findings'] }
const LENSES = [
  { key: 'code', text: `CODE lens: review the work (\`${DIFF}\`) for correctness: no Arabic-Indic figure left anywhere in Fleet screens/papers (sweep apps/web/src/modules/fleet/** yourself: shared formatNumber/formatDate imports, ar-EG on digits, toLocale*, ٠-٩ in source and in fleet.* Arabic catalogue values), English byte-identical, NOTHING outside Fleet changed in behaviour (Operations still «١٠٠٪» in the image viewer; shared format.ts untouched), machine values (URLs, data-*, Excel numeric cells, inputs) still raw, the violations count equals both halves of the opened board (company totalCount sums incl. old-book rows), the plural forms right for 0/1/2/3/11/100/103/1234 with «سجل نظيف» kept, the custody letters Latin and their pagination unchanged, the guard spec really bites, specs re-pointed to exact strings not loosened, lint/typecheck clean.` },
  { key: 'look', text: `LOOK lens: render the REAL pages with a mocked API (git-excluded zz files only, port 5318, strictPort, 127.0.0.1; Playwright and Chromium preinstalled: require('playwright'), chromium.launch() with no options) and shoot DARK at deviceScaleFactor 1 into ${SP}/look/: «السيارات» title count, «التراخيص», «الإخطارات», the car page (record counts with plural forms, «المخالفات» count) and its print sheet dates, the violations board opened from that link (company + drivers halves summing to the count), a custody letter preview, odometer toolbar and record dialog, maintenance exit dialog, fuel cards board, an image viewer zoom readout, the dashboard and roster as controls; and Operations' shipment receipt image viewer (must still read «١٠٠٪»). Report anything Arabic-Indic, broken bidi, wrapped/overflowing text, a wrong plural, or an English word on an Arabic screen.` },
  { key: 'order', text: `ORDER lens: check the work against ${N}/spec.md (the REVERSAL rule and «الحركة فقط») and ${N}/fleet-plan.md item by item: each done exactly as asked and nothing more (no change outside Fleet; identifiers and Excel numbers unchanged), the two car-record items done, the told list in ${N}/pr-body.md true and complete and in Arabic script only (no Latin letters), CHANGELOG and the design-doc subsection accurate, formal Arabic in every new value.` },
]
const reviews = await parallel(LENSES.map(l => () => agent(`${COMMON}

HUB REPORT: ${JSON.stringify(hub)}

YOUR JOB: independent review — ${l.text} Do not edit tracked files. Findings with severity, file, evidence and a concrete fix.`, { label: 'مراجعة:' + l.key, phase: 'المراجعة', schema: FIND })))
const findings = reviews.filter(Boolean).flatMap((r, i) => (r.findings || []).map(f => ({ ...f, id: LENSES[i].key + '-' + f.id })))
log(findings.length + ' ملاحظة من ' + reviews.filter(Boolean).length + ' مراجعين')

phase('تصليح الملاحظات')
const fix = await agent(`${COMMON}

HUB REPORT: ${JSON.stringify(hub)}
FINDINGS: ${JSON.stringify(findings)}

YOUR JOB: (1) verify each finding in the code; fix every real one (major and minor; nits when cheap and in scope) with specs; write a short verdict per finding (fixed / not real + why) in ${N}/handoff/fix.md. (2) Update ${N}/pr-body.md if anything changed (keep the told list Arabic script only). (3) Full gate ALONE as in the HUB step (\`flock /tmp/ecms-heavy.lock bash ${N}/gate.sh\`) until every rc is 0. (4) The OWNER's DARK pictures, deviceScaleFactor 2, Arabic UI, dark theme, real pages with a mocked API (zz files only, port 5318): the plan §6 list items 1-14 (skip 15), into ${SP}/owner-shots/NN-<short-english-name>.png, and write ${N}/owner-shots-list.md: one line per picture «NN — <Egyptian Arabic caption, Arabic script only, what to look at>». Make sure every figure in the pictures is Latin and the record counts read «3 حوادث», «14 عملية». (5) Remove every zz-* scratch file. (6) ONE signed commit for the fixes (same env vars and trailers as the HUB, message "fix(fleet): Latin digits — review fixes"). Never push. Report: commit sha, gate summary, finding verdicts, picture list.`, { label: 'تصليح', phase: 'تصليح الملاحظات' })

return { step0, built, hub, verdicts: reviews.filter(Boolean).map(r => r.verdict), findings, fix }
