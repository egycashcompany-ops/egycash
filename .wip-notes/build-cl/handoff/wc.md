# WC hand-off (web — «العهدة»): done, NOT committed

Tree /home/user/egycash-dash (21995fd4f + C0 + the parallel A1/WL edits), plan build-cl/plan.md §6. No earlier WC run had
left anything in the owned files (only C0's `C0-STUB(WC)` tags) — built from the plan.

## Files (owned)
- NEW apps/web/src/modules/fleet/components/fleet-dashboard/tab-custody.tsx — `export const CustodyTab = (props: MixedTabProps)`,
  wrapper `data-dash-tab-body="custody"`. Heading: `CUSTODY_FUND.icon`, title `t('fleet.dash.shell.tab.custody')` (HUB's key),
  `live={false}`, sub `fleet.dash.custody.sub` (critic C8) or `.subNow` for a reader with no period band. Reads «سجل العهدة»
  ONCE here: `useCustodyLedger(CUSTODY_LEDGER_PARAMS, custody !== null)` (the custody board's cache). RefreshTools: age = the
  oldest of `props.updatedAt` and the ledger's; «تحديث» = `props.onRefresh()` + ledger refetch; refreshing = props || ledger.
  «الآن» band when `props.custody !== null`; period band when `props.period.enabled && sectionPermitted('opex', can)`.
- NEW …/tab-custody-now.tsx — `CustodyNowBand`: BandHead «الآن» (LiveChip + «من بداية العهدة» + `CompanyWide` when narrowed —
  R1's `scopeBranches`, else R2's echo, so a chosen branch AND «كل فروعي», critic E1); ReadBand over the custody reads
  (`custody.detail` → ready; `custody.error` → ReadError(`custody.failure`, `custody.refetch`); else skeleton). Strip ×5
  (`data-cust-term`, operators `data-cust-operator` at every width), the three waiting cards (`data-cust-wait=waiting|held|settle`,
  amber edge, tiles sky/amber/emerald), «تنبيهات العهدة» (`data-cust-block="alerts"`, rows `data-cust-alert=<type>`
  `data-cust-alert-tone=<amber|red>`), then the history.
- NEW …/tab-custody-history.tsx — `CustodyHistory({ ledger })`: «إجمالي العهدة بعد كل عملية» (`data-cust-block="steps"`, steps
  `data-cust-step`, brand line `data-cust-line="brand"`, red `data-cust-line="below"` + `data-cust-negative-band` below zero,
  readout, «الآن» label via `custodyNowLabelPlace`, axis via `custodyStepScale`, value axis at the left with «ج.م», x labels for
  the operations, legend, chip «آخر 100 عملية» only when `meta.totalItems > items.length`; scrolls inside the card on a narrow
  screen, opening on the latest point) and «آخر عمليات العهدة» (`data-cust-block="recent"`, rows `data-cust-row=<id>`
  `data-cust-status`, table from 768 px, blocks below). Exports `type LedgerRead`.
- NEW …/tab-custody-period.tsx — `CustodyPeriodBand`: BandHead «خلال الفترة» (sky, RangeChip, sub `periodSub`), the page's FULL
  PeriodFilterBar, ReadBand over R2; row `xl:[2fr|3fr]` [«مصروفات العهدة» `data-cust-period="spend"` (sky; `opex.custody`; chip
  `opex.custodyCount`; «منها حتى الآن:» `data-cust-state` ×3 plain, only when `custodyStates` is shown; DataFrom line as the
  fuel tab; foot «عرض مصروفات العهدة») | «مصروفات العهدة حسب النوع» `data-cust-block="kinds"` (bars `data-cust-bar` in the custody
  order maintenance · fuel(fuelCustody) · tyres · wash, `TONE.brand.bar`, `shareText`)]; the B4 note `data-cust-overlap` +
  `props.tabLink('fuel', 'opex.custody.tab')` «الوقود والمصروفات» (omitted when null). `opex` failed → SectionError; `custodyStates`
  failed → SectionError above the row, the KPI without «منها».
- NEW …/tab-custody-words.tsx — `useCustodyWords` (`fleet.dash.custody.*`), `Counted` (five forms, one/two in words; receipt/memo →
  `fleet.custody.count.*`, request → `fleet.custody.ledger.tiles.requestedNote.*`, part → `fleet.custody.ledger.parts.*`,
  alert/car → NEW `fleet.dash.custody.count.*`), `useCountedText`, `Money` (red «−» below 0, muted at 0), `Day`, `useMemoName`
  (`memoDisplayName` — a typed name as typed, B6), `Age`, `AgeChip` (amber + clock past 30, A3), `PeriodPhrase`, `FOOT`, `EndLine`,
  `narrowedView`, `periodView`.
- apps/web/src/modules/fleet/components/fleet-dashboard/custody-fund-line.tsx — `CustodyFigures` += `detail: CustodyDetail | null`
  ({summary, replenish, settle, alerts}; null until all three reads answered), `failure: unknown` (first read error, for the tab's
  ReadError), `fetching: boolean`. NEW exported `interface CustodyDetail`. The ONE `useCustodyFundAlerts(` call kept (its array
  now handed over whole; `lines` = its length as before). Every older field unchanged → «ملخصات» and the overview identical.
- apps/web/src/modules/fleet/lib/custody-dashboard-fund.ts — NEW `custodyOutsideReceipts(outside)`, `custodySettleCount(parts)`,
  `custodyPendingCount(memos)`, `custodyLetterMemos(letter)`, `custodyDoneRows` (= the custody board's own `custodyStepRows`
  re-exported under the plan's name — no second copy of the rule).
- apps/web/src/modules/fleet/pages/custody-dashboard-fund.spec.tsx — NEW case «counts what the dashboard's «العهدة» tab lists»
  (all five helpers); C0 tags dropped; the held=1 fixture now carries a letter that ties (8,476.00 = 5,126 + 3,350; 12 receipts).
- C0-STUB(WC) replaced (tags dropped): custody-fund-dialogs / custody-tabs / custody-memos / custody-ledger / custody-split
  (`letters: []` where nothing is held), custody-hold.spec.tsx + custody-split.spec.tsx (held=1 → a real tying letter),
  receipts-screen / receipts-memo-lock / fleet-row-actions-look (`custodyCount` kept as planned).
  Not touched (no stub there, no change needed): custody-deleted, custody-delete-dialog, custody-hold-dialogs.
- NEW apps/web/src/modules/fleet/fleet-dashboard-tab-custody.spec.tsx — 41 cases through `renderDashboard`. It seeds its OWN
  custody caches (fund summary with a held letter, replenish/settle candidates, the ledger page under
  `custodyQueryKeys.ledger(CUSTODY_LEDGER_PARAMS)`) and its own R2 page — no FX/PFX change needed for it. Clock pinned with
  `vi.useFakeTimers({ toFake: ['Date'] })` at 2026-11-12 (the approved ages: 35/38/37/4 days). Uses
  `[...ALL_KEYS, 'fleetLicenseExpense.view']` (LE is PAGELESS, not in ALL_KEYS).
  **It fails until HUB wires FDP** («no custody tab body» — C0's `UNBUILT_TABS` keeps «العهدة» out of the bar) — by plan it runs at
  HUB's end.

## Self-check (temporary shim, deleted from the tree; copies in build-cl/wc-shim/)
- wc-shim-tmp.spec.tsx: mocks i18n (wc.json + `fleet.dash.shell.tab.custody`), the §8 L builders, and FDP →
  pages/wc-shim-fdp.tmp.tsx (the real FDP with the planned D3 wiring, see below). **41/41 green.**
- mutate.py: 13 mutations, all red (chart emerald, held rows drawn, tag only on a branch, memo alert red, licence links for all,
  no cut at six, bars order, states linked, waiting without held, held age from the newest letter, 7 recent rows, bare fund link,
  period sub always).
- NT («counts nothing», «useCustodyFundAlerts( in custody-fund-line only», «no sample/Q marker») green with the new files.

## L names coded against (HUB adds them — plan §8; web tsc's ONLY WC errors are these 5)
top level `custodyLinks` (no echo):
- `log(op: FleetCustodyLedgerOp | null, metric)` → `/fleet/custody/log?op=<op>`; null → `?sort=date:desc`
  metrics: `custodyFund.charged|spent|replenished|settled` (op), `custodyFund.total`, `custodyFund.log`, `custodyFund.alertNegative` (null).
- `open(id, metric)` → `/fleet/custody/log?open=<id>` — `custodyFund.heldTotal` (one letter), `custodyFund.letter`, `custodyFund.recent`.
- `memos({status?, kind?}, metric)` → `/fleet/custody/memos?status=held|pending` / `?kind=<k>` — `custodyFund.held`,
  `custodyFund.inMemos`, `custodyFund.inMemosMore`, `custodyFund.heldTotal` (2+ letters), `custodyFund.outside.<kind>`,
  `custodyFund.alertStale`, `custodyFund.alertMemo`.
- `days(from, to, metric)` → `/fleet/custody-expenses?from&to` — `custodyFund.recent` (a «صرف» run).
- `licenceWaiting(kind | null, metric)` → `/fleet/license-expenses?[kind=<k>&]status=waiting` — `custodyFund.settle`,
  `custodyFund.settlePart`, `custodyFund.settleMore`, `custodyFund.alertLicence`, `custodyFund.alertSettleOver` (all only with
  `fleetLicenseExpense.view`).
- existing `custodyDashboardLink(metric)` (PATH_ONLY) — `custodyFund.waiting`, `custodyFund.outside`.
`periodLinks(data).custodySpend(metric, kind?: FleetCustodySource)` (D20): nothing but codes narrows →
`/fleet/custody-expenses?[source=<k>&]from&to[&vehicleCodes]`; else `/fleet/receipts?from&to&type&operation&branch&vehicleCodes&[kind=<k>&]source=custody`
— metrics `opex.custody` (KPI figure), `opex.custodyScreen` (KPI foot), `opex.custody.<maintenance|fuel|tyres|wash>` (bars).
tab link: `props.tabLink('fuel', 'opex.custody.tab')` — DEVIATION from the plan's `opex.custodyOverlap`: the census exempts only
`*.tab` metrics from «a narrowed period link carries type/operation/branch» (a tab link carries the page's params, not the echo).
The shim's builders (build-cl/wc-shim/wc-shim-tmp.spec.tsx) are the exact behaviour the spec pins (by path + params, any order).

## FDP wiring HUB applies (D3) — proven in build-cl/wc-shim/wc-shim-fdp.tmp.tsx
1. `import { CustodyTab } from '../components/fleet-dashboard/tab-custody'`; `MIXED_PANELS += { custody: CustodyTab }`;
   `MIXED_PERIOD_SECTIONS.custody = ['opex']`; drop `UNBUILT_TABS` (+ its type and the `NowTabKey` cast).
2. Mixed branch: `const web = !FLEET_DASHBOARD_TAB_READS[active].includes('now')`;
   own stamp = `web ? custody?.updatedAt ?? 0 : (reads.now ? nowQ.dataUpdatedAt : 0)`; «تحديث» = `web ? custody?.refetch() : nowQ.refetch`
   (+ R2 when drawn); `refreshing = (web ? custody?.fetching ?? false : reads.now && nowQ.isFetching) || (periodDrawn && periodQ.isFetching)`;
   no `nowPending` for a web tab. (The tab itself adds its ledger to the age and to «تحديث».)
3. `dashboardReads.period` = C0's planned D5 stub (keep): a custody-only reader sends no R2 → no period band (pinned).

## FX / PFX (HUB) — what the shared specs need (the tab spec does not)
- For LC/NT/RF to see the custody links in the census: `seedCustody` += `held.letters` (one letter, its memos tying to `held`),
  pending memos (2, one past 30 days), settle parts (≥ 7 to exercise «و N أخرى»; one past 30 days), a stale outside kind, and the
  ledger page under `custodyQueryKeys.ledger(CUSTODY_LEDGER_PARAMS)` (a run, a charge, a settle, one held, one transferred with a
  reference, one cancelled). PFX: `opex.custodyCount`, `custodyStates` (Σ = `opex.custody`) in FULL/YEAR/narrowed.
- LC «checked» params gained by this tab: `/fleet/custody/log?op|open|sort`, `/fleet/custody/memos?status|kind`,
  `/fleet/license-expenses?kind|status`, `/fleet/custody-expenses?source|from|to`, `/fleet/receipts?kind|source`.
- Census plain figures (named exceptions, no link): every count chip (receipts, memos, letters' memos, parts, alerts, cars),
  the held part's memo count, the visa/cash line, a settle row's amount, a pending memo's amount, the held letter memos' amounts,
  the strip tiles' feet, the three «منها حتى الآن» states, the bars' shares, the readout, the chart, the table's amount/after cells.

## Words — build-cl/i18n/wc.json (= WC.json): 28 keys, ar + en, change {}, dropRead []
`fleet.dash.custody.{sub, subNow, now, period, periodSub, open, more, unit, held.title, held.inside, held.none, alerts.title,
alerts.none, period.tag, period.statesHead, bars.title, bars.note, overlap, count.alert.{one,two,few,many,other},
count.car.{one,two,few,many,other}}` — copied from ZC's literals (`subNow` = the approved sub without its period clause, for a
reader with no period band). Checked (build-cl/wc-shim/check-wc.mjs): parity, identical placeholders, no collision with i18n.ts,
`offendersIn` = 0, no Latin in ar.
HUB adds its own `fleet.dash.shell.tab.custody` «العهدة» / 'Custody' (the tab title reads it).
Reused (keep for this tab): `fleet.custody.ledger.tiles.{requested,spent,replenished,settled,formulaRequests,requestedNote.*}`,
`fleet.custody.fundForm.before`, `fleet.custody.count.{memo,receipt}.*`, `fleet.custody.ledger.parts.*`,
`fleet.custody.dashboard.{fund.scopeSince, waiting.title, waiting.held, waiting.inMemos, waiting.oldest, waiting.note,
waiting.showExpenses, settle.title, settle.note, steps.title, steps.noteRequests, steps.after, steps.capped, steps.empty,
recent.title, recent.showLog, age.*, alerts.{negative,stale.*,memo,licence,settleOver}, states.*}`,
`fleet.custody.memos.outside.title`, `fleet.custody.source.*`, `fleet.custody.totals.fuel`, `fleet.custody.hold.{heldTileNote,
letterOf, chip, unchanged, waitingSince, transferredOn, reference}`, `fleet.custody.parts.{memoFallback,to}`,
`fleet.custody.ledger.{detail.period, now, columns.*}`, `fleet.custody.fundForm.settle.{kind.*, visa, cash, empty, moreCars.*}`,
`fleet.custody.actions.{requestShort,replenishShort,settleShort}` (via CUSTODY_OPS), `fleet.licenseExpenses.kinds.*`,
`fleet.nav.custodyExpenses`, `fleet.dash.summaries.{waiting,settle}`, `fleet.dash.period.dataFrom`, `fleet.dash.shell.tab.fuel`,
`fleet.dash.common.{liveChip, companyWide}`; the log's own `ledgerWords` keys.

## Look (temporary Vite harness, port 5329; files deleted from the tree; `git ls-files --others --ignored --exclude-standard -- apps/web | grep '/zz-'` prints nothing)
Copies + shots in build-cl/wc-harness/ (company-1920, branch-1920, c-1366, light-1536, phone 375, neg-1920 + crops chart.png,
branch-top.png, neg-chart.png, ph-a/ph-b): words, order, tones, operators, amber edges, register tiles, brand line/bars, «فتح»,
tables and notes match cust-dark / cust-branch-dark; «الشركة كلها» on «الآن» under the branch, never on the period band; the value
axis left with «ج.م» (fixed after the first shot: it had stood at the right); phone: tiles stacked with their operators, the
table as blocks, the chart scrolling inside its card; `scrollWidth − clientWidth = 0` at 375/1366/1536/1920. The only console
errors were the period bar's own list reads (no API behind the harness).

## Checks
- eslint + prettier: clean on all 18 owned files.
- web tsc: WC's errors are ONLY the 5 HUB-pending L names (`custodyLinks` ×2 imports, `custodySpend` ×3). The one other error
  (fleet-dashboard-tab-overview.spec.tsx:232) is not WC's.
- vitest: custody-*.spec + receipts-screen + receipts-memo-lock + fleet-row-actions-look + custody-dashboard-fund: 18 files /
  519 tests green. `src/modules/fleet/fleet-dashboard*`: the same 12 failures C0 listed (HUB re-pins) + the custody tab spec
  waiting for HUB's FDP — nothing new.

## Deviations / notes
1. `custodyDoneRows` is `custodyStepRows` re-exported (the rule already lived in lib/custody-hold.ts).
2. Tab-link metric `opex.custody.tab` (census `.tab` rule), not `opex.custodyOverlap`.
3. CFL gained `failure: unknown` beside the planned `detail`/`fetching` (the tab's error face shows the real error).
4. «في انتظار التحويل منذ 4 أيام» = `fleet.custody.dashboard.waiting.held` + the age words (two existing keys, as ZC did) — no new key.
5. The table's settle note reads the log's own words (`ledgerWords` → `useCount`): «تجديد تراخيص 2 سيارات، مد مدة 1 سيارة», where ZC
   wrote «سيارتين / سيارة واحدة». Kept identical to «سجل العهدة» (same line on both screens); a dual for the log's car count is a
   custody-screen wording hand-off (like critic B5), not changed here.
6. The held part of «تنتظر الاستعاضة» is drawn at 0.00 too (muted) with «فتح» to the held memos — a sum shows its parts (ZC).
7. The custody «الآن» reads stay company-wide; the tab never sends a branch to them.

## Told (for the owner's list)
- «العهدة» = «لوحة تحكم العهدة» in the new look: same formula, same names; «الآن» is the whole company since the first day (with
  «الشركة كلها» when a branch or «كل فروعي» is chosen); «خلال الفترة» follows the branch through the receipt's car.
- «في مذكرات لم تُستعَض بعد» and «تنتظر التسوية» list the first 6, then «و N أخرى» (the picture shows 2 and 3).
- «استعاضة معلّقة» lists every letter waiting (the picture has one); its age is the oldest letter's.
- The licensing «فتح» buttons and the settle total link only for a reader of «مصروفات التراخيص».
- «تنبيهات العهدة» shows only the lines that fire; late is amber, red only for a fund below zero or settlements over the fund.
- The chart draws the last 100 operations («آخر 100 عملية» when there are more); held and cancelled replenishments are not drawn.
- «مصروفات العهدة» and its kind bars are the same columns «صيانة / وقود من العهدة / كاوتش / غسيل» of «الوقود والمصروفات» for the same
  period and branch — never added to them; «منها حتى الآن» is today's state of those receipts (a past month can change).
- A reader of the custody fund without the receipts sees «الآن» only (no period band).

## Open hand-offs
- HUB: L builders above; FDP wiring above; i18n merge of wc.json + `fleet.dash.shell.tab.custody`; FX/PFX seeds for the census;
  NT 12-tab loop/RULED_OUT; LC params/metrics above; RT (custody memo/operation → LIVE + PAST) per plan D24; then run
  fleet-dashboard-tab-custody.spec.tsx (41 cases).
- A1: `held.letters` oldest first with each letter's memos (`no` asc) — the held card's age reads `letters[0]`; `custodyCount` and
  `custodyStates` (null when not permitted; Σ = `opex.custody`).
- INT: real-page shots of «العهدة» on port 5315 (company + «المهندسين», dark), 375 and 1366.
