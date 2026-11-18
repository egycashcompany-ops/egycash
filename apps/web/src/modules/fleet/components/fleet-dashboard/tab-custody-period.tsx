// «العهدة» — the «خلال الفترة» band (approved/cust-dark.png and cust-branch-dark.png; harness
// zz-custody-tab.tsx PeriodBand; DECISIONS §9 Q1 (أ) «اعمل اللى بتفضلوا», critic C3, C4, C7), over
// the page's R2 under the page's own filters — the custody receipts by their paper's day, following
// the branch through the receipt's car (never «الشركة كلها» here):
//
//   · the band's head (sky, the range the read answered for, its line), the page's FULL period bar
//     right under it (type, operation and codes narrow these receipts, as approved);
//   · the row [«مصروفات العهدة» (sky: the period's custody spend `opex.custody`, its receipts, and
//     «منها حتى الآن» — where that spend stands NOW: `custodyStates`, plain figures, only for a reader
//     of that section) | «مصروفات العهدة حسب النوع» (brand bars in the custody screen's FIXED order
//     صيانة · وقود من العهدة · كاوتش · غسيل, each its one-decimal share)];
//   · under the row, that these are the very columns of «الوقود والمصروفات» — never added to them
//     (the fuel tab's critic B4) — and a link to that tab when the reader sees it.
//
// A figure opens «مصروفات العهدة» while nothing but the codes narrows the read, else the receipts
// with `source=custody` under the whole set (D20, `periodLinks.custodySpend`) — and the card's foot
// names the screen it opens: «عرض مصروفات العهدة», or «عرض إيصالات العهدة» when it opens the
// receipts (audit D46). NOTHING IS COUNTED HERE: every figure is a field R2 sent; the browser draws
// a bar's length and a share.
import { type FleetCustodySource, type FleetDashboardPeriodDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { periodLinks, type PeriodLinks } from '../../lib/fleet-dashboard-links';
import { shareText, slashDay } from '../../lib/fleet-dashboard-tabs';
import { RECEIPT_ICON } from '../custody-memo-parts';
import { Amount, Phrase, SectionError, type MixedTabProps } from './dash-shell';
import {
  BandHead,
  BigMoney,
  BlockHead,
  COUNT_CHIP,
  NoteLine,
  RangeChip,
  ReadBand,
} from './dash-blocks';
import {
  AMBER,
  Card,
  DIVIDE,
  FootLink,
  I,
  IconTile,
  MUTED,
  N,
  PCT,
  RULE,
  STRONG,
  TITLE,
  TONE,
  Tag,
  WELL,
  cn,
} from './dash-kit';
import { PeriodFilterBar } from './period-filter-bar';
import { Counted, FOOT, Money, periodView, useCustodyWords } from './tab-custody-words';

type Opex = NonNullable<FleetDashboardPeriodDto['opex']>;
type States = NonNullable<FleetDashboardPeriodDto['custodyStates']>;

/** «البيانات متاحة من …» — the range starts before the first receipt. */
const DataFrom = ({ from, dataFrom }: { from: string; dataFrom: string | null }) => {
  const t = useT();
  if (dataFrom === null || from >= dataFrom) return null;
  return (
    <p data-cust-data-from={dataFrom} className={cn('mt-3 text-[13px] font-semibold', AMBER)}>
      <Phrase text={t('fleet.dash.period.dataFrom')} parts={{ day: <N>{slashDay(dataFrom)}</N> }} />
    </p>
  );
};

/** The three states of «منها حتى الآن» in the custody screen's order and words. */
const STATES = ['replenished', 'pending', 'outside'] as const;

/** «مصروفات العهدة» — the period's custody receipts, and where that spend stands now (Q1 أ). */
const SpendKpi = ({
  o,
  states,
  from,
  links,
}: {
  o: Opex;
  /** `null`: not this reader's (or not sent) — the KPI without «منها». */
  states: States | null;
  from: string;
  links: PeriodLinks;
}): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  // The foot names the screen it opens (D46): the custody receipts on «خصم الإيصالات» when a
  // branch, a type or an operation narrows the view, «مصروفات العهدة» otherwise; none at all for a
  // reader whose reach holds no branch (D21).
  const screen = links.custodySpend('opex.custodyScreen');
  const receipts = screen !== null && screen.to.startsWith('/fleet/receipts?');
  return (
    <Card accent="sky" data-cust-period="spend" data-cust-amount={String(o.custody)}>
      <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap')}>
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', TONE.sky.dot)}
              />
              {t('fleet.nav.custodyExpenses')}
            </h3>
            <div className="mt-2 flex h-5 items-center gap-1.5">
              <Tag tone="sky" dot>
                {w('period.tag')}
              </Tag>
            </div>
          </div>
          <IconTile d={RECEIPT_ICON} tone="sky" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BigMoney value={o.custody} link={links.custodySpend('opex.custody')} />
          <span data-cust-chip="spend-receipts" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <Counted n={o.custodyCount} noun="receipt" />
          </span>
        </div>
        {states !== null && (
          <div data-cust-states="true" className={cn(WELL, 'mt-4 px-4 py-3')}>
            <p className={cn('text-[12.5px] font-bold', MUTED)}>{w('period.statesHead')}</p>
            {/* One column of words, the amounts beside them: plain figures (no list matches a
                state over a period exactly). */}
            <ul className="mt-1.5 grid grid-cols-[max-content_max-content] gap-x-6 gap-y-1">
              {STATES.map((state) => (
                <li
                  key={state}
                  data-cust-state={state}
                  data-cust-amount={String(states[state])}
                  className="col-span-2 grid grid-cols-subgrid items-center text-[13px] leading-6"
                >
                  <span className="whitespace-nowrap font-semibold text-slate-600 dark:text-slate-300">
                    {t(`fleet.custody.dashboard.states.${state}`)}
                  </span>
                  <Money value={states[state]} className="text-[13.5px]" />
                </li>
              ))}
            </ul>
          </div>
        )}
        <DataFrom from={from} dataFrom={o.dataFrom} />
      </div>
      <div
        data-cust-foot="spend"
        data-cust-foot-screen={receipts ? 'receipts' : 'custodyExpenses'}
        className={FOOT}
      >
        {screen !== null && (
          <FootLink link={screen}>
            {receipts
              ? w('period.showReceipts')
              : t('fleet.custody.dashboard.waiting.showExpenses')}
          </FootLink>
        )}
      </div>
    </Card>
  );
};

/** The custody kinds in the custody screen's FIXED order, each with its R2 amount and its name
 *  (the fuel tab's words for fuel paid from the custody). */
type KindField = 'maintenance' | 'fuelCustody' | 'tyres' | 'wash';
const KINDS: readonly { kind: FleetCustodySource; field: KindField; name: string }[] = [
  { kind: 'maintenance', field: 'maintenance', name: 'fleet.custody.source.maintenance' },
  { kind: 'fuel', field: 'fuelCustody', name: 'fleet.custody.totals.fuel' },
  { kind: 'tyres', field: 'tyres', name: 'fleet.custody.source.tyres' },
  { kind: 'wash', field: 'wash', name: 'fleet.custody.source.wash' },
];

/** The share box beside a bar: one width for every share, so the boxes' edges line up. */
const SHARE_BOX = cn(PCT, 'inline-block min-w-[3.25rem] text-center');

/** «مصروفات العهدة حسب النوع» — brand bars, each its share of the custody spend. */
const KindsCard = ({ o, links }: { o: Opex; links: PeriodLinks }): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  return (
    <Card data-cust-block="kinds">
      <BlockHead
        icon={I.rank}
        tone="brand"
        title={w('bars.title')}
        note={w('bars.note')}
        chips={
          <span data-cust-chip="kinds" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <Amount value={o.custody} />
          </span>
        }
      />
      <ol className={cn('border-t', RULE, DIVIDE)}>
        {KINDS.map(({ kind, field, name }) => {
          const amount = o[field];
          // Each bar is its share of the custody spend (display only; the parts are the server's).
          const pct = o.custody > 0 ? (amount / o.custody) * 100 : 0;
          return (
            <li
              key={kind}
              data-cust-bar={kind}
              data-cust-amount={String(amount)}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4"
            >
              <span
                className={cn(
                  'w-28 shrink-0 whitespace-nowrap text-[14px] font-bold max-sm:flex-1',
                  STRONG,
                )}
              >
                {t(name)}
              </span>
              <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                <div className="h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
                  <div
                    data-cust-bar-fill={kind}
                    className={cn('h-2 rounded-full', TONE.brand.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="w-32 shrink-0 whitespace-nowrap text-end max-sm:w-auto">
                <Money
                  value={amount}
                  link={links.custodySpend(`opex.custody.${kind}`, kind)}
                  className="text-[13.5px]"
                />
              </span>
              <span data-cust-share={kind} className="shrink-0">
                <span dir="ltr" className={SHARE_BOX}>
                  {shareText(amount, o.custody)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
};

/** The period's figures on their way: the row of two in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
    <Skeleton className="h-72 rounded-2xl" />
    <Skeleton className="h-72 rounded-2xl" />
  </div>
);

const PeriodBody = ({
  data,
  props,
}: {
  data: FleetDashboardPeriodDto;
  props: MixedTabProps;
}): JSX.Element | null => {
  const t = useT();
  const w = useCustodyWords();
  const { can } = props;
  const links = periodLinks(data);
  const opexView = periodView(data, can, 'opex');
  const statesView = periodView(data, can, 'custodyStates');
  const fuelTab = props.tabLink('fuel', 'opex.custody.tab');
  if (opexView === 'failed') return <SectionError section="opex" onRetry={props.period.onRetry} />;
  if (opexView !== 'shown' || data.opex === null) return null;
  return (
    <>
      {statesView === 'failed' && (
        <SectionError section="custodyStates" onRetry={props.period.onRetry} className="mb-4" />
      )}
      <div
        data-cust-row="period"
        className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      >
        <SpendKpi
          o={data.opex}
          states={statesView === 'shown' ? data.custodyStates : null}
          from={data.range.from}
          links={links}
        />
        <KindsCard o={data.opex} links={links} />
      </div>
      {/* The fuel tab's critic B4: these are its very columns — never added to them. */}
      <div
        data-cust-overlap="true"
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1"
      >
        <NoteLine>{w('overlap')}</NoteLine>
        {fuelTab !== null && <FootLink link={fuelTab}>{t('fleet.dash.shell.tab.fuel')}</FootLink>}
      </div>
    </>
  );
};

export const CustodyPeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useCustodyWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  return (
    <section data-cust-band="period" aria-label={w('period')} className="mt-8">
      <BandHead
        id="period"
        tone="sky"
        title={w('period')}
        chips={data === undefined ? undefined : <RangeChip range={data.range} />}
        sub={w('periodSub')}
      />
      {/* The dashboard's own period bar, right under the band's head and above what it moves: the
          page's ONE filter state (the other period tabs share it), written to the address bar. */}
      <PeriodFilterBar
        filters={period.filters}
        onFilters={period.onFilters}
        data={data}
        can={can}
      />
      <ReadBand state={state} onRetry={period.onRetry} skeleton={<PeriodSkeleton />}>
        {data !== undefined && <PeriodBody data={data} props={props} />}
      </ReadBand>
    </section>
  );
};
