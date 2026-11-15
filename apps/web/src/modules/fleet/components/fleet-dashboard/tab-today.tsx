// «الحركة اليوم» — the dashboard's second tab, as the owner approved it («تمام» on the sample,
// approved/today-{dark,branch-dark}.png; harness zz-today.tsx), drawn over R1's `vehicles`, `roster`
// and `workshop` (Cairo today, untouched by the page's filters):
//
//   1  the heading — «حركة الأسطول اليوم وتعيين السائقين», the live chip, the refresh tools
//   2  the readiness card, two halves — «السيارات الجاهزة التي لها سائق» (readyManned ÷ ready, the
//      two-part meter, what was left out of «الجاهزة») | «ميزان اليوم» (ready cars against the drivers)
//   3  five KPI cards — active · in the workshop · without a driver · drivers available · absent
//      (2 + 2 + 2 | 3 + 3 on six columns, five in one row from 1840 px)
//   4  the lists — «سيارات بلا سائق اليوم» (the server's rows, «فتح» on each) | «الغائبون اليوم»
//
// NOTHING IS COUNTED HERE. Every figure is a field the server sent; the lists are the server's rows
// as sent (at most FLEET_DASHBOARD_TODAY_ROWS), and «عرض الكل (N)» takes N from the server's count,
// never from the rows. A share is display arithmetic on two server figures; so are «استُبعدت» (rows −
// ready), «المسجّلة» (active + out of service) and the absent total (attendance + leave).
//
// WHAT EACH FIGURE COVERS. The cars follow the reader's branches; the drivers' pool is the company's
// (R-27). So while the figures are narrowed (`scopeBranches !== null`, one branch or «كل فروعي») the
// drivers wear «الشركة كلها», the balance offers no driver-versus-car difference, and each half of a
// sentence names its own fleet («في الفرع» / «في فروعك» … «في الشركة كلها»).
//
// The roster's own words name a driver's reason (`fleet.roster.reason.*`: «الملف موقوف», «خارج الخدمة
// الوظيفية», «تمام: غير متاح», «إجازة معتمدة») — one spelling on both screens. Names need the drivers'
// view (`fleetDriver.view`, the people list): without it the table says the reason alone and the
// absent list is not drawn.
import { type ReactNode } from 'react';
import {
  type FleetDashboardAbsentDriverDto,
  type FleetDashboardNowDto,
  type FleetDashboardUnmannedClass,
  type FleetDashboardUnmannedRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { DriverAvatar } from '../DriverPerson';
import { useFleetPeopleMap } from '../EmployeeName';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { share, shareText } from '../../lib/fleet-dashboard-tabs';
import {
  BOX,
  BOX_HOVER,
  Btn,
  CAIRO,
  CHIP,
  CarChip,
  Card,
  CompanyWide,
  DIVIDE,
  Fig,
  FootLink,
  I,
  Icon,
  IconTile,
  MUTED,
  Meter,
  N,
  NOTE,
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
import { COUNT_CHIP, Big, Counted, Kpi, Small, WORDS } from './dash-blocks';
import { Phrase, RefreshTools, SectionError, count, useNoun, type NowTabProps } from './dash-shell';

type Roster = NonNullable<FleetDashboardNowDto['roster']>;

/** What the cars cover: the whole company, one branch, or the reader's several branches. */
type Scope = 'company' | 'branch' | 'branches';

const scopeOf = (now: FleetDashboardNowDto): Scope =>
  now.scopeBranches === null ? 'company' : now.scopeBranches.length === 1 ? 'branch' : 'branches';

/** The roster's own word for an unavailable driver (one spelling on both screens). */
const REASON_TONE: Record<FleetDashboardAbsentDriverDto['reason'], Tone> = {
  fleetUnavailability: 'rose',
  hrLeave: 'violet',
};

/** A ready car's class, in the words of the «أسباب عدم التعيين» tiles. */
const CLASS_WORD: Record<FleetDashboardUnmannedClass, string> = {
  crewGap: 'fleet.dash.now.unmannedCrewGap',
  stalePlan: 'fleet.dash.now.unmannedStalePlan',
  noCrew: 'fleet.dash.now.unmannedNoCrew',
  unassigned: 'fleet.dash.now.unmannedUnassigned',
};

/** Out-of-service cars named in the active card's band before «عرض الكل». */
const OUT_TILES = 4;

// ── Local pieces (the harness's, on the kit's tokens) ─────────────────────────────────────────

const BAND_LABEL =
  'flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:font-semibold dark:text-slate-300';
const SENTENCE = 'text-[13.5px] leading-7 text-slate-600 dark:text-slate-300';
const DOT_SEP = 'text-slate-300 dark:text-slate-600';

const Sep = ({ className }: { className?: string }): JSX.Element => (
  <span aria-hidden="true" className={cn(DOT_SEP, className)}>
    ·
  </span>
);

/** A mini tile of a card's breakdown: the figure over its label. */
const Tile = ({
  n,
  label,
  tone,
  link = null,
  className,
}: {
  n: number;
  label: string;
  tone?: Tone;
  link?: DashLink | null;
  className?: string | undefined;
}): JSX.Element => (
  <div
    className={cn(
      BOX,
      BOX_HOVER,
      'flex h-full min-w-0 flex-col items-center justify-center px-1.5 py-2.5 text-center',
      className,
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
    <span className="mt-2 text-balance text-[11.5px] font-semibold leading-4 text-slate-600 dark:text-slate-400">
      {label}
    </span>
  </div>
);

/** Two to four tiles on two columns; an odd last tile takes the whole row. */
const Tiles = ({
  tiles,
}: {
  tiles: readonly {
    id: string;
    n: number;
    label: string;
    tone?: Tone;
    link?: DashLink | null;
  }[];
}): JSX.Element => (
  <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
    {tiles.map((tile, i) => (
      <Tile
        key={tile.id}
        n={tile.n}
        label={tile.label}
        {...(tile.tone === undefined ? {} : { tone: tile.tone })}
        link={tile.link ?? null}
        className={i === tiles.length - 1 && i % 2 === 0 ? 'col-span-2' : undefined}
      />
    ))}
  </div>
);

type ReasonRow = { id: string; label: string; n: number; tone?: Tone; link?: DashLink | null };

/**
 * The drivers left out of «المتاحون» beside the absent, and the ones counted in it with a flag: the
 * roster's two groups in ONE box, each under its own caption. Stacked while the card is one of five
 * (from 1840 px), side by side while it spans half the row (1024–1839 px).
 */
const ReasonGroups = ({
  groups,
}: {
  groups: readonly { id: string; caption: string; rows: readonly ReasonRow[] }[];
}): JSX.Element => (
  <div
    data-today-reasons="true"
    className={cn(
      BOX,
      'grid min-w-0 flex-1 grid-cols-1 px-2 py-1 lg:grid-cols-2 min-[1840px]:grid-cols-1',
    )}
  >
    {groups.map((group, i) => (
      <div
        key={group.id}
        data-today-reasons-group={group.id}
        className={cn(
          'flex min-w-0 flex-col',
          i === 0
            ? 'pb-1.5 lg:pb-0 lg:pe-2 min-[1840px]:pb-1.5 min-[1840px]:pe-0'
            : cn(
                'border-t pt-1.5 lg:border-s lg:border-t-0 lg:ps-2 lg:pt-0',
                'min-[1840px]:border-s-0 min-[1840px]:border-t min-[1840px]:ps-0 min-[1840px]:pt-1.5',
                RULE,
              ),
        )}
      >
        <div className="px-1 text-[11px] font-bold leading-4 text-slate-500 dark:font-semibold dark:text-slate-400">
          {group.caption}
        </div>
        {group.rows.map((row) => (
          <div
            key={row.id}
            data-today-reason={row.id}
            className="flex items-center justify-between gap-2 px-1 py-px text-xs leading-[18px]"
          >
            <span
              className={cn(
                'min-w-0 whitespace-nowrap font-semibold',
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
    ))}
  </div>
);

/** «منذ 12 يومًا», «منذ اليوم» — never «منذ 0 أيام». */
const Since = ({ days }: { days: number }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return days === 0 ? (
    <>{t('fleet.dash.common.sinceToday')}</>
  ) : (
    <Phrase
      text={t('fleet.dash.common.since')}
      parts={{ count: <N>{count(days)}</N>, noun: noun('day', days) }}
    />
  );
};

// ── 2 · The readiness card ────────────────────────────────────────────────────────────────────

const HalfHead = ({
  icon,
  tone,
  title,
  note,
  end,
}: {
  icon: IconPath;
  tone: Tone;
  title: string;
  note: string;
  end?: ReactNode;
}): JSX.Element => (
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <div className="flex min-w-0 items-center gap-2.5">
      <IconTile d={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <h3 className={cn(TITLE, 'whitespace-nowrap')}>{title}</h3>
        <p className={NOTE}>{note}</p>
      </div>
    </div>
    {end}
  </div>
);

/** The line at the foot of a half, ruled off; both halves end on one. */
const HalfFoot = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="mt-auto pt-4">
    <div
      className={cn(
        'flex min-h-7 items-center gap-2 border-t pt-3.5 text-[13px] leading-6 text-slate-600 dark:text-slate-300',
        RULE,
      )}
    >
      {children}
    </div>
  </div>
);

const LegendDot = ({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-sm', TONE[tone].bar)} />
    {children}
  </span>
);

const ReadyHalf = ({ roster, links }: { roster: Roster; links: NowLinks }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const excluded = roster.rows - roster.ready;
  return (
    <section data-today-card="readiness" className="flex min-w-0 flex-col px-6 pb-5 pt-5">
      <HalfHead
        icon={I.check}
        tone="sky"
        title={t('fleet.dash.now.badgeTitle')}
        note={t('fleet.dash.now.readyNote')}
      />
      <div className="mt-5 flex items-center gap-5">
        <span
          dir="ltr"
          data-today-share="true"
          className={cn(
            'shrink-0 text-[46px] font-black leading-none tracking-tight tabular-nums text-sky-600 dark:text-sky-400',
            CAIRO,
          )}
        >
          {shareText(roster.readyManned, roster.ready)}
        </span>
        <p className={cn(SENTENCE, 'min-w-0 text-[14px]')}>
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
      <Meter
        className="mt-5"
        height="h-3"
        parts={[
          { pct: share(roster.readyManned, roster.ready) ?? 0, tone: 'sky' },
          { pct: share(roster.unmanned, roster.ready) ?? 0, tone: 'amber' },
        ]}
      />
      <div className={cn('mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold', MUTED)}>
        <LegendDot tone="sky">
          {t('fleet.dash.now.legendManned')}{' '}
          <N className={cn('font-bold', STRONG)}>{count(roster.readyManned)}</N>
        </LegendDot>
        <LegendDot tone="amber">
          {t('fleet.dash.now.legendUnmanned')}{' '}
          <N className={cn('font-bold', TONE.amber.text)}>{count(roster.unmanned)}</N>
        </LegendDot>
      </div>
      <HalfFoot>
        <Icon d={I.filter} className="h-4 w-4 shrink-0 text-slate-400" />
        <span data-today-excluded="true">
          <Phrase
            text={t('fleet.dash.now.excludedFoot')}
            parts={{
              count: <N className={cn('font-bold', STRONG)}>{count(excluded)}</N>,
              rows: <N className={cn('font-bold', STRONG)}>{count(roster.rows)}</N>,
            }}
          />{' '}
          <Fig link={links.rosterWorkshop()} className="font-semibold">
            {t('fleet.dash.now.inWorkshop')}{' '}
            <N className={cn('font-bold', TONE.amber.text)}>{count(roster.inWorkshop)}</N>
          </Fig>{' '}
          <Sep className="mx-1" />{' '}
          {/* No list holds the cars whose licence expired (the roster has no such view): plain. */}
          <span className="font-semibold">
            {t('fleet.dash.now.licenceExpired')}{' '}
            <N className={cn('font-bold', TONE.red.text)}>{count(roster.licenceExpired)}</N>
          </span>
        </span>
      </HalfFoot>
    </section>
  );
};

/** A figure tile of the balance: the label, the big figure (and its tag), the icon. */
const FigureTile = ({
  id,
  icon,
  tone,
  label,
  n,
  link,
  tag,
}: {
  id: string;
  icon: IconPath;
  tone: Tone;
  label: string;
  n: number;
  link: DashLink | null;
  tag?: ReactNode;
}): JSX.Element => (
  <div
    data-today-figure={id}
    className={cn(BOX, BOX_HOVER, 'flex min-w-0 items-center justify-between gap-3 px-4 py-3.5')}
  >
    <div className="min-w-0">
      <div className={cn(WORDS, 'flex h-5 items-center whitespace-nowrap')}>{label}</div>
      <div className="mt-2.5 flex items-center gap-2">
        <Big link={link}>{count(n)}</Big>
        {tag}
      </div>
    </div>
    {/* On a phone the two tiles share 343 px: the label needs the icon's room. */}
    <span className="max-sm:hidden">
      <IconTile d={icon} tone={tone} />
    </span>
  </div>
);

const BALANCE_TEXT: Record<Scope, string> = {
  company: 'fleet.dash.now.balanceText',
  branch: 'fleet.dash.now.balanceTextBranch',
  branches: 'fleet.dash.now.balanceTextBranches',
};

const BalanceHalf = ({
  roster,
  links,
  scope,
}: {
  roster: Roster;
  links: NowLinks;
  scope: Scope;
}): JSX.Element => {
  const t = useT();
  // A difference only while both figures count the same fleet: narrowed, the cars are the reader's
  // branches' and the drivers the company's pool, and no difference is offered.
  const gap = roster.available - roster.ready;
  return (
    <section
      data-today-card="balance"
      className={cn(
        'flex min-w-0 flex-col border-t px-6 pb-5 pt-5 lg:border-s lg:border-t-0',
        RULE,
      )}
    >
      <HalfHead
        icon={I.scale}
        tone="slate"
        title={t('fleet.dash.now.balanceTitle')}
        note={t('fleet.dash.now.balanceNote')}
        end={
          scope === 'company' && gap !== 0 ? (
            <span data-today-gap="true" className={cn(COUNT_CHIP, TONE.teal.soft)}>
              <span>
                <Phrase
                  text={t(
                    gap > 0
                      ? 'fleet.dash.now.balanceMoreDrivers'
                      : 'fleet.dash.now.balanceMoreCars',
                  )}
                  parts={{ count: <N className="font-bold">{count(Math.abs(gap))}</N> }}
                />
              </span>
            </span>
          ) : undefined
        }
      />
      <div className="mt-5 grid grid-cols-2 gap-3">
        <FigureTile
          id="ready"
          icon={I.truck}
          tone="sky"
          label={t('fleet.dash.now.balanceCars')}
          n={roster.ready}
          link={links.rosterReady()}
        />
        <FigureTile
          id="available"
          icon={I.users}
          tone="teal"
          label={t('fleet.dash.now.balanceDrivers')}
          n={roster.available}
          // A named exception: «المتاحون» counts the seated drivers too, and the roster lists only
          // those still without a car — that count is the sentence's «بلا سيارة», and it is linked.
          link={null}
          tag={<CompanyWide show={scope !== 'company'} />}
        />
      </div>
      <HalfFoot>
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-sm', TONE.amber.bar)} />
        <span>
          <Phrase
            text={t(BALANCE_TEXT[scope])}
            parts={{
              cars: (
                <Small link={links.rosterUnmanned('roster.unmanned.balance')}>
                  {count(roster.unmanned)}
                </Small>
              ),
              drivers: (
                <Small link={links.rosterAvailable('roster.availableWithoutVehicle.balance')}>
                  {count(roster.availableWithoutVehicle)}
                </Small>
              ),
            }}
          />
        </span>
      </HalfFoot>
    </section>
  );
};

// ── 3 · The five KPI cards ────────────────────────────────────────────────────────────────────

/** Five equal cards in one row from 1840 px; below it the three car cards over the two driver cards
 *  (six columns: 2 + 2 + 2 | 3 + 3), so no row is left with a hole. */
const SPAN_CAR = 'lg:col-span-2 min-[1840px]:col-span-1';
const SPAN_DRIVER = 'lg:col-span-3 min-[1840px]:col-span-1';

const ShareTag = ({
  tone,
  part,
  whole,
  basis,
}: {
  tone: Tone;
  part: number;
  whole: number;
  basis: string;
}): JSX.Element => (
  <Tag tone={tone} dot>
    <N>{shareText(part, whole)}</N> {basis}
  </Tag>
);

const VehiclesKpi = ({
  vehicles,
  links,
}: {
  vehicles: NonNullable<FleetDashboardNowDto['vehicles']>;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const registered = vehicles.active + vehicles.outOfService;
  return (
    <Kpi
      id="vehicles"
      data-today-card="vehicles"
      tone="emerald"
      icon={I.truck}
      title={t('fleet.dash.now.activeTitle')}
      className={SPAN_CAR}
      tag={
        <ShareTag
          tone="emerald"
          part={vehicles.active}
          whole={registered}
          basis={t('fleet.dash.now.activeBasis')}
        />
      }
      figure={
        <>
          <Big link={links.vehiclesActive()}>{count(vehicles.active)}</Big>
          <span className={WORDS}>
            <Phrase
              text={t('fleet.dash.now.activeOf')}
              parts={{ count: <N>{count(registered)}</N> }}
            />
          </span>
        </>
      }
      sub={
        <Meter
          className="w-full"
          height="h-2"
          parts={[{ pct: share(vehicles.active, registered) ?? 0, tone: 'emerald' }]}
        />
      }
      box={
        <>
          <div className={cn(BAND_LABEL, TONE.amber.text)}>
            <Icon d={I.warn} className="h-3.5 w-3.5" />
            <Fig link={links.vehiclesOutOfService()}>
              {t('fleet.dash.now.statusOut')} <N>{count(vehicles.outOfService)}</N>
            </Fig>
          </div>
          {vehicles.outOfServiceList.length > 0 && (
            <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
              {vehicles.outOfServiceList.slice(0, OUT_TILES).map((row) => (
                <div
                  key={row.vehicleId}
                  data-today-out={row.code}
                  className={cn(
                    BOX,
                    BOX_HOVER,
                    'flex min-w-0 flex-col items-start justify-center gap-1 px-2.5 py-1.5',
                  )}
                >
                  <CarChip
                    code={row.code}
                    link={links.vehicle(row.vehicleId, 'vehicles.outOfServiceRow')}
                  />
                  <span className="text-[11.5px] font-semibold leading-4 text-slate-600 dark:text-slate-400">
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
  );
};

const WorkshopKpi = ({
  workshop,
  activeBase,
  links,
  can,
}: {
  workshop: NonNullable<FleetDashboardNowDto['workshop']>;
  /** The active cars the share is taken of: the registry's, else the roster's rows. */
  activeBase: number | null;
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const { oldest } = workshop;
  return (
    <Kpi
      id="workshop"
      data-today-card="workshop"
      tone="amber"
      icon={I.wrench}
      title={t('fleet.dash.now.workshopTitle')}
      className={SPAN_CAR}
      tag={
        activeBase === null ? undefined : (
          <ShareTag
            tone="amber"
            part={workshop.openActive}
            whole={activeBase}
            basis={t('fleet.dash.now.ofActive')}
          />
        )
      }
      figure={
        <>
          <Big link={links.workshopOpen()}>{count(workshop.open)}</Big>
          <span className={WORDS}>
            {t('fleet.dash.now.workshopUnit', { noun: noun('car', workshop.open) })}
          </span>
        </>
      }
      sub={
        oldest === null ? undefined : (
          <span
            data-today-oldest="true"
            className={cn('flex items-center gap-1 whitespace-nowrap', MUTED)}
          >
            {t('fleet.dash.now.oldest')}
            {/* The car's file is the vehicles screen's (fleetVehicle.view), not this section's
                (fleetMaintenance.view): a link only with its own guard. */}
            <CarChip
              code={oldest.code}
              link={
                oldest.vehicleId === null || !can('fleetVehicle.view')
                  ? null
                  : links.vehicle(oldest.vehicleId, 'workshop.oldest')
              }
            />
            <span className={cn('font-bold', TONE.amber.text)}>
              <Since days={oldest.days} />
            </span>
          </span>
        )
      }
      box={
        <>
          <div className={BAND_LABEL}>
            <Icon d={I.layers} className="h-3.5 w-3.5 text-slate-400" />
            {t('fleet.dash.now.workshopByStatus')}
          </div>
          {/* Plain: the maintenance screen reads no vehicle-status parameter, so neither part has an
              exact list (the headline's open visits do). */}
          <Tiles
            tiles={[
              {
                id: 'active',
                n: workshop.openActive,
                label: t('fleet.dash.now.statusActive'),
                tone: 'amber',
              },
              { id: 'out', n: workshop.openOutOfService, label: t('fleet.dash.now.statusOut') },
            ]}
          />
        </>
      }
    />
  );
};

const UnmannedKpi = ({ roster, links }: { roster: Roster; links: NowLinks }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  // The tiles are PARTS of `unmanned` (the server counts them in the one loop that counts it), each
  // plain: the roster's crew-gap view lists manned cars too. stalePlan and the residue only when > 0.
  const tiles = [
    { id: 'crewGap', n: roster.unmannedCrewGap, label: t('fleet.dash.now.unmannedCrewGap') },
    ...(roster.unmannedStalePlan > 0
      ? [
          {
            id: 'stalePlan',
            n: roster.unmannedStalePlan,
            label: t('fleet.dash.now.unmannedStalePlan'),
          },
        ]
      : []),
    { id: 'noCrew', n: roster.unmannedNoCrew, label: t('fleet.dash.now.unmannedNoCrew') },
    ...(roster.unmannedUnassigned > 0
      ? [
          {
            id: 'unassigned',
            n: roster.unmannedUnassigned,
            label: t('fleet.dash.now.unmannedUnassigned'),
          },
        ]
      : []),
  ];
  return (
    <Kpi
      id="unmanned"
      data-today-card="unmanned"
      tone="amber"
      icon={I.userX}
      title={t('fleet.dash.now.unmannedTitle')}
      className={SPAN_CAR}
      tag={
        roster.unmanned > 0 ? (
          <Tag tone="amber" dot>
            {t('fleet.dash.now.unmannedTag')}
          </Tag>
        ) : (
          <Tag tone="emerald" dot>
            {t('fleet.dash.now.unmannedClear')}
          </Tag>
        )
      }
      figure={
        <>
          <Big link={links.rosterUnmanned()} className="!text-amber-600 dark:!text-amber-400">
            {count(roster.unmanned)}
          </Big>
          <span className={WORDS}>
            {t('fleet.dash.now.unmannedUnit', { noun: noun('car', roster.unmanned) })}
          </span>
        </>
      }
      sub={
        <span className={MUTED}>
          <Phrase
            text={t('fleet.dash.now.unmannedOf')}
            parts={{
              count: <N className={cn('font-bold', STRONG)}>{count(roster.ready)}</N>,
              noun: noun('car', roster.ready),
            }}
          />
        </span>
      }
      box={
        <>
          <div className={BAND_LABEL}>
            <Icon d={I.info} className="h-3.5 w-3.5 text-slate-400" />
            {t('fleet.dash.now.unmannedWhy')}
          </div>
          <Tiles tiles={tiles} />
        </>
      }
    />
  );
};

const AvailableKpi = ({
  roster,
  links,
  narrowed,
}: {
  roster: Roster;
  links: NowLinks;
  narrowed: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <Kpi
      id="available"
      data-today-card="available"
      tone="teal"
      icon={I.users}
      title={t('fleet.dash.now.availableTitle')}
      className={SPAN_DRIVER}
      tag={
        <>
          <ShareTag
            tone="teal"
            part={roster.available}
            whole={roster.registry}
            basis={t('fleet.dash.now.ofRegistry')}
          />
          <CompanyWide show={narrowed} />
        </>
      }
      figure={
        <>
          {/* A named exception: «المتاحون» counts the seated drivers too (see the balance). */}
          <Big>{count(roster.available)}</Big>
          <span className={WORDS}>
            <Phrase
              text={t('fleet.dash.now.availableOf')}
              parts={{ count: <N>{count(roster.registry)}</N> }}
            />
          </span>
        </>
      }
      sub={
        <span className={MUTED}>
          <Phrase
            text={t('fleet.dash.now.withoutVehicleSub')}
            parts={{
              count: (
                <Small link={links.rosterAvailable()} className={TONE.amber.text}>
                  {count(roster.availableWithoutVehicle)}
                </Small>
              ),
            }}
          />
        </span>
      }
      box={
        <ReasonGroups
          groups={[
            {
              id: 'excluded',
              caption: t('fleet.dash.now.excludedBesides'),
              rows: [
                {
                  id: 'licenceExpired',
                  label: t('fleet.dash.now.licenceExpiredDriver'),
                  n: roster.licenceExpiredDrivers,
                  tone: 'red',
                  // Refused: the roster lists them as unavailable; flagged: they stay in its
                  // available panel, with the flag.
                  link:
                    roster.licenceRule === 'refuse'
                      ? links.rosterUnavailable('licenceExpired', 'roster.licenceExpiredDrivers')
                      : links.rosterAvailable('roster.licenceExpiredDrivers'),
                },
                {
                  id: 'profileInactive',
                  label: t('fleet.roster.reason.profileInactive'),
                  n: roster.profileInactive,
                  link: links.rosterUnavailable('profileInactive', 'roster.profileInactive'),
                },
                {
                  id: 'notEmployed',
                  label: t('fleet.roster.reason.notEmployed'),
                  n: roster.notEmployed,
                  link: links.rosterUnavailable('notEmployed', 'roster.notEmployed'),
                },
              ],
            },
            {
              id: 'flagged',
              caption: t('fleet.dash.now.ofAvailable'),
              rows: [
                {
                  id: 'licenceNotRecorded',
                  label: t('fleet.dash.now.licenceNotRecorded'),
                  n: roster.availableLicenceNotRecorded,
                  tone: 'amber',
                },
                {
                  id: 'noProfile',
                  label: t('fleet.dash.now.noProfile'),
                  n: roster.availableNoProfile,
                  tone: 'amber',
                },
              ],
            },
          ]}
        />
      }
    />
  );
};

const AbsentKpi = ({
  roster,
  links,
  narrowed,
  can,
}: {
  roster: Roster;
  links: NowLinks;
  narrowed: boolean;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const absent = roster.absent.attendance + roster.absent.leave;
  return (
    <Kpi
      id="absent"
      data-today-card="absent"
      tone="rose"
      icon={I.calendarX}
      title={t('fleet.dash.now.absentTitle')}
      className={SPAN_DRIVER}
      tag={
        <>
          <ShareTag
            tone="rose"
            part={absent}
            whole={roster.registry}
            basis={t('fleet.dash.now.ofRegistry')}
          />
          <CompanyWide show={narrowed} />
        </>
      }
      figure={
        <>
          <Big>{count(absent)}</Big>
          <span className={WORDS}>
            {t(absent === 1 ? 'fleet.dash.now.absentUnitOne' : 'fleet.dash.now.absentUnit', {
              noun: noun('driver', absent),
            })}
          </span>
        </>
      }
      sub={
        // The attendance sheet is its own screen, behind its own guard.
        can('fleetAvailability.view') ? (
          <FootLink link={links.attendance()}>{t('fleet.dash.now.attendanceSheet')}</FootLink>
        ) : undefined
      }
      box={
        <>
          <div className={BAND_LABEL}>
            <Icon d={I.info} className="h-3.5 w-3.5 text-slate-400" />
            {t('fleet.dash.now.byReason')}
          </div>
          <Tiles
            tiles={[
              {
                id: 'attendance',
                n: roster.absent.attendance,
                label: t('fleet.roster.reason.fleetUnavailability'),
                tone: REASON_TONE.fleetUnavailability,
                link: links.rosterAbsent('fleetUnavailability'),
              },
              {
                id: 'leave',
                n: roster.absent.leave,
                label: t('fleet.roster.reason.hrLeave'),
                tone: REASON_TONE.hrLeave,
                link: links.rosterAbsent('hrLeave'),
              },
            ]}
          />
        </>
      }
    />
  );
};

const KpiRow = ({
  now,
  links,
  can,
  onRetry,
}: {
  now: FleetDashboardNowDto;
  links: NowLinks;
  can: (permission: string) => boolean;
  onRetry: () => void;
}): JSX.Element => {
  const { vehicles, roster, workshop } = now;
  const failed = (section: 'vehicles' | 'workshop'): boolean => now.unavailable.includes(section);
  const narrowed = now.scopeBranches !== null;
  return (
    <div
      data-today-block="kpis"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 min-[1840px]:grid-cols-5"
    >
      {failed('vehicles') && (
        <SectionError section="vehicles" onRetry={onRetry} className={SPAN_CAR} />
      )}
      {vehicles !== null && <VehiclesKpi vehicles={vehicles} links={links} />}
      {failed('workshop') && (
        <SectionError section="workshop" onRetry={onRetry} className={SPAN_CAR} />
      )}
      {workshop !== null && (
        <WorkshopKpi
          workshop={workshop}
          activeBase={vehicles?.active ?? roster?.rows ?? null}
          links={links}
          can={can}
        />
      )}
      {roster !== null && (
        <>
          <UnmannedKpi roster={roster} links={links} />
          <AvailableKpi roster={roster} links={links} narrowed={narrowed} />
          <AbsentKpi roster={roster} links={links} narrowed={narrowed} can={can} />
        </>
      )}
    </div>
  );
};

// ── 4 · The lists ─────────────────────────────────────────────────────────────────────────────

const ListHead = ({
  icon,
  tone,
  title,
  note,
  chips,
  end,
}: {
  icon: IconPath;
  tone: Tone;
  title: string;
  note: string;
  chips: ReactNode;
  end?: ReactNode;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4">
    <div className="flex min-w-0 items-center gap-3">
      <IconTile d={icon} tone={tone} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn(TITLE, 'whitespace-nowrap')}>{title}</h3>
          {chips}
        </div>
        <p className={cn('mt-0.5', NOTE)}>{note}</p>
      </div>
    </div>
    {end !== undefined && <div className="shrink-0">{end}</div>}
  </div>
);

/** «عرض الكل (N)» — N is the server's count, never the rows on screen. */
const ShowAll = ({ link, n }: { link: DashLink; n: number }): JSX.Element => {
  const t = useT();
  return (
    <FootLink link={link}>
      <span>
        <Phrase text={t('fleet.dash.now.showAllCount')} parts={{ count: <N>{count(n)}</N> }} />
      </span>
    </FootLink>
  );
};

const CELL = 'px-4 py-4 align-middle first:ps-5 last:pe-5';

const REST_TEXT: Record<Scope, string> = {
  company: 'fleet.dash.now.table.rest',
  branch: 'fleet.dash.now.table.restBranch',
  branches: 'fleet.dash.now.table.restBranches',
};

const UnmannedRow = ({
  row,
  links,
  showBranch,
  names,
  can,
}: {
  row: FleetDashboardUnmannedRowDto;
  links: NowLinks;
  showBranch: boolean;
  /** The drivers' names by employee id; empty without fleetDriver.view. */
  names: ReadonlyMap<string, { fullNameAr: string }>;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const name =
    row.absent === null || !can('fleetDriver.view')
      ? undefined
      : names.get(row.absent.employeeId)?.fullNameAr;
  return (
    <tr data-today-unmanned={row.code} data-today-why={row.why}>
      <td className={CELL}>
        <div className="flex flex-col items-start gap-1">
          {/* The car's file is the vehicles screen's: a link only with its own guard. */}
          <CarChip
            code={row.code}
            link={
              can('fleetVehicle.view') ? links.vehicle(row.vehicleId, 'roster.unmannedRow') : null
            }
          />
          {row.typeName !== null && (
            <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
              {localized(row.typeName, locale)}
            </span>
          )}
        </div>
      </td>
      {showBranch && (
        <td className={cn(CELL, 'whitespace-nowrap font-semibold', STRONG)}>
          {row.branch === null
            ? t('fleet.dash.now.table.noBranch')
            : localized(row.branch.name, locale)}
        </td>
      )}
      <td className={CELL}>
        {row.mission === null ? (
          <span className={MUTED}>—</span>
        ) : (
          <span className={cn(CHIP, 'inline-flex items-center py-1')}>
            {localized(row.mission, locale)}
          </span>
        )}
      </td>
      <td className={CELL}>
        {/* One tone for every class, as the KPI's tiles: no class is more urgent than another; the
            absent driver's line tells them apart. */}
        <div className={cn('whitespace-nowrap font-bold', STRONG)}>{t(CLASS_WORD[row.why])}</div>
        {row.absent !== null && (
          <div
            data-today-absent-driver="true"
            className={cn('mt-0.5 whitespace-nowrap text-xs font-semibold', MUTED)}
          >
            {name !== undefined && (
              <>
                {name}
                <Sep className="mx-1.5" />
              </>
            )}
            {t(`fleet.roster.reason.${row.absent.reason}`)}
          </div>
        )}
      </td>
      <td className={cn(CELL, 'text-end')}>
        <Btn link={links.rosterCar(row.code)} className="h-9 px-4">
          {t('fleet.dash.now.table.open')}
        </Btn>
      </td>
    </tr>
  );
};

const UnmannedTable = ({
  roster,
  links,
  scope,
  can,
}: {
  roster: Roster;
  links: NowLinks;
  scope: Scope;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const names = useFleetPeopleMap();
  // The car's branch is a column only while the figures cover more than one branch.
  const showBranch = scope !== 'branch';
  const more = roster.unmanned > roster.unmannedRows.length;
  const empty = roster.unmanned === 0;
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-today-card="unmanned-list">
      <ListHead
        icon={I.userX}
        tone="amber"
        title={t('fleet.dash.now.table.title')}
        note={t('fleet.dash.now.table.note')}
        chips={
          <span className={cn(COUNT_CHIP, TONE.amber.soft)}>
            <Phrase
              text={t('fleet.dash.now.table.chip')}
              parts={{ count: <N>{count(roster.unmanned)}</N>, noun: noun('car', roster.unmanned) }}
            />
          </span>
        }
        end={
          more ? (
            <ShowAll link={links.rosterUnmanned('roster.unmanned.all')} n={roster.unmanned} />
          ) : undefined
        }
      />
      {empty ? (
        <div
          data-today-empty="unmanned"
          className={cn(
            'flex flex-1 items-center justify-center gap-2.5 border-t px-5 py-8 text-[13px] font-semibold',
            RULE,
            MUTED,
          )}
        >
          <IconTile d={I.tick} tone="emerald" size="sm" />
          <span>{t('fleet.dash.now.table.empty')}</span>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start text-[13px]">
              <thead className={TH_ROW}>
                <tr className={cn('border-y', RULE)}>
                  <th className={th}>{t('fleet.dash.now.table.code')}</th>
                  {showBranch && <th className={th}>{t('fleet.dash.now.table.branch')}</th>}
                  <th className={th}>{t('fleet.dash.now.table.mission')}</th>
                  <th className={th}>{t('fleet.dash.now.table.reason')}</th>
                  <th className={cn(CELL, 'w-px py-2.5')}>
                    <span className="sr-only">{t('fleet.dash.now.table.open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className={DIVIDE}>
                {roster.unmannedRows.map((row) => (
                  <UnmannedRow
                    key={row.vehicleId}
                    row={row}
                    links={links}
                    showBranch={showBranch}
                    names={names}
                    can={can}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* The list's end: what the rows leave out, from the same read (readyManned). */}
          <div
            data-today-rest="true"
            className={cn(
              'flex flex-1 items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
              RULE,
              MUTED,
            )}
          >
            <IconTile d={I.tick} tone="emerald" size="sm" />
            <span>
              <Phrase
                text={t(REST_TEXT[scope])}
                parts={{
                  count: <N className={cn('font-bold', STRONG)}>{count(roster.readyManned)}</N>,
                  noun: noun('car', roster.readyManned),
                }}
              />
            </span>
          </div>
          <div className={cn('flex items-center border-t px-5 py-3.5', RULE)}>
            <FootLink link={links.rosterUnmanned('roster.unmanned.all')}>
              {t('fleet.dash.now.table.all')}
            </FootLink>
          </div>
        </>
      )}
    </Card>
  );
};

const AbsentList = ({
  roster,
  links,
  narrowed,
  can,
}: {
  roster: Roster;
  links: NowLinks;
  narrowed: boolean;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const names = useFleetPeopleMap();
  const total = roster.absent.attendance + roster.absent.leave;
  return (
    <Card data-today-card="absent-list">
      <ListHead
        icon={I.calendarX}
        tone="rose"
        title={t('fleet.dash.now.absentList.title')}
        note={t('fleet.dash.now.absentList.note')}
        chips={
          <>
            <span className={cn(COUNT_CHIP, TONE.rose.soft)}>
              <Counted n={total} noun="driver" />
            </span>
            <CompanyWide show={narrowed} />
          </>
        }
        end={total > 0 ? <ShowAll link={links.rosterAbsentAll()} n={total} /> : undefined}
      />
      {total === 0 ? (
        <div
          data-today-empty="absent"
          className={cn(
            'flex flex-1 items-center justify-center gap-2.5 border-t px-5 py-8 text-[13px] font-semibold',
            RULE,
            MUTED,
          )}
        >
          <IconTile d={I.tick} tone="emerald" size="sm" />
          <span>{t('fleet.dash.now.absentList.empty')}</span>
        </div>
      ) : (
        <ul className={cn('border-t', RULE, DIVIDE)}>
          {roster.absentDrivers.map((driver) => {
            const person = names.get(driver.employeeId);
            const name = person?.fullNameAr ?? '—';
            return (
              <li
                key={driver.employeeId}
                data-today-absent={driver.employeeId}
                className="flex items-center gap-3 px-5 py-2"
              >
                <DriverAvatar
                  name={name}
                  seed={person?.code ?? driver.employeeId}
                  muted={person === undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-[14px] font-bold', STRONG)}>{name}</div>
                  <div
                    className={cn(
                      'mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold',
                      MUTED,
                    )}
                  >
                    {person !== undefined && <N>{person.code}</N>}
                    {driver.crewVehicle !== null && (
                      <>
                        {person !== undefined && <Sep />}
                        {/* The chip stands taller than the line: its margin keeps every row one height. */}
                        <span data-today-crew-car="true" className="-my-0.5 whitespace-nowrap">
                          {t('fleet.dash.now.absentList.crewCar')}{' '}
                          <CarChip code={driver.crewVehicle.code} />
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Tag tone={REASON_TONE[driver.reason]}>
                  {t(`fleet.roster.reason.${driver.reason}`)}
                </Tag>
              </li>
            );
          })}
        </ul>
      )}
      <div
        className={cn(
          'mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-3.5',
          RULE,
        )}
      >
        {can('fleetAvailability.view') && (
          <>
            <FootLink link={links.attendance()}>{t('fleet.dash.now.attendanceSheet')}</FootLink>
            <Sep />
          </>
        )}
        <FootLink link={links.rosterUnavailableAll()}>
          {t('fleet.dash.now.absentList.unavailableLink')}
        </FootLink>
      </div>
    </Card>
  );
};

/** Side by side from 1366 px; below it the table's columns no longer fit, so the two lists stack. The
 *  absent list needs the drivers' names: without them the table takes the row alone. */
const Lists = ({
  roster,
  links,
  scope,
  can,
}: {
  roster: Roster;
  links: NowLinks;
  scope: Scope;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const names = can('fleetDriver.view');
  return (
    <div
      data-today-block="lists"
      className={cn(
        'mt-5 grid grid-cols-1 gap-5',
        names && 'min-[1366px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]',
      )}
    >
      <UnmannedTable roster={roster} links={links} scope={scope} can={can} />
      {names && (
        <AbsentList roster={roster} links={links} narrowed={scope !== 'company'} can={can} />
      )}
    </div>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

const Body = ({
  now,
  can,
  onRetry,
}: {
  now: FleetDashboardNowDto;
  can: (permission: string) => boolean;
  onRetry: () => void;
}): JSX.Element => {
  const links = nowLinks(now);
  const scope = scopeOf(now);
  const { roster } = now;
  return (
    <>
      {now.unavailable.includes('roster') && (
        <SectionError section="roster" onRetry={onRetry} className="mb-5" />
      )}
      {roster !== null && (
        <Card data-today-block="readiness" className="mb-5">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <ReadyHalf roster={roster} links={links} />
            <BalanceHalf roster={roster} links={links} scope={scope} />
          </div>
        </Card>
      )}
      <KpiRow now={now} links={links} can={can} onRetry={onRetry} />
      {roster !== null && <Lists roster={roster} links={links} scope={scope} can={can} />}
    </>
  );
};

export const TodayTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now } = props;
  return (
    <div data-dash-tab-body="today">
      <TabHead
        icon={I.truck}
        title={t('fleet.dash.now.title')}
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
      {now !== null && <Body now={now} can={props.can} onRetry={props.onRetry} />}
    </div>
  );
};
