export const meta = {
  name: 'fleet-owner-followups',
  description: 'تنفيذ ردود صاحب الطلب: شيل «أرقام الفترة»، و«إجمالي العهدة»، وتصليح رسالة الغلط، والحاجات الصغيرة، ثم الفحص والمراجعة والصور الغامقة',
  phases: [
    { title: 'الخطة', detail: 'خطة التنفيذ وملكية الملفات' },
    { title: 'التنفيذ', detail: 'الحزم بالتوازي' },
    { title: 'الدمج', detail: 'الكلمات والسجل والفحص الكامل حتى ينجح' },
    { title: 'المراجعة', detail: 'مراجعة الكود والشكل والطلبات' },
    { title: 'تصليح الملاحظات', detail: 'تصليح الملاحظات والفحص الكامل والصور الغامقة' },
  ],
}

const W = '/home/user/egycash'
const N = W + '/.wip-notes'
const OUT = N + '/followups'
const SP = '/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups'
const BASE = '53594fd2'

const COMMON = `
CONTEXT. ECMS monorepo. TREE = ${W} (branch claude/fleet-progress-status-yvgr3f; ${BASE} = the same tree as main 04651a71; on top only WIP commits adding the temporary folder .wip-notes/; node_modules installed; contracts built). packages/contracts Zod, apps/api Express+Mongoose (integration specs on mongodb-memory-server), apps/web React 18 + Vite + Tailwind, RTL Arabic, light + dark.
THE ORDER: read ${N}/followups-spec.md first, fully — the owner's six answers and exactly what each means: remove the fleet dashboard tab «أرقام الفترة» (key period; «ملخصات» stays), rename the overview card «رصيد العهدة النقدية» → «إجمالي العهدة», keep «2 سيارات» in «سجل العهدة», no raw English/Latin error code in the shared ErrorState, and the small fixes a–f (licence-month option digits, car page digits, car record accidents count by code, the daily dialog name/code gap, the daily notes 500 cap, the mission select clipping on both roster screens). Nothing else.
NOTES LIVE IN THE TREE: plans, hand-offs and i18n JSON under ${OUT}/ (inside .wip-notes, committed as WIP by the parent and removed before the PR). Screenshots and big logs go to ${SP}/. The parent may make signed WIP commits at any time: the work = \`git diff ${BASE} -- . ':!.wip-notes'\`; never revert or amend those commits.
RULES: edit only inside ${W}. Never push, never open or touch a PR, never publish anything. Do NOT commit unless your step says so. Formal Arabic in the UI (scripts/check-formal-arabic.mjs), ar + en keys for every new i18n key (apps/web/src/platform/localization/i18n.ts), Latin digits, no English shown to Arabic users. Never print card numbers or PINs. Soft delete only; no data change. Keep layering rules, permission keys and spec conventions. Never skip/disable a test or weaken a spec. New committed files never zz-; zz-* scratch is git-excluded and must be gone at the end. MEMORY RULE: 16 GB, no swap — never two vitest runs at once; API specs one file at a time (--maxWorkers=1) except inside the full gate run alone. If the harness refuses a file write, put the text in your final answer instead.`

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

YOUR JOB: write the concrete plan into ${OUT}/plan.md and return it. Verify every item in the CURRENT code: the dashboard tab registry and bar (contracts fleet-dashboard.ts TAB_READS / TAB_SECTIONS / TAB_PARTS / PERIOD_KEYS etc., FleetDashboardPage, links/tabs/url libs, tab-period.tsx and period-tabs pieces, the overview hub, badges, the link census, the API period.service sections and which tab or «ملخصات» reads each), list EVERY figure of «أرقام الفترة» and where else it shows (tab + label) or that it is dropped; the overview custody card title key; the shared ErrorState (where the raw code is printed, what readers rely on it); monthCountOptions and its three screens; VehicleDetailPage formatNumber digits; the car record accidents count vs its link; EmployeeName and the daily RosterAssignDialog; the daily notes inputs (desk + touch) and the API cap; MISSION_BOX and the mission selects on both roster screens at 1280/1366/1920.
Produce 2–4 parallel packages with STRICT file ownership (each file one owner; hot shared files — i18n.ts, CHANGELOG.md, shared dashboard fixtures, shared specs touched by more than one package — belong to the HUB, which runs last), each with tasks and hand-offs (new/changed i18n words → ${OUT}/i18n/<pkg>.json with ar+en). Include specs per item. toldList: the owner-facing lines (Egyptian Arabic, Arabic script only, no Latin letters), numbered: what changed for each answer, every figure that disappears with «أرقام الفترة» and where it still shows, anything dropped. gate: the full CI gate — the script ${OUT}/gate.sh exists (run it alone; logs in ${SP}/gate-out). Do not edit tracked files.`, { label: 'خطة', phase: 'الخطة', schema: PKG })

phase('التنفيذ')
const built = await parallel(plan.packages.map(p => () => agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}

YOUR JOB: package ${p.id} (${p.area}). You own ONLY these files: ${JSON.stringify(p.files)} (plus new spec files you create). Tasks: ${JSON.stringify(p.tasks)}. Hand-offs to produce: ${JSON.stringify(p.handoffs || [])}.
Another package's file needs a change → hand-off in ${OUT}/handoff/${p.id}.md for the HUB. New/changed UI words → ${OUT}/i18n/${p.id}.json (ar + en); do not edit i18n.ts. Write specs for what you change. Run typecheck, eslint and prettier on your files, your specs, and the existing specs of files you touched (one vitest run at a time). Notes to ${OUT}/handoff/${p.id}.md. Do not commit. If a file you own already holds edits from an earlier cut-off run, read them first and finish. Report files changed, specs and results, open hand-offs.`, { label: 'تنفيذ:' + p.id, phase: 'التنفيذ' })))

phase('الدمج')
const hub = await agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}
PACKAGES: ${JSON.stringify(built)}

YOUR JOB (HUB + INTEGRATION): own the hub files ${JSON.stringify(plan.hub.files)} and do the hub tasks ${JSON.stringify(plan.hub.tasks)}: merge every ${OUT}/i18n/*.json into i18n.ts (ar + en; remove keys nothing reads any more), apply every hand-off in ${OUT}/handoff/*.md, shared fixtures and specs, CHANGELOG.md entry (house style, newest unreleased section), and a PR body draft at ${OUT}/pr-body.md (sections: What & why / ما يجب أن يعرفه صاحب الطلب (the told list, numbered, Arabic script only) / Scope / Review checklist (Development Workflow §4) / Verification / Notes for reviewers; end with a blank line, «🤖 Generated with [Claude Code](https://claude.com/claude-code)», a blank line, «https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B»). Check every answer in ${N}/followups-spec.md is done in the code. Then run the FULL CI gate ALONE: bash ${OUT}/gate.sh (read ${SP}/gate-out/summary.txt) — fix failures at the ROOT until every step exits 0. git status: no stray files, no zz files (.wip-notes expected). Then COMMIT the work WITHOUT .wip-notes (do not push): signed (git commit -S) with env GIT_AUTHOR_NAME="Mohamed Hatem" GIT_AUTHOR_EMAIL="hatem27slama78@gmail.com" GIT_COMMITTER_NAME="Claude" GIT_COMMITTER_EMAIL="noreply@anthropic.com"; message «feat(fleet): the owner's follow-ups — «أرقام الفترة» removed, «إجمالي العهدة», Arabic error state, small fixes»; short body; end with the two trailer lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
If the tree or WIP commits already hold a hub run's edits from a cut-off earlier run, read them first and finish.
Report: commit sha, gate results per step, files changed, items not done (if any).`, { label: 'دمج', phase: 'الدمج' })

phase('المراجعة')
const FIND = { type: 'object', properties: {
  verdict: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor', 'nit'] }, file: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['id', 'severity', 'claim', 'fix'] } } },
  required: ['verdict', 'findings'] }
const LENSES = [
  { key: 'code', text: 'CODE lens: review the work (git -C ' + W + ' diff ' + BASE + " -- . ':!.wip-notes') for correctness bugs: no dead link to the removed tab anywhere (links, hub cards, badges, census, URL ?tab=period falls back), no server section left unread or still computed for nothing, «ملخصات» and every other tab unchanged in figures, the custody card renamed only, ErrorState shows a formal Arabic line and never the raw code (and keeps whatever the code was used for, e.g. support details, without Latin text), Latin digits in the month options on all three screens and on the whole car page, the accidents count equals the list its link opens, the daily dialog gap, the 500 cap on desk and touch notes (daily), the mission select on both screens at 1280/1366/1920, i18n keys removed only when unread, specs. Verify by reading code; single web spec runs only." },
  { key: 'look', text: 'LOOK lens: render the REAL pages with a mocked API (git-excluded zz files only, port 5318, strictPort, 127.0.0.1; playwright preinstalled) and shoot DARK: the dashboard bar (company and one branch) without «أرقام الفترة», the overview card «إجمالي العهدة», a page in its error state, the licence-month options open on the three screens, the car page figures, the daily «تعيين السيارات» «تعديل» dialog (name and code), the daily notes at the 500 cap (desk and phone), and the mission select with a long mission name on the daily and the fixed screens at 1280 and 1920. Check words, digits, tones, no truncation, no raw keys, no Latin text, no sideways scroll, and that nothing else changed. Save under ' + SP + '/review/shots/. Stop Vite; git status clean.' },
  { key: 'order', text: 'ORDER lens: check the work against ' + N + '/followups-spec.md answer by answer: each done exactly as asked and nothing more («ملخصات» stays, «2 سيارات» stays), every «أرقام الفترة» figure has a home or is told as dropped, the told list in ' + OUT + '/pr-body.md true and complete in Arabic script only, CHANGELOG accurate, formal Arabic.' },
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

YOUR JOB: (1) verify each finding in the code; fix every confirmed major/minor and cheap nits at the root, with specs; reject with a reason anything wrong or against the spec. Update ${OUT}/pr-body.md and the CHANGELOG so the told list matches the code. (2) Re-run the FULL CI gate ALONE (bash ${OUT}/gate.sh) until every step exits 0. (3) OWNER PICTURES (DARK only, deviceScaleFactor 2, real pages, the look reviewer's harness on port 5318, git-excluded zz files): one picture per owner answer/item showing the change with enough context to recognise the screen, under ${SP}/owner-shots/ named NN-<short-english-slug>.png, plus ${OUT}/owner-shots-list.md in Egyptian Arabic (Arabic script only apart from file names) mapping each picture to the owner's answer. Look at every picture yourself. Stop Vite and remove the harness files. (4) git status clean except the commit (.wip-notes changes expected). COMMIT the changes without .wip-notes (signed, same env and the two trailer lines) as «fix(fleet): owner's follow-ups — review fixes» (skip only if nothing changed). Do not push. If the tree already holds this step's edits from a cut-off earlier run, read them first and finish. Report per finding fixed/rejected, gate results, commit sha, the picture list.`, { label: 'تصليح', phase: 'تصليح الملاحظات' })

return { plan, built, hub, verdicts: reviews.filter(Boolean).map(r => r.verdict), findings, fix }
