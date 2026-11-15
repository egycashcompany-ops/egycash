// Tab 3 «توزيع السيارات» — the owner-approved sample (approved/dist-dark.png, dist-branch-dark.png;
// harness zz-distribution.tsx) over the real reads: R1 `distributionVehicles` / `distributionDrivers`,
// the fixed «هذا الشهر» read (`props.month`, R2 with no page filter) for the kilometres, and the supply
// contracts' own summary (three calls of the contracts screen's hook, this year's contracts only).
//
//   1  the heading — its line names only what this reader is shown (drivers, km, supply by grant)
//   2  the operation row — «كل السيارات النشطة» (cash · ATM · «أخرى» on one meter), «نقل الأموال»,
//      «ATM»; each with its drivers in the grey band (the drivers, «سائق لكل سيارة», more/fewer)
//   3  the company (and «كل فروعي»): «الفروع» — a card per branch in the server's order (active cars
//      desc), its operations line from the server's `kinds` — then the type × branch matrix and, under
//      it, the month's kilometres by branch as a column chart, both the page's full width (the
//      owner: «الجدول … واخد عرض الصفحة كلها … الكيلومترات يكون تحته ويبقى شارتس مش بروجريس»)
//   3' one branch in scope (`scopeBranches.length === 1`, the switcher's branch or a one-branch
//      reader alike): the branch's cars by type (bars, two columns) and its kilometres by type
//   4  «عقود توريد السيارات» — this year's contracts, company-wide (contracts carry no branch)
//
// NOTHING IS COUNTED HERE. Every figure is a field a read sent: «أخرى» is the server's `other` and
// `kinds`, a branch's line its `kinds`, the km columns R2's rows. The browser draws shares, the
// drivers ratio, the more/fewer gap and «المتبقية» (contracted − received) — display arithmetic on
// figures shown side by side. «أخرى», «بلا فرع» and «غير مسجّلة» have no link: no screen lists exactly
// them. The km links come from the month read's OWN echo, never the page's filters. Every data bar and
// column is the brand's (DECISIONS §5); the operations keep their colours (brand · sky · slate).
import { type ReactNode } from 'react';
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { useVehicleContractSummary } from '../../api/vehicle-contract-queries';
import {
  nowLinks,
  periodLinks,
  type DashLink,
  type NowLinks,
} from '../../lib/fleet-dashboard-links';
import {
  leadIndex,
  ratioText,
  sectionPermitted,
  share,
  shareText,
  slashDay,
} from '../../lib/fleet-dashboard-tabs';
import {
  BAND,
  BOX,
  BOX_HOVER,
  Btn,
  CAIRO,
  Card,
  CompanyWide,
  DIVIDE,
  Fig,
  HEAD_CHIP,
  I,
  IconTile,
  MUTED,
  Meter,
  N,
  NOTE,
  RED,
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
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  HBars,
  Kpi,
  NoteLine,
  RangeChip,
  SHARE,
  Sep,
  Small,
  WORDS,
  Big,
  monthName,
  type HBarRow,
} from './dash-blocks';
import { ColumnChart, type ColumnDatum } from './dash-columns';
import {
  Phrase,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type MonthRead,
  type NowTabProps,
} from './dash-shell';
import { kmText } from './tab-period';

type Vehicles = NonNullable<FleetDashboardNowDto['distributionVehicles']>;
type Drivers = NonNullable<FleetDashboardNowDto['distributionDrivers']>;
type Kinds = Vehicles['noBranchKinds'];
type Km = NonNullable<FleetDashboardPeriodDto['km']>;

const W = 'fleet.dash.distribution';

/** A part's share of a whole for a meter (0 when there is no whole). */
const pct = (part: number, whole: number): number => share(part, whole) ?? 0;

/** The meter of the three operations, in card 1's colours: cash brand · ATM sky · «أخرى» slate. */
const kindParts = (kinds: Kinds, whole: number): { pct: number; tone: Tone }[] => [
  { pct: pct(kinds.cash, whole), tone: 'brand' },
  { pct: pct(kinds.atm, whole), tone: 'sky' },
  { pct: pct(kinds.other, whole), tone: 'slate' },
];

const LegendDot = ({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', TONE[tone].bar)} />
    {children}
  </span>
);

/** The kit's section head with its line UNDER the title (the approved «الفروع» head). */
const SectionTitle = ({ title, sub }: { title: string; sub: string }): JSX.Element => (
  <div className="mb-3 mt-7 border-b border-slate-200 pb-2.5 dark:border-[#1c263b]">
    <h3 className={cn(TITLE, 'flex items-center gap-2')}>
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE.emerald.dot)} />
      {title}
    </h3>
    <p className={cn('mt-0.5 ps-4 text-xs font-semibold', MUTED)}>{sub}</p>
  </div>
);

/** A block's head figure: its label, then the big total and its unit. */
const HeadFigure = ({
  id,
  label,
  value,
  unit,
  link,
}: {
  id: string;
  label: string;
  value: string;
  unit: string;
  link: DashLink | null;
}): JSX.Element => (
  <div data-dist-total={id} className="px-5 pb-1">
    <div className={cn('text-xs font-bold dark:font-semibold', MUTED)}>{label}</div>
    <div className="mt-2 flex items-baseline gap-2">
      <Big link={link}>{value}</Big>
      <span className={WORDS}>{unit}</span>
    </div>
  </div>
);

// ── 1 · The heading ───────────────────────────────────────────────────────────────────────────

const Heading = ({
  props,
  oneBranch,
  drivers,
  km,
  supply,
}: {
  props: NowTabProps;
  oneBranch: boolean;
  drivers: boolean;
  km: boolean;
  supply: { updatedAt: number; fetching: boolean; refetch: () => void } | null;
}): JSX.Element => {
  const t = useT();
  const view = oneBranch ? 'branch' : 'company';
  const sub = t(`${W}.sub.line`, {
    what: t(`${W}.sub.${view}`),
    drivers: drivers ? t(`${W}.sub.drivers.${view}`) : '',
    km: km ? t(`${W}.sub.km.${view}`) : '',
    supply: supply === null ? '' : t(`${W}.sub.supply`),
  });
  // The heading's age is its OLDEST figures': R1 and the month read (the page), and the contracts.
  const updatedAt =
    supply === null || supply.updatedAt === 0
      ? props.updatedAt
      : props.updatedAt === 0
        ? supply.updatedAt
        : Math.min(props.updatedAt, supply.updatedAt);
  return (
    <TabHead
      icon={I.pin}
      title={t(`${W}.title`)}
      sub={sub}
      end={
        <RefreshTools
          updatedAt={updatedAt}
          onRefresh={() => {
            props.onRefresh();
            supply?.refetch();
          }}
          refreshing={props.refreshing || (supply?.fetching ?? false)}
          {...(props.clock === undefined ? {} : { clock: props.clock })}
        />
      }
    />
  );
};

// ── 2 · The operation row ─────────────────────────────────────────────────────────────────────

const TILE_FIG = cn(
  'text-[24px] font-black leading-none tracking-tight text-slate-900 dark:text-white',
  CAIRO,
);

/** A tile of the drivers' band: the label over the figure, the icon at its side. */
const BandTile = ({
  id,
  icon,
  label,
  children,
}: {
  id: string;
  icon: IconPath;
  label: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-dist-tile={id}
    className={cn(BOX, BOX_HOVER, 'flex min-w-0 items-center justify-between gap-2 px-3.5 py-3')}
  >
    <div className="min-w-0">
      <div className={cn(WORDS, 'whitespace-nowrap text-[12.5px]')}>{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
    <IconTile d={icon} tone="slate" size="sm" />
  </div>
);

/** «منهم N بتصنيف قديم» — drivers counted through the old specialisation; only when there are. */
const Legacy = ({ n }: { n: number }): JSX.Element | null => {
  const t = useT();
  if (n <= 0) return null;
  return (
    <p data-dist-legacy="true" className={cn('mt-1 px-1 text-[12px] font-semibold', MUTED)}>
      <Phrase text={t(`${W}.legacy`)} parts={{ count: <N className="font-bold">{count(n)}</N> }} />
    </p>
  );
};

/** The drivers against the cars: the drivers (a link), «سائق لكل سيارة» (a plain ratio — no mark, no
 *  colour, no target) and the system's more/fewer sentence. */
const DriversBand = ({
  id,
  drivers,
  cars,
  link,
  legacy,
}: {
  id: string;
  drivers: number;
  cars: number;
  link: DashLink | null;
  legacy: number;
}): JSX.Element => {
  const t = useT();
  const gap = drivers - cars;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <BandTile id={`${id}.drivers`} icon={I.users} label={t(`${W}.drivers`)}>
          <Fig link={link} className={TILE_FIG}>
            <N className="!font-[inherit]">{count(drivers)}</N>
          </Fig>
        </BandTile>
        <BandTile id={`${id}.ratio`} icon={I.scale} label={t(`${W}.perVehicle`)}>
          <span data-dist-ratio={id} className={TILE_FIG}>
            <N className="!font-[inherit]">{ratioText(drivers, cars)}</N>
          </span>
        </BandTile>
      </div>
      <p
        data-dist-sentence={id}
        className={cn('mt-2.5 px-1 text-[12.5px] font-semibold leading-5', MUTED)}
      >
        {gap === 0 ? (
          t(`${W}.even`)
        ) : (
          <Phrase
            text={t(gap > 0 ? `${W}.moreDrivers` : `${W}.moreCars`)}
            parts={{ count: <N className={cn('font-bold', STRONG)}>{count(Math.abs(gap))}</N> }}
          />
        )}
      </p>
      <Legacy n={legacy} />
    </>
  );
};

const OperationRow = ({
  vehicles,
  drivers,
  links,
  oneBranch,
  narrowed,
}: {
  vehicles: Vehicles | null;
  drivers: Drivers | null;
  links: NowLinks;
  oneBranch: boolean;
  narrowed: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const active = vehicles?.totals.total ?? 0;
  const activeUnit = (n: number): string => t(`${W}.activeUnit`, { noun: noun('car', n) });
  const ofActive = t(oneBranch ? `${W}.ofBranchActive` : `${W}.ofActive`);
  const ofCount = (
    <span>
      <Phrase
        text={t(oneBranch ? `${W}.ofBranchActiveCount` : `${W}.ofActiveCount`)}
        parts={{
          count: <N className={cn('font-bold', STRONG)}>{count(active)}</N>,
          noun: noun('car', active),
        }}
      />
    </span>
  );
  const kindLink = (key: 'cash' | 'atm'): DashLink | null =>
    vehicles === null || vehicles[key].operationIds.length === 0
      ? null
      : links.vehiclesBy(
          { operationIds: vehicles[key].operationIds },
          `distributionVehicles.${key}`,
        );
  const driversLink = (key: 'cash' | 'atm'): DashLink | null =>
    drivers === null
      ? null
      : links.driversBySpec(drivers[key].specializationIds, `distributionDrivers.${key}`);

  // A reader with the drivers but not the cars: each card holds its drivers alone (absent, not 0,
  // for the cars).
  if (vehicles === null) {
    if (drivers === null) return <></>;
    const card = (id: 'all' | 'cash' | 'atm', tone: Tone, icon: IconPath, title: string) => {
      const n = id === 'all' ? drivers.total : drivers[id].drivers;
      return (
        <Kpi
          key={id}
          id={id}
          data-op-card={id}
          tone={tone}
          icon={icon}
          title={title}
          figure={
            <>
              <Big link={id === 'all' ? links.drivers() : driversLink(id)}>{count(n)}</Big>
              <span className={WORDS}>{noun('driver', n)}</span>
            </>
          }
          sub={id === 'all' ? undefined : <Legacy n={drivers[id].legacy} />}
        />
      );
    };
    return (
      <div data-dist-block="operations" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {card('all', 'emerald', I.truck, t(`${W}.allTitle`))}
        {card('cash', 'brand', I.cash, t(`${W}.cashTitle`))}
        {card('atm', 'sky', I.card, t(`${W}.atmTitle`))}
      </div>
    );
  }

  const kinds: Kinds = {
    cash: vehicles.cash.vehicles,
    atm: vehicles.atm.vehicles,
    other: vehicles.other.vehicles,
  };
  const allSub =
    drivers === null
      ? t(oneBranch ? `${W}.allSubCarsBranch` : `${W}.allSubCars`)
      : t(oneBranch ? `${W}.allSubBranch` : `${W}.allSub`);
  const kindCard = (key: 'cash' | 'atm', tone: Tone, icon: IconPath) => {
    const n = vehicles[key].vehicles;
    return (
      <Kpi
        id={key}
        data-op-card={key}
        tone={tone}
        icon={icon}
        title={t(`${W}.${key}Title`)}
        tag={
          <Tag tone={tone} dot>
            <N>{shareText(n, active)}</N> {ofActive}
          </Tag>
        }
        figure={
          <>
            <Big link={kindLink(key)}>{count(n)}</Big>
            <span className={WORDS}>{activeUnit(n)}</span>
          </>
        }
        sub={
          <div className="w-full">
            <Meter height="h-2.5" parts={[{ pct: pct(n, active), tone }]} />
            <div className={cn('mt-2.5 flex min-h-5 items-center text-xs font-semibold', MUTED)}>
              {ofCount}
            </div>
          </div>
        }
        {...(drivers === null
          ? {}
          : {
              box: (
                <DriversBand
                  id={key}
                  drivers={drivers[key].drivers}
                  cars={n}
                  link={driversLink(key)}
                  legacy={drivers[key].legacy}
                />
              ),
            })}
      />
    );
  };
  return (
    <>
      <div data-dist-block="operations" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Kpi
          id="all"
          data-op-card="all"
          tone="emerald"
          icon={I.truck}
          title={t(`${W}.allTitle`)}
          tag={<span className={cn(NOTE, 'whitespace-nowrap')}>{allSub}</span>}
          figure={
            <>
              <Big link={links.vehiclesBy({}, 'distributionVehicles.total')}>{count(active)}</Big>
              <span className={WORDS}>{activeUnit(active)}</span>
            </>
          }
          sub={
            <div className="w-full">
              <Meter height="h-2.5" parts={kindParts(kinds, active)} />
              <div
                data-op-legend="all"
                className={cn(
                  'mt-2.5 flex min-h-5 flex-wrap items-center gap-x-4 text-xs font-semibold',
                  MUTED,
                )}
              >
                <LegendDot tone="brand">
                  {t(`${W}.cashTitle`)} <Small link={kindLink('cash')}>{count(kinds.cash)}</Small>
                </LegendDot>
                <LegendDot tone="sky">
                  {t(`${W}.atmTitle`)} <Small link={kindLink('atm')}>{count(kinds.atm)}</Small>
                </LegendDot>
                <LegendDot tone="slate">
                  {t(`${W}.other`)} <Small>{count(kinds.other)}</Small>
                </LegendDot>
              </div>
            </div>
          }
          {...(drivers === null
            ? {}
            : {
                box: (
                  <DriversBand
                    id="all"
                    drivers={drivers.total}
                    cars={active}
                    link={links.drivers()}
                    legacy={0}
                  />
                ),
              })}
        />
        {kindCard('cash', 'brand', I.cash)}
        {kindCard('atm', 'sky', I.card)}
      </div>
      {narrowed && drivers !== null && (
        <div data-dist-drivers-note="true" className="mt-3 px-1">
          <NoteLine>{t(`${W}.driversBranchNote`)}</NoteLine>
        </div>
      )}
    </>
  );
};

// ── 3 · «الفروع»: a card per branch, in the server's order ──────────────────────────────────────

/** The «بلا فرع» card: red, and no link (the vehicles screen has no such parameter). */
const NONE_CARD =
  'relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-red-200/90 bg-red-50/80 px-4 pb-4 pt-4 shadow-sm dark:border-red-500/40 dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)]';

const BranchCard = ({
  id,
  name,
  n,
  kinds,
  whole,
  lead,
  links,
  vehicles,
}: {
  /** The branch id; `null` = «بلا فرع». */
  id: string | null;
  name: string;
  n: number;
  kinds: Kinds;
  whole: number;
  lead: boolean;
  links: NowLinks;
  vehicles: Vehicles;
}): JSX.Element => {
  const t = useT();
  const none = id === null;
  const kindLink = (key: 'cash' | 'atm'): DashLink | null =>
    id === null || vehicles[key].operationIds.length === 0
      ? null
      : links.vehiclesBy(
          { branchId: id, operationIds: vehicles[key].operationIds },
          key === 'cash' ? 'distributionVehicles.branchCash' : 'distributionVehicles.branchAtm',
        );
  const body = (
    <>
      <div className="flex h-6 items-center justify-between gap-2">
        <h4 className={cn(TITLE, 'truncate whitespace-nowrap', none && RED)}>{name}</h4>
        {lead && <Tag tone="brand">{t(`${W}.biggest`)}</Tag>}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <Big
            link={
              id === null ? null : links.vehiclesBy({ branchId: id }, 'distributionVehicles.branch')
            }
            className={cn('!text-[30px]', none && '!text-red-700 dark:!text-red-300')}
          >
            {count(n)}
          </Big>
          <span className={WORDS}>{t(`${W}.activeShort`)}</span>
        </span>
        <N className="text-[13px] font-bold text-slate-600 dark:text-slate-300">
          {shareText(n, whole)}
        </N>
      </div>
      <div className="mt-2.5">
        <Meter parts={none ? [{ pct: pct(n, whole), tone: 'red' }] : kindParts(kinds, whole)} />
      </div>
      <div
        data-branch-kinds={id ?? 'none'}
        className={cn(
          BOX,
          'mt-3.5 whitespace-nowrap px-2.5 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-300',
        )}
      >
        {t(`${W}.cashTitle`)} <Small link={kindLink('cash')}>{count(kinds.cash)}</Small>
        <Sep />
        {t(`${W}.atmTitle`)} <Small link={kindLink('atm')}>{count(kinds.atm)}</Small>
        <Sep />
        {t(`${W}.other`)} <Small>{count(kinds.other)}</Small>
      </div>
    </>
  );
  return none ? (
    <div data-branch-card="none" className={NONE_CARD}>
      {body}
    </div>
  ) : (
    <Card data-branch-card={id} className="px-4 pb-4 pt-4">
      {body}
    </Card>
  );
};

const Branches = ({ vehicles, links }: { vehicles: Vehicles; links: NowLinks }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const whole = vehicles.totals.total;
  const lead = leadIndex(vehicles.branches.map((b) => vehicles.totals.counts[b.id] ?? 0));
  const zero: Kinds = { cash: 0, atm: 0, other: 0 };
  return (
    <section data-dist-block="branches">
      <SectionTitle title={t(`${W}.branchesTitle`)} sub={t(`${W}.branchesSub`)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1700px]:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))]">
        {vehicles.branches.map((b, i) => (
          <BranchCard
            key={b.id}
            id={b.id}
            name={localized(b.name, locale)}
            n={vehicles.totals.counts[b.id] ?? 0}
            kinds={vehicles.kinds[b.id] ?? zero}
            whole={whole}
            lead={i === lead}
            links={links}
            vehicles={vehicles}
          />
        ))}
        {vehicles.totals.noBranch > 0 && (
          <BranchCard
            id={null}
            name={t(`${W}.noBranch`)}
            n={vehicles.totals.noBranch}
            kinds={vehicles.noBranchKinds}
            whole={whole}
            lead={false}
            links={links}
            vehicles={vehicles}
          />
        )}
      </div>
    </section>
  );
};

// ── 4 · The type × branch matrix, the page's full width ─────────────────────────────────────────

const TCELL = 'px-2.5 py-3.5 align-middle first:ps-5 last:pe-5';
const TOTAL_COL = 'bg-slate-50 dark:bg-[#0c121e]';
/** The type column stays put while a narrow screen scrolls the table sideways under it. */
const STICKY = 'sticky start-0 z-[1]';
/** Its cells' own ground — only where the table can scroll (under the card's 880 px), so the wide
 *  table reads as one surface. */
const STICKY_BODY = 'max-lg:bg-white max-lg:dark:bg-[#0e1422]';

/** A zero cell: a dash, never a 0 and never a link. */
const Zero = (): JSX.Element => (
  <span aria-label="0" className="font-semibold text-slate-400 dark:text-slate-600">
    —
  </span>
);

const Matrix = ({ vehicles, links }: { vehicles: Vehicles; links: NowLinks }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const total = vehicles.totals.total;
  const showNone = vehicles.totals.noBranch > 0;
  return (
    <Card data-dist-block="matrix" data-fleet-matrix="true">
      <BlockHead
        icon={I.grid}
        tone="brand"
        title={t(`${W}.matrixTitle`)}
        note={t(`${W}.matrixSub`)}
        chips={
          <span data-dist-chip="matrix" className={cn(COUNT_CHIP, TONE.brand.soft)}>
            <Phrase
              text={t(`${W}.matrixChip`)}
              parts={{ count: <N>{count(total)}</N>, noun: noun('car', total) }}
            />
          </span>
        }
      />
      {vehicles.rows.length === 0 ? (
        <p className={cn('px-5 pb-6', NOTE)}>{t(`${W}.empty`)}</p>
      ) : (
        <div data-dist-scroll="matrix" className="overflow-x-auto">
          <table className="w-full min-w-[880px] table-fixed border-collapse text-[13px]">
            <thead className={TH_ROW}>
              <tr className={cn('border-y', RULE)}>
                <th className={cn(TCELL, TH, STICKY, TH_ROW, 'w-[19%] py-2.5 text-start')}>
                  {t(`${W}.type`)}
                </th>
                {vehicles.branches.map((b) => (
                  <th key={b.id} className={cn(TCELL, TH, 'whitespace-nowrap py-2.5 text-center')}>
                    {localized(b.name, locale)}
                  </th>
                ))}
                {showNone && (
                  <th className={cn(TCELL, TH, 'whitespace-nowrap py-2.5 text-center', RED)}>
                    {t(`${W}.noBranch`)}
                  </th>
                )}
                <th className={cn(TCELL, TH, 'w-[12%] py-2.5 text-center')}>{t(`${W}.total`)}</th>
              </tr>
            </thead>
            <tbody className={DIVIDE}>
              {vehicles.rows.map((row) => (
                <tr key={row.typeId} data-dist-type={row.typeId}>
                  <td
                    className={cn(
                      TCELL,
                      STICKY,
                      STICKY_BODY,
                      'whitespace-nowrap font-bold',
                      STRONG,
                    )}
                  >
                    {localized(row.name, locale)}
                  </td>
                  {vehicles.branches.map((b) => {
                    const n = row.counts[b.id] ?? 0;
                    return (
                      <td key={b.id} className={cn(TCELL, 'text-center')}>
                        {n === 0 ? (
                          <Zero />
                        ) : (
                          <Small
                            link={links.vehiclesBy(
                              { typeId: row.typeId, branchId: b.id },
                              'distributionVehicles.cell',
                            )}
                            className="text-slate-700 dark:text-slate-200"
                          >
                            {count(n)}
                          </Small>
                        )}
                      </td>
                    );
                  })}
                  {showNone && (
                    <td className={cn(TCELL, 'text-center')}>
                      {row.noBranch === 0 ? (
                        <Zero />
                      ) : (
                        <Small className={RED}>{count(row.noBranch)}</Small>
                      )}
                    </td>
                  )}
                  <td className={cn(TCELL, TOTAL_COL, 'whitespace-nowrap text-center')}>
                    <Small
                      link={links.vehiclesBy(
                        { typeId: row.typeId },
                        'distributionVehicles.typeTotal',
                      )}
                    >
                      {count(row.total)}
                    </Small>
                    <N className={cn('ms-1.5', SHARE)}>{shareText(row.total, total)}</N>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={cn('border-t', RULE, TH_ROW)}>
                <td className={cn(TCELL, STICKY, TH_ROW, 'whitespace-nowrap font-bold', STRONG)}>
                  {t(`${W}.branchTotal`)}
                </td>
                {vehicles.branches.map((b) => (
                  <td key={b.id} className={cn(TCELL, 'text-center')}>
                    <Small
                      link={links.vehiclesBy({ branchId: b.id }, 'distributionVehicles.branch')}
                    >
                      {count(vehicles.totals.counts[b.id] ?? 0)}
                    </Small>
                  </td>
                ))}
                {showNone && (
                  <td className={cn(TCELL, 'text-center')}>
                    <Small className={RED}>{count(vehicles.totals.noBranch)}</Small>
                  </td>
                )}
                <td className={cn(TCELL, 'text-center')}>
                  <Small
                    link={links.vehiclesBy({}, 'distributionVehicles.total')}
                    className={cn('text-[15px]', TONE.brand.text)}
                  >
                    {count(total)}
                  </Small>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <BlockFoot stack>
        <NoteLine>{t(`${W}.matrixNote`)}</NoteLine>
        {showNone && <NoteLine>{t(`${W}.matrixNoBranchNote`)}</NoteLine>}
      </BlockFoot>
    </Card>
  );
};

// ── 5 · The month's kilometres (the fixed «هذا الشهر» read, never the page's filters) ─────────────

/** «نوفمبر 2026» — the month alone, where the title already says «هذا الشهر». */
const MonthChip = ({ range }: { range: FleetDashboardPeriodDto['range'] }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span data-dash-month={range.from.slice(0, 7)} className={HEAD_CHIP}>
      {monthName(range.from, locale)} <N>{range.from.slice(0, 4)}</N>
    </span>
  );
};

/** The average of the confirmed days, or why there is none yet. */
const AverageLine = ({ km }: { km: Km }): JSX.Element => {
  const t = useT();
  if (km.closedDays === 0 || km.average === null || km.confirmedThrough === null) {
    return (
      <p data-dist-average="none" className="font-semibold">
        {t('fleet.dash.km.legend.noAverage')}
      </p>
    );
  }
  return (
    <p data-dist-average="true" className="font-semibold">
      <Phrase
        text={t(`${W}.averageLine`)}
        parts={{
          day: <N>{slashDay(km.confirmedThrough)}</N>,
          km: <N className={cn('font-bold', STRONG)}>{kmText(km.average)}</N>,
        }}
      />
    </p>
  );
};

/** The km block's face while the month read is on its way, or its error and retry. */
const MonthPending = ({
  id,
  month,
  icon,
  title,
}: {
  id: string;
  month: MonthRead;
  icon: IconPath;
  title: string;
}): JSX.Element =>
  month.failed ? (
    <div data-dist-block={id}>
      <SectionError section="km" onRetry={month.onRetry} />
    </div>
  ) : (
    <Card data-dist-block={id} data-dist-loading="true">
      <BlockHead icon={icon} tone="teal" title={title} />
      <div className="px-5 pb-5">
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </Card>
  );

/** The month read as this tab draws it: hidden, on its way / failed, failed section, or its km. */
const monthKm = (
  month: MonthRead,
  can: (permission: string) => boolean,
): 'hidden' | 'pending' | 'failed' | { data: FleetDashboardPeriodDto; km: Km } => {
  if (!month.enabled || !sectionPermitted('km', can)) return 'hidden';
  const data = month.data;
  if (data === undefined) return 'pending';
  if ((data.unavailable as readonly string[]).includes('km')) return 'failed';
  return data.km === null ? 'hidden' : { data, km: data.km };
};

const KmByBranch = ({ data, km }: { data: FleetDashboardPeriodDto; km: Km }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const unit = t('fleet.dash.km.unit');
  const of = t(`${W}.ofTotal`);
  // The month read's OWN echo: its range and its set, one branch narrower per column.
  const narrowed = (branchId: string) =>
    periodLinks({ range: data.range, vehicleScope: { ...data.vehicleScope, branchId } });
  const columns: ColumnDatum[] = km.byBranch.map((row) => ({
    key: row.branchId ?? 'none',
    name: row.name === null ? t('fleet.dash.km.noBranch') : localized(row.name, locale),
    value: row.km,
    valueText: kmText(row.km),
    unit,
    share: shareText(row.km, km.total),
    link: row.branchId === null ? null : narrowed(row.branchId).km('km.byBranch'),
    muted: row.branchId === null,
  }));
  if (km.unregistered !== null && km.unregistered > 0) {
    columns.push({
      key: 'unregistered',
      name: t('fleet.dash.km.unregistered'),
      value: km.unregistered,
      valueText: kmText(km.unregistered),
      unit,
      share: shareText(km.unregistered, km.total),
      link: null,
      muted: true,
    });
  }
  return (
    <Card data-dist-block="km">
      <BlockHead
        icon={I.gauge}
        tone="teal"
        title={t(`${W}.kmTitle`)}
        note={t(`${W}.kmNote`)}
        chips={<RangeChip range={data.range} />}
      />
      <HeadFigure
        id="km"
        label={t(`${W}.kmTotal`)}
        value={kmText(km.total)}
        unit={unit}
        link={periodLinks(data).km('km.total')}
      />
      {columns.length === 0 ? (
        <p className={cn('px-5 pb-5 pt-3', NOTE)}>{t('fleet.dash.km.noReadings')}</p>
      ) : (
        <ColumnChart id="km" columns={columns} ariaLabel={t(`${W}.kmTitle`)} of={of} />
      )}
      <BlockFoot stack>
        <AverageLine km={km} />
        <NoteLine>{t('fleet.dash.km.byBranchNote')}</NoteLine>
      </BlockFoot>
    </Card>
  );
};

// ── 5' · One branch in scope: its cars by type, its kilometres by type ─────────────────────────

const BranchCarsByType = ({
  vehicles,
  branchId,
  links,
}: {
  vehicles: Vehicles;
  branchId: string;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const total = vehicles.totals.total;
  const rows: HBarRow[] = vehicles.rows
    .filter((row) => (row.counts[branchId] ?? 0) > 0)
    .map((row) => {
      const n = row.counts[branchId] ?? 0;
      return {
        key: row.typeId,
        name: localized(row.name, locale),
        value: count(n),
        n,
        unit: noun('car', n),
        extra: shareText(n, total),
        link: links.vehiclesBy(
          { typeId: row.typeId, branchId },
          'distributionVehicles.typeInBranch',
        ),
      };
    });
  return (
    <Card data-dist-block="branch-types">
      <BlockHead
        icon={I.grid}
        tone="brand"
        title={t(`${W}.branchTypesTitle`)}
        note={t(`${W}.branchTypesNote`)}
      />
      <HeadFigure
        id="branch-types"
        label={t(`${W}.branchActive`)}
        value={count(total)}
        unit={t(`${W}.activeUnit`, { noun: noun('car', total) })}
        link={links.vehiclesBy({ branchId }, 'distributionVehicles.branch')}
      />
      <div className="px-5 pb-5 pt-4">
        {rows.length === 0 ? (
          <p className={NOTE}>{t(`${W}.empty`)}</p>
        ) : (
          <HBars rows={rows} tone="brand" columns={2} />
        )}
      </div>
      <BlockFoot stack>
        <NoteLine>{t(`${W}.matrixNote`)}</NoteLine>
        <NoteLine>{t(`${W}.barsNote`)}</NoteLine>
      </BlockFoot>
    </Card>
  );
};

const BranchKmByType = ({ data, km }: { data: FleetDashboardPeriodDto; km: Km }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const unit = t('fleet.dash.km.unit');
  const narrowed = (typeId: string) =>
    periodLinks({ range: data.range, vehicleScope: { ...data.vehicleScope, typeIds: [typeId] } });
  const columns: ColumnDatum[] = (km.byType ?? []).map((row) => ({
    key: row.typeId,
    name: localized(row.name, locale),
    value: row.km,
    valueText: kmText(row.km),
    unit,
    share: shareText(row.km, km.total),
    link: narrowed(row.typeId).km('km.byType'),
  }));
  if (km.unregistered !== null && km.unregistered > 0) {
    columns.push({
      key: 'unregistered',
      name: t('fleet.dash.km.unregistered'),
      value: km.unregistered,
      valueText: kmText(km.unregistered),
      unit,
      share: shareText(km.unregistered, km.total),
      link: null,
      muted: true,
    });
  }
  return (
    <Card data-dist-block="branch-km">
      <BlockHead
        icon={I.gauge}
        tone="teal"
        title={t(`${W}.branchKmTitle`)}
        note={t(`${W}.branchKmNote`)}
        chips={<MonthChip range={data.range} />}
      />
      <HeadFigure
        id="branch-km"
        label={t(`${W}.branchKmTotal`)}
        value={kmText(km.total)}
        unit={unit}
        link={periodLinks(data).km('km.total')}
      />
      {columns.length === 0 ? (
        <p className={cn('px-5 pb-5 pt-3', NOTE)}>{t('fleet.dash.km.noReadings')}</p>
      ) : (
        <ColumnChart
          id="branch-km"
          columns={columns}
          ariaLabel={t(`${W}.branchKmTitle`)}
          of={t(`${W}.ofBranchKm`)}
        />
      )}
      <BlockFoot stack>
        <AverageLine km={km} />
        <NoteLine>
          {t('fleet.dash.km.byTypeNote')} {t(`${W}.notClosedYet`)}
        </NoteLine>
      </BlockFoot>
    </Card>
  );
};

// ── 6 · «عقود توريد السيارات»: this year's contracts, company-wide ──────────────────────────────

type Summary = ReturnType<typeof useVehicleContractSummary>;
const yearWindow = (year: string) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** The contracts' three summaries (all, red, yellow) over the contracts dated in R1's year. */
const useSupply = (now: FleetDashboardNowDto | null, can: (permission: string) => boolean) => {
  const permitted = now !== null && sectionPermitted('supplyContracts', can);
  const year = now === null ? '' : now.today.slice(0, 4);
  const all = useVehicleContractSummary(yearWindow(year), permitted);
  const red = useVehicleContractSummary({ ...yearWindow(year), alarm: ['red'] }, permitted);
  const yellow = useVehicleContractSummary({ ...yearWindow(year), alarm: ['yellow'] }, permitted);
  const reads: readonly Summary[] = [all, red, yellow];
  return permitted
    ? {
        year,
        all,
        red,
        yellow,
        // The oldest of the three, once all three have answered.
        updatedAt: reads.every((q) => q.dataUpdatedAt > 0)
          ? Math.min(...reads.map((q) => q.dataUpdatedAt))
          : 0,
        fetching: reads.some((q) => q.isFetching),
        refetch: () => {
          for (const q of reads) void q.refetch({ cancelRefetch: false });
        },
      }
    : null;
};
type Supply = NonNullable<ReturnType<typeof useSupply>>;

const SupplyTile = ({
  id,
  icon,
  tone,
  label,
  children,
  foot,
}: {
  id: string;
  icon: IconPath;
  tone: Tone;
  label: string;
  children: ReactNode;
  foot?: ReactNode;
}): JSX.Element => (
  <div data-supply-tile={id} className={cn(BOX, 'flex min-w-0 flex-col px-4 pb-3.5 pt-3.5')}>
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className={cn(WORDS, 'whitespace-nowrap')}>{label}</div>
        <div className="mt-2">{children}</div>
      </div>
      <IconTile d={icon} tone={tone} size="sm" />
    </div>
    {foot}
  </div>
);

const ALARM_FIG = cn('text-[22px] font-black leading-none tracking-tight', CAIRO);

/** An alarm line of the third tile: the colour named, the CONTRACTS' count beside it. */
const AlarmRow = ({
  id,
  tone,
  word,
  n,
  link,
}: {
  id: 'red' | 'yellow';
  tone: Tone;
  word: string;
  n: number;
  link: DashLink;
}): JSX.Element => {
  const noun = useNoun();
  return (
    <div
      data-supply-alarm={id}
      className={cn(
        'flex min-w-[8.5rem] flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-1.5',
        TONE[tone].soft,
      )}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold">
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)} />
        {word}
      </span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <Fig link={link} className={cn(ALARM_FIG, TONE[tone].text)}>
          <N className="!font-[inherit]">{count(n)}</N>
        </Fig>
        <span className={cn('text-[13px] font-bold', TONE[tone].text)}>{noun('contract', n)}</span>
      </span>
    </div>
  );
};

const SupplyCard = ({
  supply,
  links,
  narrowed,
}: {
  supply: Supply;
  links: NowLinks;
  narrowed: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const { year } = supply;
  const all = supply.all.data;
  const red = supply.red.data;
  const yellow = supply.yellow.data;
  const reads = [supply.all, supply.red, supply.yellow];
  const failed = reads.some((q) => q.isError && q.data === undefined);
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-3 pe-5">
      <BlockHead
        icon={I.doc}
        tone="violet"
        title={t('fleet.vehicleContracts.title')}
        note={t(`${W}.supply.note`, { year })}
        chips={
          <>
            <span data-supply-chip="year" className={HEAD_CHIP}>
              <Phrase text={t(`${W}.supply.chip`)} parts={{ year: <N>{year}</N> }} />
            </span>
            <CompanyWide show={narrowed} />
          </>
        }
      />
      <div className="shrink-0 ps-5">
        <Btn link={links.supplyContracts('supplyContracts.open')} className="h-9 px-4">
          {t(`${W}.supply.open`)}
        </Btn>
      </div>
    </div>
  );
  if (failed) {
    return (
      <div data-dist-block="supply" className="mt-5">
        <SectionError section="supplyContracts" onRetry={supply.refetch} />
      </div>
    );
  }
  let band: ReactNode;
  if (all === undefined || red === undefined || yellow === undefined) {
    band = (
      <div data-dist-loading="true" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  } else if (all.count === 0) {
    band = (
      <p data-supply-empty="true" className={cn('px-1 py-2', NOTE)}>
        {t(`${W}.supply.empty`, { year })}
      </p>
    );
  } else {
    const remaining = all.contracted - all.received;
    band = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SupplyTile
          id="received"
          icon={I.check}
          tone="emerald"
          label={t(`${W}.supply.received`)}
          foot={
            <div className="mt-2.5">
              <Meter
                height="h-3"
                parts={[{ pct: pct(all.received, all.contracted), tone: 'emerald' }]}
              />
            </div>
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Big link={links.supplyContracts('supplyContracts.received')}>
              {count(all.received)}
            </Big>
            <span className={WORDS}>
              <Phrase
                text={t(`${W}.supply.of`)}
                parts={{
                  count: (
                    <Small link={links.supplyContracts('supplyContracts.contracted')}>
                      {count(all.contracted)}
                    </Small>
                  ),
                  noun: noun('car', all.contracted),
                }}
              />
            </span>
          </div>
        </SupplyTile>
        <SupplyTile id="remaining" icon={I.clock} tone="slate" label={t(`${W}.supply.remaining`)}>
          <div className="flex items-baseline gap-2 whitespace-nowrap">
            <Big link={links.supplyContracts('supplyContracts.remaining')}>{count(remaining)}</Big>
            <span className={WORDS}>{noun('car', remaining)}</span>
          </div>
        </SupplyTile>
        <SupplyTile
          id="alarm"
          icon={I.bell}
          tone="slate"
          label={t('fleet.vehicleContracts.alarm.title')}
        >
          <div className="flex flex-wrap gap-2">
            <AlarmRow
              id="red"
              tone="red"
              word={t(`${W}.supply.red`)}
              n={red.count}
              link={links.supplyContracts('supplyContracts.red', 'red')}
            />
            <AlarmRow
              id="yellow"
              tone="amber"
              word={t(`${W}.supply.yellow`)}
              n={yellow.count}
              link={links.supplyContracts('supplyContracts.yellow', 'yellow')}
            />
          </div>
        </SupplyTile>
      </div>
    );
  }
  return (
    <Card data-dist-block="supply" className="mt-5">
      {head}
      <div className={cn(BAND, 'px-4 pb-4 pt-3')}>{band}</div>
    </Card>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const DistributionTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now, can } = props;
  const supply = useSupply(now, can);
  const links = now === null ? null : nowLinks(now);
  const vehicles = now?.distributionVehicles ?? null;
  const drivers = now?.distributionDrivers ?? null;
  const scope = now?.scopeBranches ?? null;
  // One branch in scope — the switcher's branch, or a reader whose grant holds one branch.
  const branch = scope !== null && scope.length === 1 ? (scope[0] ?? null) : null;
  const narrowed = scope !== null;
  const month = monthKm(props.month, can);
  const failed = (section: 'distributionVehicles' | 'distributionDrivers'): boolean =>
    now?.unavailable.includes(section) ?? false;
  const kmPending = (id: string, title: string): JSX.Element => (
    <MonthPending id={id} month={props.month} icon={I.gauge} title={title} />
  );
  return (
    <div data-dash-tab-body="distribution">
      <Heading
        props={props}
        oneBranch={branch !== null}
        drivers={drivers !== null}
        km={month !== 'hidden'}
        supply={supply}
      />
      {(failed('distributionVehicles') || failed('distributionDrivers')) && (
        <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {failed('distributionVehicles') && (
            <SectionError section="distributionVehicles" onRetry={props.onRetry} />
          )}
          {failed('distributionDrivers') && (
            <SectionError section="distributionDrivers" onRetry={props.onRetry} />
          )}
        </div>
      )}
      {links !== null && (vehicles !== null || drivers !== null) && (
        <OperationRow
          vehicles={vehicles}
          drivers={drivers}
          links={links}
          oneBranch={branch !== null}
          narrowed={narrowed}
        />
      )}
      {links !== null && vehicles !== null && branch === null && (
        <Branches vehicles={vehicles} links={links} />
      )}
      <div className="mt-5 flex flex-col gap-5 empty:hidden">
        {branch === null ? (
          <>
            {links !== null && vehicles !== null && <Matrix vehicles={vehicles} links={links} />}
            {month === 'pending' && kmPending('km', t(`${W}.kmTitle`))}
            {month === 'failed' && (
              <div data-dist-block="km">
                <SectionError section="km" onRetry={props.month.onRetry} />
              </div>
            )}
            {typeof month === 'object' && <KmByBranch data={month.data} km={month.km} />}
          </>
        ) : (
          <>
            {links !== null && vehicles !== null && (
              <BranchCarsByType vehicles={vehicles} branchId={branch.id} links={links} />
            )}
            {month === 'pending' && kmPending('branch-km', t(`${W}.branchKmTitle`))}
            {month === 'failed' && (
              <div data-dist-block="branch-km">
                <SectionError section="km" onRetry={props.month.onRetry} />
              </div>
            )}
            {typeof month === 'object' && <BranchKmByType data={month.data} km={month.km} />}
          </>
        )}
      </div>
      {supply !== null && links !== null && (
        <SupplyCard supply={supply} links={links} narrowed={narrowed} />
      )}
    </div>
  );
};
