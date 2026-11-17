// «العهدة» — the fund's history at the foot of the «الآن» band (approved/cust-dark.png; harness
// zz-custody-tab.tsx StepsChart / RecentTable), over «سجل العهدة» as «لوحة تحكم العهدة» reads it
// (`useCustodyLedger(CUSTODY_LEDGER_PARAMS)`: the newest lines, one page at the most the API serves —
// the same cache, so the two screens never differ):
//
//   · «إجمالي العهدة بعد كل عملية» — the page's full width: a step line in the brand (DECISIONS §5,
//     critic C8), red where the fund went below zero, over the DONE lines only (a held or cancelled
//     replenishment moves nothing: no step), a dot per line in its register colour (a request a
//     ring), «الآن» on the last point, the readout of the picked line, the legend; «آخر 100 عملية»
//     only when the history is longer than the page; on a phone it scrolls inside the card, opening
//     on the latest point;
//   · «آخر عمليات العهدة» — the page's full width: the newest FLEET_DASHBOARD_CUSTODY_RECENT_ROWS lines
//     of any status in the log's own words, a held line tinted «لم تتغيّر بعد», a transferred one with
//     its letter day and reference, «الآن» on the latest, «فتح» per row (an operation to its drawer, a
//     receipts run to «مصروفات العهدة» over its days); a table from 768 px, each row a block below.
//
// The axis is the custody board's own (`custodyStepScale`, `custodyNowLabelPlace`); the words are
// the log's (`ledgerWords`). Nothing is counted here.
import { useEffect, useRef, useState } from 'react';
import {
  FLEET_DASHBOARD_CUSTODY_RECENT_ROWS,
  type FleetCustodyLedgerRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { type useCustodyLedger } from '../../api/fleet-queries';
import { custodyLinks, type DashLink } from '../../lib/fleet-dashboard-links';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyDoneRows, custodyLedgerTarget } from '../../lib/custody-dashboard-fund';
import { ledgerWords } from '../../lib/custody-ledger-words';
import {
  CUSTODY_LEDGER_PARAMS,
  custodyNowLabelPlace,
  custodyStepScale,
} from '../CustodyDashboardFund';
import { CUSTODY_OPS } from '../CustodyFundActions';
import { useLedgerWordsKit } from '../CustodyOperationDrawer';
import { useMoney } from '../custody-dashboard-parts';
import { HoldAmountOr, HoldOpChip, holdRowTint } from '../custody-hold-parts';
import { LEDGER_OP_DOT, LedgerOpChip, ledgerOpLabel } from '../custody-ledger-parts';
import { Signed } from '../custody-memo-parts';
import { Phrase, ReadError, count } from './dash-shell';
import { BlockFoot, BlockHead } from './dash-blocks';
import {
  Btn,
  Card,
  DIVIDE,
  FootLink,
  HEAD_CHIP,
  I,
  MUTED,
  N,
  RED,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  cn,
} from './dash-kit';
import { Day, Money, useCustodyWords } from './tab-custody-words';

/** «سجل العهدة» as the custody board reads it — the tab reads it once and hands it down. */
export type LedgerRead = ReturnType<typeof useCustodyLedger>;

/** A figure of the fund — «−4,335.50» left to right below zero, red. */
const Signedless = ({ value, className }: { value: number; className?: string }): JSX.Element => {
  const { figure } = useMoney()(Math.abs(value));
  return (
    <N className={cn('font-bold', value < 0 ? RED : STRONG, className)}>
      {value < 0 ? '−' : ''}
      {figure}
    </N>
  );
};

/** Under an operation's slot, its short word («طلب», «استعاضة», «تسوية»). */
const shortOf = (op: Exclude<FleetCustodyLedgerRowDto['op'], 'spend'>): string =>
  CUSTODY_OPS[op].short;

/** «الآن» — the system's emerald now. */
const NOW_CHIP =
  'rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[11px] font-bold leading-4 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300';

/** A line's days: a receipts run its first and last. */
const LineDays = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  return row.op === 'spend' && row.dateTo !== null && row.dateTo !== row.date ? (
    <span className="whitespace-nowrap">
      <Day ymd={row.date} />{' '}
      <span className="text-[11px] text-slate-400">{t('fleet.custody.parts.to')}</span>{' '}
      <Day ymd={row.dateTo} />
    </span>
  ) : (
    <Day ymd={row.date} />
  );
};

/** Where a line leads: an operation to its drawer, a receipts run to its days (D13). */
const lineLink = (row: FleetCustodyLedgerRowDto): DashLink => {
  const target = custodyLedgerTarget(row);
  return target.kind === 'operation'
    ? custodyLinks.open(row.id, 'custodyFund.recent')
    : custodyLinks.days(target.from, target.to, 'custodyFund.recent');
};

/** A history on its way, or failed with nothing to show. */
const HistoryFace = ({
  ledger,
  marker,
  height,
}: {
  ledger: LedgerRead;
  marker: string;
  height: string;
}): JSX.Element =>
  ledger.isError ? (
    <div data-cust-history-error={marker} className="mt-5">
      <ReadError error={ledger.error} onRetry={() => void ledger.refetch()} />
    </div>
  ) : (
    <Skeleton className={cn('mt-5 rounded-2xl', height)} />
  );

// ── «إجمالي العهدة بعد كل عملية» ──────────────────────────────────────────────────────────────

/** The plot as the custody board draws it (its «الآن» label rule reads these). */
const CHART_H = 250;
const PAD = { top: 26, bottom: 8 };
const PLOT_W = 1000;
/** Each line's least width: the history fits a wide screen, scrolls on a narrow one. */
const SLOT_PX = 44;

/** A tick of the value axis: the whole figure, «−» below zero. */
const tickText = (tick: number): string => (tick < 0 ? `−${count(-tick)}` : count(tick));

const StepsChart = ({ rows, capped }: { rows: FleetCustodyLedgerRowDto[]; capped: boolean }) => {
  const t = useT();
  const w = useCustodyWords();
  const n = rows.length;
  const [picked, setPicked] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    // Wider than its card, the plot opens on its latest stretch — «الآن» — at the right end.
    if (box !== null) box.scrollLeft = box.scrollWidth;
  }, [n]);
  const { ticks, top, bottom, negative } = custodyStepScale(rows);
  const slot = PLOT_W / Math.max(1, n);
  const x = (i: number): number => slot * (i + 0.5);
  const y = (v: number): number =>
    PAD.top + (1 - (v - bottom) / Math.max(1, top - bottom)) * (CHART_H - PAD.top - PAD.bottom);
  const active = picked === null ? n - 1 : Math.min(picked, n - 1);
  const shown = rows[active];
  const latest = rows[n - 1];
  let line = `M 0 ${y(rows[0]?.before ?? 0)}`;
  rows.forEach((row, i) => {
    line += ` H ${x(i)} V ${y(row.after)}`;
  });
  const zero = y(0);
  const area = `${line} H ${PLOT_W} V ${zero} H 0 Z`;
  if (n > 0) line += ` H ${PLOT_W}`;
  const gradientId = 'cust-steps-area';
  const clip = (side: string): { clipPath?: string } =>
    negative ? { clipPath: `url(#cust-steps-${side})` } : {};
  const now = latest === undefined ? null : custodyNowLabelPlace(y(latest.after), y(latest.before));
  return (
    <Card data-cust-block="steps" className="mt-5">
      <BlockHead
        icon={I.trend}
        tone="brand"
        title={t('fleet.custody.dashboard.steps.title')}
        note={t('fleet.custody.dashboard.steps.noteRequests')}
        chips={
          capped ? (
            <span data-cust-chip="capped" className={HEAD_CHIP}>
              {t('fleet.custody.dashboard.steps.capped', {
                count: count(CUSTODY_LEDGER_PARAMS.pageSize),
              })}
            </span>
          ) : undefined
        }
      />
      {shown === undefined || latest === undefined || now === null ? (
        <p
          data-cust-steps-empty="true"
          className={cn('border-t px-5 py-4 text-[13px] font-semibold', RULE, MUTED)}
        >
          {t('fleet.custody.dashboard.steps.empty')}
        </p>
      ) : (
        <div className="px-5 pb-5">
          <div
            aria-live="polite"
            data-cust-readout={shown.id}
            className="flex min-h-[46px] flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700 shadow-inner dark:border-brand-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
          >
            <LedgerOpChip op={shown.op} size="sm" />
            <LineDays row={shown} />
            <span className="text-slate-400">·</span>
            <span className="text-[13px] font-bold">
              <Signed value={shown.amount} />
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-semibold">{t('fleet.custody.dashboard.steps.after')}</span>
            <span data-cust-readout-after={String(shown.after)}>
              <Money value={shown.after} className="text-sm" />
            </span>
            {shown.latest && (
              <span data-cust-readout-now="true" className={NOW_CHIP}>
                {t('fleet.custody.ledger.now')}
              </span>
            )}
          </div>
          {/* The days run left to right, the value axis at their start (the approved picture). */}
          <div dir="ltr" className="mt-3 flex gap-3">
            {/* The value axis, round steps in ج.م. */}
            <div aria-hidden="true" className="relative w-16 shrink-0" style={{ height: CHART_H }}>
              <span
                dir="rtl"
                className="absolute end-0 -top-1 whitespace-nowrap text-[11px] font-semibold text-slate-400 dark:text-slate-500"
              >
                {w('unit')}
              </span>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  data-cust-tick={String(tick)}
                  className="absolute end-0 -translate-y-1/2"
                  style={{ top: y(tick) }}
                >
                  <N className="block text-[11px] leading-none text-slate-400 dark:text-slate-500">
                    {tickText(tick)}
                  </N>
                </span>
              ))}
            </div>
            <div
              ref={scroller}
              data-cust-chart-scroller="true"
              className="min-w-0 flex-1 overflow-x-auto"
            >
              <div style={{ minWidth: `${n * SLOT_PX}px` }}>
                <div data-cust-plot="steps" className="relative" style={{ height: CHART_H }}>
                  <svg
                    viewBox={`0 0 ${PLOT_W} ${CHART_H}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full overflow-visible"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                        <stop
                          offset="0%"
                          style={{ stopColor: 'rgb(var(--brand-500))', stopOpacity: 0.24 }}
                        />
                        <stop
                          offset="100%"
                          style={{ stopColor: 'rgb(var(--brand-500))', stopOpacity: 0.02 }}
                        />
                      </linearGradient>
                      {negative && (
                        <>
                          <clipPath id="cust-steps-above">
                            <rect x={0} y={0} width={PLOT_W} height={zero} />
                          </clipPath>
                          <clipPath id="cust-steps-below">
                            <rect x={0} y={zero} width={PLOT_W} height={CHART_H - zero} />
                          </clipPath>
                        </>
                      )}
                    </defs>
                    {ticks.map((tick) => (
                      <line
                        key={tick}
                        {...(tick === 0 ? { 'data-cust-zero': 'true' } : {})}
                        x1={0}
                        x2={PLOT_W}
                        y1={y(tick)}
                        y2={y(tick)}
                        className={
                          tick === 0
                            ? 'stroke-slate-300 dark:stroke-[#2a3953]'
                            : 'stroke-slate-100 dark:stroke-[#1a2538]'
                        }
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <rect
                      data-cust-step-highlight={String(active)}
                      x={slot * active}
                      y={PAD.top - 18}
                      width={slot}
                      height={CHART_H - PAD.top + 18 - PAD.bottom}
                      rx={6}
                      className="fill-brand-50 stroke-brand-200 dark:fill-brand-500/10 dark:stroke-brand-500/30"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    {negative && (
                      <rect
                        data-cust-negative-band="true"
                        x={0}
                        y={zero}
                        width={PLOT_W}
                        height={y(bottom) - zero}
                        className="fill-red-500/10"
                      />
                    )}
                    <path
                      data-cust-area="above"
                      d={area}
                      fill={`url(#${gradientId})`}
                      {...clip('above')}
                    />
                    {negative && (
                      <path
                        data-cust-area="below"
                        d={area}
                        className="fill-red-500/15"
                        {...clip('below')}
                      />
                    )}
                    <path
                      data-cust-line="brand"
                      d={line}
                      fill="none"
                      className="stroke-brand-600 dark:stroke-brand-500"
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      {...clip('above')}
                    />
                    {negative && (
                      <path
                        data-cust-line="below"
                        d={line}
                        fill="none"
                        className="stroke-red-600 dark:stroke-red-400"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        {...clip('below')}
                      />
                    )}
                  </svg>
                  {rows.map((row, i) => (
                    <button
                      key={row.id}
                      type="button"
                      data-cust-step={row.id}
                      data-cust-op={row.op}
                      data-cust-after={String(row.after)}
                      aria-label={`${t(ledgerOpLabel(row.op))} ${slashDay(row.date)} — ${t('fleet.custody.dashboard.steps.after')} ${tickText(row.after)}`}
                      onMouseEnter={() => setPicked(i)}
                      onMouseLeave={() => setPicked(null)}
                      onFocus={() => setPicked(i)}
                      onBlur={() => setPicked(null)}
                      className={cn(
                        'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow',
                        row.op === 'charge'
                          ? 'border-[3px] bg-white dark:bg-[#0d1424]'
                          : 'border-2 border-white dark:border-[#0d1424]',
                        i === active && 'scale-125 ring-2 ring-brand-400/60',
                      )}
                      style={
                        row.op === 'charge'
                          ? {
                              left: `${(x(i) / PLOT_W) * 100}%`,
                              top: y(row.after),
                              borderColor: LEDGER_OP_DOT[row.op],
                            }
                          : {
                              left: `${(x(i) / PLOT_W) * 100}%`,
                              top: y(row.after),
                              backgroundColor: LEDGER_OP_DOT[row.op],
                            }
                      }
                    />
                  ))}
                  <span
                    data-cust-now-label={now.beside ? 'beside' : 'true'}
                    dir="rtl"
                    className={cn(
                      'absolute -translate-x-full whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-950/80 dark:text-emerald-300',
                    )}
                    style={{
                      left: `calc(${(x(n - 1) / PLOT_W) * 100}% ${now.beside ? '- 12px' : '+ 6px'})`,
                      top: now.top,
                    }}
                  >
                    {t('fleet.custody.ledger.now')} <Signedless value={latest.after} />
                  </span>
                </div>
                {/* Under each operation: what it was, and when (the receipts runs stand unnamed). */}
                <div data-cust-xaxis="steps" className="relative mt-2 h-9">
                  {rows.map((row, i) =>
                    row.op === 'spend' ? null : (
                      <span
                        key={row.id}
                        data-cust-xlabel={row.id}
                        className="absolute flex -translate-x-1/2 flex-col items-center gap-0.5"
                        style={{ left: `${(x(i) / PLOT_W) * 100}%` }}
                      >
                        <span
                          dir="rtl"
                          className="whitespace-nowrap text-[11px] font-bold text-slate-600 dark:text-slate-300"
                        >
                          {t(shortOf(row.op))}
                        </span>
                        <N className="whitespace-nowrap text-[10.5px] text-slate-500 dark:text-slate-400">
                          {slashDay(row.date).slice(5)}
                        </N>
                      </span>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
          <div
            data-cust-legend="steps"
            className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                data-cust-swatch="line"
                className="h-0.5 w-5 rounded-full bg-brand-600 dark:bg-brand-500"
              />
              {t('fleet.custody.dashboard.steps.title')}
            </span>
            {(['charge', 'spend', 'replenish', 'settle'] as const).map((op) => (
              <span key={op} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden="true"
                  className={cn('h-2.5 w-2.5 rounded-full', op === 'charge' && 'border-2')}
                  style={
                    op === 'charge'
                      ? { borderColor: LEDGER_OP_DOT[op] }
                      : { backgroundColor: LEDGER_OP_DOT[op] }
                  }
                />
                {t(ledgerOpLabel(op))}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

// ── «آخر عمليات العهدة» ───────────────────────────────────────────────────────────────────────

const CELL = 'px-3 py-3.5 align-middle first:ps-5 last:pe-5';

/** A line's day: a transferred replenishment its letter day under it, a run its last day. */
const RecentDate = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  if (row.op === 'replenish' && row.status === 'done' && row.letterDate !== null)
    return (
      <span className="inline-flex flex-col items-start leading-[18px]">
        <Day ymd={row.date} />
        <span className={cn('whitespace-nowrap text-[11px] leading-4', MUTED)}>
          <Phrase
            text={t('fleet.custody.hold.letterOf')}
            parts={{ date: <N>{slashDay(row.letterDate)}</N> }}
          />
        </span>
      </span>
    );
  if (row.op === 'spend' && row.dateTo !== null && row.dateTo !== row.date)
    return (
      <span className="inline-flex flex-col items-start leading-[18px]">
        <Day ymd={row.date} />
        <span className={cn('whitespace-nowrap text-[11.5px] leading-4', MUTED)}>
          {t('fleet.custody.parts.to')}{' '}
          <N className="font-semibold text-slate-500 dark:text-slate-400">{slashDay(row.dateTo)}</N>
        </span>
      </span>
    );
  return <Day ymd={row.date} />;
};

/** «التفاصيل» in the log's own words; a held line «في انتظار تحويل المبلغ منذ …», a transferred
 *  one «حُوِّل المبلغ في …» and its reference when one was typed. */
const RecentDetail = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  const words = ledgerWords(row, useLedgerWordsKit());
  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={cn(
          'text-[13px] font-bold',
          row.op === 'spend' || row.status === 'cancelled'
            ? 'text-slate-600 dark:text-slate-300'
            : STRONG,
        )}
      >
        {words.title}
      </span>
      {words.note !== '' && (
        <span className={cn('text-[12px] leading-5', MUTED)}>{words.note}</span>
      )}
      {row.status === 'held' && (
        <span
          data-cust-held-note="true"
          className="mt-0.5 whitespace-nowrap text-[12px] font-bold leading-4 text-amber-700 dark:text-amber-300"
        >
          <Phrase
            text={t('fleet.custody.hold.waitingSince')}
            parts={{ date: <N>{slashDay(row.date)}</N> }}
          />
        </span>
      )}
      {row.op === 'replenish' && row.status === 'done' && row.transfer !== null && (
        <span
          data-cust-transfer-note="true"
          className="mt-0.5 text-[12px] font-bold leading-4 text-emerald-700 dark:text-emerald-400"
        >
          ✓{' '}
          <Phrase
            text={t('fleet.custody.hold.transferredOn')}
            parts={{ date: <N>{slashDay(row.transfer.date)}</N> }}
          />
          {row.transfer.reference !== '' && (
            <span
              data-cust-reference="true"
              className="ms-2 font-medium text-slate-500 dark:text-slate-400"
            >
              <Phrase
                text={t('fleet.custody.hold.reference')}
                parts={{ ref: <N>{row.transfer.reference}</N> }}
              />
            </span>
          )}
        </span>
      )}
    </span>
  );
};

const RecentAfter = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Signedless value={row.after} />
        {row.latest && (
          <span data-cust-now-chip="true" className={NOW_CHIP}>
            {t('fleet.custody.ledger.now')}
          </span>
        )}
      </span>
      {row.status === 'held' && (
        <span className="whitespace-nowrap text-[11px] font-semibold leading-4 text-amber-700/90 dark:text-amber-300/80">
          {t('fleet.custody.hold.unchanged')}
        </span>
      )}
    </span>
  );
};

const OpCell = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => (
  <HoldOpChip status={row.status} size="xs">
    <LedgerOpChip op={row.op} size="sm" />
  </HoldOpChip>
);

const AmountCell = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => (
  <span className="text-[13px] font-bold">
    <HoldAmountOr
      status={row.status}
      value={row.amount}
      note={false}
      done={<Signed value={row.amount} />}
    />
  </span>
);

const rowLook = (row: FleetCustodyLedgerRowDto): string | undefined =>
  holdRowTint(row.status) ??
  (row.op === 'spend' ? 'bg-slate-50/70 dark:bg-white/[0.02]' : undefined);

const RecentTable = ({ rows }: { rows: FleetCustodyLedgerRowDto[] }): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  const C = 'fleet.custody.ledger.columns';
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-cust-block="recent" className="mt-5">
      <BlockHead icon={I.rank} tone="slate" title={t('fleet.custody.dashboard.recent.title')} />
      {rows.length === 0 ? (
        <p className={cn('border-t px-5 py-4 text-[13px] font-semibold', RULE, MUTED)}>
          {t('fleet.custody.dashboard.steps.empty')}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-[13px]">
              <colgroup>
                <col className="w-[17%]" />
                <col className="w-[15%]" />
                <col />
                <col className="w-[13%]" />
                <col className="w-[14%]" />
                <col className="w-[104px]" />
              </colgroup>
              <thead className={TH_ROW}>
                <tr className={cn('border-y', RULE)}>
                  <th className={th}>{t(`${C}.date`)}</th>
                  <th className={th}>{t(`${C}.op`)}</th>
                  <th className={th}>{t(`${C}.detail`)}</th>
                  <th className={th}>{t(`${C}.amount`)}</th>
                  <th className={th}>{t(`${C}.after`)}</th>
                  <th className={cn(CELL, 'py-2.5')}>
                    <span className="sr-only">{w('open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className={DIVIDE}>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-cust-row={row.id}
                    data-cust-status={row.status}
                    className={rowLook(row)}
                  >
                    <td className={CELL}>
                      <RecentDate row={row} />
                    </td>
                    <td className={CELL}>
                      <OpCell row={row} />
                    </td>
                    <td className={CELL}>
                      <RecentDetail row={row} />
                    </td>
                    <td className={cn(CELL, 'whitespace-nowrap')}>
                      <AmountCell row={row} />
                    </td>
                    <td className={cn(CELL, 'whitespace-nowrap')}>
                      <RecentAfter row={row} />
                    </td>
                    <td className={cn(CELL, 'text-end')}>
                      <Btn link={lineLink(row)} className="h-9 px-4">
                        {w('open')}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Under 768 px: each line a block of its own — the page never scrolls sideways. */}
          <ul className={cn('border-t md:hidden', RULE, DIVIDE)}>
            {rows.map((row) => (
              <li
                key={row.id}
                data-cust-row-phone={row.id}
                className={cn('flex flex-col gap-2 px-4 py-3.5 text-[13px]', rowLook(row))}
              >
                <div className="flex flex-col items-start gap-1.5">
                  <OpCell row={row} />
                  <RecentDate row={row} />
                </div>
                <RecentDetail row={row} />
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className={cn('font-semibold', MUTED)}>{t(`${C}.amount`)}</dt>
                  <dd>
                    <AmountCell row={row} />
                  </dd>
                  <dt className={cn('font-semibold', MUTED)}>{t(`${C}.after`)}</dt>
                  <dd>
                    <RecentAfter row={row} />
                  </dd>
                </dl>
                <Btn link={lineLink(row)} className="h-9 w-full px-4">
                  {w('open')}
                </Btn>
              </li>
            ))}
          </ul>
        </>
      )}
      <BlockFoot>
        <FootLink link={custodyLinks.log(null, 'custodyFund.log')}>
          {t('fleet.custody.dashboard.recent.showLog')}
        </FootLink>
      </BlockFoot>
    </Card>
  );
};

// ── Both ──────────────────────────────────────────────────────────────────────────────────────

export const CustodyHistory = ({ ledger }: { ledger: LedgerRead }): JSX.Element => {
  const page = ledger.data;
  if (page === undefined) {
    return (
      <>
        <HistoryFace ledger={ledger} marker="steps" height="h-96" />
        {!ledger.isError && <Skeleton className="mt-5 h-80 rounded-2xl" />}
      </>
    );
  }
  return (
    <>
      <StepsChart
        rows={custodyDoneRows(page.items)}
        capped={page.meta.totalItems > page.items.length}
      />
      <RecentTable rows={page.items.slice(0, FLEET_DASHBOARD_CUSTODY_RECENT_ROWS)} />
    </>
  );
};
