export const meta = {
  name: 'dash-build-custody-licences',
  description: 'بناء «العهدة» و«التراخيص والتجديدات» في لوحة الحركة الحقيقية، ثم الفحص والمراجعة والتصليح',
  phases: [
    { title: 'الخطة', detail: 'خطة هذا الطلب: الحزم وملكية الملفات' },
    { title: 'العقود', detail: 'تغييرات العقود أولًا' },
    { title: 'البناء', detail: 'الخادم والواجهة بالتوازي' },
    { title: 'الدمج', detail: 'الكلمات والسجل والفحص الكامل حتى ينجح' },
    { title: 'المراجعة', detail: 'مراجعة الكود والصور والقرارات' },
    { title: 'التصليح', detail: 'تصليح الملاحظات والفحص الكامل' },
  ],
}

const W = '/home/user/egycash-dash'
const H = '/home/user/egycash/apps/web'
const S = '/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/stitch-dash'
const OUT = S + '/build-cl'
const BASE = '21995fd4f'

const COMMON = `
CONTEXT. ECMS monorepo. BUILD TREE = ${W} (git worktree on branch claude/fleet-progress-status-yvgr3f at ${BASE} = latest main after #728; clean; node_modules installed). Main already holds #708 («نظرة عامة», «الحركة اليوم»), #711, #715 («توزيع السيارات», «الصيانة والورش»), #727 («العدادات والكيلومترات», «الحوادث ومطالبات التأمين»), #728 («المخالفات المرورية والتسويات» key violations + «الوقود والمصروفات» key fuel, both NEW mixed tabs; fuel cards follow the card's current car branch; FDP MIXED_PERIOD_SECTIONS is a list). Current bar (FLEET_DASHBOARD_TABS): overview, today, distribution, maintenance, km, accidents, violations, fuel, period, summaries, licences. packages/contracts Zod, apps/api Express+Mongoose, apps/web React 18 + Vite + Tailwind, RTL Arabic, light + dark.
THE ORDER: the owner ships the approved fleet-dashboard redesign two tabs per PR. Now: «اعمل «العهدة» و«التراخيص والتجديدات»» — build, in one PR: «العهدة» (design _7, DECISIONS §9, approved cust-dark/cust-branch-dark) as a NEW tab right after «الوقود والمصروفات» (no old tab of its own; _7 is a restyle of the existing /fleet/custody/dashboard figures — same formula and titles), and «التراخيص والتجديدات» (design _8, DECISIONS §11, approved lic-dark/lic-branch-dark) which REPLACES the old «التراخيص» body (keep key licences; the pill becomes «التراخيص والتجديدات» as approved). Final bar: نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات · الحوادث ومطالبات التأمين · المخالفات المرورية والتسويات · الوقود والمصروفات · العهدة · التراخيص والتجديدات · then the remaining old tabs «أرقام الفترة» and «ملخصات», which STAY exactly as they are (do NOT retire them — the owner decides that later). Nobody loses a figure from the old «التراخيص» body: every old figure must have a home (the new tab, or the fuel tab for fuel-card expiry per §11 Q1 told, with one line here), or be told; no dead link; licensing-only readers keep /fleet (§11 A2).
READ FIRST: ${S}/DECISIONS.md fully (§0, §0b scope rules, §0c period default, §5 BRAND bar rule for all tabs, §9 custody with ALL its decisions (the 17 critic corrections A1–D1; Q1 (أ) period card «مصروفات العهدة» = total + where that spend stands now «تمت الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات»; NOW band company-wide all-time with LiveChip + «من بداية العهدة» + «الشركة كلها» when narrowed incl. «كل فروعي»; equation strip; waiting cards «تنتظر الاستعاضة» · «استعاضة معلّقة» · «تنتظر التسوية»; «تنبيهات العهدة» firing only; chart «إجمالي العهدة بعد كل عملية» brand, red below 0; «آخر عمليات العهدة»; PERIOD follows the branch via the receipt's car; sky KPI + separate «مصروفات العهدة حسب النوع» brand bars in custody order; the not-summed sentence vs the fuel tab (the fuel tab's «وقود من العهدة»/كاوتش/غسيل/صيانة overlap — fuel critic B4 hand-off); every drop), §11 licences with ALL its decisions (21 critic corrections A1–B9; Q2 (أ) full-width «أقرب رخص السائقين» table with names beside «أقرب تراخيص السيارات»; KPI order cars row (منتهية · تنتهي · أوراق) over drivers row (منتهية · تنتهي · بيانات ناقصة); red badge = expired car licences (active cars, car branch) + expired driver licences (Fleet driver files incl. suspended, HR branch), hidden at 0; period bar = period choices only on this tab; every told item and drop), §10 build notes, and every 2026-11-15/16/17 line incl. #708/#711/#715/#727/#728). Analyses: ${S}/custody/ and ${S}/licences/ (gap-map + critic; critic overrides). There is NO build-plan file for these two tabs — derive it from DECISIONS + the analyses + the code, following ${S}/build-plan/plan.md, critic.md, shell.md, drift.md for shared rules. How #727 and #728 were built (patterns to follow: mixed panels, MIXED_PERIOD_SECTIONS, links/tabs/url libs, scopeBranches, part sections and gates, fixtures, specs, i18n hand-off JSONs, real-page harness, told-list style): ${S}/build-ka/ and ${S}/build-vf/ (plan.md, handoff/*.md, hub/pr-body.md), and the code in ${W}. Approved visual truth: ${S}/approved/cust-dark.png, cust-branch-dark.png, lic-dark.png, lic-branch-dark.png and the harnesses ${H}/src/zz-custody-tab.tsx (+ the zz-custody-dash*.tsx pieces it imports) and ${H}/src/zz-licences-tab.tsx (mock data; words, order, tones, notes are approved; figures must come from real reads). Never fake a figure: a line with no real data is dropped or told.
RULES: edit only inside ${W}. Never push, never open or touch a PR, never publish anything (no Artifact tool). Do NOT commit unless your step says so. Formal Arabic in the UI (scripts/check-formal-arabic.mjs), ar + en keys for every new i18n key (apps/web/src/platform/localization/i18n.ts), Latin digits, no English shown to Arabic users. Never print card numbers or PINs; card numbers stay masked. Soft delete only; no data migration; existing data unchanged (a new index declared on a model is allowed if needed — say so). Keep the repo's layering rules, permission keys and spec conventions. Write notes under ${OUT}.`

const PKG = { type: 'object', properties: {
  summary: { type: 'string' },
  contracts: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, tasks: { type: 'array', items: { type: 'string' } } }, required: ['files', 'tasks'] },
  packages: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, area: { type: 'string', enum: ['api', 'web'] }, files: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'string' } }, handoffs: { type: 'array', items: { type: 'string' } } }, required: ['id', 'area', 'files', 'tasks'] } },
  hub: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, tasks: { type: 'array', items: { type: 'string' } } }, required: ['files', 'tasks'] },
  toldList: { type: 'array', items: { type: 'string' } },
  gate: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'contracts', 'packages', 'hub', 'toldList', 'gate'] }

phase('الخطة')
const plan = await agent(`${COMMON}

YOUR JOB: write the concrete plan for THIS PR into ${OUT}/plan.md and return it. Verify everything in ${W}.
Scope: (1) «العهدة» per DECISIONS §9 and the approved pictures, a mixed panel (NOW company-wide all-time + PERIOD by the receipt car's branch), with real reads (reuse what /fleet/custody/dashboard already computes; add only what is missing). (2) «التراخيص والتجديدات» per DECISIONS §11, replacing the old «التراخيص» body under key licences: NOW KPIs (cars row over drivers row), «أقرب تراخيص السيارات» and «أقرب رخص السائقين» full-width tables, the period part with its period choices, the red badge rule, licensing-only readers keep /fleet; map every figure of the old «التراخيص» body to its new home (incl. the fuel-cards panel that #728 made branch-following) and list what moves or is told. (3) State the bar (final order above; pill names as approved), badges, overview hub lines that should open the new tabs, other screens that must learn params, the old «أرقام الفترة»/«ملخصات» figures that share reads (must stay identical).
Produce: contracts changes (one package, done first), then 2–4 parallel packages (api / web) with STRICT file ownership (hot shared files — FleetDashboardPage, links/tabs/url libs, i18n.ts, CHANGELOG.md, shared fixtures and shared specs — belong to the HUB, which runs last), each with tasks and hand-offs (new i18n words → ${OUT}/i18n/<pkg>.json with ar+en), the told list for the owner (visible behaviour changes and every place the build differs from the approved pictures, in Egyptian Arabic, numbered), and the full CI gate command list in CI order (${S}/build-vf/fix/gate shows the last run).`, { label: 'خطة', phase: 'الخطة', schema: PKG })

phase('العقود')
const contracts = await agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}

YOUR JOB: the CONTRACTS package only (files: ${JSON.stringify(plan.contracts.files)}). Make the contract changes, add/adjust contract tests, build the contracts package, and leave minimal neutral stubs ONLY where api/web stop typechecking so the next packages can start (list every stub in ${OUT}/contracts-stubs.md so its owner replaces it). Run contracts tests and typecheck. Do not commit. Report what changed.`, { label: 'عقود', phase: 'العقود' })

phase('البناء')
const built = await parallel(plan.packages.map(p => () => agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}
CONTRACTS REPORT: ${JSON.stringify(contracts)}

YOUR JOB: package ${p.id} (${p.area}). You own ONLY these files: ${JSON.stringify(p.files)}. Tasks: ${JSON.stringify(p.tasks)}. Hand-offs to produce: ${JSON.stringify(p.handoffs || [])}.
Replace any contracts stub you own. Write unit/integration specs for what you add (in files you own). New UI words → ${OUT}/i18n/${p.id}.json (ar + en, formal Arabic); do not edit i18n.ts. Run typecheck, eslint and prettier on your files, and your specs. For web: match the approved harness and picture (words, order, tones, brand bars/charts, «فتح»), using the real kit (dash-kit.tsx, dash-blocks, dash-columns) and real reads. Write your notes to ${OUT}/handoff/${p.id}.md. Do not commit. If a file you own already holds edits from an earlier cut-off run of this same package, read them first and finish them rather than starting over. Report files changed, specs, results, open hand-offs.`, { label: 'بناء:' + p.id, phase: 'البناء' })))

phase('الدمج')
const hub = await agent(`${COMMON}

PLAN: ${JSON.stringify(plan)}
CONTRACTS: ${JSON.stringify(contracts)}
PACKAGES: ${JSON.stringify(built)}

YOUR JOB (HUB + INTEGRATION): own the hub files ${JSON.stringify(plan.hub.files)} and do the hub tasks ${JSON.stringify(plan.hub.tasks)}: merge every ${OUT}/i18n/*.json into i18n.ts (ar + en), remove i18n keys only the replaced old «التراخيص» body used (keep any key still referenced), wire FleetDashboardPage/links/tabs/url libs (bar order of the plan), shared fixtures and shared specs, overview hub lines, CHANGELOG.md entry (house style), and a PR body draft at ${OUT}/hub/pr-body.md in the style of ${S}/build-vf/hub/pr-body.md (sections: What & why / ما يجب أن يعرفه صاحب الطلب (the told list) / Scope / Review checklist (Development Workflow §4) / Verification / Notes for reviewers). Apply every open hand-off. Then run the FULL CI gate in CI order with CI=true: ${JSON.stringify(plan.gate)} — fix failures at the ROOT (never skip/disable a test, never weaken a spec to pass) until every step exits 0. Check git status: no stray files, nothing from ${H} copied in, no zz files tracked. Then COMMIT on the branch (do not push): signed (git commit -S) with env GIT_AUTHOR_NAME="Mohamed Hatem" GIT_AUTHOR_EMAIL="hatem27slama78@gmail.com" GIT_COMMITTER_NAME="Claude" GIT_COMMITTER_EMAIL="noreply@anthropic.com"; conventional message «feat(fleet): dashboard — «العهدة» and «التراخيص والتجديدات» (approved screens)»; body short; end with the two trailer lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
If the tree already holds a hub/integration run's edits from a cut-off earlier run, read them first and finish. Report: commit sha, gate results per step, files changed count, anything left.`, { label: 'دمج', phase: 'الدمج' })

phase('المراجعة')
const FIND = { type: 'object', properties: {
  verdict: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor', 'nit'] }, file: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['id', 'severity', 'claim', 'fix'] } } },
  required: ['verdict', 'findings'] }
const LENSES = [
  { key: 'code', text: 'CODE lens: review the new commit (git -C ' + W + ' diff ' + BASE + '..HEAD) for correctness bugs: branch scope rules (company / chosen branch / «كل فروعي» / single-branch), custody NOW company-wide all-time vs PERIOD by the receipt car branch, the equation strip and fund formula identical to /fleet/custody/dashboard, the period card split (تمت الاستعاضة / في مذكرات لم تُستعَض / خارج المذكرات) summing to the total, licences: expiry windows (expired / ≤30 / 31–60), active cars only, car branch vs HR branch for drivers, suspended driver files, missing-data counts, red badge rule, licensing-only readers keep /fleet, Cairo-day boundaries, period default and URL state, links that do not match what the target screen reads, every old «التراخيص» figure still reachable, tab keys and every existing link, permissions/gates per part, counts the browser computes (banned), realtime invalidation of the new reads, missing specs, error/loading states, old «أرقام الفترة»/«ملخصات» figures unchanged. Verify each finding by reading the code; no hunches.' },
  { key: 'visual', text: 'VISUAL lens: render the REAL dashboard (not the harness) with a mocked API: git-excluded files only (apps/web/zz-real-cl.html, apps/web/src/zz-real-cl.tsx, apps/web/zz-vite-real-cl.config.mjs on port 5315, strictPort, 127.0.0.1 — apps/web/zz-* is git-excluded; copy ideas from ' + S + '/build-vf/vis/) mounting the real FleetDashboardPage route with mock responses shaped by the real contracts and figures copied from the approved harnesses; shoot «العهدة» and «التراخيص والتجديدات» dark at 1920 (company + branch «المهندسين») and 1366/1280, plus «نظرة عامة» and one old tab (period) to prove they still work, plus phone 375 and tablet 768; playwright-core from /opt/node-tools, chromium /opt/pw-browsers. Compare with ' + S + '/approved/cust-dark.png, cust-branch-dark.png, lic-dark.png, lic-branch-dark.png: words, order, tones, brand bars/charts, «فتح», chips, badges, no sideways scroll, no truncation. Save shots under ' + OUT + '/shots/ (name the four owner pictures cust-company-1920.png, cust-branch-1920.png, lic-company-1920.png, lic-branch-1920.png). Stop Vite; leave git status clean.' },
  { key: 'decisions', text: 'DECISIONS lens: check the build against DECISIONS.md §9/§11 and the custody/licences critics line by line: every approved element present, every drop gone, every hand-off applied (custody period card split, not-summed sentence vs fuel, brand bars in custody order, alerts firing only, licences KPI rows, two full-width tables with drivers\' names, red badge rule, period choices), every old «التراخيص» figure has a home or is told, told items true in code and complete (every difference from the approved pictures told), the eight built tabs and the old «أرقام الفترة»/«ملخصات» untouched and reachable, CHANGELOG accurate, formal Arabic.' },
]
const reviews = await parallel(LENSES.map(l => () => agent(`${COMMON}

HUB REPORT: ${JSON.stringify(hub)}

YOUR JOB: independent review — ${l.text} Do not edit tracked files. Findings with severity, file, evidence and a concrete fix.`, { label: 'مراجعة:' + l.key, phase: 'المراجعة', schema: FIND })))
const findings = reviews.filter(Boolean).flatMap((r, i) => (r.findings || []).map(f => ({ ...f, id: LENSES[i].key + '-' + f.id })))
log(findings.length + ' ملاحظة من ' + reviews.filter(Boolean).length + ' مراجعين')

phase('التصليح')
let fix = null
if (findings.length > 0) {
  fix = await agent(`${COMMON}

HUB REPORT: ${JSON.stringify(hub)}
FINDINGS: ${JSON.stringify(findings)}

YOUR JOB: verify each finding in the code; fix every confirmed major/minor and cheap nits at the root, with specs; reject with a reason anything wrong or against DECISIONS. Update ${OUT}/hub/pr-body.md and the CHANGELOG so the told list matches the code. Re-run the FULL CI gate in CI order with CI=true until every step exits 0 (${JSON.stringify(plan.gate)}). Re-shoot the visual check (git-excluded files, port 5315; the four owner pictures at 1920 DSF 2, dark, named cust-dark.png, cust-branch-dark.png, lic-dark.png, lic-branch-dark.png under ${OUT}/fix/shots/; stop Vite; remove the harness files). git status clean except the commit. COMMIT (signed, same author/committer env and the same two trailer lines) as «fix(fleet): dashboard «العهدة» and «التراخيص والتجديدات» — review fixes». Do not push. If the tree already holds this step's edits from a cut-off earlier run, read them first and finish. Report per finding fixed/rejected, gate results, commit sha.`, { label: 'تصليح', phase: 'التصليح' })
}
return { plan, contracts, built, hub, verdicts: reviews.filter(Boolean).map(r => r.verdict), findings, fix }
