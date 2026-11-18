// «نظرة عامة» — the dashboard's first tab, layout B as the owner approved it («دى اعتمدها» on
// approved/overview-B-dark.png; harness zz-overview.tsx `?layout=b`), drawn over the server's reads:
//
//   1  the heading — «N سيارة نشطة» (the registry's active cars), the live chip, the refresh tools
//   2  six KPI cards — readiness · without a driver today · in the workshop · urgent alerts · fuel
//      card balances · the custody fund (1 → 2 → 3 columns, six from 1700 px)
//   3  two columns (from xl): the action centre on the right — one row per alert line that fired,
//      red group above amber, every button «فتح» — and on the left the section hub (2 × 3), each line
//      opening the tab that shows the same figure, then «ملخص إحصائيات هذا الشهر» (2 × 2)
//
// THE MONTH CARD IS ITS OWN READ. R2 over «هذا الشهر» with NO page filter (`props.month`), so a period,
// type or codes chosen on another tab never move it; its links carry that read's own echo. The hub's
// tab links keep the page's filters (`props.tabLink`) and are plain when the reader cannot see the tab.
//
// NOTHING IS COUNTED HERE. Every figure is a field the server sent; the urgent count and the tallies
// count the alert LINES (`alertSummary`); the fuel total is the two balances the card names side by
// side; «خارج الجاهزية» is rows − ready. What has no data in the system (the design's «6+3», days of
// cover, in-kind custody, km cost, budget saving, hours, injuries, the urgent movement order) is not
// drawn. «الشركة كلها» marks the company-wide figures (the custody fund) while the rest are narrowed
// to the reader's branches (`scopeBranches !== null`); the fuel card balances follow the branch of
// each card's car, so they carry no such tag.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  type FleetDashboardNowDto,
  type FleetDashboardNowSection,
  type FleetDashboardPeriodSection,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import {
  custodyDashboardLink,
  echoTabFilters,
  nowLinks,
  periodLinks,
  type DashLink,
  type NowLinks,
} from '../../lib/fleet-dashboard-links';
import {
  alertSummary,
  leadIndex,
  sectionPermitted,
  share,
  shareText,
  slashDay,
  type AlertLine,
} from '../../lib/fleet-dashboard-tabs';
import {
  AMBER,
  BOX,
  BOX_HOVER,
  BTN,
  CAIRO,
  COMPANY,
  CarChip,
  Card,
  CardHead,
  CompanyWide,
  Fig,
  FootLink,
  HEAD_CHIP,
  I,
  Icon,
  IconTile,
  LINKED_TIGHT,
  LiveChip,
  MUTED,
  Meter,
  N,
  NOTE,
  RULE,
  STRONG,
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
  ReadError,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type DashNoun,
  type MonthRead,
  type NowTabProps,
} from './dash-shell';
import {
  Big,
  BigMoney,
  COUNT_CHIP,
  Counted,
  Kpi,
  Small,
  Tally,
  WORDS,
  monthName,
} from './dash-blocks';
import { ACTION_SECTIONS, useActionLine, type ActionView } from './tab-overview-actions';

/** The word of a key under the overview's own namespace. */
const useWords = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.overview.${key}`, params);
};

// ── 2 · The six KPI cards ─────────────────────────────────────────────────────────────────────

const KpiRow = ({
  props,
  links,
}: {
  props: NowTabProps;
  links: NowLinks | null;
}): JSX.Element | null => {
  const w = useWords();
  const t = useT();
  const noun = useNoun();
  const { now, custody, can } = props;
  const narrowed = now !== null && now.scopeBranches !== null;
  const failed = (section: FleetDashboardNowSection): boolean =>
    now?.unavailable.includes(section) === true;
  const cards: ReactNode[] = [];
  const roster = now?.roster ?? null;
  const workshop = now?.workshop ?? null;
  const fuel = now?.fuelCharging ?? null;

  // R1 on its way: its cards in grey, each in its place, beside the custody card (another read).
  if (props.nowPending?.state === 'loading') {
    const r1Cards = [
      ...(sectionPermitted('roster', can) ? ['readiness', 'unmanned'] : []),
      ...(sectionPermitted('workshop', can) ? ['workshop'] : []),
      ...(ACTION_SECTIONS.some((section) => sectionPermitted(section, can)) ? ['urgent'] : []),
      ...(sectionPermitted('fuelCharging', can) ? ['fuel'] : []),
    ];
    for (const id of r1Cards) {
      cards.push(
        <div key={id} data-dash-loading="true" data-dash-kpi-loading={id}>
          <Skeleton className="h-44 rounded-2xl" />
        </div>,
      );
    }
  }

  if (failed('roster'))
    cards.push(<SectionError key="roster" section="roster" onRetry={props.onRetry} />);
  if (roster !== null && links !== null) {
    const out = roster.rows - roster.ready;
    const toToday = props.tabLink('today', 'roster.tab');
    cards.push(
      <Kpi
        key="readiness"
        id="readiness"
        tone="sky"
        icon={I.check}
        title={w('kpi.readiness.title')}
        tag={
          <Tag tone="emerald" dot>
            <Phrase
              text={w('kpi.readiness.tag')}
              parts={{ share: <N>{shareText(roster.ready, roster.rows)}</N> }}
            />
          </Tag>
        }
        figure={
          <>
            <Big link={links.rosterReady()}>{count(roster.ready)}</Big>
            <span className={WORDS}>
              <Phrase
                text={w('kpi.readiness.of')}
                parts={{ count: <N>{count(roster.rows)}</N>, noun: noun('car', roster.rows) }}
              />
            </span>
          </>
        }
        sub={
          <Meter
            className="w-full"
            parts={[{ pct: share(roster.ready, roster.rows) ?? 0, tone: 'sky' }]}
          />
        }
        footIcon={I.warn}
        footTone={out > 0 ? 'amber' : undefined}
        foot={
          <Phrase
            text={w('kpi.readiness.out')}
            parts={{ count: <N>{count(out)}</N>, noun: noun('car', out) }}
          />
        }
      />,
    );
    cards.push(
      <Kpi
        key="unmanned"
        id="unmanned"
        tone="amber"
        icon={I.userX}
        title={w('kpi.unmanned.title')}
        tag={
          roster.unmanned > 0 ? (
            <Tag tone="amber" dot>
              {w('kpi.unmanned.tag')}
            </Tag>
          ) : (
            <Tag tone="emerald" dot>
              {w('kpi.unmanned.clear')}
            </Tag>
          )
        }
        figure={
          <>
            <Big link={links.rosterUnmanned()} className="!text-amber-600 dark:!text-amber-400">
              {count(roster.unmanned)}
            </Big>
            <span className={WORDS}>
              {w('kpi.unmanned.unit', { noun: noun('car', roster.unmanned) })}
            </span>
          </>
        }
        sub={
          <span className={MUTED}>
            <Phrase
              text={w('kpi.unmanned.of')}
              parts={{
                count: <N className={cn('font-bold', STRONG)}>{count(roster.ready)}</N>,
                noun: noun('car', roster.ready),
              }}
            />
          </span>
        }
        // No figure of its own: the tab whose table names each car and why (the approved card
        // draws a foot band on all six).
        {...(toToday === null
          ? {}
          : { foot: <FootLink link={toToday}>{w('kpi.unmanned.open')}</FootLink> })}
      />,
    );
  }

  if (failed('workshop'))
    cards.push(<SectionError key="workshop" section="workshop" onRetry={props.onRetry} />);
  if (workshop !== null && links !== null) {
    const oldest = workshop.oldest;
    cards.push(
      <Kpi
        key="workshop"
        id="workshop"
        tone="amber"
        icon={I.wrench}
        title={w('kpi.workshop.title')}
        figure={
          <>
            <Big link={links.workshopOpen()}>{count(workshop.open)}</Big>
            <span className={WORDS}>
              {w('kpi.workshop.unit', { noun: noun('car', workshop.open) })}
            </span>
          </>
        }
        sub={
          oldest === null ? undefined : (
            <span className={cn('flex items-center gap-1 whitespace-nowrap', MUTED)}>
              {w('kpi.workshop.oldest')}
              {/* The car's file is the vehicles screen's (fleetVehicle.view), not this section's
                  (fleetMaintenance.view): a link only with its own guard. */}
              <CarChip
                code={oldest.code}
                link={
                  oldest.vehicleId === null || oldest.deleted || !can('fleetVehicle.view')
                    ? null
                    : links.vehicle(oldest.vehicleId, 'workshop.oldest')
                }
              />
              <span className={cn('font-bold', AMBER)}>
                {oldest.days === 0 ? (
                  t('fleet.dash.common.sinceToday')
                ) : (
                  <Phrase
                    text={t('fleet.dash.common.since')}
                    parts={{ count: <N>{count(oldest.days)}</N>, noun: noun('day', oldest.days) }}
                  />
                )}
              </span>
            </span>
          )
        }
        footIcon={I.cog}
        foot={
          // The parts add up to the headline: «مكهنة» and «بلا سيارة في السجل» (a car deleted since,
          // or an old-book visit) join «نشطة · خارج الخدمة» only when they hold a visit. Plain: the
          // maintenance screen reads no vehicle-status parameter.
          <span data-dash-workshop-split="true">
            <Phrase
              text={w('kpi.workshop.split')}
              parts={{
                active: <N>{count(workshop.openActive)}</N>,
                out: <N>{count(workshop.openOutOfService)}</N>,
              }}
            />
            {workshop.openDisposed > 0 && (
              <>
                {' · '}
                <span className="whitespace-nowrap">
                  {t('fleet.dash.now.statusDisposed')} <N>{count(workshop.openDisposed)}</N>
                </span>
              </>
            )}
            {workshop.openNoCar > 0 && (
              <>
                {' · '}
                <span className="whitespace-nowrap">
                  {t('fleet.dash.now.statusNoCar')} <N>{count(workshop.openNoCar)}</N>
                </span>
              </>
            )}
          </span>
        }
      />,
    );
  }

  // The urgent card counts the red LINES (as the action centre's tallies do) — shown while any R1
  // source of a line is there to fire.
  if (now !== null && ACTION_SECTIONS.some((section) => now[section] !== null)) {
    const summary = alertSummary(props.lines);
    cards.push(
      <Kpi
        key="urgent"
        id="urgent"
        tone="red"
        icon={I.warn}
        title={w('kpi.urgent.title')}
        figure={
          <>
            <Big className={summary.red > 0 ? '!text-red-600 dark:!text-red-400' : undefined}>
              {count(summary.red)}
            </Big>
            <span className={WORDS}>{noun('alert', summary.red)}</span>
          </>
        }
        footIcon={I.bell}
        foot={
          <Phrase
            text={w('kpi.urgent.of')}
            parts={{
              count: <N className={cn('font-bold', STRONG)}>{count(summary.total)}</N>,
              noun: noun('alert', summary.total),
            }}
          />
        }
      />,
    );
  }

  if (failed('fuelCharging'))
    cards.push(<SectionError key="fuel" section="fuelCharging" onRetry={props.onRetry} />);
  if (fuel !== null && links !== null) {
    const part = (company: 'wataniya' | 'chillout'): JSX.Element => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', COMPANY[company].dot)} />
        {w(`kpi.fuel.${company}`)}
        <Fig link={links.chargingCompany(company)} className={cn('font-bold', STRONG)}>
          <Amount value={fuel[company]} />
        </Fig>
      </span>
    );
    cards.push(
      <Kpi
        key="fuel"
        id="fuel"
        tone="emerald"
        icon={I.fuel}
        title={w('kpi.fuel.title')}
        // The two balances the card names side by side, added for the headline (display only).
        figure={<BigMoney value={fuel.wataniya + fuel.chillout} />}
        sub={
          <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-0.5', MUTED)}>
            {part('wataniya')}
            {part('chillout')}
          </span>
        }
        footIcon={I.card}
        foot={
          <Phrase
            text={w('kpi.fuel.cards')}
            parts={{ count: <N>{count(fuel.cards)}</N>, noun: noun('card', fuel.cards) }}
          />
        }
      />,
    );
  }

  if (custody !== null) {
    if (custody.error && custody.fundTotal === null) {
      cards.push(<SectionError key="custody" section="custodyFund" onRetry={custody.refetch} />);
    } else {
      cards.push(
        <Kpi
          key="custody"
          id="custody"
          tone="slate"
          icon={I.wallet}
          title={w('kpi.custody.title')}
          tag={<CompanyWide show={narrowed} />}
          figure={
            custody.fundTotal === null ? (
              <span className={cn('text-[34px] font-black leading-none', MUTED)}>—</span>
            ) : (
              <BigMoney
                value={custody.fundTotal}
                link={custodyDashboardLink('custodyFund.total')}
                className={custody.fundTotal < 0 ? '!text-red-600 dark:!text-red-400' : undefined}
              />
            )
          }
          foot={
            <FootLink link={custodyDashboardLink('custodyFund.dashboard')}>
              {w('kpi.custody.open')}
            </FootLink>
          }
        />,
      );
    }
  }

  if (cards.length === 0) return null;
  return (
    <div
      data-dash-block="kpis"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1700px]:grid-cols-6"
    >
      {cards}
    </div>
  );
};

// ── 3 · The action centre ─────────────────────────────────────────────────────────────────────

/**
 * Icon · words · count chip · «فتح». Below `sm` the chip and the button go under the words; from
 * `sm` they are the row's last two cells (the wrapper is `contents`), a step narrower below 1536 px.
 */
const ROW_GRID = cn(
  'grid items-center gap-x-3.5 gap-y-2',
  'grid-cols-[32px_minmax(0,1fr)] sm:grid-cols-[32px_minmax(0,1fr)_80px_112px] min-[1536px]:grid-cols-[32px_minmax(0,1fr)_88px_120px]',
);

const ActionRow = ({ line, view }: { line: AlertLine; view: ActionView }): JSX.Element => {
  const w = useWords();
  const tone: Tone = line.level === 'red' ? 'red' : 'amber';
  return (
    <article
      data-dash-action={line.id}
      data-dash-action-count={line.count}
      className={cn(BOX, BOX_HOVER, TONE[tone].accent, ROW_GRID, 'min-h-[64px] px-4 py-2.5')}
    >
      <IconTile d={view.icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <p
          className={cn(
            'flex flex-wrap items-center gap-x-2 text-balance text-[14px] font-bold leading-6 text-slate-800 dark:text-slate-100',
            CAIRO,
          )}
        >
          <span>{view.title}</span>
          <CompanyWide show={view.companyWide} />
        </p>
        {view.sub !== null && (
          <p className={cn('mt-0.5 text-balance text-[12.5px] leading-6', MUTED)}>{view.sub}</p>
        )}
      </div>
      <div className="col-start-2 flex items-center gap-2 sm:contents">
        <span className={cn(COUNT_CHIP, 'h-7 justify-center', TONE[tone].soft)}>
          <Counted n={view.count} noun={view.noun} />
        </span>
        {view.link !== null && (
          <Link
            to={view.link.to}
            data-metric={view.link.metric}
            data-dash-action-open={line.id}
            className={cn(BTN.soft, 'h-9 sm:w-full')}
          >
            {w('actions.open')}
            <Icon d={I.arrow} className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </article>
  );
};

const ActionGroup = ({
  level,
  rows,
}: {
  level: 'red' | 'orange';
  rows: readonly { line: AlertLine; view: ActionView }[];
}): JSX.Element | null => {
  const w = useWords();
  if (rows.length === 0) return null;
  const tone: Tone = level === 'red' ? 'red' : 'amber';
  return (
    <section data-dash-action-group={tone} className="flex min-w-0 flex-col">
      <div className="mb-3 border-b border-slate-200 pb-2.5 dark:border-[#1c263b]">
        <h4 className={cn(TITLE, 'flex items-center gap-2')}>
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
          />
          {w(`actions.group.${tone}`)}
        </h4>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ line, view }) => (
          <ActionRow key={line.id} line={line} view={view} />
        ))}
      </div>
    </section>
  );
};

const ActionCentre = ({ props }: { props: NowTabProps }): JSX.Element => {
  const w = useWords();
  const view = useActionLine(props.can);
  const { now, custody } = props;
  // A source that FAILED gives no line: say which, with its retry — never the all-clear over it.
  const failed = ACTION_SECTIONS.filter((section) => now?.unavailable.includes(section) === true);
  const custodyFailed = custody?.error === true;
  const rows = props.lines.flatMap((line) => {
    const shown = view(line, now, custody);
    return shown === null ? [] : [{ line, view: shown }];
  });
  const tally = alertSummary(rows.map((row) => row.line));
  // R1 failed (the tab says so above): its lines are unknown, so never the all-clear either.
  const quiet = failed.length === 0 && !custodyFailed && props.nowPending === undefined;
  return (
    <Card data-dash-block="actions">
      <div
        className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4', RULE)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <IconTile d={I.bell} tone="red" />
          <div className="min-w-0">
            <h3 className={TITLE}>{w('actions.title')}</h3>
            <p className={cn('mt-0.5', NOTE)}>{w('actions.sub')}</p>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2">
            <Tally tone="red" label={w('actions.urgent')} n={tally.red} />
            <Tally tone="amber" label={w('actions.follow')} n={tally.orange} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-6 p-5">
        {!quiet && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {failed.map((section) => (
              <SectionError key={section} section={section} onRetry={props.onRetry} />
            ))}
            {custodyFailed && custody !== null && (
              <SectionError section="custodyFund" onRetry={custody.refetch} />
            )}
          </div>
        )}
        {rows.length === 0 ? (
          quiet && (
            <div
              data-dash-actions-none="true"
              className="flex flex-col items-center gap-2 px-6 py-10 text-center"
            >
              <IconTile d={I.check} tone="emerald" />
              <p className={TITLE}>{w('actions.none.title')}</p>
              <p className={cn('text-[13px]', MUTED)}>{w('actions.none.note')}</p>
            </div>
          )
        ) : (
          <>
            <ActionGroup level="red" rows={rows.filter((row) => row.line.level === 'red')} />
            <ActionGroup level="orange" rows={rows.filter((row) => row.line.level === 'orange')} />
          </>
        )}
      </div>
    </Card>
  );
};

// ── 4 · «مؤشرات الأقسام والأبواب التشغيلية» ──────────────────────────────────────────────────

interface HubLine {
  id: string;
  label: ReactNode;
  value: ReactNode;
}
interface HubCard {
  id: string;
  title: string;
  icon: IconPath;
  tone: Tone;
  lines: HubLine[];
  /** «عرض التفاصيل» — the tab behind the card; `null` when the reader cannot see it. */
  foot: DashLink | null;
}

/** A hub figure: the number in its tone, opening its tab (or list), then its counted noun. */
const HubFigure = ({
  n,
  noun,
  link,
  tone,
}: {
  n: number;
  noun?: DashNoun;
  link: DashLink | null;
  tone?: Tone;
}): JSX.Element => (
  <>
    <Small link={link} className={tone === undefined ? STRONG : TONE[tone].text}>
      {count(n)}
    </Small>
    {noun !== undefined && <HubNoun noun={noun} n={n} tone={tone} />}
  </>
);
const HubNoun = ({ noun, n, tone }: { noun: DashNoun; n: number; tone?: Tone | undefined }) => {
  const word = useNoun();
  return <span className={tone === undefined ? STRONG : TONE[tone].text}> {word(noun, n)}</span>;
};

/** A month line whose read is on its way or failed: «—» in the figure's place (the month card says
 *  why, with its retry), so the hub keeps its shape. */
const HubPending = (): JSX.Element => (
  <span data-dash-hub-pending="true" className={MUTED}>
    —
  </span>
);

/**
 * A hub line fed by the month read: drawn with its figure, drawn as «—» while that read is on its
 * way or failed (or its section failed), or not drawn — no period key, or a section this reader
 * may not see.
 */
const monthLine = (
  month: MonthRead,
  section: 'accidents' | 'opex',
  can: (permission: string) => boolean,
): 'shown' | 'pending' | 'hidden' => {
  if (!month.enabled) return 'hidden';
  const data = month.data;
  if (data === undefined) return sectionPermitted(section, can) ? 'pending' : 'hidden';
  if (data.unavailable.includes(section)) return 'pending';
  return data[section] === null ? 'hidden' : 'shown';
};

const useHubCards = (props: NowTabProps, links: NowLinks | null): HubCard[] => {
  const w = useWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { now, tabLink } = props;
  const month = props.month.enabled ? props.month.data : undefined;
  const cards: HubCard[] = [];
  const line = (id: string, label: ReactNode, value: ReactNode): HubLine => ({ id, label, value });

  // «الحركة اليوم» — the figures «الحركة اليوم» shows.
  const movement: HubLine[] = [];
  if (now?.vehicles != null) {
    movement.push(
      line(
        'active',
        w('hub.movement.active'),
        <HubFigure n={now.vehicles.active} link={tabLink('today', 'vehicles.tab')} />,
      ),
    );
  }
  if (now?.roster != null) {
    movement.push(
      line(
        'readyManned',
        w('hub.movement.readyManned'),
        <HubFigure
          n={now.roster.readyManned}
          link={tabLink('today', 'roster.tab')}
          tone="emerald"
        />,
      ),
    );
  }
  cards.push({
    id: 'movement',
    title: w('hub.movement.title'),
    icon: I.truck,
    tone: 'sky',
    lines: movement,
    foot: tabLink('today', 'roster.tab'),
  });

  // «توزيع السيارات» — the company (or «كل فروعي»): the branches and the largest; ONE branch in
  // scope: the branch's active cars and its largest type.
  const distribution: HubLine[] = [];
  const dv = now?.distributionVehicles ?? null;
  if (dv !== null) {
    const toTab = tabLink('distribution', 'distributionVehicles.tab');
    const oneBranch = now?.scopeBranches != null && now.scopeBranches.length === 1;
    if (oneBranch) {
      distribution.push(
        line(
          'branchActive',
          w('hub.distribution.branchActive'),
          <HubFigure n={dv.totals.total} link={toTab} />,
        ),
      );
      const lead = leadIndex(dv.rows.map((row) => row.total));
      const type = lead < 0 ? undefined : dv.rows[lead];
      if (type !== undefined) {
        distribution.push(
          line(
            'biggestType',
            w('hub.distribution.biggestType', { name: localized(type.name, locale) }),
            <HubFigure n={type.total} noun="car" link={toTab} />,
          ),
        );
      }
    } else {
      distribution.push(
        line(
          'branches',
          w('hub.distribution.branches'),
          <HubFigure n={dv.branchCount} noun="branch" link={toTab} />,
        ),
      );
      const values = dv.branches.map((branch) => dv.totals.counts[branch.id] ?? 0);
      const lead = leadIndex(values);
      const branch = lead < 0 ? undefined : dv.branches[lead];
      if (dv.branchCount >= 2 && branch !== undefined) {
        distribution.push(
          line(
            'biggestBranch',
            localized(branch.name, locale),
            <HubFigure n={values[lead] ?? 0} noun="car" link={toTab} />,
          ),
        );
      }
    }
  }
  cards.push({
    id: 'distribution',
    title: w('hub.distribution.title'),
    icon: I.pin,
    tone: 'blue',
    lines: distribution,
    foot: tabLink('distribution', 'distributionVehicles.tab'),
  });

  // «الصيانة والورش» — the workshop and the red alarm, both shown on the «الصيانة والورش» tab (its
  // «الآن» band), which the two lines and the foot open.
  const maintenance: HubLine[] = [];
  if (now?.workshop != null) {
    maintenance.push(
      line(
        'workshop',
        w('hub.maintenance.open'),
        <HubFigure
          n={now.workshop.open}
          noun="car"
          link={tabLink('maintenance', 'workshop.tab')}
        />,
      ),
    );
  }
  if (now?.maintenanceAlarm != null) {
    maintenance.push(
      line(
        'alarm',
        w('hub.maintenance.red'),
        <HubFigure
          n={now.maintenanceAlarm.red}
          noun="car"
          tone="red"
          link={tabLink('maintenance', 'maintenanceAlarm.tab')}
        />,
      ),
    );
  }
  cards.push({
    id: 'maintenance',
    title: w('hub.maintenance.title'),
    icon: I.wrench,
    tone: 'amber',
    lines: maintenance,
    foot: tabLink('maintenance', 'workshop.tab'),
  });

  // «الحوادث والمخالفات» — the month's accidents (the tab «الحوادث ومطالبات التأمين», opened on the
  // month read's own slice — «هذا الشهر», no type or codes — so it shows this number), every fine
  // still owed (the tab «المخالفات المرورية والتسويات», whose «إجمالي المخالفات القائمة» is every
  // year's owed total — this number).
  const incidents: HubLine[] = [];
  const accidentsLine = monthLine(props.month, 'accidents', props.can);
  if (accidentsLine === 'pending') {
    incidents.push(line('accidents', w('hub.incidents.accidents'), <HubPending />));
  } else if (month?.accidents != null) {
    incidents.push(
      line(
        'accidents',
        w('hub.incidents.accidents'),
        <HubFigure
          n={month.accidents.count}
          noun="accident"
          tone="red"
          link={tabLink('accidents', 'accidents.month', echoTabFilters(month))}
        />,
      ),
    );
  }
  if (now?.violationsOpen != null && links !== null) {
    incidents.push(
      line(
        'violations',
        w('hub.incidents.violations'),
        <HubFigure
          n={now.violationsOpen.total.count}
          noun="violation"
          link={tabLink('violations', 'violationsOpen.tab')}
        />,
      ),
    );
  }
  cards.push({
    id: 'incidents',
    title: w('hub.incidents.title'),
    icon: I.warn,
    tone: 'rose',
    lines: incidents,
    foot: tabLink('accidents', 'accidents.tab'),
  });

  // «الوقود والمصروفات» — the month's fuel receipts: the tab «الوقود والمصروفات», opened on the
  // month read's own slice — «هذا الشهر», no type or codes — so its «الوقود كله» is this number.
  const fuel: HubLine[] = [];
  if (monthLine(props.month, 'opex', props.can) === 'pending') {
    fuel.push(line('fuelSpend', w('hub.fuel.spend'), <HubPending />));
  } else if (month?.opex != null) {
    fuel.push(
      line(
        'fuelSpend',
        w('hub.fuel.spend'),
        <Fig
          link={tabLink('fuel', 'opex.fuel.month', echoTabFilters(month))}
          className={cn('font-bold', STRONG)}
        >
          <Amount value={month.opex.fuel} />
        </Fig>,
      ),
    );
  }
  cards.push({
    id: 'fuel',
    title: w('hub.fuel.title'),
    icon: I.fuel,
    tone: 'emerald',
    lines: fuel,
    foot: tabLink('fuel', 'opex.tab'),
  });

  // «العهدة والتراخيص» — the cars whose licence runs out soon (the licences tab).
  const licences: HubLine[] = [];
  if (now?.licenceVehicles != null) {
    licences.push(
      line(
        'expiring',
        w('hub.custodyLicences.expiring'),
        <HubFigure
          n={now.licenceVehicles.expiring}
          noun="car"
          tone="amber"
          link={tabLink('licences', 'licenceVehicles.tab')}
        />,
      ),
    );
  }
  cards.push({
    id: 'custodyLicences',
    title: w('hub.custodyLicences.title'),
    icon: I.shield,
    tone: 'violet',
    lines: licences,
    foot: tabLink('licences', 'licenceVehicles.tab'),
  });

  // A card with no line left is not drawn.
  return cards.filter((card) => card.lines.length > 0);
};

const HubTile = ({ card }: { card: HubCard }): JSX.Element => {
  const w = useWords();
  return (
    <div
      data-dash-hub={card.id}
      className={cn(BOX, BOX_HOVER, 'flex min-w-0 flex-col px-4 pb-3.5 pt-4')}
    >
      <div className="flex items-center gap-2.5">
        <IconTile d={card.icon} tone={card.tone} size="sm" />
        {/* A title may wrap where the two-column layout begins (xl): never into the padding. */}
        <h4 className={cn(TITLE, 'min-w-0 text-balance text-[15px]')}>{card.title}</h4>
      </div>
      <dl className="mt-3.5 space-y-2 text-[13px]">
        {card.lines.map((row) => (
          // Label and value side by side while they fit; the value moves under the label (never
          // the label breaking beside it) on a narrow tile.
          <div
            key={row.id}
            data-dash-hub-line={row.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <dt className={cn('whitespace-nowrap font-semibold', MUTED)}>{row.label}</dt>
            <dd className="ms-auto whitespace-nowrap font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
      {card.foot !== null && (
        <div className="mt-auto pt-3.5">
          <div data-dash-hub-foot={card.id} className={cn('flex border-t pt-3', RULE)}>
            <FootLink link={card.foot}>{w('hub.details')}</FootLink>
          </div>
        </div>
      )}
    </div>
  );
};

const Hub = ({ cards }: { cards: readonly HubCard[] }): JSX.Element => {
  const w = useWords();
  return (
    <Card data-dash-block="hub">
      <div className="px-5 pb-5 pt-4">
        <CardHead
          dot={null}
          className="mb-4 items-center"
          title={
            <>
              <IconTile d={I.layers} tone="brand" size="sm" />
              {w('hub.title')}
            </>
          }
          end={<span className={cn('text-xs font-semibold', MUTED)}>{w('hub.aside')}</span>}
        />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {cards.map((card) => (
            <HubTile key={card.id} card={card} />
          ))}
        </div>
      </div>
    </Card>
  );
};

// ── 5 · «ملخص إحصائيات هذا الشهر» ─────────────────────────────────────────────────────────────

const MONTH_FIG = cn(
  'text-[26px] font-black leading-none tracking-tight text-slate-900 dark:text-white',
  CAIRO,
);

/** The month card's four figures; the page asks for the month read only for a reader of one. */
export const MONTH_SECTIONS = [
  'km',
  'opex',
  'exits',
  'accidents',
] as const satisfies readonly FleetDashboardPeriodSection[];

/** What the month card is: not asked, on its way, failed with nothing to show, or shown. */
const monthState = (month: MonthRead): 'hidden' | 'loading' | 'failed' | 'shown' => {
  if (!month.enabled) return 'hidden';
  const data = month.data;
  if (data === undefined) return month.failed ? 'failed' : 'loading';
  return MONTH_SECTIONS.some(
    (section) => data[section] !== null || data.unavailable.includes(section),
  )
    ? 'shown'
    : 'hidden';
};

const MonthTitle = ({ chip }: { chip: ReactNode }): JSX.Element => {
  const w = useWords();
  return (
    <div className="flex min-w-0 items-start gap-3">
      <IconTile d={I.calendar} tone="brand" />
      <div className="min-w-0">
        <h3 className={cn(TITLE, 'flex flex-wrap items-center gap-2')}>
          {w('month.title')}
          {chip}
        </h3>
        <p className={cn('mt-1 text-balance leading-5', NOTE)}>{w('month.sub')}</p>
      </div>
    </div>
  );
};

const Stat = ({
  id,
  icon,
  tone,
  label,
  figure,
  line,
}: {
  id: string;
  icon: IconPath;
  tone: Tone;
  label: string;
  figure: ReactNode;
  line?: ReactNode;
}): JSX.Element => (
  <div data-dash-month-stat={id} className={cn(BOX, 'flex h-full min-w-0 flex-col px-4 py-4')}>
    <div className="flex items-center gap-2">
      <IconTile d={icon} tone={tone} size="sm" />
      <span className="whitespace-nowrap text-[13px] font-bold text-slate-700 dark:font-semibold dark:text-slate-300">
        {label}
      </span>
    </div>
    <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">{figure}</div>
    <div className={cn('mt-2.5 min-h-5 text-xs font-semibold leading-5', MUTED)}>{line}</div>
  </div>
);

const MonthCard = ({ month }: { month: MonthRead }): JSX.Element | null => {
  const w = useWords();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const state = monthState(month);
  if (state === 'hidden') return null;
  if (state === 'failed') return <SectionError section="month" onRetry={month.onRetry} />;
  const data = month.data;
  if (state === 'loading' || data === undefined) {
    return (
      <Card data-dash-block="month" data-dash-month-loading="true" className="flex-1">
        <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
          <div className="mb-4">
            <MonthTitle chip={null} />
          </div>
          <div className="grid flex-1 grid-cols-1 gap-3.5 sm:grid-cols-2">
            {MONTH_SECTIONS.map((section) => (
              <Skeleton key={section} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      </Card>
    );
  }
  // Every link carries THIS read's own echo — the month and no page filter.
  const links = periodLinks(data);
  const stats: ReactNode[] = [];
  // Each figure in its place; one whose section failed shows its error and the retry there.
  const failed = (section: (typeof MONTH_SECTIONS)[number]): boolean => {
    if (!data.unavailable.includes(section)) return false;
    stats.push(<SectionError key={section} section={section} onRetry={month.onRetry} />);
    return true;
  };
  if (!failed('km') && data.km !== null) {
    stats.push(
      <Stat
        key="km"
        id="km"
        icon={I.gauge}
        tone="sky"
        label={w('month.km')}
        figure={
          <>
            <Fig link={links.km()} className={cn(MONTH_FIG, 'tabular-nums')}>
              <span dir="ltr">{count(data.km.total)}</span>
            </Fig>
            <span className={WORDS}>{w('month.kmUnit')}</span>
          </>
        }
      />,
    );
  }
  if (!failed('opex') && data.opex !== null) {
    const dataFrom = data.opex.dataFrom;
    stats.push(
      <Stat
        key="opex"
        id="opex"
        icon={I.cash}
        tone="emerald"
        label={w('month.opex')}
        figure={
          <span className={cn(MONTH_FIG, 'tabular-nums')}>
            <Fig link={links.opex()}>
              <Amount value={data.opex.total} className="!font-[inherit]" />
            </Fig>
          </span>
        }
        line={
          dataFrom !== null && data.range.from < dataFrom ? (
            <span data-data-from={dataFrom} className={AMBER}>
              <Phrase text={w('month.dataFrom')} parts={{ day: <N>{slashDay(dataFrom)}</N> }} />
            </span>
          ) : undefined
        }
      />,
    );
  }
  if (!failed('exits') && data.exits !== null) {
    stats.push(
      <Stat
        key="visits"
        id="visits"
        icon={I.wrench}
        tone="amber"
        label={w('month.visits')}
        figure={
          <>
            <Fig link={links.exits()} className={cn(MONTH_FIG, 'tabular-nums')}>
              <span dir="ltr">{count(data.exits.count)}</span>
            </Fig>
            <span className={WORDS}>{noun('visit', data.exits.count)}</span>
          </>
        }
        line={w('month.visitsBasis')}
      />,
    );
  }
  if (!failed('accidents') && data.accidents !== null) {
    stats.push(
      <Stat
        key="accidents"
        id="accidents"
        icon={I.warn}
        tone="red"
        label={w('month.accidents')}
        figure={
          <>
            <Fig link={links.accidents()} className={cn(MONTH_FIG, 'tabular-nums')}>
              <span dir="ltr">{count(data.accidents.count)}</span>
            </Fig>
            <span className={WORDS}>{noun('accident', data.accidents.count)}</span>
          </>
        }
      />,
    );
  }
  return (
    <Card data-dash-block="month" className="flex-1">
      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <div className="mb-4">
          <MonthTitle
            chip={
              <span data-dash-month={data.range.from.slice(0, 7)} className={HEAD_CHIP}>
                {monthName(data.range.from, locale)} <N>{data.range.from.slice(0, 4)}</N>
              </span>
            }
          />
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3.5 sm:grid-cols-2">{stats}</div>
      </div>
    </Card>
  );
};

// ── 1 · The heading, and the tab ──────────────────────────────────────────────────────────────

/** «138 سيارة نشطة» — the registry's active cars, beside the title. */
const ActiveChip = ({
  now,
  links,
}: {
  now: FleetDashboardNowDto | null;
  links: NowLinks | null;
}): JSX.Element | null => {
  const w = useWords();
  const noun = useNoun();
  const vehicles = now?.vehicles ?? null;
  if (vehicles === null || links === null) return null;
  return (
    <span data-dash-active-chip="true" className={HEAD_CHIP}>
      <Phrase
        text={w('activeChip')}
        parts={{
          count: (
            <Fig link={links.vehiclesActive()} linkedClassName={LINKED_TIGHT}>
              <N>{count(vehicles.active)}</N>
            </Fig>
          ),
          noun: noun('car', vehicles.active),
        }}
      />
    </span>
  );
};

/**
 * What stands in the action centre's place: the card while a source of a line is there (or failed)
 * — R1's, or custody's; R1 on its way: its shape in grey; R1 failed: the card only for the custody
 * rows (or custody's own error), never an all-clear over the R1 lines nobody could read.
 */
const actionsPlace = (props: NowTabProps): 'card' | 'loading' | null => {
  const { now, custody, nowPending } = props;
  if (nowPending?.state === 'loading') {
    const r1 = ACTION_SECTIONS.some((section) => sectionPermitted(section, props.can));
    return custody !== null || r1 ? 'loading' : null;
  }
  if (nowPending?.state === 'error') {
    return custody !== null && (props.lines.length > 0 || custody.error) ? 'card' : null;
  }
  const r1 =
    now !== null &&
    ACTION_SECTIONS.some((section) => now[section] !== null || now.unavailable.includes(section));
  return custody !== null || r1 ? 'card' : null;
};

export const OverviewTab = (props: NowTabProps): JSX.Element => {
  const w = useWords();
  const { now } = props;
  const pending = props.nowPending;
  const links = now === null ? null : nowLinks(now);
  const hub = useHubCards(props, links);
  const actions = actionsPlace(props);
  const month = monthState(props.month) !== 'hidden';
  const side = hub.length > 0 || month;
  return (
    <div data-dash-tab-body="overview">
      <TabHead
        icon={I.grid}
        title={w('title')}
        live={false}
        chips={
          <>
            <ActiveChip now={now} links={links} />
            <LiveChip variant="overview" />
          </>
        }
        sub={w('sub')}
        end={
          <RefreshTools
            updatedAt={props.updatedAt}
            onRefresh={props.onRefresh}
            refreshing={props.refreshing}
            {...(props.clock === undefined ? {} : { clock: props.clock })}
          />
        }
      />
      <div className="space-y-5">
        {/* R1 failed: its error and retry in place of its cards and lines; the month card, the
            month's hub lines and the custody parts are other reads and still stand. */}
        {pending?.state === 'error' && <ReadError error={pending.error} onRetry={props.onRetry} />}
        <KpiRow props={props} links={links} />
        {(actions !== null || side) && (
          <div
            data-dash-columns="true"
            className={cn(
              'grid grid-cols-1 gap-5',
              actions !== null && side && 'xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]',
            )}
          >
            {actions === 'card' && <ActionCentre props={props} />}
            {actions === 'loading' && (
              <div data-dash-loading="true" data-dash-actions-loading="true">
                <Skeleton className="h-[420px] rounded-2xl" />
              </div>
            )}
            {side && (
              <div data-dash-side="true" className="flex min-w-0 flex-col gap-5">
                {hub.length > 0 && <Hub cards={hub} />}
                <MonthCard month={props.month} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
