// «الوقود والمصروفات» — the «خلال الفترة» band (approved/fuel-dark.png and fuel-branch-dark.png;
// harness zz-fuel.tsx; DECISIONS §8, the approved look L2), over the page's R2 under the page's own
// filters:
//
//   · the band's head (sky, the range the read answered for, its line), the dashboard's period bar
//     right under it;
//   · the row [«مصروف التشغيل» (the receipts alone: the period's total, its receipts, the fuel among
//     them and its estimated litres — C9) | «فواتير التوكيل» (beside it, never added to it: no priced
//     meter, as approved)], then the sentence that they are never summed;
//   · «مصروف التشغيل حسب النوع», the page's full width: five brand bars in the system's FIXED order
//     (C10), each its share of the whole, and the honesty note (C11);
//   · «مصروف التشغيل يومًا بيوم» (tab-fuel-chart.tsx, C12);
//   · «فواتير التوكيل في الفترة», the page's full width: at most FLEET_DASHBOARD_DEALERSHIP_ROWS rows
//     in the dealership screen's own order (its first page), the one pending phrase (C4), «فتح» per
//     row, «عرض الباقي (N)» only when rows are left; a table from 1024 px, each row a block below.
//
// Each part shows under its own gate: a receipts-only reader gets the receipts part, a
// dealership-only reader the dealership part. NOTHING IS COUNTED HERE: every figure is a field R2
// sent (`dealershipList.more`, never a list's length); the browser draws a bar's length and a share.
import {
  type FleetDashboardPeriodDealershipRowDto,
  type FleetDashboardPeriodDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { periodLinks, type DashLink, type PeriodLinks } from '../../lib/fleet-dashboard-links';
import { shareText, slashDay } from '../../lib/fleet-dashboard-tabs';
import {
  AMBER,
  Btn,
  Card,
  CarChip,
  DIVIDE,
  FootLink,
  I,
  Icon,
  IconTile,
  MUTED,
  N,
  PCT,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  TITLE,
  TONE,
  Tag,
  WELL,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { Amount, Phrase, SectionError, count, type MixedTabProps } from './dash-shell';
import {
  BandHead,
  BigMoney,
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  NoteLine,
  RangeChip,
  ReadBand,
  Sep,
} from './dash-blocks';
import { PeriodFilterBar } from './period-filter-bar';
import { OpexDayChart } from './tab-fuel-chart';
import { FOLD, PhoneLabel } from './tab-fuel-now';
import {
  Dash,
  Day,
  Dual,
  EndLine,
  FOOT,
  Money,
  periodView,
  useFuelWords,
  type SectionView,
} from './tab-fuel-words';

type Opex = NonNullable<FleetDashboardPeriodDto['opex']>;
type Dealership = NonNullable<FleetDashboardPeriodDto['dealership']>;
type DealershipList = NonNullable<FleetDashboardPeriodDto['dealershipList']>;

/** «البيانات متاحة من …» — the range starts before the first record of its source. */
const DataFrom = ({ from, dataFrom }: { from: string; dataFrom: string | null }) => {
  const t = useT();
  if (dataFrom === null || from >= dataFrom) return null;
  return (
    <p data-fuel-data-from={dataFrom} className={cn('mt-3 text-[13px] font-semibold', AMBER)}>
      <Phrase text={t('fleet.dash.period.dataFrom')} parts={{ day: <N>{slashDay(dataFrom)}</N> }} />
    </p>
  );
};

/** The head of a period card: the dot title, its tag, the icon tile. */
const PeriodHead = ({
  tone,
  icon,
  title,
  tag,
}: {
  tone: Tone;
  icon: IconPath;
  title: string;
  tag: string;
}): JSX.Element => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap')}>
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)} />
        {title}
      </h3>
      <div className="mt-2 flex h-5 items-center gap-1.5">
        <Tag tone={tone} dot>
          {tag}
        </Tag>
      </div>
    </div>
    <IconTile d={icon} tone={tone} />
  </div>
);

// ── 1 · The row: the receipts | the dealership ────────────────────────────────────────────────

/** «مصروف التشغيل» — the receipts alone: the total, its receipts, the fuel among them. Its split by
 *  kind is the bars card under the row. */
const OpexCard = ({
  o,
  from,
  links,
}: {
  o: Opex;
  from: string;
  links: PeriodLinks;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <Card accent="sky" data-fuel-opex="card" data-fuel-tone="sky">
      <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
        <PeriodHead tone="sky" icon={I.receipt} title={w('opex.title')} tag={w('opex.tag')} />
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BigMoney value={o.total} link={links.opex('opex.total')} />
          <span data-fuel-chip="receipts" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <Dual n={o.count} noun="receipt" />
          </span>
        </div>
        <p
          data-fuel-fuel-line={String(o.fuel)}
          data-fuel-litres={String(o.litres)}
          className={cn(
            WELL,
            'mt-4 px-4 py-3 text-[13px] leading-6 text-slate-700 dark:text-slate-300',
          )}
        >
          <span className="font-semibold">{w('opex.fuelAll')}</span>{' '}
          <Money value={o.fuel} link={links.opexFuel()} className="text-[13.5px]" />
          <span className="max-sm:hidden">
            <Sep />
          </span>
          <span className="whitespace-nowrap max-sm:block">
            <Phrase
              text={w('opex.litresAbout')}
              parts={{ litres: <Dual n={o.litres} noun="litre" /> }}
            />
          </span>{' '}
          <span className={cn('max-sm:block', MUTED)}>{w('opex.litresNote')}</span>
        </p>
        {/* Not in the approved picture (told): the fuel receipts with no litre price are in the
            fuel figure, never in the litres — said only when there are some. */}
        {o.unpricedFuel > 0 && (
          <p
            data-fuel-unpriced={String(o.unpricedFuel)}
            className={cn('mt-2 px-1 text-xs font-semibold leading-5', MUTED)}
          >
            <Phrase
              text={w('opex.unpriced')}
              parts={{ receipts: <Dual n={o.unpricedFuel} noun="receipt" /> }}
            />
          </p>
        )}
        <DataFrom from={from} dataFrom={o.dataFrom} />
      </div>
      <div data-fuel-foot="opex" className={FOOT}>
        <FootLink link={links.opex('opex.count')}>{w('opex.allReceipts')}</FootLink>
      </div>
    </Card>
  );
};

/** «فواتير التوكيل» — beside the receipts, never added to them (no priced meter: approved L2). */
const DealerCard = ({
  d,
  from,
  links,
}: {
  d: Dealership;
  from: string;
  links: PeriodLinks;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <Card accent="violet" data-fuel-dealer="card" data-fuel-tone="violet">
      <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
        <PeriodHead tone="violet" icon={I.doc} title={w('dealer.title')} tag={w('dealer.tag')} />
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BigMoney value={d.amount} link={links.dealership('dealership.amount')} />
          <span data-fuel-chip="dealer-rows" className={cn(COUNT_CHIP, TONE.violet.soft)}>
            <Dual n={d.rows} noun="row" />
          </span>
        </div>
        {d.pending > 0 && (
          <p
            data-fuel-pending={String(d.pending)}
            className={cn('mt-4 text-[13px] font-bold leading-6', TONE.amber.text)}
          >
            <Phrase
              text={w('dealer.pending')}
              parts={{
                rows: (
                  <Dual
                    n={d.pending}
                    noun="row"
                    link={links.dealership('dealership.pending', 'pending')}
                    figure={TONE.amber.text}
                  />
                ),
              }}
            />
          </p>
        )}
        <div className="mt-3">
          <NoteLine>{w('dealer.note')}</NoteLine>
        </div>
        <DataFrom from={from} dataFrom={d.dataFrom} />
      </div>
      <div data-fuel-foot="dealer" className={FOOT}>
        <FootLink link={links.dealership('dealershipList.screen')}>{w('dealer.screen')}</FootLink>
      </div>
    </Card>
  );
};

// ── 2 · «مصروف التشغيل حسب النوع» ─────────────────────────────────────────────────────────────

type BarKey = 'card' | 'fuelCustody' | 'tyres' | 'wash' | 'maintenance';
/** The receipts' split in the system's FIXED order (receipt kinds; the fuel by who paid). */
const BARS: readonly BarKey[] = ['card', 'fuelCustody', 'tyres', 'wash', 'maintenance'];

const barName = (key: BarKey): string =>
  key === 'card'
    ? 'fleet.dash.fuel.bars.card'
    : key === 'fuelCustody'
      ? 'fleet.custody.totals.fuel'
      : `fleet.receipts.kind.${key}`;

const barLink = (key: BarKey, links: PeriodLinks): DashLink =>
  key === 'card'
    ? links.opexKind('opex.card', 'fuel', 'card')
    : key === 'fuelCustody'
      ? links.opexKind('opex.fuelCustody', 'fuel', 'custody')
      : links.opexKind(`opex.${key}`, key);

/** The share box beside a bar: one width for every share, so the boxes' edges line up. */
const SHARE_BOX = cn(PCT, 'inline-block min-w-[3.25rem] text-center');

const OpexBars = ({ o, links }: { o: Opex; links: PeriodLinks }): JSX.Element => {
  const t = useT();
  const w = useFuelWords();
  return (
    <Card data-fuel-block="bars" className="mt-5">
      <BlockHead
        icon={I.rank}
        tone="brand"
        title={w('bars.title')}
        note={w('bars.note')}
        chips={
          <span data-fuel-chip="bars" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <Amount value={o.total} />
          </span>
        }
      />
      <ol className={cn('border-t', RULE, DIVIDE)}>
        {BARS.map((key) => {
          // Each bar is its share of the whole (display only; the parts are the server's).
          const pct = o.total > 0 ? (o[key] / o.total) * 100 : 0;
          return (
            <li
              key={key}
              data-fuel-bar={key}
              data-fuel-amount={String(o[key])}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5"
            >
              <span
                className={cn(
                  'w-28 shrink-0 whitespace-nowrap text-[14px] font-bold max-sm:flex-1',
                  STRONG,
                )}
              >
                {t(barName(key))}
              </span>
              <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                <div className="h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
                  <div
                    data-fuel-bar-fill={key}
                    className={cn('h-2 rounded-full', TONE.brand.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="w-32 shrink-0 whitespace-nowrap text-end max-sm:w-auto">
                <Money value={o[key]} link={barLink(key, links)} className="text-[13.5px]" />
              </span>
              <span data-fuel-share={key} className="shrink-0">
                <span dir="ltr" className={SHARE_BOX}>
                  {shareText(o[key], o.total)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <div data-fuel-foot="bars" className={cn(FOOT, 'whitespace-normal')}>
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="[text-wrap:pretty]">{w('bars.noReceipt')}</span>
      </div>
    </Card>
  );
};

// ── 3 · «فواتير التوكيل في الفترة» ────────────────────────────────────────────────────────────

const CELL = 'px-3 py-3.5 align-middle first:ps-5 last:pe-5';

/** The car and its make; the chip opens the car's record for a reader of the registry, and only
 *  while the car is in it (an old-book code or a deleted car has no record to open). A car deleted
 *  since says so («محذوفة»), as «كروت تحتاج متابعة» does. */
const DealerCar = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardPeriodDealershipRowDto;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const record =
    canVehicle && row.vehicleId !== null && !row.vehicleDeleted
      ? links.vehicle(row.vehicleId, 'dealershipList.vehicle')
      : null;
  return (
    <div
      data-fuel-dealer-car={row.code ?? ''}
      {...(row.vehicleDeleted ? { 'data-fuel-dealer-car-deleted': 'true' } : {})}
      className="flex flex-col items-start gap-1"
    >
      <span className="flex items-center gap-1.5">
        <CarChip code={row.code ?? '—'} link={record} />
        {row.vehicleDeleted && <Tag tone="slate">{t('fleet.dash.common.vehicleDeleted')}</Tag>}
      </span>
      {row.typeName !== null && (
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {localized(row.typeName, locale)}
        </span>
      )}
    </div>
  );
};

/** The amount, or the one pending phrase in the register's amber (critic C4). */
const DealerValue = ({ row }: { row: FleetDashboardPeriodDealershipRowDto }): JSX.Element => {
  const w = useFuelWords();
  return row.invoiceAmount === null ? (
    <span data-fuel-pending-tag="true">
      <Tag tone="amber" dot>
        {w('dealerTable.pendingTag')}
      </Tag>
    </span>
  ) : (
    <Money value={row.invoiceAmount} className="text-[13px]" />
  );
};

const DealerRow = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardPeriodDealershipRowDto;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <tr data-fuel-dealer-row={row.id} data-fuel-work={row.workKind} className={FOLD.row}>
      <td className={cn(CELL, FOLD.cell, FOLD.start)}>
        <DealerCar row={row} links={links} canVehicle={canVehicle} />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('dealerTable.col.date')}</PhoneLabel>
        <Day ymd={row.date} />
      </td>
      <td
        className={cn(
          CELL,
          FOLD.cell,
          FOLD.line,
          'whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200',
        )}
      >
        <PhoneLabel>{w('dealerTable.col.work')}</PhoneLabel>
        {row.workTypeLabel}
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('dealerTable.col.invoice')}</PhoneLabel>
        {row.invoiceNumber === null ? (
          <Dash />
        ) : (
          <N className="font-semibold text-slate-700 dark:text-slate-200">{row.invoiceNumber}</N>
        )}
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.end, 'whitespace-nowrap')}>
        <DealerValue row={row} />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'text-end')}>
        <Btn link={links.dealershipRow(row)} className="h-9 px-4 max-lg:w-full">
          {w('open')}
        </Btn>
      </td>
    </tr>
  );
};

const DealerTable = ({
  list,
  dealership,
  links,
  canVehicle,
}: {
  list: DealershipList;
  /** The period's rows for the chip; `null` when that section is not drawn. */
  dealership: Dealership | null;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useFuelWords();
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-fuel-block="dealer-table" className="mt-5">
      <BlockHead
        icon={I.doc}
        tone="violet"
        title={w('dealerTable.title')}
        note={w('dealerTable.note')}
        chips={
          dealership === null ? undefined : (
            <span data-fuel-chip="dealer-table" className={cn(COUNT_CHIP, TONE.violet.soft)}>
              <Dual n={dealership.rows} noun="row" />
            </span>
          )
        }
      />
      {list.rows.length === 0 ? (
        <EndLine marker="dealer-table">{w('dealerTable.empty')}</EndLine>
      ) : (
        <div className={FOLD.scroll}>
          <table
            className={cn(
              'w-full border-collapse text-[13px] lg:min-w-[900px] lg:table-fixed',
              FOLD.table,
            )}
          >
            <colgroup className={FOLD.head}>
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col />
              <col className="w-[14%]" />
              <col className="w-[18%]" />
              <col className="w-[104px]" />
            </colgroup>
            <thead className={cn(TH_ROW, FOLD.head)}>
              <tr className={cn('border-y', RULE)}>
                <th className={th}>{w('dealerTable.col.vehicle')}</th>
                <th className={th}>{w('dealerTable.col.date')}</th>
                <th className={th}>{w('dealerTable.col.work')}</th>
                <th className={th}>{w('dealerTable.col.invoice')}</th>
                <th className={th}>{w('dealerTable.col.amount')}</th>
                <th className={cn(CELL, 'py-2.5')}>
                  <span className="sr-only">{w('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, FOLD.body, RULE)}>
              {/* The server's order (the dealership screen's first page), never re-sorted here. */}
              {list.rows.map((row) => (
                <DealerRow key={row.id} row={row} links={links} canVehicle={canVehicle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.more > 0 && (
        <BlockFoot>
          <FootLink link={links.dealership('dealershipList.more')}>
            <span data-fuel-more={String(list.more)}>
              <Phrase text={w('dealerTable.more')} parts={{ count: <N>{count(list.more)}</N> }} />
            </span>
          </FootLink>
        </BlockFoot>
      )}
    </Card>
  );
};

// ── The band ──────────────────────────────────────────────────────────────────────────────────

/** The period's figures on their way: the row of two, the bars and the chart in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Skeleton className="h-60 rounded-2xl" />
      <Skeleton className="h-60 rounded-2xl" />
    </div>
    <Skeleton className="h-64 rounded-2xl" />
    <Skeleton className="h-96 rounded-2xl" />
  </div>
);

const shown = <T,>(view: SectionView, value: T | null): T | null =>
  view === 'shown' ? value : null;

const PeriodBody = ({
  data,
  can,
  onRetry,
}: {
  data: FleetDashboardPeriodDto;
  can: (permission: string) => boolean;
  onRetry: () => void;
}): JSX.Element => {
  const t = useT();
  const w = useFuelWords();
  const links = periodLinks(data);
  const views = {
    opex: periodView(data, can, 'opex'),
    opexSeries: periodView(data, can, 'opexSeries'),
    dealership: periodView(data, can, 'dealership'),
    dealershipList: periodView(data, can, 'dealershipList'),
  };
  const opex = shown(views.opex, data.opex);
  const series = shown(views.opexSeries, data.opexSeries);
  const dealership = shown(views.dealership, data.dealership);
  const list = shown(views.dealershipList, data.dealershipList);
  const canVehicle = can('fleetVehicle.view');
  const opexFailed = views.opex === 'failed';
  const dealershipFailed = views.dealership === 'failed';
  return (
    <>
      {(opexFailed || dealershipFailed) && (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {opexFailed && <SectionError section="opex" onRetry={onRetry} />}
          {dealershipFailed && <SectionError section="dealership" onRetry={onRetry} />}
        </div>
      )}
      {(opex !== null || dealership !== null) && (
        <div
          data-fuel-row="period"
          className={cn(
            'grid grid-cols-1 gap-4',
            opex !== null && dealership !== null && 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
          )}
        >
          {opex !== null && <OpexCard o={opex} from={data.range.from} links={links} />}
          {dealership !== null && (
            <DealerCard d={dealership} from={data.range.from} links={links} />
          )}
        </div>
      )}
      {opex !== null && dealership !== null && (
        <div data-fuel-not-summed="true" className="mt-3 px-1">
          <NoteLine>{t('fleet.dash.period.notSummed')}</NoteLine>
        </div>
      )}
      {opex !== null && <OpexBars o={opex} links={links} />}
      {views.opexSeries === 'failed' && (
        <SectionError section="opexSeries" onRetry={onRetry} className="mt-5" />
      )}
      {series !== null && (
        <OpexDayChart
          buckets={series.buckets}
          granularity={data.range.granularity}
          today={data.today}
          total={opex?.total ?? null}
        />
      )}
      {views.dealershipList === 'failed' && (
        <SectionError section="dealershipList" onRetry={onRetry} className="mt-5" />
      )}
      {list !== null && (
        <>
          <DealerTable list={list} dealership={dealership} links={links} canVehicle={canVehicle} />
          <div className="mt-4 px-1">
            <NoteLine>
              <span data-fuel-note="asOfNow">{w('dealerTable.asOfNow')}</span>
            </NoteLine>
          </div>
        </>
      )}
    </>
  );
};

export const FuelPeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useFuelWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  return (
    <section data-fuel-band="period" aria-label={w('period')} className="mt-8">
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
        {data !== undefined && <PeriodBody data={data} can={can} onRetry={period.onRetry} />}
      </ReadBand>
    </section>
  );
};
