export const meta = {
  name: 'fleet-fixed-roster-build-2',
  description: 'بناء شاشة «الطقم الثابت» الحقيقية بشكل «تعيين السيارات» زي العينة الموافق عليها (على الجهاز الجديد)، ثم الفحص الكامل والمراجعة والصور الغامقة',
  phases: [
    { title: 'الخطة', detail: 'خطة البناء وملكية الملفات' },
    { title: 'البناء', detail: 'الحزم بالتوازي' },
    { title: 'الدمج', detail: 'الكلمات والسجل والفحص الكامل حتى ينجح' },
    { title: 'المراجعة', detail: 'مراجعة الكود والشكل والقرارات' },
    { title: 'تصليح الملاحظات', detail: 'تصليح الملاحظات والفحص الكامل والصور الغامقة' },
  ],
}

const W = '/home/user/egycash'
const N = W + '/.wip-notes'
const OUT = N + '/fixed-build'
const SP = '/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build'
const BASE = '2b9467a3'

const COMMON = `
CONTEXT. ECMS monorepo. BUILD TREE = ${W} (a fresh clone on a NEW cloud machine; branch claude/fleet-progress-status-yvgr3f; ${BASE} = the same tree as main 45d212b2 after #753; on top of it only WIP commits that add the temporary folder .wip-notes/; node_modules installed; contracts built). packages/contracts Zod, apps/api Express+Mongoose (integration specs on mongodb-memory-server), apps/web React 18 + Vite + Tailwind, RTL Arabic, light + dark.
THE ORDER: the owner approved a redesign of the fleet screen «الطقم الثابت» (/fleet/fixed-roster, apps/web/src/modules/fleet/pages/FixedRosterPage.tsx) in the look of the merged daily roster «تعيين السيارات» (RosterPage and its desk/touch boards), saw sample v2 with his answers «1 ب / 2 ج», and now says the page is still not built: build it for real, in one PR.
SPEC (read first, fully): ${N}/fixed-roster-spec.md — the binding rules Q1 (ب) / Q2 (ج), how the approved sample was assembled from the REAL daily pieces (what to reuse, what the sample copied and changed), the build hand-offs, and the 21-item told list the owner read (every item must be true in the build). The old machine's detailed gap map, sample harness and the six approved pictures were LOST in a machine replacement; the spec file is what survives. Where the spec is silent, the rule is: exactly the daily «تعيين السيارات» look and behaviour, minus the day (no date, no stepper, no «يوم سابق», no availability words, no absent/leave), with the fixed page's own data, rules, permissions, draft key and Excel content. Read the CURRENT code: FixedRosterPage.tsx, the daily RosterPage, apps/web/src/modules/fleet/components/roster/*, lib/roster-*.ts, lib/daily-roster-board.ts, lib/roster-view.ts (incl. visibleFixedRows, isAnyVehicleCode), useDraftBoard, the fixed roster API client/queries, and the fixed-roster API service (its 409 refusal body).
BINDING RULES (from the spec): Q1 (ب) no flag for a standing member who cannot drive anywhere on this screen, no new contract field; Q2 (ج) PageContainer fullHeight + PageHeader (title fleet.nav.fixedRoster, breadcrumbs fleet.module.title → /fleet › fleet.nav.fixedRoster) at every width, its ExportSheetButton removed, Excel = the daily ExcelPill (desk toolbar row) / ExcelButton (touch first row), one per width, no title box in the stepper's place, one title per width. The fixed save rules, API semantics and data do not change (soft delete only, no migration). The daily «تعيين السيارات» screen must NOT change behaviour or look (a shared piece may gain an optional prop with the daily default unchanged). In this PR also: DriverSlotPicker emptyLabel; touch DriversButton label («السائقون» here); the Arabic plural-aware car count where this screen shows it; the friendly Arabic refusal line for the fixed save's 409 (naming the driver and the holding car code when the error carries them, never English, never an internal id — the server may add those names to the error details if it has them, read-side, no rule change); the EmployeeName gap only if the daily stays as approved (else local); the stale comments N1/N5/N10 if found.
NOTES LIVE IN THE TREE so a machine loss cannot erase them: write plans, hand-offs and i18n JSON under ${OUT}/ (inside .wip-notes, which the parent commits as WIP and removes before the PR). Screenshots and big logs go to ${SP}/ (scratch). The parent may make signed WIP commits of the whole tree at any time: your package's work = \`git diff ${BASE} -- . ':!.wip-notes'\` (commits + working tree); never revert or amend those commits.
RULES: edit only inside ${W}. Never push, never open or touch a PR, never publish anything (no Artifact tool). Do NOT commit unless your step says so. Formal Arabic in the UI (scripts/check-formal-arabic.mjs), ar + en keys for every new i18n key (apps/web/src/platform/localization/i18n.ts), Latin digits, no English shown to Arabic users. Never print card numbers or PINs. Keep the repo's layering rules, permission keys and spec conventions. New committed files never zz-; zz-* scratch is git-excluded (.git/info/exclude) and must be gone at the end. MEMORY RULE: 16 GB, no swap — never two vitest runs at once; API specs one file at a time (--maxWorkers=1) except inside the full gate run alone. If the harness refuses a file write, put the text in your final answer instead.`

const PKG = { type: 'object', properties: {
  summary: { type: 'string' },
  packages: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, area: { type: 'string', enum: ['api', 'web'] }, files: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'string' } }, handoffs: { type: 'array', items: { type: 'string' } } }, required: ['id', 'area', 'files', 'tasks'] } },
  hub: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, tasks: { type: 'array', items: { type: 'string' } } }, required: ['files', 'tasks'] },
  toldList: { type: 'array', items: { type: 'string' } },
  gate: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'packages', 'hub', 'toldList', 'gate'] }

phase('الخطة')
const plan = await agent(`${COMMON}

YOUR JOB: write the concrete build plan into ${OUT}/plan.md and return it. First re-derive the element-by-element design (desk ≥1280: header, toolbar row with count + Excel pill, counters, the table columns and cells, the drivers panel, the save bar, the pen dialog; tablet and phone <1280: search row + Excel button + drivers button, car cards, picker sheet, drivers sheet, filters sheet, ⋮ menu; states: loading, empty, error, read-only viewer, branch view, draft restored) from the spec + the CURRENT daily roster code + today's FixedRosterPage, and write it to ${OUT}/design.md (this replaces the lost gap map; every told item 1–21 mapped to its element). Map each element to its real home: which existing daily components to reuse or export (optional props, daily default unchanged), which new real files to create (e.g. a fixed desk board, a fixed touch board, a fixed model lib, cells), what FixedRosterPage keeps (data, permissions, save, draft key, export content). List every function of today's page and its place in the new one (nobody loses a function).
Produce 2–5 parallel packages with STRICT file ownership (each file one owner; hot shared files — i18n.ts, CHANGELOG.md, shared specs touched by more than one package — belong to the HUB, which runs last), each with tasks and hand-offs (new i18n words → ${OUT}/i18n/<pkg>.json with ar+en, formal Arabic). Include specs per package (no date, save bar, undo, transfer, swap, views/filters, Excel, permissions, Q1 no flags, Q2 header, the 409 line, the daily unchanged). toldList: the owner-facing told lines (Egyptian Arabic, Arabic script only, no Latin letters) — the spec's 1–21 as built (item 16 now: the refusal is Arabic with the driver's name and the car) plus anything else the build changes, numbered. gate: the full CI gate in CI order — the script ${OUT}/gate.sh already exists (run it alone; logs in ${SP}/gate-out). Do not edit tracked files.`, { label: 'خطة', phase: 'الخطة', schema: PKG })

phase('البناء')
const built = await parallel(plan.packages.map(p => () => agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}
DESIGN: ${OUT}/design.md

YOUR JOB: package ${p.id} (${p.area}). You own ONLY these files: ${JSON.stringify(p.files)} (plus new spec files you create). Tasks: ${JSON.stringify(p.tasks)}. Hand-offs to produce: ${JSON.stringify(p.handoffs || [])}.
Build exactly the design (words, order, tones, sizes, behaviours — the daily roster's look is the reference; reuse its real pieces). Another package's file needs a change → hand-off in ${OUT}/handoff/${p.id}.md for the HUB. New UI words → ${OUT}/i18n/${p.id}.json (ar + en); do not edit i18n.ts. Write specs for what you build. Run typecheck, eslint and prettier on your files, your specs, and the existing specs of files you touched (one vitest run at a time). Notes to ${OUT}/handoff/${p.id}.md. Do not commit. If a file you own already holds edits from an earlier cut-off run of this package, read them first and finish. Report files changed, specs and results, open hand-offs.`, { label: 'بناء:' + p.id, phase: 'البناء' })))

phase('الدمج')
const hub = await agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}
PACKAGES: ${JSON.stringify(built)}

YOUR JOB (HUB + INTEGRATION): own the hub files ${JSON.stringify(plan.hub.files)} and do the hub tasks ${JSON.stringify(plan.hub.tasks)}: merge every ${OUT}/i18n/*.json into i18n.ts (ar + en; remove keys only the old page used and no one reads now), apply every hand-off in ${OUT}/handoff/*.md, shared specs, CHANGELOG.md entry (house style, newest unreleased section), and a PR body draft at ${OUT}/pr-body.md (sections: What & why / ما يجب أن يعرفه صاحب الطلب (the told list, numbered, Arabic script only) / Scope / Review checklist (Development Workflow §4) / Verification / Notes for reviewers; end it with a blank line, then «🤖 Generated with [Claude Code](https://claude.com/claude-code)», a blank line, then «https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B»). Check every told item and binding rule is true in the code. Then run the FULL CI gate ALONE: bash ${OUT}/gate.sh (CI order, CI=true; read ${SP}/gate-out/summary.txt) — fix failures at the ROOT (never skip/disable a test, never weaken a spec) until every step exits 0. git status: no stray files, no zz files (the .wip-notes folder is expected). Then COMMIT the build (do not push), WITHOUT .wip-notes changes (git add everything except .wip-notes): signed (git commit -S) with env GIT_AUTHOR_NAME="Mohamed Hatem" GIT_AUTHOR_EMAIL="hatem27slama78@gmail.com" GIT_COMMITTER_NAME="Claude" GIT_COMMITTER_EMAIL="noreply@anthropic.com"; message «feat(fleet): «الطقم الثابت» in the daily roster's look (approved sample)»; short body; end with the two trailer lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
If the tree or the WIP commits already hold a hub run's edits from a cut-off earlier run, read them first and finish.
Report: commit sha, gate results per step, files changed, told items not met (if any), anything left.`, { label: 'دمج', phase: 'الدمج' })

phase('المراجعة')
const FIND = { type: 'object', properties: {
  verdict: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor', 'nit'] }, file: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['id', 'severity', 'claim', 'fix'] } } },
  required: ['verdict', 'findings'] }
const LENSES = [
  { key: 'code', text: 'CODE lens: review the build (git -C ' + W + ' diff ' + BASE + " -- . ':!.wip-notes') for correctness bugs: the draft (key, restore on reload, undo, cancel confirm), the fixed save rules unchanged (driver2 waits for driver1, same person not in both seats, transfer from another car, swap, empty-crew bin, notes 500 cap, mission), held-elsewhere drivers, views and filters (بلا طقم / workshop / assigned, the code filter with isAnyVehicleCode, mission boxes), permissions (planner edits; viewer: no actions column, no save bar), the branch switcher (cars by branch, drivers company-wide), Excel content unchanged (filtered rows, eight columns), the 409 refusal line (Arabic, names, no internal id), Q1 no flags anywhere, Q2 header and one Excel per width, the daily screen unchanged (shared prop defaults), query keys, realtime, loading/error/empty states, a11y labels, missing specs. Verify each finding by reading the code; no hunches. Run at most single web spec files." },
  { key: 'look', text: 'LOOK lens: render the REAL fixed page and the REAL daily «تعيين السيارات» side by side with a mocked API shaped by the real contracts (same cars, drivers and branches on both) — git-excluded zz files only (apps/web/zz-real-fx.html, apps/web/src/zz-real-fx*.tsx, apps/web/zz-vite-real-fx.config.mjs on port 5317, strictPort, 127.0.0.1; playwright is preinstalled, chromium needs no options) — and shoot DARK: desk 1920 company, desk one branch, the pen dialog, 1366 and 1280 desk, tablet 1024 landscape and 768 portrait, phone 390 with the drivers sheet and the picker sheet; the daily at the same sizes. Check against ' + N + '/fixed-roster-spec.md (told 1–21, Q1, Q2) and ' + OUT + '/design.md: the fixed page must read as the daily minus the day — words, order, tones, sizes, badges, counters, the save bar, the white code, Latin digits, «معيّنون على سيارات أخرى», no «متاح», no flags, the header + one Excel; no sideways scroll, no truncation, no raw i18n keys, no Latin text except the approved Excel word; and the daily looks exactly as before this build (shoot it from ' + BASE + ' too if needed via git stash-free worktree: git worktree add --detach /home/user/egycash-base ' + BASE + ', then remove it). Save shots under ' + SP + '/review/shots/. Stop Vite; git status clean.' },
  { key: 'decisions', text: 'DECISIONS lens: check the build against ' + N + '/fixed-roster-spec.md and ' + OUT + '/design.md line by line: every function of the old page has its place, every told item 1–21 is true (item 16 now Arabic with names), Q1 (ب) and Q2 (ج) exactly, every build hand-off done or explicitly left with a reason, the PR body draft ' + OUT + '/pr-body.md and CHANGELOG accurate, formal Arabic, the daily screen untouched.' },
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

YOUR JOB: (1) verify each finding in the code; fix every confirmed major/minor and cheap nits at the root, with specs; reject with a reason anything wrong or against the spec/binding rules. Update ${OUT}/pr-body.md and the CHANGELOG so the told list matches the code. (2) Re-run the FULL CI gate ALONE (bash ${OUT}/gate.sh) until every step exits 0. (3) OWNER PICTURES (the owner sees only DARK pictures): with the look reviewer's harness (git-excluded zz files, port 5317; scripts under ${SP}/review), shoot the REAL fixed page DARK at deviceScaleFactor 2 in the six views of the approved sample: fixed-dark.png (desk 1920 company), fixed-branch-dark.png (desk 1920 one branch), fixed-edit-dark.png (the pen dialog), fixed-tablet-dark.png, fixed-phone-dark.png (phone full page), fixed-phone-sheet-dark.png (phone drivers sheet), under ${SP}/owner-shots/, plus the daily at the same views as daily-*.png for comparison, and ${OUT}/owner-shots-list.md in Egyptian Arabic (Arabic script only apart from file names) saying for each picture what it shows and which told items it proves. Look at every picture yourself: real words, no raw keys, no Latin text except the approved Excel word, no truncation. Stop Vite and remove the harness files. (4) git status clean except the commit (.wip-notes changes are expected and not part of it). COMMIT the build changes only, without .wip-notes (signed, same author/committer env and the same two trailer lines) as «fix(fleet): «الطقم الثابت» — review fixes» (skip only if nothing changed). Do not push. If the tree already holds this step's edits from a cut-off earlier run, read them first and finish. Report per finding fixed/rejected, gate results, commit sha, the picture list.`, { label: 'تصليح', phase: 'تصليح الملاحظات' })

return { plan, built, hub, verdicts: reviews.filter(Boolean).map(r => r.verdict), findings, fix }
