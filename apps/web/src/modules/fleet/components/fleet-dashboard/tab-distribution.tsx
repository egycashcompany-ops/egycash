// Tab 3 «توزيع السيارات» — the approved v2 sample (zz-fleetdash-v2-distribution.tsx) over R1's
// `distributionVehicles` and `distributionDrivers` (T3.1–T3.8, R-08).
//
// The columns are the reader's scope branches, in the server's order; «بلا فرع» appears only when a
// legacy car has no branch, and has no link (the vehicles screen has no such parameter). Every cell
// opens the vehicles list on its type and branch. The colouring (the biggest branch, the biggest
// branch of each type) and the shares are display arithmetic on the server's cells. The owner's
// answers (D5): drivers per vehicle is a plain ratio with no target, and there is no export button.
import { useState, type ReactNode } from 'react';
import { type FleetDashboardNowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { leadIndex, ratioText, share, shareText } from '../../lib/fleet-dashboard-tabs';
import {
  AMBER,
  BAND,
  BOX,
  CAIRO,
  CHIP,
  Card,
  CardHead,
  DIVIDE,
  Fig,
  I,
  Icon,
  IconTile,
  MUTED,
  Meter,
  N,
  NOTE,
  NUM,
  PCT,
  RED,
  ROW_HOVER,
  RULE,
  STRONG,
  SectionHead,
  TH,
  TH_ROW,
  TITLE,
  TONE,
  TabHead,
  Tag,
  cn,
  type IconPath,
} from './dash-kit';
import { Phrase, RefreshTools, SectionError, count, useNoun, type NowTabProps } from './dash-shell';

type Vehicles = NonNullable<FleetDashboardNowDto['distributionVehicles']>;
type Drivers = NonNullable<FleetDashboardNowDto['distributionDrivers']>;

// ── The system's classes this tab draws with (beyond the kit) ─────────────────────────────────

const LEAD_INK = 'text-brand-700 dark:text-brand-300';
const LEAD_WASH = 'bg-brand-50/70 dark:bg-brand-950/40';
const LEAD_HEAD = 'bg-brand-100/70 text-brand-800 dark:bg-brand-950/70 dark:text-brand-300';
const LEAD_FOOT = 'bg-brand-100/60 dark:bg-brand-950/60';
const TH_SHAPE = 'text-[13px] font-bold';
const TH_INK = 'text-slate-500 dark:text-slate-400';
const COL_WASH = 'bg-slate-100/70 dark:bg-[#16203a]/70';
const COL_HEAD = 'bg-slate-200/60 text-slate-800 dark:bg-[#16203a] dark:text-slate-100';
const TOTAL_HEAD = 'bg-slate-200/80 text-slate-900 dark:bg-[#131f35] dark:text-emerald-300';
const TOTAL_CELL = 'bg-slate-50 dark:bg-[#131f35]/50';
const GRAND_ROW = cn(
  'bg-slate-100 dark:bg-[#090e18]',
  '[&>td]:shadow-[inset_0_2px_0_#10b981]',
  '[&>td:last-child]:bg-emerald-50 dark:[&>td:last-child]:bg-[#122238]',
  '[&>td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_1px_0_0_#a7f3d0,inset_-1px_0_0_#a7f3d0] dark:[&>td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_0_3px_0_rgba(16,185,129,0.3)]',
);
const GRAND_WORD = 'text-emerald-800 dark:text-emerald-400';
const GRAND_INK = 'text-emerald-800 dark:text-emerald-300';
const TILE_LABEL = 'text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300';
const COUNT_CHIP =
  'border-slate-200 bg-slate-200/80 text-slate-700 dark:border-slate-700/60 dark:bg-[#142135] dark:text-slate-300';
const PCT_SHAPE = cn('whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-bold', NUM);
const PCT_LEAD = cn(
  PCT_SHAPE,
  'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
);
const PCT_RED = cn(PCT_SHAPE, 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300');
const BIG_FACE = cn('font-black leading-none tracking-tight tabular-nums', CAIRO);

/** A big figure of a card face (Cairo, tabular), left to right. */
const Big = ({
  link,
  children,
  className = cn('text-[34px]', STRONG),
}: {
  link: DashLink | null;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <Fig link={link} className={cn(BIG_FACE, className)}>
    <span dir="ltr">{children}</span>
  </Fig>
);

/** The figures every part of the tab reads: one place, from the server's cells. */
const useMatrix = (vehicles: Vehicles) => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = vehicles.branches.map((b) => ({ id: b.id, name: localized(b.name, locale) }));
  const branchTotals = branches.map((b) => vehicles.totals.counts[b.id] ?? 0);
  const rows = vehicles.rows.map((row) => ({
    typeId: row.typeId,
    name: localized(row.name, locale),
    per: branches.map((b) => row.counts[b.id] ?? 0),
    noBranch: row.noBranch,
    total: row.total,
  }));
  return {
    branches,
    branchTotals,
    rows,
    total: vehicles.totals.total,
    noBranch: vehicles.totals.noBranch,
    leadBranch: leadIndex(branchTotals),
    leadType: leadIndex(rows.map((row) => row.total)),
    leadPerType: rows.map((row) => leadIndex(row.per)),
  };
};
type Matrix = ReturnType<typeof useMatrix>;

// ── Row 1 · vehicles and drivers ──────────────────────────────────────────────────────────────

const Stat = ({
  label,
  n,
  link,
  note,
  drivers = false,
}: {
  label: string;
  n: number;
  link: DashLink | null;
  note: ReactNode;
  drivers?: boolean;
}): JSX.Element => (
  <div
    className={cn(
      BOX,
      'flex h-full min-w-0 flex-col px-4 py-3.5 transition-colors hover:border-slate-300 dark:hover:border-slate-600',
    )}
  >
    <span className={TILE_LABEL}>{label}</span>
    <Big link={link} className={cn('mt-2 self-start text-[30px]', drivers ? LEAD_INK : STRONG)}>
      {count(n)}
    </Big>
    <span className={cn('mt-2 text-[11px] font-semibold leading-4', MUTED)}>{note}</span>
  </div>
);

const PoolCard = ({
  data,
  title,
  sub,
  icon,
  cars,
  drivers,
}: {
  data: string;
  title: string;
  sub: string;
  icon: IconPath;
  cars: { label: string; n: number; link: DashLink | null; note: ReactNode } | null;
  drivers: { label: string; n: number; link: DashLink | null; note: ReactNode } | null;
}): JSX.Element => {
  const t = useT();
  const both = cars !== null && drivers !== null;
  const longer = both ? Math.max(cars.n, drivers.n) : 0;
  return (
    <Card data-pool={data}>
      <div className="px-5 pb-5 pt-5">
        <div className="flex items-start gap-3">
          <IconTile d={icon} tone="slate" />
          <div className="min-w-0">
            <h3 className={TITLE}>{title}</h3>
            <p className={cn('mt-0.5', NOTE)}>{sub}</p>
          </div>
        </div>
        <div className={cn('mt-4 grid gap-3', both ? 'grid-cols-2' : 'grid-cols-1')}>
          {cars !== null && <Stat {...cars} />}
          {drivers !== null && <Stat {...drivers} drivers />}
        </div>
      </div>
      {both && (
        <div className={cn(BAND, 'mt-auto px-5 pb-4 pt-3.5')}>
          <div className="flex items-center gap-1.5">
            <span
              dir="ltr"
              className={cn(
                CAIRO,
                'text-[22px] font-black leading-none tracking-tight tabular-nums',
                LEAD_INK,
              )}
            >
              {ratioText(drivers.n, cars.n)}
            </span>
            <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
              {t('fleet.dash.distribution.perVehicle')}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t('fleet.dash.distribution.cars')}
            </span>
            <Meter parts={[{ pct: share(cars.n, longer) ?? 0, tone: 'slate' }]} />
            <N className={cn('text-[13px] font-black', STRONG)}>{count(cars.n)}</N>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t('fleet.dash.distribution.drivers')}
            </span>
            <Meter parts={[{ pct: share(drivers.n, longer) ?? 0, tone: 'brand' }]} />
            <N className={cn('text-[13px] font-black', LEAD_INK)}>{count(drivers.n)}</N>
          </div>
          <p className="mt-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {drivers.n === cars.n ? (
              t('fleet.dash.distribution.even')
            ) : (
              <Phrase
                text={t(
                  drivers.n > cars.n
                    ? 'fleet.dash.distribution.moreDrivers'
                    : 'fleet.dash.distribution.moreCars',
                )}
                parts={{
                  count: (
                    <N className={cn('font-bold', LEAD_INK)}>
                      {count(Math.abs(drivers.n - cars.n))}
                    </N>
                  ),
                }}
              />
            )}
          </p>
        </div>
      )}
    </Card>
  );
};

const Pools = ({
  vehicles,
  drivers,
  links,
}: {
  vehicles: Vehicles | null;
  drivers: Drivers | null;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const active = vehicles?.totals.total ?? 0;
  const ofActive = (n: number): ReactNode => (
    <>
      <span dir="ltr" className={PCT}>
        {shareText(n, active)}
      </span>{' '}
      {t('fleet.dash.distribution.ofActive')}
    </>
  );
  const legacy = (n: number): ReactNode =>
    n > 0 ? (
      <span className={AMBER}>
        <Phrase
          text={t('fleet.dash.distribution.legacy')}
          parts={{ count: <N className="font-bold">{count(n)}</N> }}
        />
      </span>
    ) : (
      t('fleet.dash.distribution.fromRegistry')
    );
  const kind = (key: 'cash' | 'atm') => ({
    cars:
      vehicles === null
        ? null
        : {
            label: t('fleet.dash.distribution.cars'),
            n: vehicles[key].vehicles,
            link:
              vehicles[key].operationIds.length === 0
                ? null
                : links.vehiclesBy(
                    { operationIds: vehicles[key].operationIds },
                    `distributionVehicles.${key}`,
                  ),
            note: ofActive(vehicles[key].vehicles),
          },
    drivers:
      drivers === null
        ? null
        : {
            label: t('fleet.dash.distribution.drivers'),
            n: drivers[key].drivers,
            link: links.driversBySpec(drivers[key].specializationIds, `distributionDrivers.${key}`),
            note: legacy(drivers[key].legacy),
          },
  });
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <PoolCard
        data="all"
        title={t('fleet.dash.distribution.allTitle')}
        sub={t('fleet.dash.distribution.allSub')}
        icon={I.scale}
        cars={
          vehicles === null
            ? null
            : {
                label: t('fleet.dash.distribution.allCars'),
                n: active,
                link: links.vehiclesBy({}, 'distributionVehicles.total'),
                note: t('fleet.dash.distribution.activeFleet'),
              }
        }
        drivers={
          drivers === null
            ? null
            : {
                label: t('fleet.dash.distribution.allDrivers'),
                n: drivers.total,
                link: links.drivers(),
                note: t('fleet.dash.distribution.fromRegistry'),
              }
        }
      />
      <PoolCard
        data="cash"
        title={t('fleet.dash.distribution.cashTitle')}
        sub={t('fleet.dash.distribution.cashSub')}
        icon={I.shield}
        {...kind('cash')}
      />
      <PoolCard
        data="atm"
        title={t('fleet.dash.distribution.atmTitle')}
        sub={t('fleet.dash.distribution.atmSub')}
        icon={I.cash}
        {...kind('atm')}
      />
    </div>
  );
};

// ── Row 2 · the branches ──────────────────────────────────────────────────────────────────────

/**
 * A branch's letter: its first, past the Arabic article («القاهرة» → «ق») and past a leading alef
 * («الإسكندرية» → «س»): a lone «إ» or «أ» in the badge reads as «!», the «بلا فرع» badge's mark.
 */
const initial = (name: string): string =>
  name
    .replace(/^ال/u, '')
    .replace(/^[اأإآ](?=.)/u, '')
    .slice(0, 1);

const Letter = ({
  letter,
  kind,
}: {
  letter: string;
  kind: 'lead' | 'plain' | 'none';
}): JSX.Element => (
  <span
    aria-hidden="true"
    className={cn(
      'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[17px] font-black',
      CAIRO,
      kind === 'lead' ? TONE.brand.tile : kind === 'plain' ? TONE.slate.tile : TONE.red.tile,
    )}
  >
    {letter}
  </span>
);

const NONE_CARD =
  'relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-red-200/90 bg-red-50/80 shadow-sm dark:border-red-500/40 dark:bg-red-950/20 dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)] dark:backdrop-blur-[12px]';

const BranchCard = ({
  m,
  index,
  links,
}: {
  m: Matrix;
  index: number | 'none';
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const none = index === 'none';
  const branch = none ? null : m.branches[index];
  const total = none ? m.noBranch : (m.branchTotals[index] ?? 0);
  const lead = !none && index === m.leadBranch;
  const pct = share(total, m.total) ?? 0;
  const body = (
    <div className="flex flex-1 flex-col p-4" data-branch-card={branch?.id ?? 'none'}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Letter
            letter={none ? '!' : initial(branch?.name ?? '')}
            kind={none ? 'none' : lead ? 'lead' : 'plain'}
          />
          <div className="min-w-0">
            <div className={cn('text-[11px] font-semibold', none ? RED : MUTED)}>
              {none
                ? t('fleet.dash.distribution.legacyRecord')
                : t('fleet.dash.distribution.branch')}
            </div>
            <h4
              className={cn('truncate text-base font-bold leading-6', CAIRO, none ? RED : STRONG)}
            >
              {none ? t('fleet.dash.distribution.noBranch') : branch?.name}
            </h4>
          </div>
        </div>
        {lead && (
          <span className="self-start">
            <Tag tone="brand">{t('fleet.dash.distribution.biggest')}</Tag>
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Big
          link={
            none || branch === undefined || branch === null
              ? null
              : links.vehiclesBy({ branchId: branch.id }, 'distributionVehicles.branch')
          }
          className={cn('text-[34px]', none ? RED : STRONG)}
        >
          {count(total)}
        </Big>
        <span
          className={cn(
            'text-[13px] font-bold',
            none ? 'text-red-700 dark:text-red-300' : 'text-slate-600 dark:text-slate-300',
          )}
        >
          {none ? (
            t('fleet.dash.distribution.noBranchUnit')
          ) : (
            <Phrase
              text={t('fleet.dash.distribution.activeUnit')}
              parts={{ noun: noun('car', total) }}
            />
          )}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <Meter
          height="h-1.5"
          className="flex-1"
          parts={[{ pct, tone: none ? 'red' : lead ? 'brand' : 'slate' }]}
        />
        <span dir="ltr" className={none ? PCT_RED : lead ? PCT_LEAD : PCT}>
          {shareText(total, m.total)}
        </span>
      </div>
      <ul
        className={cn(
          'mt-4 flex flex-1 flex-col justify-between rounded-xl border px-1.5 py-1.5',
          none
            ? 'border-red-200 bg-white/70 dark:border-red-500/20 dark:bg-[#0a101b]/70'
            : 'border-slate-200 bg-slate-50/60 dark:border-[#1e2a3f] dark:bg-[#0a101b]/70',
        )}
      >
        {m.rows.map((row) => {
          const n = none ? row.noBranch : (row.per[index] ?? 0);
          return (
            <li
              key={row.typeId}
              className={cn(
                'flex items-center justify-between gap-2 rounded-lg px-2 py-[5px] text-[13px]',
                n > 0 && !none && ROW_HOVER,
              )}
            >
              <span
                className={
                  n === 0
                    ? 'text-slate-400 dark:text-slate-500'
                    : 'font-semibold text-slate-700 dark:text-slate-200'
                }
              >
                {row.name}
              </span>
              {n === 0 ? (
                <span className="w-7 text-center text-slate-300 dark:text-slate-600">—</span>
              ) : (
                <Fig
                  link={
                    none || branch === undefined || branch === null
                      ? null
                      : links.vehiclesBy(
                          { typeId: row.typeId, branchId: branch.id },
                          'distributionVehicles.cell',
                        )
                  }
                  className={cn(
                    'inline-flex h-6 min-w-7 items-center justify-center rounded-md border px-1 text-[12px] font-black',
                    NUM,
                    none ? TONE.red.soft : COUNT_CHIP,
                  )}
                >
                  {count(n)}
                </Fig>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
  return none ? <div className={NONE_CARD}>{body}</div> : <Card>{body}</Card>;
};

// ── Row 3 · the matrix ────────────────────────────────────────────────────────────────────────

const MatrixCard = ({ m, links }: { m: Matrix; links: NowLinks }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const [col, setCol] = useState<number | null>(null);
  const th = cn('px-2 py-3 text-center', TH_SHAPE);
  const tint = (i: number): string => (i === m.leadBranch ? LEAD_WASH : col === i ? COL_WASH : '');
  const showNone = m.noBranch > 0;
  return (
    <Card data-fleet-matrix="true">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <CardHead
          title={t('fleet.dash.distribution.matrixTitle')}
          sub={
            <Phrase
              text={t('fleet.dash.distribution.matrixSub')}
              parts={{
                count: (
                  <N className="font-bold text-slate-700 dark:text-slate-200">{count(m.total)}</N>
                ),
                noun: noun('car', m.total),
              }}
            />
          }
        />
      </div>
      {m.rows.length === 0 ? (
        <p className={cn('px-5 pb-6', NOTE)}>{t('fleet.dash.distribution.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[640px] border-collapse text-sm"
            onMouseLeave={() => setCol(null)}
          >
            <thead>
              <tr className={cn(TH_ROW, 'border-y border-slate-200 dark:border-[#1c293f]')}>
                <th className={cn('px-5 py-3 text-start', TH)}>
                  {t('fleet.dash.distribution.type')}
                </th>
                {m.branches.map((b, i) => (
                  <th
                    key={b.id}
                    className={cn(
                      th,
                      'transition-colors',
                      i === m.leadBranch ? LEAD_HEAD : col === i ? COL_HEAD : TH_INK,
                    )}
                  >
                    {b.name}
                  </th>
                ))}
                {showNone && (
                  <th className={cn(th, RED)}>{t('fleet.dash.distribution.noBranch')}</th>
                )}
                <th className={cn(th, TOTAL_HEAD)}>{t('fleet.dash.distribution.total')}</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((row, r) => (
                <tr
                  key={row.typeId}
                  className="group border-b border-slate-200 dark:border-slate-800/80"
                >
                  <td className="px-5 py-3.5 text-start transition-colors group-hover:bg-slate-100 dark:group-hover:bg-[#16203a]">
                    <span className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-slate-100">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
                      />
                      {row.name}
                    </span>
                  </td>
                  {row.per.map((n, i) => {
                    const branch = m.branches[i];
                    const link =
                      branch === undefined
                        ? null
                        : links.vehiclesBy(
                            { typeId: row.typeId, branchId: branch.id },
                            'distributionVehicles.cell',
                          );
                    return (
                      <td
                        key={branch?.id ?? i}
                        onMouseEnter={() => setCol(i)}
                        className={cn('px-2 py-3.5 text-center transition-colors', tint(i))}
                      >
                        {n === 0 ? (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        ) : i === m.leadPerType[r] ? (
                          <Fig
                            link={link}
                            className={cn(
                              'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-1.5 text-[15px] font-black',
                              NUM,
                              TONE.brand.soft,
                            )}
                          >
                            {count(n)}
                          </Fig>
                        ) : (
                          <Fig
                            link={link}
                            className={cn(
                              'text-[15px] font-bold text-slate-700 dark:text-slate-200',
                              NUM,
                            )}
                          >
                            {count(n)}
                          </Fig>
                        )}
                      </td>
                    );
                  })}
                  {showNone && (
                    <td className="px-2 py-3.5 text-center" onMouseEnter={() => setCol(null)}>
                      {row.noBranch === 0 ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <N className={cn('text-[15px] font-black', RED)}>{count(row.noBranch)}</N>
                      )}
                    </td>
                  )}
                  <td
                    className={cn('px-2 py-3.5 text-center', TOTAL_CELL)}
                    onMouseEnter={() => setCol(null)}
                  >
                    <Fig
                      link={links.vehiclesBy(
                        { typeId: row.typeId },
                        'distributionVehicles.typeTotal',
                      )}
                      className={cn('text-[16px] font-black', NUM, STRONG)}
                    >
                      {count(row.total)}
                    </Fig>
                  </td>
                </tr>
              ))}
              <tr className={GRAND_ROW}>
                <td className={cn('px-5 py-4 text-start font-black', GRAND_WORD)}>
                  {t('fleet.dash.distribution.branchTotal')}
                </td>
                {m.branchTotals.map((n, i) => {
                  const branch = m.branches[i];
                  return (
                    <td
                      key={branch?.id ?? i}
                      onMouseEnter={() => setCol(i)}
                      className={cn(
                        'px-2 py-4 text-center transition-colors',
                        i === m.leadBranch ? LEAD_FOOT : col === i && COL_WASH,
                      )}
                    >
                      <Fig
                        link={
                          branch === undefined
                            ? null
                            : links.vehiclesBy(
                                { branchId: branch.id },
                                'distributionVehicles.branch',
                              )
                        }
                        className={cn(
                          'font-black',
                          NUM,
                          i === m.leadBranch
                            ? cn('text-[22px]', LEAD_INK)
                            : cn('text-[17px]', STRONG),
                        )}
                      >
                        {count(n)}
                      </Fig>
                    </td>
                  );
                })}
                {showNone && (
                  <td className="px-2 py-4 text-center" onMouseEnter={() => setCol(null)}>
                    <N className={cn('text-[17px] font-black', RED)}>{count(m.noBranch)}</N>
                  </td>
                )}
                <td className="px-2 py-4 text-center" onMouseEnter={() => setCol(null)}>
                  <Big
                    link={links.vehiclesBy({}, 'distributionVehicles.total')}
                    className={cn('text-[28px]', GRAND_INK)}
                  >
                    {count(m.total)}
                  </Big>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className={cn('flex items-start gap-2 border-t px-5 py-3.5', RULE)}>
        <Icon d={I.info} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        <p className={cn(NOTE, 'leading-6')}>{t('fleet.dash.distribution.matrixNote')}</p>
      </div>
    </Card>
  );
};

// ── Row 4 · a quick read and the branchless cars ──────────────────────────────────────────────

const Fact = ({
  label,
  value,
  n,
  of,
  link,
}: {
  label: string;
  value: string;
  n: number;
  of: number;
  link: DashLink | null;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return (
    <div className={cn(BOX, 'min-w-0 px-4 py-3.5')}>
      <div className={TILE_LABEL}>{label}</div>
      <div className={cn('mt-1 truncate text-[19px] font-black tracking-tight', CAIRO, STRONG)}>
        {value}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-600 dark:text-slate-300">
        <Fig link={link} className={cn('font-bold', STRONG)}>
          <N>{count(n)}</N>
        </Fig>
        <span>{noun('car', n)}</span>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
          ·
        </span>
        <span dir="ltr" className={PCT_LEAD}>
          {shareText(n, of)}
        </span>
        <span>{t('fleet.dash.distribution.ofActive')}</span>
      </div>
    </div>
  );
};

const QuickRead = ({ m, links }: { m: Matrix; links: NowLinks }): JSX.Element | null => {
  const t = useT();
  const leadBranch = m.branches[m.leadBranch];
  const leadType = m.rows[m.leadType];
  if (leadBranch === undefined && leadType === undefined) return null;
  const sameLeader = m.leadBranch >= 0 && m.leadPerType.every((i) => i === m.leadBranch);
  return (
    <Card data-quick-read="true">
      <div className="flex flex-1 flex-col p-5">
        <CardHead
          title={t('fleet.dash.distribution.quickTitle')}
          sub={t('fleet.dash.distribution.quickSub')}
          end={<IconTile d={I.bars} tone="slate" size="sm" />}
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {leadBranch !== undefined && (
            <Fact
              label={t('fleet.dash.distribution.biggestBranch')}
              value={leadBranch.name}
              n={m.branchTotals[m.leadBranch] ?? 0}
              of={m.total}
              link={links.vehiclesBy({ branchId: leadBranch.id }, 'distributionVehicles.branch')}
            />
          )}
          {leadType !== undefined && (
            <Fact
              label={t('fleet.dash.distribution.biggestType')}
              value={leadType.name}
              n={leadType.total}
              of={m.total}
              link={links.vehiclesBy({ typeId: leadType.typeId }, 'distributionVehicles.typeTotal')}
            />
          )}
        </div>
        <div className="mt-4 flex flex-1 flex-col">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {t('fleet.dash.distribution.leaderPerType')}
            </span>
            {sameLeader && leadBranch !== undefined && (
              <Tag tone="brand">
                <Phrase
                  text={t('fleet.dash.distribution.sameLeader')}
                  parts={{ branch: leadBranch.name }}
                />
              </Tag>
            )}
          </div>
          <ul className={cn('flex flex-1 flex-col justify-between', DIVIDE)}>
            {m.rows.map((row, r) => {
              const i = m.leadPerType[r] ?? -1;
              const branch = m.branches[i];
              const n = row.per[i] ?? 0;
              return (
                <li
                  key={row.typeId}
                  className={cn(
                    'grid items-center gap-3 py-2 text-[13px]',
                    sameLeader
                      ? 'grid-cols-[5.5rem_minmax(0,1fr)_3.75rem]'
                      : 'grid-cols-[5.5rem_4.75rem_minmax(0,1fr)_3.75rem]',
                  )}
                >
                  <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                    {row.name}
                  </span>
                  {!sameLeader && (
                    <span className={cn('truncate whitespace-nowrap font-bold', LEAD_INK)}>
                      {branch?.name ?? '—'}
                    </span>
                  )}
                  <Meter
                    height="h-1.5"
                    className="min-w-0"
                    parts={[{ pct: share(n, row.total) ?? 0, tone: 'brand' }]}
                  />
                  <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    <Phrase
                      text={t('fleet.dash.now.partOf')}
                      parts={{
                        part: (
                          <Fig
                            link={
                              branch === undefined
                                ? null
                                : links.vehiclesBy(
                                    { typeId: row.typeId, branchId: branch.id },
                                    'distributionVehicles.cell',
                                  )
                            }
                            className={cn('font-bold', STRONG)}
                          >
                            <N>{count(n)}</N>
                          </Fig>
                        ),
                        whole: <N>{count(row.total)}</N>,
                      }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Card>
  );
};

const Branchless = ({ m }: { m: Matrix }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return (
    // Its own height beside «قراءة سريعة»: it has no list to fill a stretched card with (the
    // «بلا فرع» cars have no exact list to open — a named exception).
    <Card accent="red" data-branchless="true" className="lg:self-start">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <IconTile d={I.warn} tone="red" size="sm" />
            <div className="min-w-0">
              <h3 className={TITLE}>{t('fleet.dash.distribution.branchlessTitle')}</h3>
              <p className={cn('mt-0.5', NOTE)}>{t('fleet.dash.distribution.branchlessSub')}</p>
            </div>
          </div>
          <Tag tone="red" dot>
            {t('fleet.dash.distribution.needsReview')}
          </Tag>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
          <Phrase
            text={t('fleet.dash.distribution.branchlessText')}
            parts={{
              count: <N className={cn('font-bold', RED)}>{count(m.noBranch)}</N>,
              noun: noun('car', m.noBranch),
              total: <N className="font-bold">{count(m.total)}</N>,
            }}
          />
        </p>
      </div>
    </Card>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

const BranchChip = ({
  name,
  n,
  link,
  none = false,
  lead = false,
}: {
  name: string;
  n: number;
  link: DashLink | null;
  none?: boolean;
  lead?: boolean;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-1.5 text-[13px] font-semibold shadow-sm transition-colors',
      none
        ? TONE.red.soft
        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-slate-300 dark:hover:border-slate-500',
    )}
  >
    {name}
    <Fig
      link={link}
      className={cn('text-[14px] font-bold', NUM, none ? RED : lead ? LEAD_INK : STRONG)}
    >
      {count(n)}
    </Fig>
  </span>
);

const Body = ({
  vehicles,
  drivers,
  links,
}: {
  vehicles: Vehicles;
  drivers: Drivers | null;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const m = useMatrix(vehicles);
  return (
    <>
      <Pools vehicles={vehicles} drivers={drivers} links={links} />
      {m.branches.length > 0 && (
        <>
          <SectionHead
            title={t('fleet.dash.distribution.branchesTitle')}
            sub={t('fleet.dash.distribution.branchesSub')}
          />
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
            {m.branches.map((b, i) => (
              <BranchCard key={b.id} m={m} index={i} links={links} />
            ))}
            {m.noBranch > 0 && <BranchCard m={m} index="none" links={links} />}
          </div>
        </>
      )}
      <div className="mt-5">
        <MatrixCard m={m} links={links} />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <QuickRead m={m} links={links} />
        {m.noBranch > 0 && <Branchless m={m} />}
      </div>
    </>
  );
};

const HeadChips = ({ vehicles, links }: { vehicles: Vehicles; links: NowLinks }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const m = useMatrix(vehicles);
  return (
    <>
      <span className={cn(CHIP, 'inline-flex items-center gap-1 py-1')}>
        <Phrase
          text={t('fleet.dash.distribution.headChip')}
          parts={{
            count: (
              <Fig
                link={links.vehiclesBy({}, 'distributionVehicles.total')}
                className={cn('font-bold', STRONG)}
              >
                <N>{count(m.total)}</N>
              </Fig>
            ),
            noun: noun('car', m.total),
          }}
        />
      </span>
      {m.branches.map((b, i) => (
        <BranchChip
          key={b.id}
          name={b.name}
          n={m.branchTotals[i] ?? 0}
          lead={i === m.leadBranch}
          link={links.vehiclesBy({ branchId: b.id }, 'distributionVehicles.branch')}
        />
      ))}
      {m.noBranch > 0 && (
        <BranchChip name={t('fleet.dash.distribution.noBranch')} n={m.noBranch} link={null} none />
      )}
    </>
  );
};

export const DistributionTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now } = props;
  const links = now === null ? null : nowLinks(now);
  const vehicles = now?.distributionVehicles ?? null;
  const drivers = now?.distributionDrivers ?? null;
  const failed = (section: 'distributionVehicles' | 'distributionDrivers'): boolean =>
    now?.unavailable.includes(section) ?? false;
  return (
    <div data-dash-tab-body="distribution">
      <TabHead
        icon={I.grid}
        title={t('fleet.dash.shell.tab.distribution')}
        sub={t('fleet.dash.distribution.sub')}
        end={
          <>
            {vehicles !== null && links !== null && <HeadChips vehicles={vehicles} links={links} />}
            <RefreshTools
              updatedAt={props.updatedAt}
              onRefresh={props.onRefresh}
              refreshing={props.refreshing}
              {...(props.clock === undefined ? {} : { clock: props.clock })}
            />
          </>
        }
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
      {links !== null && vehicles !== null && (
        <Body vehicles={vehicles} drivers={drivers} links={links} />
      )}
      {links !== null && vehicles === null && drivers !== null && (
        <Pools vehicles={null} drivers={drivers} links={links} />
      )}
    </div>
  );
};
