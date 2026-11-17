// «العهدة» — the «الآن» band (approved/cust-dark.png and cust-branch-dark.png; harness
// zz-custody-tab.tsx NowBand; DECISIONS §9 and its critic), over the custody screen's OWN reads (the
// fund's summary, the replenish and settle candidates and the banner's lines — `props.custody.detail`,
// the very reads «لوحة تحكم العهدة» makes), for the department's whole fund since its first day:
//
//   · the band's head: the live chip, «من بداية العهدة», and «الشركة كلها» while the figures are
//     narrowed to the reader's branches (a chosen branch AND «كل فروعي» — critic C1, E1);
//   · the formula as five tiles «طلبات − مصروفات + استعاضة − تسوية = إجمالي العهدة الآن», the
//     operators at every width (stacked on a phone), each tile in its register colour, the fund red
//     «−X» below zero; no «استعاضة معلّقة» line on the strip (critic C5);
//   · three cards on the amber «waits» edge, their tiles in the register colours (critic C2):
//     «تنتظر الاستعاضة» (its three parts — the held letters' memos, the memos waiting, the receipts in
//     no memo yet — with held money INSIDE it), «استعاضة معلّقة» (each letter waiting for its
//     transfer and its memos), «تنتظر التسوية» (the licensing memos waiting); at most
//     FLEET_DASHBOARD_CUSTODY_WAIT_ROWS rows in a list, then «و N أخرى»;
//   · «تنبيهات العهدة»: the fund's banner lines that fire (a–e) in the banner's order and words,
//     amber with a clock, red only for (a) and (e) (critic A3);
//   · then the history (tab-custody-history.tsx).
//
// Every link names its list's parameters (never `?fund=`, never `letter=1`, never a bare list —
// critic C6); a licensing link only for a reader of «مصروفات التراخيص». NOTHING IS COUNTED HERE: the
// figures are the reads' fields, and the counts of a list are the custody lib's.
import {
  FLEET_CUSTODY_STALE_DAYS,
  FLEET_DASHBOARD_CUSTODY_WAIT_ROWS,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyHeldLetterDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySettleCandidateDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { custodyDashboardLink, custodyLinks, type DashLink } from '../../lib/fleet-dashboard-links';
import {
  custodyAgeDays,
  custodyLetterMemos,
  custodyOutsideReceipts,
  custodyPendingCount,
  custodySettleCount,
  custodyWaiting,
  type CustodyFundAlert,
} from '../../lib/custody-dashboard-fund';
import { codesShown } from '../../lib/custody-fund-forms';
import { useCustodyCount } from '../../lib/custody-words';
import { CUSTODY_OPS } from '../CustodyFundActions';
import { CUSTODY_FUND } from '../CustodyKinds';
import { LICENCE_DOT, LICENCE_PILL } from '../CustodySettleDialog';
import { HOLD_CLOCK } from '../custody-hold-parts';
import { RECEIPT_ICON } from '../custody-memo-parts';
import { useMoney } from '../custody-dashboard-parts';
import { type CustodyDetail, type CustodyFigures } from './custody-fund-line';
import { Amount, Phrase, count, type MixedTabProps } from './dash-shell';
import { BandHead, BigMoney, BlockHead, COUNT_CHIP, ReadBand } from './dash-blocks';
import {
  BAND,
  BOX,
  Btn,
  CHIP,
  Card,
  CarChip,
  CompanyWide,
  DIVIDE,
  FootLink,
  Fig,
  I,
  Icon,
  IconTile,
  LiveChip,
  MUTED,
  N,
  NUM,
  RULE,
  STRONG,
  TITLE,
  TONE,
  Tag,
  UNIT,
  WELL,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { CustodyHistory, type LedgerRead } from './tab-custody-history';
import {
  Age,
  AgeChip,
  Counted,
  Day,
  FOOT,
  Money,
  PeriodPhrase,
  narrowedView,
  useCustodyWords,
  useMemoName,
} from './tab-custody-words';

const UNDER = cn('whitespace-nowrap text-[12.5px] font-semibold', MUTED);
const PART_NAME = cn('whitespace-nowrap text-[14px] font-bold', STRONG);

/** «و N أخرى ←» under a list cut at FLEET_DASHBOARD_CUSTODY_WAIT_ROWS — N a lib count less the cut. */
const More = ({
  rest,
  link,
  marker,
}: {
  rest: number;
  link: DashLink | null;
  marker: string;
}): JSX.Element | null => {
  const w = useCustodyWords();
  if (rest <= 0) return null;
  const words = (
    <span data-cust-more={marker} data-cust-rest={String(rest)}>
      <Phrase text={w('more')} parts={{ count: <N>{count(rest)}</N> }} />
    </span>
  );
  return (
    <div className="pt-2.5">
      {link === null ? (
        <span className={cn('text-[13px] font-bold', MUTED)}>{words}</span>
      ) : (
        <FootLink link={link}>{words}</FootLink>
      )}
    </div>
  );
};

// ── 1 · The formula: five tiles ───────────────────────────────────────────────────────────────

/** The circled sign before a term: between two tiles in one row (from xl), between two stacked
 *  tiles under it — kept at every width (the custody screen hides it under xl and loses its
 *  equation). */
const OPERATOR = cn(
  'absolute z-10 flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-base font-black leading-none text-slate-700 shadow-sm dark:border-slate-600 dark:bg-[#0b0f19] dark:text-slate-200',
  NUM,
  'max-xl:-top-6 max-xl:left-1/2 max-xl:-translate-x-1/2 xl:-start-6 xl:top-1/2 xl:-translate-y-1/2',
);

/** A term's figure: Cairo black, a size under the hero (five tiles share the row). */
const TERM_FIGURE =
  'text-[24px] font-black leading-none tracking-tight text-slate-900 tabular-nums dark:text-white min-[1700px]:text-[28px]';

type TermId = 'charged' | 'spent' | 'replenished' | 'settled' | 'fund';

interface Term {
  id: TermId;
  label: string;
  value: number;
  tone: Tone;
  icon: IconPath;
  operator: '−' | '+' | '=' | null;
  foot: JSX.Element;
  link: DashLink;
}

const Strip = ({ summary }: { summary: FleetCustodyFundSummaryDto }): JSX.Element => {
  const t = useT();
  const terms: Term[] = [
    {
      id: 'charged',
      label: t('fleet.custody.ledger.tiles.requested'),
      value: summary.charged.amount,
      tone: 'teal',
      icon: CUSTODY_OPS.charge.icon,
      operator: null,
      foot: <Counted n={summary.charged.count} noun="request" />,
      link: custodyLinks.log('charge', 'custodyFund.charged'),
    },
    {
      id: 'spent',
      label: t('fleet.custody.ledger.tiles.spent'),
      value: summary.spent.amount,
      tone: 'slate',
      icon: RECEIPT_ICON,
      operator: '−',
      foot: <Counted n={summary.spent.count} noun="receipt" />,
      link: custodyLinks.log('spend', 'custodyFund.spent'),
    },
    {
      id: 'replenished',
      label: t('fleet.custody.ledger.tiles.replenished'),
      value: summary.replenished.amount,
      tone: 'sky',
      icon: CUSTODY_OPS.replenish.icon,
      operator: '+',
      foot: <Counted n={summary.replenished.memos} noun="memo" />,
      link: custodyLinks.log('replenish', 'custodyFund.replenished'),
    },
    {
      id: 'settled',
      label: t('fleet.custody.ledger.tiles.settled'),
      value: summary.settled.amount,
      tone: 'emerald',
      icon: CUSTODY_OPS.settle.icon,
      operator: '−',
      foot: <Counted n={summary.settled.parts} noun="part" />,
      link: custodyLinks.log('settle', 'custodyFund.settled'),
    },
    {
      id: 'fund',
      label: t('fleet.custody.fundForm.before'),
      value: summary.fundTotal,
      tone: 'slate',
      icon: CUSTODY_FUND.icon,
      operator: '=',
      foot: (
        <span data-cust-formula="true" className="whitespace-nowrap">
          {t('fleet.custody.ledger.tiles.formulaRequests')}
        </span>
      ),
      link: custodyLinks.log(null, 'custodyFund.total'),
    },
  ];
  return (
    <div
      data-cust-block="strip"
      aria-label={t('fleet.custody.ledger.tiles.formulaRequests')}
      className="grid grid-cols-1 gap-5 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)]"
    >
      {terms.map((term) => (
        <div key={term.id} className="relative" data-cust-term-slot={term.id}>
          {term.operator !== null && (
            <span aria-hidden="true" data-cust-operator={term.operator} className={OPERATOR}>
              {term.operator}
            </span>
          )}
          <Card
            accent={term.tone}
            data-cust-term={term.id}
            data-cust-tone={term.tone}
            data-cust-amount={String(term.value)}
            {...(term.value < 0 ? { 'data-cust-negative': 'true' } : {})}
            className={cn(
              'h-full',
              term.id === 'fund' && 'ring-1 ring-inset ring-slate-300/70 dark:ring-slate-400/25',
            )}
          >
            <div className="flex flex-1 flex-col px-4 pb-3.5 pt-4">
              <div className="flex items-start justify-between gap-2">
                <h3
                  className={cn(
                    'whitespace-nowrap pt-1 text-[13px] font-bold',
                    term.id === 'fund'
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-700 dark:text-slate-300',
                  )}
                >
                  {term.label}
                </h3>
                <IconTile d={term.icon} tone={term.tone} />
              </div>
              <div className="mt-2.5 flex items-end">
                <span
                  className={cn(TERM_FIGURE, term.value < 0 && '!text-red-600 dark:!text-red-400')}
                >
                  <Fig link={term.link}>
                    <Amount
                      value={term.value}
                      className="!font-[inherit]"
                      unitClassName={cn(UNIT, 'text-[12px]')}
                    />
                  </Fig>
                </span>
              </div>
            </div>
            <div
              data-cust-box={term.id}
              className={cn(
                BAND,
                'mt-auto flex min-h-[40px] items-center px-4 py-2.5 text-[12.5px] font-semibold',
                MUTED,
              )}
            >
              {term.foot}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
};

// ── 2 · The three cards that wait ─────────────────────────────────────────────────────────────

/** A waiting card's head: the amber dot and title, the line or tag under it, the register tile. */
const WaitHead = ({
  tile,
  icon,
  title,
  under,
}: {
  tile: Tone;
  icon: IconPath;
  title: string;
  under: JSX.Element;
}): JSX.Element => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap pt-1')}>
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE.amber.dot)} />
        {title}
      </h3>
      <div className="mt-1.5 flex h-5 items-center">{under}</div>
    </div>
    <span data-cust-tile={tile}>
      <IconTile d={icon} tone={tile} />
    </span>
  </div>
);

/** The big figure and its count chip. */
const Headline = ({
  value,
  link,
  chip,
  marker,
}: {
  value: number;
  link: DashLink | null;
  chip: JSX.Element;
  marker: string;
}): JSX.Element => (
  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
    <BigMoney value={value} link={link} />
    <span data-cust-chip={marker} className={cn(COUNT_CHIP, TONE.slate.soft)}>
      {chip}
    </span>
  </div>
);

/** A part of «تنتظر الاستعاضة»: its name and count, its amount and «فتح». */
const PartHead = ({
  name,
  under,
  amount,
  link,
}: {
  name: string;
  under: JSX.Element;
  amount: number;
  link: DashLink;
}): JSX.Element => {
  const w = useCustodyWords();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className={PART_NAME}>{name}</span>
        <span className={UNDER}>{under}</span>
      </p>
      <div className="flex shrink-0 items-center gap-3">
        <Money value={amount} className="text-[15px]" />
        <Btn link={link} className="h-8 px-3">
          {w('open')}
        </Btn>
      </div>
    </div>
  );
};

/** One kind of the receipts in no memo yet: its amount (its memos' list), receipts, oldest. */
const OutsideKind = ({ line }: { line: FleetCustodyOutsideKindDto }): JSX.Element => {
  const t = useT();
  const late = line.stale.count > 0;
  return (
    <div
      data-cust-outside={line.kind}
      data-cust-amount={String(line.total)}
      {...(late ? { 'data-cust-late': 'true' } : {})}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border px-3 py-2.5',
        late
          ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/[0.06]'
          : 'border-slate-200 bg-white dark:border-[#1e2a3f] dark:bg-[#0a101b]/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('whitespace-nowrap text-[13px] font-bold', STRONG)}>
          {t(`fleet.custody.source.${line.kind}`)}
        </span>
        <Money
          value={line.total}
          link={custodyLinks.memos({ kind: line.kind }, `custodyFund.outside.${line.kind}`)}
          className="text-[13.5px]"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px]">
        <span className={cn('whitespace-nowrap font-semibold', MUTED)}>
          <Counted n={line.count} noun="receipt" />
        </span>
        {line.oldest !== null && <AgeChip day={line.oldest} lead />}
      </div>
    </div>
  );
};

/** «تنتظر الاستعاضة» — what «استعاضة العهدة» would bring back: the held letters' memos, the memos
 *  waiting, the receipts in no memo yet (the custody screen's N2, held money inside it — D3). */
const WaitingCard = ({
  detail,
  waiting,
  className,
}: {
  detail: CustodyDetail;
  /** The CFL figure — «ملخصات» shows the same field. */
  waiting: number | null;
  className: string;
}): JSX.Element => {
  const t = useT();
  const memoName = useMemoName();
  const { summary, replenish } = detail;
  const parts = custodyWaiting(
    replenish.memos,
    replenish.outside,
    summary.memos.pendingTotal,
    summary.held,
  );
  const total = waiting ?? parts.total;
  const pending = custodyPendingCount(replenish.memos);
  return (
    <Card
      accent="amber"
      data-cust-wait="waiting"
      data-cust-amount={String(total)}
      className={className}
    >
      <div className="flex flex-1 flex-col px-5 pb-2 pt-5">
        <WaitHead
          tile="sky"
          icon={CUSTODY_OPS.replenish.icon}
          title={t('fleet.dash.summaries.waiting')}
          under={<span className={UNDER}>{t('fleet.custody.dashboard.waiting.title')}</span>}
        />
        <Headline
          value={total}
          link={custodyDashboardLink('custodyFund.waiting')}
          marker="waiting-receipts"
          chip={<Counted n={parts.receipts} noun="receipt" />}
        />
        <div
          className={cn(
            'mt-4 grid grid-cols-1 border-t lg:grid-cols-2 lg:gap-x-8 min-[1500px]:grid-cols-1 min-[1500px]:gap-x-0',
            RULE,
          )}
        >
          <ul className={DIVIDE}>
            <li data-cust-part="held" data-cust-amount={String(parts.held)} className="py-3">
              <PartHead
                name={t('fleet.custody.dashboard.waiting.held')}
                under={<Counted n={summary.held.memos} noun="memo" />}
                amount={parts.held}
                link={custodyLinks.memos({ status: 'held' }, 'custodyFund.held')}
              />
            </li>
            <li data-cust-part="inMemos" data-cust-amount={String(parts.inMemos)} className="py-3">
              <PartHead
                name={t('fleet.custody.dashboard.waiting.inMemos')}
                under={<Counted n={pending} noun="memo" />}
                amount={parts.inMemos}
                link={custodyLinks.memos({ status: 'pending' }, 'custodyFund.inMemos')}
              />
              {pending > 0 && (
                <ul
                  className={cn(WELL, 'mt-2.5 divide-y divide-slate-200/70 dark:divide-[#1a2538]')}
                >
                  {/* The candidates' own order (oldest first), cut at the tab's rows. */}
                  {replenish.memos.slice(0, FLEET_DASHBOARD_CUSTODY_WAIT_ROWS).map((memo) => (
                    <li
                      key={memo.id}
                      data-cust-memo={String(memo.no)}
                      data-cust-amount={String(memo.total)}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                        <span className={cn('font-bold', STRONG)}>{memoName(memo)}</span>
                        <span className={cn('whitespace-nowrap', MUTED)}>
                          <Day ymd={memo.date} /> · <Counted n={memo.receipts} noun="receipt" />
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        <AgeChip day={memo.date} />
                        <Money value={memo.total} className="text-[13.5px]" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <More
                rest={pending - FLEET_DASHBOARD_CUSTODY_WAIT_ROWS}
                link={custodyLinks.memos({ status: 'pending' }, 'custodyFund.inMemosMore')}
                marker="inMemos"
              />
            </li>
          </ul>
          <div
            data-cust-part="outside"
            data-cust-amount={String(parts.outside)}
            className={cn('border-t py-3 lg:border-t-0 min-[1500px]:border-t', RULE)}
          >
            <PartHead
              name={t('fleet.custody.memos.outside.title')}
              under={<Counted n={custodyOutsideReceipts(replenish.outside)} noun="receipt" />}
              amount={parts.outside}
              link={custodyDashboardLink('custodyFund.outside')}
            />
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* One per custody kind, in the custody order, zeros kept (the read's own). */}
              {replenish.outside.map((line) => (
                <OutsideKind key={line.kind} line={line} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div data-cust-foot="waiting" className={FOOT}>
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span>{t('fleet.custody.dashboard.waiting.note')}</span>
      </div>
    </Card>
  );
};

/** One letter waiting for its transfer: its day and memos, its period, «فتح», its memos. */
const Letter = ({ letter }: { letter: FleetCustodyHeldLetterDto }): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  const memoName = useMemoName();
  return (
    <li data-cust-letter={letter.id} data-cust-amount={String(letter.amount)} className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-col">
          <span className={cn('text-[13px] font-bold', STRONG)}>
            <Phrase
              text={t('fleet.custody.hold.letterOf')}
              parts={{ date: <Day ymd={letter.date} className="!text-inherit" /> }}
            />
            <span className={cn('font-semibold', MUTED)}>
              {' '}
              · <Counted n={custodyLetterMemos(letter)} noun="memo" />
            </span>
          </span>
          {letter.from !== null && letter.to !== null && (
            <span data-cust-letter-period="true" className={cn('text-[12px] leading-5', MUTED)}>
              <PeriodPhrase from={letter.from} to={letter.to} />
            </span>
          )}
        </span>
        <Btn link={custodyLinks.open(letter.id, 'custodyFund.letter')} className="h-8 px-3">
          {w('open')}
        </Btn>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {letter.memos.map((memo) => (
          <li
            key={memo.id}
            data-cust-held-memo={String(memo.no)}
            data-cust-amount={String(memo.total)}
            className={cn(BOX, 'flex items-center justify-between gap-3 px-3 py-3')}
          >
            <span className="flex min-w-0 flex-col gap-0.5 text-[12.5px]">
              <span className={cn('font-bold', STRONG)}>{memoName(memo)}</span>
              <span className={cn('whitespace-nowrap text-[12px]', MUTED)}>
                <Day ymd={memo.date} /> · <Counted n={memo.receipts} noun="receipt" />
              </span>
            </span>
            <Money value={memo.total} className="text-[13.5px]" />
          </li>
        ))}
      </ul>
    </li>
  );
};

/** «استعاضة معلّقة» — the letters sent, their money not transferred yet: inside «تنتظر الاستعاضة»
 *  (its first part), not in the fund until «تأكيد التحويل». */
const HeldCard = ({ summary }: { summary: FleetCustodyFundSummaryDto }): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  const { held } = summary;
  const [first] = held.letters;
  // One letter: its own drawer; more than one: the held memos' list.
  const link =
    held.count === 1 && first !== undefined
      ? custodyLinks.open(first.id, 'custodyFund.heldTotal')
      : custodyLinks.memos({ status: 'held' }, 'custodyFund.heldTotal');
  return (
    <Card accent="amber" data-cust-wait="held" data-cust-amount={String(held.amount)}>
      <div className="flex flex-1 flex-col px-5 pb-2 pt-5">
        <WaitHead
          tile="amber"
          icon={HOLD_CLOCK}
          title={w('held.title')}
          under={
            <span data-cust-tag="inside">
              <Tag tone="amber" dot>
                {w('held.inside')}
              </Tag>
            </span>
          }
        />
        <Headline
          value={held.amount}
          link={held.count === 0 ? null : link}
          marker="held-receipts"
          chip={<Counted n={held.receipts} noun="receipt" />}
        />
        {first === undefined ? (
          <p
            data-cust-held-none="true"
            className={cn('mt-4 border-t pt-3 text-[13px] font-semibold', RULE, MUTED)}
          >
            {w('held.none')}
          </p>
        ) : (
          <div className={cn('mt-4 border-t pt-3', RULE)}>
            {/* The oldest letter's age (the custody pages' cut): «في انتظار التحويل منذ 4 أيام». */}
            <p
              data-cust-held-since={String(custodyAgeDays(first.date))}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold',
                TONE.amber.text,
              )}
            >
              <Icon d={HOLD_CLOCK} className="h-4 w-4 shrink-0" />
              <span>
                {t('fleet.custody.dashboard.waiting.held')}{' '}
                <Age days={custodyAgeDays(first.date)} />
              </span>
            </p>
            <ul className={DIVIDE}>
              {held.letters.map((letter) => (
                <Letter key={letter.id} letter={letter} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <div data-cust-foot="held" className={FOOT}>
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span>{t('fleet.custody.hold.heldTileNote')}</span>
      </div>
    </Card>
  );
};

/** A licensing memo's kind in its pill — a renewal sky, an extension violet (the settle dialog's). */
const LicencePill = ({ part }: { part: FleetCustodySettleCandidateDto['part'] }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-cust-licence-kind={part}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-bold leading-5',
        LICENCE_PILL[part],
      )}
    >
      <i className={cn('h-1.5 w-1.5 rounded-full', LICENCE_DOT[part])} />
      {t(`fleet.custody.fundForm.settle.kind.${part}`)}
    </span>
  );
};

/** The cars of a licensing memo: their chips, then «و19 سيارة أخرى» (the settle dialog's way). */
const Cars = ({ codes }: { codes: readonly string[] }): JSX.Element => {
  const t = useT();
  const { form } = useCustodyCount();
  const list = codesShown(codes);
  return (
    <>
      {list.shown.map((code, i) => (
        <CarChip key={`${code}:${i}`} code={code} />
      ))}
      {list.more > 0 && (
        <span className={cn('whitespace-nowrap font-semibold', MUTED)}>
          {t(`fleet.custody.fundForm.settle.moreCars.${form(list.more)}`, {
            count: count(list.more),
          })}
        </span>
      )}
    </>
  );
};

const SettleRow = ({
  part,
  licences,
}: {
  part: FleetCustodySettleCandidateDto;
  licences: boolean;
}): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  const money = useMoney();
  return (
    <li
      data-cust-settle={`${part.expenseId}:${part.part}`}
      data-cust-amount={String(part.total)}
      className="flex flex-col gap-2 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex flex-wrap items-center gap-2">
          <LicencePill part={part.part} />
          <Day ymd={part.date} className="text-[12.5px]" />
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <Money value={part.total} className="text-[15px]" />
          {licences && (
            <Btn
              link={custodyLinks.licenceWaiting(part.part, 'custodyFund.settlePart')}
              className="h-8 px-3"
            >
              {w('open')}
            </Btn>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 max-sm:flex-col max-sm:items-start">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
          <span className={cn('whitespace-nowrap font-semibold', MUTED)}>
            <Counted n={part.cars} noun="car" />:
          </span>
          <Cars codes={part.codes} />
        </span>
        <AgeChip day={part.date} />
      </div>
      {/* The settle dialog's own line: the two figures, no currency (the amount above has it). */}
      <p data-cust-split="true" className={cn('whitespace-nowrap text-[11.5px]', MUTED)}>
        {t('fleet.custody.fundForm.settle.visa')}{' '}
        <N className="font-semibold text-slate-600 dark:text-slate-300">
          {money(part.visaTotal).figure}
        </N>{' '}
        • {t('fleet.custody.fundForm.settle.cash')}{' '}
        <N className="font-semibold text-slate-600 dark:text-slate-300">
          {money(part.cashTotal).figure}
        </N>
      </p>
    </li>
  );
};

/** «تنتظر التسوية» — what «تسوية العهدة» would take out: the licensing memos waiting (N3). */
const SettleCard = ({
  detail,
  settle,
  licences,
}: {
  detail: CustodyDetail;
  /** The CFL figure — «ملخصات» shows the same field. */
  settle: number;
  /** The reader opens «مصروفات التراخيص». */
  licences: boolean;
}): JSX.Element => {
  const t = useT();
  const { parts } = detail.settle;
  const n = custodySettleCount(parts);
  return (
    <Card accent="amber" data-cust-wait="settle" data-cust-amount={String(settle)}>
      <div className="flex flex-1 flex-col px-5 pb-2 pt-5">
        <WaitHead
          tile="emerald"
          icon={CUSTODY_OPS.settle.icon}
          title={t('fleet.dash.summaries.settle')}
          under={<span className={UNDER}>{t('fleet.custody.dashboard.settle.title')}</span>}
        />
        <Headline
          value={settle}
          link={licences ? custodyLinks.licenceWaiting(null, 'custodyFund.settle') : null}
          marker="settle-parts"
          chip={<Counted n={n} noun="part" />}
        />
        {n === 0 ? (
          <p
            data-cust-settle-none="true"
            className={cn('mt-4 border-t pt-3 text-[13px] font-semibold', RULE, MUTED)}
          >
            {t('fleet.custody.fundForm.settle.empty')}
          </p>
        ) : (
          <>
            <ul className={cn('mt-4 border-t', RULE, DIVIDE)}>
              {/* The candidates' own order (day ascending, renewal first), cut at the tab's rows. */}
              {parts.slice(0, FLEET_DASHBOARD_CUSTODY_WAIT_ROWS).map((part) => (
                <SettleRow key={`${part.expenseId}:${part.part}`} part={part} licences={licences} />
              ))}
            </ul>
            <More
              rest={n - FLEET_DASHBOARD_CUSTODY_WAIT_ROWS}
              link={licences ? custodyLinks.licenceWaiting(null, 'custodyFund.settleMore') : null}
              marker="settle"
            />
          </>
        )}
      </div>
      <div data-cust-foot="settle" className={FOOT}>
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span>{t('fleet.custody.dashboard.settle.note')}</span>
      </div>
    </Card>
  );
};

// ── 3 · «تنبيهات العهدة» ──────────────────────────────────────────────────────────────────────

/** Red only for a fund below zero (a) and settlements over the fund (e); amber with a clock for
 *  every late line (critic A3). */
const ALERT_LOOK: Record<CustodyFundAlert['type'], { icon: IconPath; tone: Tone }> = {
  negative: { icon: I.warn, tone: 'red' },
  stale: { icon: HOLD_CLOCK, tone: 'amber' },
  memo: { icon: HOLD_CLOCK, tone: 'amber' },
  licence: { icon: HOLD_CLOCK, tone: 'amber' },
  settleOver: { icon: I.warn, tone: 'red' },
};

const B = ({ children }: { children: JSX.Element | string }): JSX.Element => (
  <strong className={cn('whitespace-nowrap font-bold', STRONG)}>{children}</strong>
);

/** A line's sentence in the banner's own words, and where «فتح» takes it (D13). */
const useAlertLine = (
  licences: boolean,
): ((line: CustodyFundAlert) => { body: JSX.Element; link: DashLink | null }) => {
  const t = useT();
  const memoName = useMemoName();
  const { form } = useCustodyCount();
  const D = 'fleet.custody.dashboard.alerts';
  return (line) => {
    switch (line.type) {
      case 'negative':
        return {
          body: (
            <Phrase
              text={t(`${D}.negative`)}
              parts={{
                amount: (
                  <strong className="whitespace-nowrap font-bold">
                    <Money value={line.amount} />
                  </strong>
                ),
              }}
            />
          ),
          link: custodyLinks.log(null, 'custodyFund.alertNegative'),
        };
      case 'stale':
        return {
          body: (
            <Phrase
              text={t(`${D}.stale.${form(line.count)}`)}
              parts={{
                count: (
                  <B>
                    <N>{count(line.count)}</N>
                  </B>
                ),
                kind: t(`fleet.custody.source.${line.kind}`),
                amount: (
                  <B>
                    <Amount value={line.total} />
                  </B>
                ),
                days: <N>{count(FLEET_CUSTODY_STALE_DAYS)}</N>,
                date: (
                  <B>
                    <Day ymd={line.oldest} className="!text-inherit" />
                  </B>
                ),
              }}
            />
          ),
          link: custodyLinks.memos({ kind: line.kind }, 'custodyFund.alertStale'),
        };
      case 'memo':
        return {
          body: (
            <Phrase
              text={t(`${D}.memo`)}
              parts={{
                // A typed name is free text of any length: it may fold (critic B6).
                memo: <strong className={cn('font-bold', STRONG)}>{memoName(line.memo)}</strong>,
                age: (
                  <B>
                    <Age days={line.days} />
                  </B>
                ),
              }}
            />
          ),
          link: custodyLinks.memos({ status: 'pending' }, 'custodyFund.alertMemo'),
        };
      case 'licence':
        return {
          body: (
            <Phrase
              text={t(`${D}.licence`)}
              parts={{
                part: t(`fleet.licenseExpenses.kinds.${line.part.part}`),
                date: (
                  <B>
                    <Day ymd={line.part.date} className="!text-inherit" />
                  </B>
                ),
                age: (
                  <B>
                    <Age days={line.days} />
                  </B>
                ),
              }}
            />
          ),
          link: licences
            ? custodyLinks.licenceWaiting(line.part.part, 'custodyFund.alertLicence')
            : null,
        };
      case 'settleOver':
        return {
          body: (
            <Phrase
              text={t(`${D}.settleOver`)}
              parts={{
                total: (
                  <B>
                    <Amount value={line.total} />
                  </B>
                ),
                fund: (
                  <strong className="whitespace-nowrap font-bold">
                    <Money value={line.fund} />
                  </strong>
                ),
              }}
            />
          ),
          link: licences ? custodyLinks.licenceWaiting(null, 'custodyFund.alertSettleOver') : null,
        };
    }
  };
};

const AlertsCard = ({
  alerts,
  lines,
  licences,
}: {
  alerts: readonly CustodyFundAlert[];
  /** The CFL count of the lines (`custody.lines`) — the chip «ملخصات» counts the same way. */
  lines: number;
  licences: boolean;
}): JSX.Element => {
  const w = useCustodyWords();
  const sentence = useAlertLine(licences);
  return (
    <Card data-cust-block="alerts" className="mt-5">
      <BlockHead
        icon={I.warn}
        tone="amber"
        title={w('alerts.title')}
        chips={
          lines > 0 ? (
            <span data-cust-chip="alerts" className={cn(COUNT_CHIP, TONE.amber.soft)}>
              <Counted n={lines} noun="alert" figure={TONE.amber.text} />
            </span>
          ) : undefined
        }
      />
      {lines === 0 ? (
        <p
          data-cust-alerts-none="true"
          className={cn('border-t px-5 py-4 text-[13px] font-semibold', RULE, MUTED)}
        >
          {w('alerts.none')}
        </p>
      ) : (
        <ul className={cn('border-t', RULE, DIVIDE)}>
          {alerts.map((line) => {
            const look = ALERT_LOOK[line.type];
            const { body, link } = sentence(line);
            return (
              <li
                key={line.key}
                data-cust-alert={line.type}
                data-cust-alert-tone={look.tone}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5"
              >
                <span className="flex min-w-0 items-start gap-2.5 text-[13.5px] leading-6 text-slate-700 dark:text-slate-300">
                  <span className={cn('mt-1 shrink-0', TONE[look.tone].text)}>
                    <Icon d={look.icon} className="h-4 w-4" />
                  </span>
                  <span className="[text-wrap:pretty]">{body}</span>
                </span>
                {link !== null && (
                  <Btn link={link} className="h-8 px-3">
                    {w('open')}
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

// ── The band ──────────────────────────────────────────────────────────────────────────────────

/** «من بداية العهدة» — once, beside the live chip (critic C1). */
const SinceChip = (): JSX.Element => {
  const t = useT();
  return (
    <span data-cust-chip="since" className={cn(CHIP, 'inline-flex items-center gap-1 py-1')}>
      <Icon d={I.calendar} className="h-3.5 w-3.5 text-slate-400" />
      {t('fleet.custody.dashboard.fund.scopeSince')}
    </span>
  );
};

/** The fund's reads on their way: the strip and the three cards in grey. */
const NowSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-36 rounded-2xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-96 rounded-2xl" />
      ))}
    </div>
  </div>
);

const NowBody = ({
  custody,
  detail,
  licences,
  ledger,
}: {
  custody: CustodyFigures;
  detail: CustodyDetail;
  licences: boolean;
  ledger: LedgerRead;
}): JSX.Element => (
  <>
    <Strip summary={detail.summary} />
    <div
      data-cust-block="waits"
      className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 min-[1500px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <WaitingCard
        detail={detail}
        waiting={custody.waiting}
        className="lg:col-span-2 min-[1500px]:col-span-1"
      />
      <HeldCard summary={detail.summary} />
      <SettleCard detail={detail} settle={custody.settle ?? 0} licences={licences} />
    </div>
    <AlertsCard alerts={detail.alerts} lines={custody.lines} licences={licences} />
    <CustodyHistory ledger={ledger} />
  </>
);

export const CustodyNowBand = ({
  props,
  custody,
  ledger,
}: {
  props: MixedTabProps;
  custody: CustodyFigures;
  ledger: LedgerRead;
}): JSX.Element => {
  const w = useCustodyWords();
  const { detail } = custody;
  const state = detail !== null ? 'ready' : custody.error ? 'error' : 'loading';
  return (
    <section data-cust-band="now" aria-label={w('now')}>
      <BandHead
        id="now"
        first
        tone="emerald"
        title={w('now')}
        chips={
          <>
            <LiveChip />
            <SinceChip />
            <CompanyWide show={narrowedView(props)} />
          </>
        }
      />
      <ReadBand
        state={state}
        error={custody.failure}
        onRetry={custody.refetch}
        skeleton={<NowSkeleton />}
      >
        {detail !== null && (
          <NowBody
            custody={custody}
            detail={detail}
            licences={props.can('fleetLicenseExpense.view')}
            ledger={ledger}
          />
        )}
      </ReadBand>
    </section>
  );
};
