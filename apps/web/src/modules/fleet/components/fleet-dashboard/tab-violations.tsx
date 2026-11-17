// «المخالفات المرورية والتسويات» — the owner-approved sample (approved/viol-dark.png,
// viol-branch-dark.png; harness zz-violations.tsx; DECISIONS §7, «اعمل اللى انت بتفضله» = every
// recommendation, then «اعتمد»), a tab of «الآن» and a period both, drawn over the real reads:
//
//   1  the heading «المخالفات المرورية وتحصيلها» (the pill keeps the owner's name); «تحديث»
//      refreshes both reads and «آخر تحديث» is the older of the two (the page hands both in)
//   2  «الآن» (R1 `violationsOpen`), «كل السنوات» said ONCE on the band's head: what is still owed
//      on the company's statements (violet), on the drivers' ledger (amber — its three parts: the
//      known drivers COUNTED first, «مجهول», the names the book never linked) and both (neutral,
//      with the figure-free foot «عرض المخالفات القائمة»). Owed = every year, the old book's rows
//      never ticked included (Q1 أ). The company view adds the rows on cars the registry never had.
//   3  «خلال الفترة» (the page's R2, under the page's own filters): its head, the dashboard's period
//      bar right under it, then «مخالفات السائقين في الفترة» (by the FINE's day) beside «مخالفات
//      الفترة حسب النوع» (brand bars, «غير محدد» last), then the period's fines as a table — at most
//      FLEET_DASHBOARD_VIOLATION_ROWS rows, owed and collected, the newest first — and the notes.
//      The company's yearly statements are never in the period (they carry a year, not a day).
//
// NOTHING IS COUNTED HERE. Every figure is a field a read sent (`violationsOpen.*`, `violations.*`,
// `violationList.more` — never a list's length). The browser only draws: a bar's length against
// the longest, and the collected share (`collected.amount ÷ amount`, a whole percent as drawn).
//
// THE COUNTS ON THE «الآن» CARDS HAVE NO LINK: the register's footers sum amounts, not fines, so no
// screen shows those counts; the amounts open the register (every year, unpaid), and «مجهول» opens
// the drivers' unpaid fines with nobody named. «اسم غير مربوط» has no list parameter: plain. A period
// link names the period by the FINE's day on the drivers' half (`dfrom`/`dto`) and its cars as that
// half reads them (`dcodes`) — never the page's `from`/`to`/`vehicleCodes`, which the register's
// halves do not read. A row's «فتح» opens the register on its car, its day and its type (that fine
// and any sharing the three). The fines are a table from 1024 px, each row a block below it (no
// sideways scroll on a phone or a tablet). Bars are the brand's (DECISIONS §5); «قائمة» is amber, «محصَّلة»
// emerald (the register's colours); nothing on this tab is red.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  isUnknownFleetDriver,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodViolationRowDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import {
  nowLinks,
  periodLinks,
  type DashLink,
  type NowLinks,
  type PeriodLinks,
} from '../../lib/fleet-dashboard-links';
import { sectionPermitted, slashDay } from '../../lib/fleet-dashboard-tabs';
import { DriverHoverText } from '../DriverHoverCard';
import { DriverName, useEmployeeRecords } from '../EmployeeName';
import {
  Btn,
  CHIP,
  Card,
  CarChip,
  DIVIDE,
  FOCUS,
  Fig,
  FootLink,
  I,
  Icon,
  IconTile,
  LiveChip,
  MUTED,
  N,
  PCT,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  TITLE,
  TONE,
  TabHead,
  Tag,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import {
  Amount,
  Phrase,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type MixedTabProps,
} from './dash-shell';
import {
  BandHead,
  Big,
  BigMoney,
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  FOOT_BAND,
  Kpi,
  NoteLine,
  RangeChip,
  ReadBand,
  Sep,
  Small,
  WORDS,
} from './dash-blocks';
import { PeriodFilterBar } from './period-filter-bar';

/** The word of a key under the tab's own namespace. */
const useWords = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.violations.${key}`, params);
};

type SectionView = 'hidden' | 'shown' | 'failed';
type Open = NonNullable<FleetDashboardNowDto['violationsOpen']>;
type Violations = NonNullable<FleetDashboardPeriodDto['violations']>;
type ViolationList = NonNullable<FleetDashboardPeriodDto['violationList']>;
type Sum = { amount: number; count: number };

/** R1's `violationsOpen` as this reader meets it: not theirs, drawn, or failed (its error in place). */
const openState = (
  now: FleetDashboardNowDto | null,
  can: (permission: string) => boolean,
): SectionView => {
  if (now === null || !sectionPermitted('violationsOpen', can)) return 'hidden';
  if (now.unavailable.includes('violationsOpen')) return 'failed';
  return now.violationsOpen === null ? 'hidden' : 'shown';
};

/** An R2 section of this tab, the same way. */
const periodState = (
  data: FleetDashboardPeriodDto,
  section: 'violations' | 'violationList',
): SectionView => {
  if (data.unavailable.includes(section)) return 'failed';
  return data[section] === null ? 'hidden' : 'shown';
};

/** A 0.00 amount reads muted wherever it stands. */
const ZERO = '!text-slate-500 dark:!text-slate-400';

/** An amount and «ج.م.», muted at 0.00, opening its list when given a link. */
const Money = ({
  value,
  link = null,
  className,
}: {
  value: number;
  link?: DashLink | null;
  className?: string;
}): JSX.Element => (
  <Fig link={link} className={STRONG}>
    <Amount value={value} className={cn(className, value === 0 && ZERO)} />
  </Fig>
);

/** «N مخالفة» — a count and its noun, the figure bold, the word muted; never a link. */
const Fines = ({ n }: { n: number }): JSX.Element => {
  const noun = useNoun();
  return (
    <span className="whitespace-nowrap">
      <Small>{count(n)}</Small> {noun('violation', n)}
    </span>
  );
};

/** The grey foot band of a «الآن» card; its height kept so the three cards' bands stand level. */
const NOW_FOOT = cn(FOOT_BAND, 'min-h-[46px] whitespace-nowrap max-sm:whitespace-normal', MUTED);

/** A table's end in words: that it is empty. */
const EndRow = ({ marker, children }: { marker: string; children: ReactNode }): JSX.Element => (
  <div
    data-viol-end={marker}
    className={cn(
      'flex items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
      RULE,
      MUTED,
    )}
  >
    {children}
  </div>
);

// ── 1 · The heading (no live chip: the tab holds «now» and the period both) ────────────────────

const Heading = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  return (
    <TabHead
      icon={I.receipt}
      title={w('heading')}
      live={false}
      sub={w('headingSub')}
      end={
        <RefreshTools
          updatedAt={props.updatedAt}
          onRefresh={props.onRefresh}
          refreshing={props.refreshing}
          {...(props.clock === undefined ? {} : { clock: props.clock })}
        />
      }
    />
  );
};

// ── 2 · «الآن»: what is still owed, on each ledger, every year ─────────────────────────────────

/**
 * A «الآن» card: the edge, the dot title, the icon tile, the amount (the one figure that opens its
 * list), the fines under it (plain), its parts, and the grey band at its foot — the approved Kpi
 * look without a tag row: «كل السنوات» is said once, on the band's head.
 */
const NowCard = ({
  id,
  tone,
  icon,
  title,
  sum,
  link,
  parts,
  foot,
  className,
}: {
  id: string;
  tone: Tone;
  icon: IconPath;
  title: string;
  sum: Sum;
  link: DashLink;
  parts?: ReactNode;
  foot: ReactNode;
  /** Where the card sits in the row (the total spans the tablet row). */
  className?: string;
}): JSX.Element => (
  <Card accent={tone} data-viol-kpi={id} data-viol-tone={tone} className={className}>
    <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap pt-1')}>
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
          />
          {title}
        </h3>
        <IconTile d={icon} tone={tone} />
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BigMoney value={sum.amount} link={link} />
      </div>
      <div
        data-viol-fines={id}
        className={cn('mt-3 flex h-6 items-center text-[13px] leading-6', MUTED)}
      >
        <Fines n={sum.count} />
      </div>
      {parts}
    </div>
    <div data-viol-foot={id} className={NOW_FOOT}>
      {foot}
    </div>
  </Card>
);

const PART_COL = 'flex min-w-0 flex-col items-start gap-0.5 px-3 first:ps-0 last:pe-0';
const PART_NAME =
  'inline-flex h-5 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-500 dark:font-semibold dark:text-slate-400';
const PART_LINE = cn('h-5 whitespace-nowrap text-[13px] leading-5');

/**
 * The drivers' three parts in one row: the known drivers COUNTED (a count of drivers, not of fines,
 * as approved — no names, the ranking is Phase 2), «مجهول» (its name opens its list, as the
 * dashboard's foot links do), and the book's names no HR record carries (no list parameter: plain).
 * The three tie to the card's figure, amount and fines both (the server's split).
 */
const DriverParts = ({ open, links }: { open: Open; links: NowLinks }): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const { attributed, unknown, unlinked } = open.drivers;
  const unknownLink = links.violationsOpenUnknown();
  return (
    <ul data-viol-parts="drivers" className={cn('mt-3 grid grid-cols-3 border-t pt-2.5', RULE)}>
      <li
        data-viol-part="known"
        data-viol-drivers={String(attributed.drivers)}
        className={PART_COL}
      >
        <span className={PART_NAME}>{w('drivers.known')}</span>
        <span className={cn(PART_LINE, MUTED)}>
          <Small>{count(attributed.drivers)}</Small> {noun('driver', attributed.drivers)}
        </span>
        <span className={PART_LINE}>
          <Money value={attributed.amount} className="text-[13px]" />
        </span>
      </li>
      <li
        data-viol-part="unknown"
        data-viol-count={String(unknown.count)}
        className={cn(PART_COL, 'border-s', RULE)}
      >
        <Link
          to={unknownLink.to}
          data-metric={unknownLink.metric}
          className={cn(
            'inline-flex h-5 items-center gap-1 whitespace-nowrap text-xs font-bold text-emerald-700 hover:underline dark:font-semibold dark:text-emerald-400',
            FOCUS,
          )}
        >
          {w('drivers.unknown')}
          <Icon d={I.arrow} className="h-3.5 w-3.5" />
        </Link>
        <span className={cn(PART_LINE, MUTED)}>
          <Small>{count(unknown.count)}</Small> {noun('violation', unknown.count)}
        </span>
        <span className={PART_LINE}>
          <Money value={unknown.amount} className="text-[13px]" />
        </span>
      </li>
      <li
        data-viol-part="unlinked"
        data-viol-count={String(unlinked.count)}
        className={cn(PART_COL, 'border-s', RULE)}
      >
        <span className={PART_NAME}>{w('drivers.unlinked')}</span>
        <span className={cn(PART_LINE, MUTED)}>
          <Small>{count(unlinked.count)}</Small> {noun('violation', unlinked.count)}
        </span>
        <span className={PART_LINE}>
          <Money value={unlinked.amount} className="text-[13px]" />
        </span>
      </li>
    </ul>
  );
};

const NowCards = ({ open, links }: { open: Open; links: NowLinks }): JSX.Element => {
  const w = useWords();
  return (
    // Three in a row from 1280 px (as approved); two on a tablet, the total across under them —
    // never one card to a row on a wide screen.
    <div data-viol-cards="now" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <NowCard
        id="company"
        tone="violet"
        icon={I.building}
        title={w('company.title')}
        sum={open.company}
        link={links.violationsOpenCompany()}
        foot={
          <>
            <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
            <span data-viol-foot-note="company">{w('company.note')}</span>
          </>
        }
      />
      <NowCard
        id="drivers"
        tone="amber"
        icon={I.users}
        title={w('drivers.title')}
        sum={open.drivers.total}
        link={links.violationsOpenDrivers('violationsOpen.drivers')}
        parts={<DriverParts open={open} links={links} />}
        foot={
          <FootLink link={links.violationsOpenDrivers('violationsOpen.driversAll')}>
            {w('drivers.all')}
          </FootLink>
        }
      />
      <NowCard
        id="total"
        tone="slate"
        icon={I.layers}
        title={w('total.title')}
        sum={open.total}
        link={links.violationsOpen('violationsOpen.total')}
        className="md:col-span-2 xl:col-span-1"
        foot={
          <FootLink link={links.violationsOpen('violationsOpen.totalAll')}>
            {w('total.all')}
          </FootLink>
        }
      />
    </div>
  );
};

/**
 * The owed rows on cars the registry never had (`bookOnly`): counted for the whole company and in no
 * branch, so the server sends them in the company view only (`null` under any narrowing), and a
 * sentence stands only when it has a row to name.
 */
const BookOnly = ({ open }: { open: Open }): JSX.Element | null => {
  const w = useWords();
  const noun = useNoun();
  const book = open.bookOnly;
  if (book === null) return null;
  const lines = (['company', 'drivers'] as const).filter((side) => book[side].count > 0);
  if (lines.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 px-1">
      {lines.map((side) => (
        <NoteLine key={side}>
          <span data-viol-book={side} data-viol-count={String(book[side].count)}>
            <Phrase
              text={w(`bookOnly.${side}`)}
              parts={{
                count: <N>{count(book[side].count)}</N>,
                noun: noun('violation', book[side].count),
              }}
            />
          </span>
        </NoteLine>
      ))}
    </div>
  );
};

/** «كل السنوات» — once, beside the live chip (the cards carry no tag of their own). */
const AllYears = (): JSX.Element => {
  const w = useWords();
  return (
    <span data-viol-chip="allYears" className={cn(CHIP, 'inline-flex items-center gap-1 py-1')}>
      <Icon d={I.calendar} className="h-3.5 w-3.5 text-slate-400" />
      {w('allYears')}
    </span>
  );
};

/** R1 on its way: the three cards in grey, never zeroes pretending to be data. */
const NowSkeleton = (): JSX.Element => (
  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
    {[0, 1, 2].map((i) => (
      <Skeleton key={i} className="h-56 rounded-2xl" />
    ))}
  </div>
);

const NowBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  const { now, can, nowPending } = props;
  const state = openState(now, can);
  // The figures only when this reader may see them (the state says so), never because the read
  // happened to carry them.
  const open = state === 'shown' ? (now?.violationsOpen ?? null) : null;
  const links = now === null ? null : nowLinks(now);
  return (
    <section data-viol-band="now" aria-label={w('now')}>
      <BandHead
        id="now"
        tone="emerald"
        first
        title={w('now')}
        chips={
          <>
            <LiveChip />
            <AllYears />
          </>
        }
      />
      <ReadBand
        state={nowPending?.state ?? 'ready'}
        error={nowPending?.error ?? null}
        onRetry={props.onRetry}
        skeleton={<NowSkeleton />}
      >
        {state === 'failed' && <SectionError section="violationsOpen" onRetry={props.onRetry} />}
        {open !== null && links !== null && (
          <>
            <NowCards open={open} links={links} />
            <BookOnly open={open} />
            {open.total.count === 0 && (
              <div className="mt-3 px-1">
                <NoteLine>
                  <span data-viol-empty="now">{w('empty.now')}</span>
                </NoteLine>
              </div>
            )}
          </>
        )}
      </ReadBand>
    </section>
  );
};

// ── 3 · «خلال الفترة»: the drivers' fines by the fine's day ─────────────────────────────────────

/** «26%» — the collected share of the period's amount, a whole percent (display only); «—» at 0. */
const share = (part: number, whole: number): string | null =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;

const PeriodKpi = ({ v, links }: { v: Violations; links: PeriodLinks }): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const pct = share(v.collected.amount, v.amount);
  return (
    <Kpi
      id="violations"
      data-viol-kpi="period"
      data-viol-tone="sky"
      tone="sky"
      icon={I.calendar}
      title={w('period.title')}
      tag={
        <Tag tone="sky" dot>
          {w('period.tag')}
        </Tag>
      }
      figure={
        <>
          <Big link={links.violations('violations.count')}>{count(v.count)}</Big>
          <span className={WORDS}>{noun('violation', v.count)}</span>
        </>
      }
      sub={
        <div className="flex flex-col">
          <div data-viol-period-amount={String(v.amount)} className="flex h-7 items-center">
            <Money
              value={v.amount}
              link={links.violations('violations.amount')}
              className="text-[17px] leading-7"
            />
          </div>
          <div className={cn('mt-2 flex flex-col gap-1 text-[13px] leading-6', MUTED)}>
            <span data-viol-owed={String(v.owed.count)} className="whitespace-nowrap">
              <Phrase
                text={w('period.owed')}
                parts={{
                  count: (
                    <Small link={links.violations('violations.owed', { dset: 'false' })}>
                      {count(v.owed.count)}
                    </Small>
                  ),
                }}
              />
              <Sep />
              <Money value={v.owed.amount} className="text-[13px]" />
            </span>
            <span
              data-viol-collected={String(v.collected.amount)}
              data-viol-share={pct ?? ''}
              className="whitespace-nowrap"
            >
              {w('period.collected')} <Money value={v.collected.amount} className="text-[13px]" />{' '}
              {pct === null ? (
                <span className={MUTED}>—</span>
              ) : (
                <span dir="ltr" className={PCT}>
                  {pct}
                </span>
              )}
            </span>
          </div>
        </div>
      }
      foot={<FootLink link={links.violations('violations.period')}>{w('period.all')}</FootLink>}
    />
  );
};

/** A type's name: the catalog's, «غير محدد» for its «unspecified» entry, «—» once it is gone. */
const useTypeName = (): ((t: { unspecified: boolean; name: LocalizedString | null }) => string) => {
  const w = useWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return ({ unspecified, name }) =>
    unspecified ? w('types.unspecified') : name === null ? '—' : localized(name, locale);
};

const TypesCard = ({ v, links }: { v: Violations; links: PeriodLinks }): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const typeName = useTypeName();
  // Each bar against the most numerous type (display only; the counts are the server's).
  const max = Math.max(0, ...v.byType.map((b) => b.count));
  return (
    <Card data-viol-block="types">
      <BlockHead
        icon={I.bars}
        tone="brand"
        title={w('types.title')}
        note={w('types.note')}
        chips={
          <span data-viol-chip="types" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <N>{count(v.count)}</N> {noun('violation', v.count)}
          </span>
        }
      />
      {v.byType.length === 0 ? (
        <EndRow marker="types">{w('empty.period')}</EndRow>
      ) : (
        <ol className={cn('border-t', RULE, DIVIDE)}>
          {v.byType.map((b) => {
            const pct = max > 0 ? (b.count / max) * 100 : 0;
            return (
              <li
                key={b.violationTypeId}
                data-viol-type={b.violationTypeId}
                data-viol-unspecified={String(b.unspecified)}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5"
              >
                <span
                  className={cn(
                    'w-24 shrink-0 truncate whitespace-nowrap text-[14px] font-bold max-sm:flex-1',
                    STRONG,
                  )}
                >
                  {typeName(b)}
                </span>
                <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
                    <div
                      data-viol-bar={b.violationTypeId}
                      className={cn('h-2 rounded-full', TONE.brand.bar)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span
                  className={cn('w-24 shrink-0 whitespace-nowrap text-[13px] font-semibold', MUTED)}
                >
                  <Small link={links.violations('violations.byType', { dtype: b.violationTypeId })}>
                    {count(b.count)}
                  </Small>{' '}
                  {noun('violation', b.count)}
                </span>
                <span className="w-28 shrink-0 whitespace-nowrap text-end">
                  <Money value={b.amount} className="text-[13.5px]" />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div
        data-viol-foot="types"
        className={cn(FOOT_BAND, 'min-h-[46px] max-sm:whitespace-normal', MUTED)}
      >
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="[text-wrap:pretty]">{w('types.foot')}</span>
      </div>
    </Card>
  );
};

// ── The table: a table from 1024 px, each row a block under it (no sideways scroll below) ──

const CELL = 'px-3 py-3.5 align-middle first:ps-5 last:pe-5';

/** How the table folds into blocks under 1024 px (its 900 px of columns would scroll a tablet):
 *  the row's first line holds the car at the start and «فتح» at the end, every other cell a line
 *  of its own with its column's name. */
const F = {
  table: 'max-lg:block',
  head: 'max-lg:hidden',
  body: 'max-lg:block max-lg:border-t',
  row: 'max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:px-4 max-lg:py-3.5',
  cell: 'max-lg:block max-lg:p-0 max-lg:first:ps-0 max-lg:last:pe-0',
  car: 'max-lg:col-start-1 max-lg:row-start-1',
  open: 'max-lg:col-start-2 max-lg:row-start-1',
  line: 'max-lg:col-span-2',
  label: 'lg:hidden',
  scroll: 'lg:overflow-x-auto',
} as const;

/** A column's name beside its value, while the row is a block (the heading says it after). */
const PhoneLabel = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className={cn('me-1.5 text-xs font-semibold', F.label, MUTED)}>{children}</span>
);

/** The car and its make; the chip opens the car's record for a reader of the registry, and only
 *  while the car is in it (an old-book code or a deleted car has no record to open). A car deleted
 *  since says so («محذوفة»), as «كروت تحتاج متابعة» and the registers do. */
const CarCell = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardPeriodViolationRowDto;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const record =
    canVehicle && row.vehicleId !== null && !row.vehicleDeleted
      ? links.vehicle(row.vehicleId, 'violationList.vehicle')
      : null;
  return (
    <div
      data-viol-car={row.code ?? ''}
      {...(row.vehicleDeleted ? { 'data-viol-car-deleted': 'true' } : {})}
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

/**
 * The driver as the register shows him: an HR driver underlined (his card on hover), «مجهول» muted,
 * a name the old book wrote as text, plain. The HR name is the roster's (the row carries the id);
 * a reader the roster does not answer gets the register's own fallback.
 */
const DriverCell = ({ row }: { row: FleetDashboardPeriodViolationRowDto }): JSX.Element => {
  const t = useT();
  const people = useEmployeeRecords(row.driverEmployeeId === null ? [] : [row.driverEmployeeId]);
  if (row.driverEmployeeId !== null) {
    const person = people.get(row.driverEmployeeId);
    return person === undefined ? (
      <span data-viol-driver="hr">
        <DriverName employeeId={row.driverEmployeeId} name={row.driverName} />
      </span>
    ) : (
      <DriverHoverText
        people={[person]}
        className="cursor-default font-semibold text-slate-700 underline decoration-slate-400 decoration-dotted decoration-[1.5px] underline-offset-[5px] dark:text-slate-200 dark:decoration-slate-500"
      >
        <span data-viol-driver="hr">{person.fullNameAr}</span>
      </DriverHoverText>
    );
  }
  if (isUnknownFleetDriver(row)) {
    return (
      <span data-viol-driver="unknown" className={cn('font-semibold', MUTED)}>
        {t('fleet.violations.unknownDriver')}
      </span>
    );
  }
  return (
    <span data-viol-driver="book" className="font-semibold text-slate-700 dark:text-slate-200">
      {row.driverName}
    </span>
  );
};

/** «قائمة» amber, «محصَّلة» emerald — the register's own words and colours, as of now. */
const StateTag = ({ collected }: { collected: boolean }): JSX.Element => {
  const t = useT();
  return (
    <span data-viol-state={collected ? 'collected' : 'owed'}>
      {collected ? (
        <Tag tone="emerald" dot>
          {t('fleet.violations.settled')}
        </Tag>
      ) : (
        <Tag tone="amber" dot>
          {t('fleet.violations.outstanding')}
        </Tag>
      )}
    </span>
  );
};

const FineRow = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardPeriodViolationRowDto;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useWords();
  const typeName = useTypeName();
  return (
    <tr data-viol-row={row.violationId} className={F.row}>
      <td className={cn(CELL, F.cell, F.car)}>
        <CarCell row={row} links={links} canVehicle={canVehicle} />
      </td>
      <td data-viol-date="true" className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('col.date')}</PhoneLabel>
        <N className="font-semibold text-slate-700 dark:text-slate-200">{slashDay(row.date)}</N>
      </td>
      {/* One line from 1280 px (as approved); below it the driver's column is narrow, so a long
          name wraps rather than losing its end to «…». */}
      <td className={cn(CELL, F.cell, F.line, 'xl:truncate xl:whitespace-nowrap')}>
        <PhoneLabel>{w('col.driver')}</PhoneLabel>
        <DriverCell row={row} />
      </td>
      <td
        className={cn(
          CELL,
          F.cell,
          F.line,
          'whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200',
        )}
      >
        <PhoneLabel>{w('col.type')}</PhoneLabel>
        <span data-viol-row-type={row.violationTypeId}>
          {typeName({ unspecified: row.unspecified, name: row.violationType })}
        </span>
      </td>
      <td className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('col.amount')}</PhoneLabel>
        <Money value={row.amount} className="text-[13px]" />
      </td>
      <td className={cn(CELL, F.cell, F.line)}>
        <StateTag collected={row.collected} />
      </td>
      <td className={cn(CELL, F.cell, F.open, 'text-end')}>
        <Btn link={links.violationRow(row)} className="h-9 px-4">
          {w('openRow')}
        </Btn>
      </td>
    </tr>
  );
};

const FinesTable = ({
  list,
  violations,
  links,
  canVehicle,
}: {
  list: ViolationList;
  /** The period's count for the chip; `null` when its section is not drawn. */
  violations: Violations | null;
  links: PeriodLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-viol-block="list" className="mt-5">
      <BlockHead
        icon={I.doc}
        tone="sky"
        title={w('list.title')}
        note={w('list.note')}
        chips={
          violations === null ? undefined : (
            <span data-viol-chip="list" className={cn(COUNT_CHIP, TONE.sky.soft)}>
              <N>{count(violations.count)}</N> {noun('violation', violations.count)}
            </span>
          )
        }
      />
      {list.rows.length === 0 ? (
        <EndRow marker="list">{w('empty.period')}</EndRow>
      ) : (
        <div className={F.scroll}>
          <table
            className={cn(
              'w-full border-collapse text-[13px] lg:min-w-[900px] lg:table-fixed',
              F.table,
            )}
          >
            <colgroup className={F.head}>
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[104px]" />
            </colgroup>
            <thead className={cn(TH_ROW, F.head)}>
              <tr className={cn('border-y', RULE)}>
                <th className={th}>{w('col.vehicle')}</th>
                <th className={th}>{w('col.date')}</th>
                <th className={th}>{w('col.driver')}</th>
                <th className={th}>{w('col.type')}</th>
                <th className={th}>{w('col.amount')}</th>
                <th className={th}>{w('col.status')}</th>
                <th className={cn(CELL, 'py-2.5')}>
                  <span className="sr-only">{w('openRow')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, F.body, RULE)}>
              {list.rows.map((row) => (
                <FineRow key={row.violationId} row={row} links={links} canVehicle={canVehicle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BlockFoot>
        {list.more > 0 && (
          <FootLink link={links.violations('violationList.more')}>
            <span data-viol-more={String(list.more)}>
              <Phrase text={w('more')} parts={{ count: <N>{count(list.more)}</N> }} />
            </span>
          </FootLink>
        )}
        <FootLink link={links.violations('violationList.all')}>{w('register')}</FootLink>
      </BlockFoot>
    </Card>
  );
};

/** The period's figures on their way: the row of two and the table in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
    <Skeleton className="h-72 rounded-2xl" />
  </div>
);

const PeriodBody = ({
  data,
  onRetry,
  canVehicle,
}: {
  data: FleetDashboardPeriodDto;
  onRetry: () => void;
  canVehicle: boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const links = periodLinks(data);
  const violationsState = periodState(data, 'violations');
  const listState = periodState(data, 'violationList');
  const violations = violationsState === 'shown' ? data.violations : null;
  const list = listState === 'shown' ? data.violationList : null;
  return (
    <>
      {violationsState === 'failed' && <SectionError section="violations" onRetry={onRetry} />}
      {violations !== null && (
        // Beside the types from 1024 px: halves to 1280 px (a third would cut into the card's
        // one-line title), then one to two as approved.
        <div
          data-viol-period-row="true"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
          <PeriodKpi v={violations} links={links} />
          <TypesCard v={violations} links={links} />
        </div>
      )}
      {listState === 'failed' && (
        <SectionError section="violationList" onRetry={onRetry} className="mt-5" />
      )}
      {list !== null && (
        <FinesTable list={list} violations={violations} links={links} canVehicle={canVehicle} />
      )}
      {(violations !== null || list !== null) && (
        <div data-viol-notes="true" className="mt-4 flex flex-col gap-1.5 px-1">
          <NoteLine>{w('note')}</NoteLine>
          {/* The company's statements carry a year, not a day: never in a period (the «ملخصات»
              sentence, kept where it is — that tab reads it too). */}
          <NoteLine>{t('fleet.dash.summaries.annualNote')}</NoteLine>
        </div>
      )}
    </>
  );
};

const PeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  return (
    <section data-viol-band="period" aria-label={w('period')} className="mt-8">
      <BandHead
        id="period"
        tone="sky"
        title={w('period')}
        chips={data === undefined ? undefined : <RangeChip range={data.range} />}
        sub={w('period.sub')}
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
        {data !== undefined && (
          <PeriodBody data={data} onRetry={period.onRetry} canVehicle={can('fleetVehicle.view')} />
        )}
      </ReadBand>
    </section>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const ViolationsTab = (props: MixedTabProps): JSX.Element => {
  const { can } = props;
  const nowOk = sectionPermitted('violationsOpen', can);
  // The period band for a reader of R2's drivers' fines (the same key as «الآن»'s, so every reader
  // of this tab sees both bands while R2 is theirs).
  const periodOk = props.period.enabled && sectionPermitted('violations', can);
  return (
    <div data-dash-tab-body="violations">
      <Heading props={props} />
      {nowOk && <NowBand props={props} />}
      {periodOk && <PeriodBand props={props} />}
    </div>
  );
};
