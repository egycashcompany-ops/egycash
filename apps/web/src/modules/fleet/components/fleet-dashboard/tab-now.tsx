// Tab 2 «الحركة الآن» — the approved v2 sample (zz-fleetdash-v2-now.tsx) over R1's `vehicles`,
// `roster` and `workshop` (T2.1–T2.7, R-03…R-06, R-09). Cairo today, untouched by the filters.
//
// The owner's answers to the sample's markers (D5): the badge is «السيارات الجاهزة التي لها سائق»
// = readyManned ÷ ready; «اقتراحات من أرقام اليوم» only OPENS existing screens; no workshop ceiling,
// «منذ N أيام» only. Every share and difference is display arithmetic on two server figures.
import { type ReactNode } from 'react';
import { type FleetDashboardNowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { share, shareText } from '../../lib/fleet-dashboard-tabs';
import {
  AMBER,
  BAND,
  BIG,
  BOX,
  BOX_HOVER,
  Btn,
  CAIRO,
  Card,
  CarChip,
  CompanyWide,
  Fig,
  I,
  Icon,
  IconTile,
  MUTED,
  Meter,
  N,
  NOTE,
  PCT,
  RED,
  RULE,
  STRONG,
  SURFACE,
  TITLE,
  TONE,
  TabHead,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { Phrase, RefreshTools, SectionError, count, useNoun, type NowTabProps } from './dash-shell';

// ── Local pieces ──────────────────────────────────────────────────────────────────────────────

const HEAD = cn(TITLE, 'flex items-center gap-2');
const BAND_LABEL_SHAPE = 'flex items-center gap-1.5 text-xs font-bold dark:font-semibold';
const BAND_LABEL = cn(BAND_LABEL_SHAPE, 'text-slate-700 dark:text-slate-300');
const FIGURE_WORDS = 'text-[13px] font-bold text-slate-600 dark:font-semibold dark:text-slate-400';
const COUNT_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold dark:font-semibold';

/** A big figure of the card face, opening the list behind it. */
const Big = ({
  link,
  children,
  className,
}: {
  link: DashLink | null;
  children: ReactNode;
  className?: string | undefined;
}): JSX.Element => (
  <Fig link={link} className={cn(BIG, 'tabular-nums', className)}>
    <span dir="ltr">{children}</span>
  </Fig>
);

/** A small figure in a sentence or a band. */
const Small = ({
  link = null,
  children,
  className,
}: {
  link?: DashLink | null;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <Fig link={link} className={cn('font-bold', className ?? STRONG)}>
    <N>{children}</N>
  </Fig>
);

/** A mini tile of a card's band: the figure over its label. */
const Tile = ({
  n,
  label,
  tone,
  link = null,
}: {
  n: number;
  label: string;
  tone?: Tone;
  link?: DashLink | null;
}): JSX.Element => (
  <div
    className={cn(
      BOX,
      BOX_HOVER,
      'flex h-full min-w-0 flex-col items-center justify-center px-1 py-2.5 text-center 2xl:px-1.5',
    )}
  >
    <Fig
      link={link}
      className={cn(
        'text-lg font-black leading-none',
        tone === undefined ? STRONG : TONE[tone].text,
      )}
    >
      <N>{count(n)}</N>
    </Fig>
    <span className="mt-2 min-h-8 text-balance text-[11px] font-semibold leading-4 text-slate-600 dark:text-slate-400">
      {label}
    </span>
  </div>
);

/** A short list in a band: a reason and its count per row. */
const Rows = ({
  rows,
}: {
  rows: readonly { label: string; n: number; tone?: Tone; link?: DashLink | null }[];
}): JSX.Element => (
  <div className={cn(BOX, 'flex min-w-0 flex-col justify-center gap-1.5 px-2 py-2')}>
    {rows.map((row) => (
      <div
        key={row.label}
        className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs"
      >
        <span
          className={cn(
            'min-w-0 font-semibold',
            row.tone === undefined ? 'text-slate-700 dark:text-slate-300' : TONE[row.tone].text,
          )}
        >
          {row.label}
        </span>
        <Small
          link={row.link ?? null}
          className={row.tone === undefined ? STRONG : TONE[row.tone].text}
        >
          {count(row.n)}
        </Small>
      </div>
    ))}
  </div>
);

/** One KPI card: the coloured edge, title, icon tile, figure and words, the share and its basis,
 *  a thin bar, then the grey band with the breakdown. */
const Kpi = ({
  data,
  tone,
  title,
  icon,
  figure,
  link,
  figureCls,
  unit,
  part,
  whole,
  basis,
  end,
  band,
}: {
  data: string;
  tone: Tone;
  title: string;
  icon: IconPath;
  figure: number;
  link: DashLink | null;
  figureCls?: string;
  unit: string;
  part: number;
  whole: number | null;
  basis: string;
  end?: ReactNode;
  band: ReactNode;
}): JSX.Element => {
  const t = useT();
  const pct = whole === null ? null : share(part, whole);
  return (
    <Card accent={tone} data-now-card={data}>
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn(HEAD, 'flex-wrap')}>
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
              />
              {title}
              {end}
            </h3>
            <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Big link={link} className={figureCls}>
                {count(figure)}
              </Big>
              <span className={FIGURE_WORDS}>{unit}</span>
            </div>
          </div>
          <IconTile d={icon} tone={tone} size="lg" />
        </div>
        {whole !== null && pct !== null && (
          <>
            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
              <span className="whitespace-nowrap">
                <span dir="ltr" className={PCT}>
                  {shareText(part, whole)}
                </span>{' '}
                <span className={cn('font-semibold', MUTED)}>{basis}</span>
              </span>
              <span className={cn('whitespace-nowrap', MUTED)}>
                <Phrase
                  text={t('fleet.dash.now.partOf')}
                  parts={{
                    part: (
                      <N className="font-bold text-slate-700 dark:text-slate-200">{count(part)}</N>
                    ),
                    whole: <N>{count(whole)}</N>,
                  }}
                />
              </span>
            </div>
            <Meter className="mt-2.5" height="h-1.5" parts={[{ pct, tone }]} />
          </>
        )}
      </div>
      <div className={cn(BAND, 'flex flex-1 flex-col px-5 pb-5 pt-4')}>{band}</div>
    </Card>
  );
};

// ── (b) The summary strip ─────────────────────────────────────────────────────────────────────

const BalanceRow = ({
  label,
  figure,
  link,
  parts,
}: {
  label: string;
  figure: number;
  link: DashLink | null;
  parts: readonly { pct: number; tone: Tone }[];
}): JSX.Element => (
  <div className="flex items-center gap-3">
    <span className={cn('w-[116px] shrink-0', BAND_LABEL)}>{label}</span>
    <Meter className="min-w-0 flex-1" height="h-2.5" parts={parts} />
    <Small link={link} className={cn('w-8 shrink-0 text-end text-[15px] !font-black', STRONG)}>
      {count(figure)}
    </Small>
  </div>
);

const Summary = ({
  roster,
  links,
}: {
  roster: NonNullable<FleetDashboardNowDto['roster']>;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const onVehicle = roster.available - roster.availableWithoutVehicle;
  const scale = Math.max(roster.ready, roster.available);
  const pct = (n: number): number => share(n, scale) ?? 0;
  const gap = roster.available - roster.ready;
  return (
    <Card accent="slate" className="mb-5" data-now-card="summary">
      <div className="grid grid-cols-1 gap-6 px-6 pb-6 pt-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.8fr)] lg:gap-0">
        <div className="flex items-center gap-4 lg:pe-6">
          <div
            className={cn(
              'flex h-[84px] w-[84px] shrink-0 flex-col items-center justify-center rounded-2xl 2xl:h-[92px] 2xl:w-[92px]',
              TONE.emerald.tile,
            )}
          >
            <span
              dir="ltr"
              data-now-badge="true"
              className={cn(
                'text-[23px] font-black leading-none tracking-tight tabular-nums text-emerald-700 dark:text-emerald-300 2xl:text-[25px]',
                CAIRO,
              )}
            >
              {shareText(roster.readyManned, roster.ready)}
            </span>
            <span className="mt-1.5 text-[11px] font-bold text-emerald-800 dark:font-semibold dark:text-emerald-300">
              {t('fleet.dash.now.badgeWord')}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className={cn(HEAD, 'flex-wrap')}>{t('fleet.dash.now.badgeTitle')}</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
              <Phrase
                text={t('fleet.dash.now.badgeText')}
                parts={{
                  manned: <Small>{count(roster.readyManned)}</Small>,
                  ready: <Small link={links.rosterReady()}>{count(roster.ready)}</Small>,
                  noun: noun('car', roster.ready),
                  unmanned: (
                    <Small
                      link={links.rosterUnmanned('roster.unmanned.summary')}
                      className={TONE.amber.text}
                    >
                      {count(roster.unmanned)}
                    </Small>
                  ),
                }}
              />
            </p>
          </div>
        </div>
        <div className={cn('min-w-0 lg:border-s lg:px-6', RULE)}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconTile d={I.scale} tone="slate" size="sm" />
              <div className="min-w-0">
                <h3 className={HEAD}>{t('fleet.dash.now.balanceTitle')}</h3>
                <p className={NOTE}>{t('fleet.dash.now.balanceNote')}</p>
              </div>
            </div>
            <span className={cn(COUNT_CHIP, TONE.teal.soft)}>
              {gap === 0 ? (
                t('fleet.dash.now.balanceEven')
              ) : (
                <Phrase
                  text={t(
                    gap > 0
                      ? 'fleet.dash.now.balanceMoreDrivers'
                      : 'fleet.dash.now.balanceMoreCars',
                  )}
                  parts={{ count: <N className="font-bold">{count(Math.abs(gap))}</N> }}
                />
              )}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            <BalanceRow
              label={t('fleet.dash.now.balanceCars')}
              figure={roster.ready}
              link={links.rosterReady()}
              parts={[
                { pct: pct(roster.readyManned), tone: 'sky' },
                { pct: pct(roster.unmanned), tone: 'amber' },
              ]}
            />
            <BalanceRow
              label={t('fleet.dash.now.balanceDrivers')}
              figure={roster.available}
              link={links.rosterAvailable('roster.available.balance')}
              parts={[
                { pct: pct(onVehicle), tone: 'teal' },
                { pct: pct(roster.availableWithoutVehicle), tone: 'amber' },
              ]}
            />
          </div>
          <p className="mt-3.5 flex items-start gap-2 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
            <span
              aria-hidden="true"
              className={cn('mt-[9px] h-2 w-2 shrink-0 rounded-sm', TONE.amber.bar)}
            />
            <span>
              <Phrase
                text={t('fleet.dash.now.balanceText')}
                parts={{
                  cars: (
                    <Small link={links.rosterUnmanned('roster.unmanned.balance')}>
                      {count(roster.unmanned)}
                    </Small>
                  ),
                  carNoun: noun('car', roster.unmanned),
                  drivers: <Small>{count(roster.availableWithoutVehicle)}</Small>,
                  driverNoun: noun('driver', roster.availableWithoutVehicle),
                }}
              />
            </span>
          </p>
        </div>
        <div
          className={cn(
            'flex min-w-0 items-center justify-between gap-4 lg:border-s lg:ps-6',
            RULE,
          )}
        >
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300">
              {t('fleet.dash.now.workingTitle')}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Big link={null}>{count(roster.readyManned)}</Big>
              <span className={FIGURE_WORDS}>{noun('car', roster.readyManned)}</span>
            </div>
            <div
              className={cn(
                'mt-2 flex items-center gap-1.5 text-xs font-semibold',
                TONE.emerald.text,
              )}
            >
              <Icon d={I.check} className="h-3.5 w-3.5 shrink-0" />
              {t('fleet.dash.now.workingNote')}
            </div>
          </div>
          <IconTile d={I.map} tone="emerald" size="lg" />
        </div>
      </div>
    </Card>
  );
};

// ── (c) The six cards ─────────────────────────────────────────────────────────────────────────

/** Out-of-service cars named in the first card's band before «عرض الكل». */
const OUT_TILES = 4;

const Cards = ({
  now,
  links,
  can,
  onRetry,
}: {
  now: FleetDashboardNowDto;
  links: NowLinks;
  can: (p: string) => boolean;
  onRetry: () => void;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const failed = (section: 'vehicles' | 'roster' | 'workshop'): boolean =>
    now.unavailable.includes(section);
  const { vehicles, roster, workshop } = now;
  const activeBase = vehicles?.active ?? roster?.rows ?? null;
  const branch = now.branchId !== null;
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {failed('vehicles') && <SectionError section="vehicles" onRetry={onRetry} />}
      {vehicles !== null && (
        <Kpi
          data="vehicles"
          tone="emerald"
          title={t('fleet.dash.now.activeTitle')}
          icon={I.truck}
          figure={vehicles.active}
          link={links.vehiclesActive()}
          unit={t('fleet.dash.now.activeUnit', { noun: noun('car', vehicles.active) })}
          part={vehicles.active}
          whole={vehicles.active + vehicles.outOfService}
          basis={t('fleet.dash.now.activeBasis')}
          band={
            <>
              <div className={cn(BAND_LABEL_SHAPE, AMBER)}>
                <Icon d={I.warn} className="h-3.5 w-3.5" />
                <Fig link={links.vehiclesOutOfService()}>
                  <Phrase
                    text={t('fleet.dash.now.outOfService')}
                    parts={{
                      count: <N>{count(vehicles.outOfService)}</N>,
                      noun: noun('car', vehicles.outOfService),
                    }}
                  />
                </Fig>
              </div>
              {vehicles.outOfServiceList.length > 0 && (
                <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
                  {vehicles.outOfServiceList.slice(0, OUT_TILES).map((row) => (
                    <div
                      key={row.vehicleId}
                      className={cn(
                        BOX,
                        BOX_HOVER,
                        'flex min-w-0 flex-col items-start justify-center gap-1.5 px-2.5 py-2',
                      )}
                    >
                      <CarChip
                        code={row.code}
                        link={links.vehicle(row.vehicleId, 'vehicles.outOfServiceRow')}
                      />
                      <span className="text-[11px] font-semibold leading-4 text-slate-600 dark:text-slate-400">
                        {row.reason ?? t('fleet.dash.now.noReason')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {vehicles.outOfService > OUT_TILES && (
                <div className="mt-2">
                  <Fig
                    link={links.vehiclesOutOfService()}
                    className={cn('text-xs font-bold', TONE.emerald.text)}
                  >
                    {t('fleet.dash.now.showAll')}
                  </Fig>
                </div>
              )}
            </>
          }
        />
      )}

      {failed('roster') && <SectionError section="roster" onRetry={onRetry} />}
      {roster !== null && (
        <Kpi
          data="ready"
          tone="sky"
          title={t('fleet.dash.now.readyTitle')}
          icon={I.check}
          figure={roster.ready}
          link={links.rosterReady()}
          unit={t('fleet.dash.now.readyUnit', { noun: noun('car', roster.ready) })}
          part={roster.ready}
          whole={roster.rows}
          basis={t('fleet.dash.now.ofActive')}
          band={
            <>
              <div className={BAND_LABEL}>
                <Icon d={I.filter} className="h-3.5 w-3.5 text-slate-400" />
                <Phrase
                  text={t('fleet.dash.now.readyExcluded')}
                  parts={{
                    count: (
                      <N className={cn('font-bold', STRONG)}>{count(roster.rows - roster.ready)}</N>
                    ),
                    noun: noun('car', roster.rows - roster.ready),
                  }}
                />
              </div>
              <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
                <Tile
                  n={roster.inWorkshop}
                  label={t('fleet.dash.now.inWorkshop')}
                  tone="amber"
                  link={links.rosterWorkshop()}
                />
                <Tile
                  n={roster.licenceExpired}
                  label={t('fleet.dash.now.licenceExpired')}
                  tone="red"
                />
              </div>
            </>
          }
        />
      )}

      {failed('workshop') && <SectionError section="workshop" onRetry={onRetry} />}
      {workshop !== null && (
        <Kpi
          data="workshop"
          tone="amber"
          title={t('fleet.dash.now.workshopTitle')}
          icon={I.wrench}
          figure={workshop.open}
          link={links.workshopOpen()}
          unit={t('fleet.dash.now.workshopUnit', { noun: noun('car', workshop.open) })}
          part={workshop.openActive}
          whole={activeBase}
          basis={t('fleet.dash.now.ofActive')}
          band={
            <>
              <div className={cn(BAND_LABEL, 'justify-between gap-3')}>
                <span className="flex items-center gap-1.5">
                  <Icon d={I.layers} className="h-3.5 w-3.5 text-slate-400" />
                  {t('fleet.dash.now.byStatus')}
                </span>
                <span className={cn('whitespace-nowrap font-semibold', MUTED)}>
                  {t('fleet.dash.now.statusActive')} <Small>{count(workshop.openActive)}</Small>
                  <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  {t('fleet.dash.now.statusOut')} <Small>{count(workshop.openOutOfService)}</Small>
                </span>
              </div>
              {workshop.oldest !== null && (
                <div
                  className={cn(
                    'mt-2.5 flex flex-1 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5',
                    TONE.red.soft,
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold dark:font-semibold">
                    <Icon d={I.clock} className="h-3.5 w-3.5" />
                    {t('fleet.dash.now.oldest')}
                    <CarChip
                      code={workshop.oldest.code}
                      link={
                        workshop.oldest.vehicleId === null
                          ? null
                          : links.vehicle(workshop.oldest.vehicleId, 'workshop.oldest')
                      }
                    />
                  </span>
                  <span className={cn('whitespace-nowrap text-xs font-bold', RED)}>
                    <Phrase
                      text={t('fleet.dash.common.since')}
                      parts={{
                        count: <N>{count(workshop.oldest.days)}</N>,
                        noun: noun('day', workshop.oldest.days),
                      }}
                    />
                  </span>
                </div>
              )}
            </>
          }
        />
      )}

      {roster !== null && (
        <>
          <Kpi
            data="unmanned"
            tone="amber"
            title={t('fleet.dash.now.unmannedTitle')}
            icon={I.userX}
            figure={roster.unmanned}
            link={links.rosterUnmanned()}
            figureCls="!text-amber-600 dark:!text-amber-400"
            unit={t('fleet.dash.now.unmannedUnit', { noun: noun('car', roster.unmanned) })}
            part={roster.unmanned}
            whole={roster.ready}
            basis={t('fleet.dash.now.ofReady')}
            band={
              <>
                <div className={BAND_LABEL}>
                  <Icon d={I.info} className="h-3.5 w-3.5 text-slate-400" />
                  {t('fleet.dash.now.unmannedWhy')}
                </div>
                <div className="mt-2.5 grid flex-1 grid-cols-3 gap-2">
                  <Tile n={roster.unmannedCrewGap} label={t('fleet.dash.now.unmannedCrewGap')} />
                  <Tile
                    n={roster.crewGap.stalePlan}
                    label={t('fleet.dash.now.unmannedStalePlan')}
                  />
                  <Tile n={roster.unmannedNoCrew} label={t('fleet.dash.now.unmannedNoCrew')} />
                </div>
              </>
            }
          />
          <Kpi
            data="available"
            tone="teal"
            title={t('fleet.dash.now.availableTitle')}
            icon={I.users}
            figure={roster.available}
            link={links.rosterAvailable()}
            unit={t('fleet.dash.now.availableUnit', { noun: noun('driver', roster.available) })}
            part={roster.available}
            whole={roster.registry}
            basis={t('fleet.dash.now.ofRegistry')}
            end={<CompanyWide show={branch} />}
            band={
              <div className="grid flex-1 grid-cols-2 grid-rows-[auto_1fr] gap-x-2 gap-y-2.5">
                <div className={BAND_LABEL}>{t('fleet.dash.now.excludedBesides')}</div>
                <div className={BAND_LABEL}>{t('fleet.dash.now.ofAvailable')}</div>
                <Rows
                  rows={[
                    {
                      label: t('fleet.dash.now.licenceExpiredDriver'),
                      n: roster.licenceExpiredDrivers,
                      tone: 'red',
                      link:
                        roster.licenceRule === 'refuse'
                          ? links.rosterUnavailable(
                              'licenceExpired',
                              'roster.licenceExpiredDrivers',
                            )
                          : links.rosterAvailable('roster.licenceExpiredDrivers'),
                    },
                    {
                      label: t('fleet.dash.now.profileInactive'),
                      n: roster.profileInactive,
                      link: links.rosterUnavailable('profileInactive', 'roster.profileInactive'),
                    },
                    {
                      label: t('fleet.dash.now.notEmployed'),
                      n: roster.notEmployed,
                      link: links.rosterUnavailable('notEmployed', 'roster.notEmployed'),
                    },
                  ]}
                />
                <Rows
                  rows={[
                    {
                      label: t('fleet.dash.now.withoutVehicle'),
                      n: roster.availableWithoutVehicle,
                      tone: 'amber',
                    },
                    {
                      label: t('fleet.dash.now.licenceNotRecorded'),
                      n: roster.availableLicenceNotRecorded,
                    },
                    { label: t('fleet.dash.now.noProfile'), n: roster.availableNoProfile },
                  ]}
                />
              </div>
            }
          />
          <Kpi
            data="absent"
            tone="rose"
            title={t('fleet.dash.now.absentTitle')}
            icon={I.calendarX}
            figure={roster.absent.attendance + roster.absent.leave}
            link={null}
            unit={t('fleet.dash.now.absentUnit', {
              noun: noun('driver', roster.absent.attendance + roster.absent.leave),
            })}
            part={roster.absent.attendance + roster.absent.leave}
            whole={roster.registry}
            basis={t('fleet.dash.now.ofRegistry')}
            end={<CompanyWide show={branch} />}
            band={
              <>
                <div className={cn(BAND_LABEL, 'justify-between gap-3')}>
                  <span className="flex items-center gap-1.5">
                    <Icon d={I.info} className="h-3.5 w-3.5 text-slate-400" />
                    {t('fleet.dash.now.byReason')}
                  </span>
                  {can('fleetAvailability.view') && (
                    <Fig
                      link={links.attendance()}
                      className={cn('text-xs font-bold', TONE.emerald.text)}
                    >
                      {t('fleet.dash.now.attendanceSheet')}
                    </Fig>
                  )}
                </div>
                <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
                  <Tile
                    n={roster.absent.attendance}
                    label={t('fleet.dash.now.absentAttendance')}
                    link={links.rosterAbsent('fleetUnavailability')}
                  />
                  <Tile
                    n={roster.absent.leave}
                    label={t('fleet.dash.now.absentLeave')}
                    link={links.rosterAbsent('hrLeave')}
                  />
                </div>
              </>
            }
          />
        </>
      )}
    </div>
  );
};

// ── (d) Suggestions from today's figures (they only OPEN screens, D5-2) ───────────────────────

const Suggestion = ({
  tone,
  icon,
  title,
  chip,
  children,
  actions,
}: {
  tone: 'sky' | 'amber' | 'red';
  icon: IconPath;
  title: string;
  chip: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}): JSX.Element => (
  <div
    className={cn(SURFACE, TONE[tone].accent, 'flex min-w-0 flex-col p-5')}
    data-suggestion={tone}
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className={cn(TITLE, 'flex items-center gap-2')}>
        <IconTile d={icon} tone={tone} size="sm" />
        {title}
      </h4>
      <span className={cn(COUNT_CHIP, TONE[tone].soft)}>{chip}</span>
    </div>
    <p className="mt-3 text-[13px] leading-7 text-slate-700 dark:text-slate-300">{children}</p>
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">{actions}</div>
  </div>
);

const Suggestions = ({
  now,
  links,
}: {
  now: FleetDashboardNowDto;
  links: NowLinks;
}): JSX.Element | null => {
  const t = useT();
  const noun = useNoun();
  const { roster, workshop, licenceVehicles, licenceDrivers } = now;
  const expiredCars = licenceVehicles?.expired ?? 0;
  const expiredDrivers = licenceDrivers?.expired ?? 0;
  const items: JSX.Element[] = [];
  if (roster !== null && roster.unmanned > 0) {
    items.push(
      <Suggestion
        key="fill"
        tone="sky"
        icon={I.bolt}
        title={t('fleet.dash.now.suggest.fillTitle')}
        chip={
          <Phrase
            text={t('fleet.dash.now.suggest.fillChip')}
            parts={{ count: <N>{count(roster.unmanned)}</N> }}
          />
        }
        actions={
          <Btn
            link={links.rosterUnmanned('roster.unmanned.suggestion')}
            kind="primary"
            icon={null}
            lead={I.calendar}
            className="w-full"
          >
            {t('fleet.dash.now.suggest.fillAction')}
          </Btn>
        }
      >
        <Phrase
          text={t('fleet.dash.now.suggest.fillText')}
          parts={{
            drivers: <Small>{count(roster.availableWithoutVehicle)}</Small>,
            driverNoun: noun('driver', roster.availableWithoutVehicle),
            cars: <Small>{count(roster.unmanned)}</Small>,
            carNoun: noun('car', roster.unmanned),
          }}
        />
      </Suggestion>,
    );
  }
  if (workshop !== null && workshop.open > 0 && workshop.oldest !== null) {
    const oldest = workshop.oldest;
    items.push(
      <Suggestion
        key="workshop"
        tone="amber"
        icon={I.wrench}
        title={t('fleet.dash.now.suggest.workshopTitle')}
        chip={
          <Phrase
            text={t('fleet.dash.now.suggest.workshopChip')}
            parts={{ count: <N>{count(workshop.open)}</N> }}
          />
        }
        actions={
          <>
            <Btn
              link={links.workshopOpen('workshop.open.suggestion')}
              kind="dark"
              icon={null}
              lead={I.eye}
              className="flex-1"
            >
              {t('fleet.dash.now.suggest.workshopAction')}
            </Btn>
            {oldest.vehicleId !== null && (
              <Btn
                link={links.vehicle(oldest.vehicleId, 'workshop.oldest.file')}
                kind="outline"
                icon={null}
                lead={I.truck}
                className="flex-1"
              >
                <Phrase
                  text={t('fleet.dash.now.suggest.vehicleFile')}
                  parts={{ code: <N>{oldest.code}</N> }}
                />
              </Btn>
            )}
          </>
        }
      >
        <Phrase
          text={t('fleet.dash.now.suggest.workshopText')}
          parts={{
            code: <CarChip code={oldest.code} />,
            since: (
              <span className={cn('font-bold', RED)}>
                <Phrase
                  text={t('fleet.dash.common.since')}
                  parts={{ count: <N>{count(oldest.days)}</N>, noun: noun('day', oldest.days) }}
                />
              </span>
            ),
            open: <Small>{count(workshop.open)}</Small>,
            openNoun: noun('car', workshop.open),
            active: <Small>{count(workshop.openActive)}</Small>,
          }}
        />
      </Suggestion>,
    );
  }
  if (expiredCars + expiredDrivers > 0) {
    items.push(
      <Suggestion
        key="licences"
        tone="red"
        icon={I.doc}
        title={t('fleet.dash.now.suggest.licencesTitle')}
        chip={
          <Phrase
            text={t('fleet.dash.now.suggest.licencesChip')}
            parts={{ count: <N>{count(expiredCars + expiredDrivers)}</N> }}
          />
        }
        actions={
          <>
            {licenceVehicles !== null && (
              <Btn
                link={links.vehicleLicencesExpired()}
                kind="dark"
                icon={null}
                lead={I.doc}
                className="flex-1"
              >
                {t('fleet.dash.now.suggest.openVehicles')}
              </Btn>
            )}
            {licenceDrivers !== null && (
              <Btn
                link={links.driverLicencesExpired()}
                kind="outline"
                icon={null}
                lead={I.users}
                className="flex-1"
              >
                {t('fleet.dash.now.suggest.openDrivers')}
              </Btn>
            )}
          </>
        }
      >
        <Phrase
          text={t('fleet.dash.now.suggest.licencesText')}
          parts={{
            cars: <Small>{count(expiredCars)}</Small>,
            carNoun: noun('car', expiredCars),
            drivers: <Small>{count(expiredDrivers)}</Small>,
            driverNoun: noun('driver', expiredDrivers),
          }}
        />
      </Suggestion>,
    );
  }
  if (items.length === 0) return null;
  return (
    <Card className="mt-5" data-now-card="suggestions">
      <div className="px-6 pb-6 pt-5">
        <div
          className={cn('flex flex-wrap items-center justify-between gap-3 border-b pb-4', RULE)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <IconTile d={I.clipboardCheck} tone="brand" />
            <div className="min-w-0">
              <h3 className={TITLE}>{t('fleet.dash.now.suggest.title')}</h3>
              <p className={cn('mt-0.5', NOTE)}>{t('fleet.dash.now.suggest.note')}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">{items}</div>
      </div>
    </Card>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const NowTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now } = props;
  return (
    <div data-dash-tab-body="now">
      <TabHead
        icon={I.clock}
        title={t('fleet.dash.shell.tab.now')}
        sub={t('fleet.dash.now.sub')}
        end={
          <RefreshTools
            updatedAt={props.updatedAt}
            onRefresh={props.onRefresh}
            refreshing={props.refreshing}
            {...(props.clock === undefined ? {} : { clock: props.clock })}
          />
        }
      />
      {now !== null && (
        <>
          {now.roster !== null && <Summary roster={now.roster} links={nowLinks(now)} />}
          <Cards now={now} links={nowLinks(now)} can={props.can} onRetry={props.onRetry} />
          <Suggestions now={now} links={nowLinks(now)} />
        </>
      )}
    </div>
  );
};
