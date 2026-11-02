// Tab 1 «التنبيهات» — the approved v2 sample (zz-fleetdash-v2-alerts.tsx) over the server's alert
// lines (T1.1–T1.12, plan §2.1). Red lines first, then the orange ones; each line has its count, a
// short sentence, its sub-lines, the figure box and the buttons that open its screen.
//
// Every number is the server's: the line's count (`alerts`), its section's parts, and the custody
// line's count from the custody screen's own banner (D3). The chips count LINES (`alertSummary`), as
// the bar's badge does. No supply-contract line (Phase 2), no receipt-audit part (D3), no Q marker.
import { Fragment, useState, type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_TAB_SECTIONS,
  type FleetDashboardNowDto,
  type FleetDashboardNowSection,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import {
  custodyDashboardLink,
  nowLinks,
  type DashLink,
  type NowLinks,
} from '../../lib/fleet-dashboard-links';
import {
  alertSummary,
  earliestDay,
  slashDay,
  type AlertCategory,
  type AlertLine,
} from '../../lib/fleet-dashboard-tabs';
import {
  BTN,
  CAIRO,
  CarChip,
  CompanyWide,
  Count,
  Fig,
  I,
  Icon,
  IconTile,
  MUTED,
  N,
  NUM,
  RED,
  SEG,
  STRONG,
  SURFACE,
  TITLE,
  TabHead,
  Tag,
  TONE,
  UNIT,
  cn,
  type IconPath,
} from './dash-kit';
import {
  Amount,
  Phrase,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type NowTabProps,
} from './dash-shell';
import { type CustodyFigures } from './custody-fund-line';
import { useMoney } from '../custody-dashboard-parts';

// ── The pieces of a line ──────────────────────────────────────────────────────────────────────

/** A figure inside the sentence — bold, the figure face, the amount ink; a link when it has one. */
const B = ({
  children,
  link = null,
}: {
  children: ReactNode;
  link?: DashLink | null;
}): JSX.Element => (
  <Fig link={link} className={cn('font-bold', NUM, STRONG)}>
    <span dir="ltr">{children}</span>
  </Fig>
);

/** The red part of a sentence: how long expired — the system's danger chip. */
const Hot = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className={cn('whitespace-nowrap rounded-md border px-1.5 py-px font-bold', TONE.red.soft)}>
    {children}
  </span>
);

/** The side box's figure: the KPI tiles' figure face, left to right. */
const F = ({ children }: { children: ReactNode }): JSX.Element => (
  <span dir="ltr" className={cn(CAIRO, 'tabular-nums tracking-tight')}>
    {children}
  </span>
);

/** Keeps a car and what is said of it on one line. */
const G = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className="whitespace-nowrap">{children}</span>
);

const U = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className={UNIT}>{children}</span>
);

/** An amount as the side box's figure: the box's own face (`F`), its «ج.م.» a size down (`U`). */
const BoxMoney = ({ value }: { value: number }): JSX.Element => {
  const { figure, currency } = useMoney()(value);
  return (
    <>
      <F>{figure}</F>
      <U>{currency}</U>
    </>
  );
};

/** Up to this many cars are named in a sentence; the rest are behind the line's button. */
const CHIPS = 6;

interface LineView {
  icon: IconPath;
  text: ReactNode;
  subs: ReactNode[];
  figure: { label: string; value: ReactNode };
  actions: { link: DashLink; label: ReactNode }[];
  companyWide: boolean;
}

/** What a line says, from its section's own figures. */
const useLineView = (
  can: (permission: string) => boolean,
): ((
  line: AlertLine,
  now: FleetDashboardNowDto | null,
  custody: CustodyFigures | null,
) => LineView | null) => {
  const t = useT();
  const noun = useNoun();
  return (line, now, custody) => {
    const k = (rest: string): string => t(`fleet.dash.alerts.${line.id}.${rest}`);
    const links: NowLinks | null = now === null ? null : nowLinks(now);
    const branch = now?.branchId != null;
    const headline = (link: DashLink | null, n: number, which: Parameters<typeof noun>[0]) => ({
      count: <B link={link}>{count(n)}</B>,
      noun: noun(which, n),
    });
    switch (line.id) {
      case 'maintenanceRed': {
        const alarm = now?.maintenanceAlarm;
        if (alarm == null || links === null) return null;
        const red = links.alarm('red', alarm.codes?.red ?? null);
        const yellow = links.alarm('yellow', alarm.codes?.yellow ?? null);
        return {
          icon: I.cog,
          text: (
            <Phrase
              text={k('text')}
              parts={{
                ...headline(red, alarm.red, 'car'),
                overdue: <B link={red}>{count(alarm.overdue)}</B>,
                yellow: <B link={yellow}>{count(alarm.yellow)}</B>,
              }}
            />
          ),
          subs: [],
          figure: { label: k('figure'), value: <F>{count(alarm.overdue)}</F> },
          actions: [
            ...(red === null ? [] : [{ link: red, label: k('actionRed') }]),
            ...(yellow === null ? [] : [{ link: yellow, label: k('actionYellow') }]),
          ],
          companyWide: false,
        };
      }
      case 'vehicleLicenceExpired': {
        const lic = now?.licenceVehicles;
        if (lic == null || links === null) return null;
        // The nearest-first list starts with the oldest expiry: the expired cars lead it.
        const expired = lic.list.slice(0, CHIPS).flatMap((row) => (row.days <= 0 ? [row] : []));
        const oldest = expired[0];
        return {
          icon: I.doc,
          text: (
            <>
              <Phrase
                text={k('text')}
                parts={headline(links.vehicleLicencesExpired(), lic.expired, 'car')}
              />
              {expired.length > 0 && ': '}
              {expired.map((row, i) => (
                <Fragment key={row.vehicleId}>
                  {i > 0 && '، '}
                  <G>
                    <CarChip
                      code={row.code}
                      link={links.vehicle(row.vehicleId, 'licenceVehicles.row')}
                    />{' '}
                    <Hot>
                      {/* Q-02: expired ON its expiry day — «منتهٍ اليوم», as tab 4 says it. */}
                      {row.days === 0 ? (
                        t('fleet.dash.licences.expiredToday')
                      ) : (
                        <Phrase
                          text={t('fleet.dash.common.since')}
                          parts={{ count: <N>{count(-row.days)}</N>, noun: noun('day', -row.days) }}
                        />
                      )}
                    </Hot>
                  </G>
                </Fragment>
              ))}
            </>
          ),
          subs: [
            k('sub'),
            ...(lic.outOfServiceExpired > 0
              ? [
                  <Phrase
                    key="oos"
                    text={k('outOfService')}
                    parts={{ count: <N>{count(lic.outOfServiceExpired)}</N> }}
                  />,
                ]
              : []),
          ],
          figure:
            oldest === undefined
              ? { label: k('figureCount'), value: <F>{count(lic.expired)}</F> }
              : {
                  label: k('figure'),
                  value:
                    oldest.days === 0 ? (
                      <U>{t('fleet.dash.common.today')}</U>
                    ) : (
                      <>
                        <F>{count(-oldest.days)}</F>
                        <U>{noun('day', -oldest.days)}</U>
                      </>
                    ),
                },
          actions: [{ link: links.vehicleLicencesExpired(), label: k('action') }],
          companyWide: false,
        };
      }
      case 'driverLicenceExpired': {
        const lic = now?.licenceDrivers;
        if (lic == null || links === null) return null;
        return {
          icon: I.user,
          text: (
            <Phrase
              text={k('text')}
              parts={headline(links.driverLicencesExpired(), lic.expired, 'driver')}
            />
          ),
          subs: [k('sub')],
          figure: { label: k('figure'), value: <F>{count(lic.expired)}</F> },
          actions: [{ link: links.driverLicencesExpired(), label: k('action') }],
          companyWide: false,
        };
      }
      case 'fuelCardExpired': {
        const cards = now?.fuelCards;
        if (cards == null || links === null) return null;
        return {
          icon: I.card,
          text: (
            <Phrase
              text={k('text')}
              parts={headline(links.fuelCardsExpired(), cards.expired, 'card')}
            />
          ),
          subs: [],
          figure: { label: k('figure'), value: <F>{count(cards.expired)}</F> },
          actions: [{ link: links.fuelCardsExpired(), label: k('action') }],
          companyWide: branch,
        };
      }
      case 'crewAbsent': {
        const roster = now?.roster;
        if (roster == null || links === null) return null;
        const gap = roster.crewGap;
        const part = (key: string, n: number): ReactNode[] =>
          n > 0
            ? [
                <Phrase
                  key={key}
                  text={k(key)}
                  parts={{ count: <N>{count(n)}</N>, noun: noun('car', n) }}
                />,
              ]
            : [];
        return {
          icon: I.users,
          text: <Phrase text={k('text')} parts={headline(links.crewGap(), gap.vehicles, 'car')} />,
          subs: [
            ...part('covered', gap.covered),
            ...part('stalePlan', gap.stalePlan),
            ...part('otherReasons', gap.otherReasons),
          ],
          figure: { label: k('figure'), value: <F>{count(gap.vehicles)}</F> },
          actions: [{ link: links.crewGap(), label: k('action') }],
          companyWide: false,
        };
      }
      case 'noReading': {
        const reading = now?.noReading;
        if (reading == null || links === null) return null;
        const staleLink = links.noReading(reading.stale.map((row) => row.code));
        // The never-read cars open the VEHICLES screen (fleetVehicle.view), not this section's
        // odometer screen: offered only with that screen's own guard.
        const neverLink = can('fleetVehicle.view')
          ? links.neverRead(reading.neverRead.map((row) => row.code))
          : null;
        const since = earliestDay(reading.stale.map((row) => row.lastDate));
        return {
          icon: I.gauge,
          text: (
            <>
              <Phrase
                text={k('text')}
                parts={{
                  ...headline(staleLink, line.count, 'car'),
                  days: <B>{count(reading.days)}</B>,
                  dayNoun: noun('day', reading.days),
                }}
              />
              {reading.stale.length > 0 && ': '}
              {reading.stale.slice(0, CHIPS).map((row, i) => (
                <Fragment key={row.vehicleId}>
                  {i > 0 && '، '}
                  <G>
                    <CarChip code={row.code} />{' '}
                    <Phrase
                      text={t('fleet.dash.common.sinceDay')}
                      parts={{ day: <N>{slashDay(row.lastDate)}</N> }}
                    />
                  </G>
                </Fragment>
              ))}
              {reading.stale.length > CHIPS && ' …'}
            </>
          ),
          subs: [
            k('sub'),
            ...(reading.neverRead.length > 0
              ? [
                  <Fragment key="never">
                    {k('neverRead')}{' '}
                    {reading.neverRead.slice(0, CHIPS).map((row) => (
                      <CarChip key={row.vehicleId} code={row.code} />
                    ))}
                    {reading.neverRead.length > CHIPS && ' …'}
                  </Fragment>,
                ]
              : []),
          ],
          figure:
            since === null
              ? { label: k('figureCount'), value: <F>{count(line.count)}</F> }
              : {
                  label: k('figure'),
                  value: (
                    <>
                      <U>{t('fleet.dash.common.sinceWord')}</U>
                      <F>{slashDay(since)}</F>
                    </>
                  ),
                },
          actions: [
            ...(staleLink === null ? [] : [{ link: staleLink, label: k('action') }]),
            ...(neverLink === null ? [] : [{ link: neverLink, label: k('actionNever') }]),
          ],
          companyWide: false,
        };
      }
      case 'fuelRequests': {
        const fuel = now?.fuelCharging;
        if (fuel == null || links === null) return null;
        const link = links.charging('requested');
        return {
          icon: I.wallet,
          text: (
            <Phrase
              text={k('text')}
              parts={{
                ...headline(link, fuel.requested.count, 'request'),
                amount: <Amount value={fuel.requested.amount} className={STRONG} />,
              }}
            />
          ),
          subs: [],
          figure: {
            label: k('figure'),
            value: <BoxMoney value={fuel.requested.amount} />,
          },
          actions: [{ link, label: k('action') }],
          companyWide: branch,
        };
      }
      case 'fuelLow': {
        const fuel = now?.fuelCharging;
        if (fuel == null || links === null) return null;
        const link = links.charging('low');
        return {
          icon: I.card,
          text: (
            <Phrase
              text={k('text')}
              parts={{
                ...headline(link, fuel.low.belowYellow, 'card'),
                yellowAt: <Amount value={fuel.low.yellowAt} className={STRONG} />,
                red: (
                  <Hot>
                    <Phrase
                      text={k('belowRed')}
                      parts={{
                        count: <N>{count(fuel.low.belowRed)}</N>,
                        redAt: <Amount value={fuel.low.redAt} />,
                      }}
                    />
                  </Hot>
                ),
              }}
            />
          ),
          subs: [],
          figure: { label: k('figure'), value: <F>{count(fuel.low.belowRed)}</F> },
          actions: [{ link, label: k('action') }],
          companyWide: branch,
        };
      }
      case 'dealershipPending': {
        const pending = now?.dealershipPending;
        if (pending == null || links === null) return null;
        return {
          icon: I.receipt,
          text: (
            <Phrase
              text={k('text')}
              parts={headline(links.dealershipPending(), pending.rows, 'row')}
            />
          ),
          subs: [],
          figure: { label: k('figure'), value: <F>{count(pending.rows)}</F> },
          actions: [{ link: links.dealershipPending(), label: k('action') }],
          companyWide: false,
        };
      }
      case 'noticesMissing': {
        const notices = now?.notices;
        if (notices == null || links === null) return null;
        return {
          icon: I.paperclip,
          text: (
            <Phrase
              text={k('text')}
              parts={headline(links.noticesOpen(), notices.missingAny, 'notice')}
            />
          ),
          subs: [
            <Phrase
              key="lic"
              text={k('licences')}
              parts={{ count: <N>{count(notices.missingLicences)}</N> }}
            />,
            <Phrase
              key="cheque"
              text={k('checkImage')}
              parts={{
                count: <B link={links.noticesCheckImage()}>{count(notices.missingCheckImage)}</B>,
              }}
            />,
            k('once'),
          ],
          figure: { label: k('figure'), value: <F>{count(notices.missingAny)}</F> },
          actions: [
            { link: links.noticesOpen(), label: k('action') },
            { link: links.noticesCheckImage(), label: k('actionCheck') },
          ],
          companyWide: branch,
        };
      }
      case 'custody': {
        if (custody === null) return null;
        const link = custodyDashboardLink('custodyFund.lines');
        return {
          icon: I.clipboardCheck,
          text: <Phrase text={k('text')} parts={headline(link, custody.lines, 'alert')} />,
          subs: [],
          figure: { label: k('figure'), value: <F>{count(custody.lines)}</F> },
          actions: [{ link, label: k('action') }],
          companyWide: branch,
        };
      }
    }
  };
};

// ── One line: icon · tags, sentence, sub-line · figure box · actions ──────────────────────────

const LOOK = {
  red: {
    box: 'border-red-300 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/[0.06]',
    ink: TONE.red.text,
  },
  orange: {
    box: 'border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/[0.06]',
    ink: TONE.amber.text,
  },
} as const;

const BOX_LABEL =
  'text-[11px] font-bold leading-4 text-slate-800 dark:font-semibold dark:text-slate-300';

const RedState = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-300 bg-white px-2 py-px text-[11px] font-bold leading-4 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:font-semibold dark:text-red-200">
    <span className={cn('h-1.5 w-1.5 rounded-full', TONE.red.dot)} />
    {children}
  </span>
);

const ROW_GRID =
  'grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 md:grid-cols-[44px_minmax(0,1fr)_164px_168px] 2xl:grid-cols-[44px_minmax(0,1fr)_184px_176px] 2xl:gap-x-5';

const AlertRow = ({ line, view }: { line: AlertLine; view: LineView }): JSX.Element => {
  const t = useT();
  const tone = line.level === 'red' ? 'red' : 'amber';
  const look = LOOK[line.level];
  return (
    <article
      data-alert={line.id}
      data-alert-count={line.count}
      className={cn(SURFACE, TONE[tone].accent)}
    >
      <div className={cn(ROW_GRID, 'min-h-[104px] py-4 pe-5 ps-5')}>
        <IconTile d={view.icon} tone={tone} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag tone={tone}>{t(`fleet.dash.alerts.${line.id}.tag`)}</Tag>
            {line.level === 'red' ? (
              <RedState>{t(`fleet.dash.alerts.${line.id}.state`)}</RedState>
            ) : (
              <Tag tone="slate">{t(`fleet.dash.alerts.${line.id}.state`)}</Tag>
            )}
            <CompanyWide show={view.companyWide} />
          </div>
          <p
            className={cn(
              'mt-1.5 text-[15px] font-bold leading-7 text-slate-800 dark:text-slate-200',
              CAIRO,
            )}
          >
            {view.text}
          </p>
          {view.subs.length > 0 && (
            <p className={cn('mt-0.5 text-[12.5px] leading-6', MUTED)}>
              {view.subs.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' '}
                  {part}
                  {i < view.subs.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="me-1 ms-2 text-[10px] text-slate-400 dark:text-slate-500"
                    >
                      •
                    </span>
                  )}
                </Fragment>
              ))}
            </p>
          )}
        </div>
        <div className={cn('col-span-2 rounded-xl border px-3.5 py-2.5 md:col-span-1', look.box)}>
          <div className={BOX_LABEL}>{view.figure.label}</div>
          <div
            className={cn(
              'mt-1 flex items-baseline gap-1 whitespace-nowrap text-[20px] font-black leading-7',
              look.ink,
            )}
          >
            {view.figure.value}
          </div>
        </div>
        <div className="col-span-2 flex flex-col gap-2 md:col-span-1">
          {view.actions.map((action, i) => (
            <Fig
              key={action.link.to}
              link={action.link}
              linkedClassName=""
              className={cn(i === 0 ? BTN.soft : BTN.outline, 'h-9 w-full')}
            >
              {action.label}
              <Icon d={I.arrow} className="h-3.5 w-3.5" />
            </Fig>
          ))}
        </div>
      </div>
    </article>
  );
};

// ── A section: dot, title, count, the note at its far end ────────────────────────────────────

const Section = ({
  level,
  rows,
  shown,
  total,
}: {
  level: 'red' | 'orange';
  rows: readonly { line: AlertLine; view: LineView }[];
  /** How many of this level's lines the chips leave on screen. */
  shown: number;
  total: number;
}): JSX.Element | null => {
  const t = useT();
  if (shown === 0) return null;
  const tone = level === 'red' ? 'red' : 'amber';
  return (
    <section data-alert-section={level}>
      <div className="mb-3 flex items-center justify-between gap-4 border-b border-slate-200 pb-2.5 dark:border-[#1c263b]">
        <h3 className={cn(TITLE, 'flex items-center gap-2')}>
          <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE[tone].dot)} />
          {t(`fleet.dash.alerts.section.${level}.title`)}
          <Count n={count(shown)} tone={tone} />
          {shown < total && (
            <span className={cn('text-xs font-semibold', MUTED)}>
              <Phrase
                text={t('fleet.dash.alerts.section.of')}
                parts={{ count: <N>{count(total)}</N> }}
              />
            </span>
          )}
        </h3>
        <span className={cn('text-xs font-bold', LOOK[level].ink)}>
          {t(`fleet.dash.alerts.section.${level}.note`)}
        </span>
      </div>
      <div className="space-y-3">
        {rows.map(({ line, view }) => (
          <AlertRow key={line.id} line={line} view={view} />
        ))}
      </div>
    </section>
  );
};

// ── The filter chips ──────────────────────────────────────────────────────────────────────────

const CHIP = cn(
  'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
  CAIRO,
);
const BUBBLE = cn(
  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] leading-none',
  NUM,
);
const BUBBLE_RED = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
const BUBBLE_AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
const TOTAL_CHIP =
  'flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white/70 px-3.5 py-2 text-[13px] shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40';

const Chip = ({
  on,
  onClick,
  bubble,
  lead,
  label,
  n,
}: {
  on: boolean;
  onClick: () => void;
  bubble?: string;
  lead?: ReactNode;
  label: string;
  n: number;
}): JSX.Element => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn(CHIP, on ? SEG.on : SEG.off)}
  >
    {lead}
    {label}
    <span className={cn(BUBBLE, on ? SEG.countOn : (bubble ?? SEG.countOff))}>{count(n)}</span>
  </button>
);

const CATEGORIES: readonly { key: AlertCategory; icon: IconPath }[] = [
  { key: 'cars', icon: I.truck },
  { key: 'drivers', icon: I.users },
  { key: 'fuel', icon: I.fuel },
];

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

/** The sources of tab 1's lines that R1 answers (custody is the page's own read, below). */
const ALERT_SECTIONS = FLEET_DASHBOARD_TAB_SECTIONS.alerts.filter(
  (section): section is FleetDashboardNowSection => section !== 'custodyFund',
);

export const AlertsTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const view = useLineView(props.can);
  // A source that FAILED gives no line: say so, with its retry, and never call the tab clear.
  const failed = ALERT_SECTIONS.filter((section) => props.now?.unavailable.includes(section));
  const custodyFailed = props.custody?.error === true;
  const [level, setLevel] = useState<'all' | 'red' | 'orange'>('all');
  const [category, setCategory] = useState<AlertCategory | null>(null);

  const rows = props.lines.flatMap((line) => {
    const shown = view(line, props.now, props.custody);
    return shown === null ? [] : [{ line, view: shown }];
  });
  const all = alertSummary(rows.map((row) => row.line));
  const picked = rows.filter(
    (row) =>
      (level === 'all' || row.line.level === level) &&
      (category === null || row.line.category === category),
  );
  const onScreen = alertSummary(picked.map((row) => row.line));

  return (
    <div data-dash-tab-body="alerts">
      <TabHead
        icon={I.bell}
        title={t('fleet.dash.shell.tab.alerts')}
        sub={t('fleet.dash.alerts.sub')}
        end={
          <>
            <div className={TOTAL_CHIP} data-alert-total={all.total}>
              <span className={MUTED}>{t('fleet.dash.alerts.total')}</span>
              <N className={cn('text-[16px] font-bold', STRONG)}>{count(all.total)}</N>
              {all.red > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className={cn('h-1 w-1 shrink-0 rounded-full', TONE.slate.dot)}
                  />
                  <span className="text-slate-600 dark:text-slate-300">
                    {t('fleet.dash.alerts.ofThem')}
                  </span>
                  <N className={cn('text-[16px] font-bold', RED)}>{count(all.red)}</N>
                  <span className={cn('font-bold', RED)}>{t('fleet.dash.alerts.urgent')}</span>
                </>
              )}
            </div>
            <RefreshTools
              updatedAt={props.updatedAt}
              onRefresh={props.onRefresh}
              refreshing={props.refreshing}
              {...(props.clock === undefined ? {} : { clock: props.clock })}
            />
          </>
        }
      />

      {(failed.length > 0 || custodyFailed) && (
        <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-3">
          {failed.map((section) => (
            <SectionError key={section} section={section} onRetry={props.onRetry} />
          ))}
          {custodyFailed && props.custody !== null && (
            <SectionError section="custodyFund" onRetry={props.custody.refetch} />
          )}
        </div>
      )}
      {rows.length === 0 ? (
        failed.length > 0 || custodyFailed ? null : (
          <div
            data-alerts-none="true"
            className={cn(SURFACE, 'flex flex-col items-center gap-2 px-6 py-12 text-center')}
          >
            <IconTile d={I.check} tone="emerald" />
            <p className={TITLE}>{t('fleet.dash.alerts.none.title')}</p>
            <p className={cn('text-[13px]', MUTED)}>{t('fleet.dash.alerts.none.note')}</p>
          </div>
        )
      ) : (
        <>
          <div className="mb-5 flex">
            <div
              role="toolbar"
              aria-label={t('fleet.dash.alerts.toolbar')}
              // One row that scrolls sideways on a narrow screen, never a stack of stray chips.
              className={cn(SEG.tray, 'w-full flex-nowrap overflow-x-auto')}
            >
              <Chip
                on={level === 'all' && category === null}
                onClick={() => {
                  setLevel('all');
                  setCategory(null);
                }}
                label={t('fleet.dash.alerts.chip.all')}
                n={all.total}
              />
              <Chip
                on={level === 'red'}
                onClick={() => setLevel(level === 'red' ? 'all' : 'red')}
                bubble={BUBBLE_RED}
                lead={<span className={cn('h-2 w-2 rounded-full', TONE.red.dot)} />}
                label={t('fleet.dash.alerts.chip.red')}
                n={all.red}
              />
              <Chip
                on={level === 'orange'}
                onClick={() => setLevel(level === 'orange' ? 'all' : 'orange')}
                bubble={BUBBLE_AMBER}
                lead={<span className={cn('h-2 w-2 rounded-full', TONE.amber.dot)} />}
                label={t('fleet.dash.alerts.chip.orange')}
                n={all.orange}
              />
              <span
                aria-hidden="true"
                className="mx-1.5 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
              />
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.key}
                  on={category === c.key}
                  onClick={() => setCategory(category === c.key ? null : c.key)}
                  lead={
                    <Icon
                      d={c.icon}
                      className={cn(
                        'h-4 w-4',
                        category === c.key ? '' : 'text-slate-400 dark:text-slate-500',
                      )}
                    />
                  }
                  label={t(`fleet.dash.alerts.category.${c.key}`)}
                  n={all.byCategory[c.key]}
                />
              ))}
            </div>
          </div>
          {onScreen.total === 0 && (
            <p className={cn('text-[13px]', MUTED)}>{t('fleet.dash.alerts.filteredNone')}</p>
          )}
          <div className="space-y-7">
            <Section
              level="red"
              rows={picked.filter((row) => row.line.level === 'red')}
              shown={onScreen.red}
              total={all.red}
            />
            <Section
              level="orange"
              rows={picked.filter((row) => row.line.level === 'orange')}
              shown={onScreen.orange}
              total={all.orange}
            />
          </div>
        </>
      )}
    </div>
  );
};
