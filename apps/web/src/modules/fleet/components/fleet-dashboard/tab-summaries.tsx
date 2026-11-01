// Tab 5 «ملخصات» — the approved v2 sample (zz-fleetdash-v2-summaries.tsx) over R1's `fuelCharging`,
// `accidentsOpen` and `violationsYear`, and the custody screen's own figures (T5.1–T5.12).
//
// The owner's answers (D5): no custody ceiling and no gauge; the open-obligations card shows the
// total WITH its two parts (open accidents' remaining + the year's unpaid fines); no print button.
// Card, custody and dealership money are never summed (Q-05). No supply-contract card (Phase 2).
import { type ReactNode } from 'react';
import { type FleetDashboardNowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import {
  custodyDashboardLink,
  nowLinks,
  type DashLink,
  type NowLinks,
} from '../../lib/fleet-dashboard-links';
import { share, shareText } from '../../lib/fleet-dashboard-tabs';
import { CARD_SURFACE } from '../custody-dashboard-parts';
import {
  BOX,
  BOX_HOVER,
  BTN,
  CAIRO,
  COMPANY,
  Card,
  CardHead,
  CompanyWide,
  FOCUS,
  Fig,
  I,
  Icon,
  IconTile,
  LINKED_TIGHT,
  MUTED,
  N,
  RED,
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
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type NowTabProps,
} from './dash-shell';
import { type CustodyFigures } from './custody-fund-line';

const UNIT_SMALL = 'text-[11px] font-semibold text-slate-500 dark:font-medium dark:text-slate-400';
const KPI_FIG = cn('text-[28px] font-black leading-none tracking-tight 2xl:text-[34px]', STRONG);
const TRACK = 'bg-slate-100 dark:bg-[#162135]';
const FUND = {
  card: 'border-slate-300 bg-gradient-to-br from-slate-100/80 via-white to-white dark:border-slate-500/40',
  box: 'border-slate-300 bg-gradient-to-br from-slate-100/80 via-white to-white dark:border-slate-500/40 dark:from-[#141c2b] dark:via-[#0e1524] dark:to-[#0e1524]',
  label: 'font-bold text-slate-800 dark:font-semibold dark:text-slate-300',
  icon: 'text-slate-500 dark:text-slate-400',
} as const;
const OP_INK = {
  replenish: 'text-sky-600 dark:text-sky-400',
  settle: 'text-emerald-600 dark:text-emerald-400',
} as const;
const BOX_LOOK = {
  plain: cn(BOX, BOX_HOVER),
  red: 'rounded-xl border border-red-300 bg-red-50 transition-colors hover:border-red-400 dark:border-red-500/30 dark:bg-red-500/[0.08] dark:hover:border-red-500/50',
  amber:
    'rounded-xl border border-amber-300 bg-amber-50/60 transition-colors hover:border-amber-400 dark:border-amber-500/30 dark:bg-amber-500/[0.06] dark:hover:border-amber-500/50',
} as const;

/** A headline amount: the tiles' face — Cairo, tabular — with «ج.م.»; red with its minus below zero. */
const Headline = ({
  value,
  link,
  className = KPI_FIG,
}: {
  value: number | null;
  link: DashLink | null;
  className?: string;
}): JSX.Element => {
  if (value === null) return <span className={cn(className, MUTED)}>—</span>;
  return (
    <Fig link={link} className={cn(CAIRO, 'tabular-nums', className, value < 0 && RED)}>
      <Amount value={value} className="!font-[inherit]" />
    </Fig>
  );
};

const SplitBar = ({
  parts,
}: {
  parts: readonly { pct: number; cls: string; title: string }[];
}): JSX.Element => (
  <div className={cn('flex h-2 gap-0.5 overflow-hidden rounded-full', TRACK)}>
    {parts.map((part) => (
      <div
        key={part.title}
        title={part.title}
        className={cn('h-full first:rounded-s-full last:rounded-e-full', part.cls)}
        style={{ width: `${part.pct}%` }}
      />
    ))}
  </div>
);

const Key = ({
  dot,
  label,
  value,
  link,
}: {
  dot: string;
  label: ReactNode;
  value: number;
  link: DashLink | null;
}): JSX.Element => (
  <span className="inline-flex min-w-0 items-baseline gap-1 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
    <span
      aria-hidden="true"
      className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', dot)}
    />
    <span className="whitespace-nowrap">{label}:</span>
    <Fig link={link} className={cn('text-[11px]', STRONG)}>
      <Amount value={value} unitClassName={UNIT_SMALL} />
    </Fig>
  </span>
);

/** A top card: the KPI tile's coloured edge; the custody total on the fund's own slate tile. */
const Kpi = ({
  data,
  tone,
  icon,
  title,
  figure,
  fund = false,
  children,
}: {
  data: string;
  tone: Tone;
  icon: IconPath;
  title: ReactNode;
  figure: ReactNode;
  fund?: boolean;
  children: ReactNode;
}): JSX.Element => {
  const body = (
    <div className="flex flex-1 flex-col px-5 pb-5 pt-5 2xl:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn(TITLE, 'flex flex-wrap items-center gap-2')}>
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
            />
            {title}
          </h3>
          <div className="mt-3 flex items-baseline gap-1.5 whitespace-nowrap">{figure}</div>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-xl border 2xl:h-14 2xl:w-14 2xl:rounded-2xl',
            TONE[tone].tile,
          )}
        >
          <Icon d={icon} className="h-5 w-5 2xl:h-6 2xl:w-6" />
        </span>
      </div>
      <div className={cn('mt-auto border-t pt-4', RULE)}>{children}</div>
    </div>
  );
  return fund ? (
    <div
      data-summary-card={data}
      className={cn(
        CARD_SURFACE,
        'relative flex min-w-0 flex-col overflow-hidden rounded-2xl',
        FUND.card,
        TONE.slate.accent,
      )}
    >
      {body}
    </div>
  ) : (
    <Card accent={tone} data-summary-card={data}>
      {body}
    </Card>
  );
};

const Row = ({
  icon,
  tone,
  kind = 'plain',
  children,
  end,
  sub,
}: {
  icon: IconPath;
  tone: Tone;
  kind?: keyof typeof BOX_LOOK;
  children: ReactNode;
  end?: ReactNode;
  sub?: ReactNode;
}): JSX.Element => (
  <div className={cn('flex items-center gap-3 px-3 py-3', BOX_LOOK[kind])}>
    <IconTile d={icon} tone={tone} size="sm" />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0 text-[13px] leading-6 text-slate-700 dark:text-slate-200">
          {children}
        </div>
        {end !== undefined && <div className="shrink-0">{end}</div>}
      </div>
      {sub !== undefined && <div className={cn('text-[11.5px] leading-5', MUTED)}>{sub}</div>}
    </div>
  </div>
);

const Column = ({
  data,
  dot,
  title,
  sub,
  end,
  children,
  foot,
}: {
  data: string;
  dot: Tone;
  title: string;
  sub: string;
  end?: ReactNode;
  children: ReactNode;
  foot: ReactNode;
}): JSX.Element => (
  <Card data-summary-column={data}>
    <div className="flex flex-1 flex-col p-4 2xl:p-5">
      <CardHead dot={dot} title={title} sub={sub} end={end} />
      <div className="mt-4 flex flex-col gap-3">{children}</div>
      <div className="mt-auto pt-5">{foot}</div>
    </div>
  </Card>
);

const Wide = ({
  link,
  icon,
  children,
}: {
  link: DashLink;
  icon: IconPath;
  children: ReactNode;
}): JSX.Element => (
  <Fig link={link} linkedClassName="" className={cn(BTN.outline, 'w-full gap-2')}>
    <Icon d={icon} className={cn('h-4 w-4', MUTED)} />
    {children}
    <Icon d={I.arrow} className="h-3.5 w-3.5 opacity-60" />
  </Fig>
);

const ScreenTile = ({
  link,
  icon,
  children,
}: {
  link: DashLink;
  icon: IconPath;
  children: ReactNode;
}): JSX.Element => (
  <Fig
    link={link}
    linkedClassName=""
    className={cn(
      'group flex min-w-0 items-center gap-2 rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-2.5 text-[13px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200',
      FOCUS,
    )}
  >
    <Icon d={icon} className="h-4 w-4 shrink-0 opacity-80" />
    <span className="min-w-0 flex-1">{children}</span>
    <Icon d={I.arrow} className="h-3.5 w-3.5 shrink-0 opacity-60" />
  </Fig>
);

// ── (b) The three top cards ───────────────────────────────────────────────────────────────────

type Fuel = NonNullable<FleetDashboardNowDto['fuelCharging']>;
type Violations = NonNullable<FleetDashboardNowDto['violationsYear']>;
type Accidents = NonNullable<FleetDashboardNowDto['accidentsOpen']>;

const FuelKpi = ({
  fuel,
  links,
  branch,
}: {
  fuel: Fuel;
  links: NowLinks;
  branch: boolean;
}): JSX.Element => {
  const t = useT();
  const total = fuel.wataniya + fuel.chillout;
  return (
    <Kpi
      data="fuel"
      tone="emerald"
      icon={I.card}
      title={
        <>
          {t('fleet.dash.summaries.fuelTitle')}
          <CompanyWide show={branch} />
        </>
      }
      figure={<Headline value={total} link={null} />}
    >
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Key
          dot={COMPANY.wataniya.dot}
          label={t('fleet.dash.summaries.wataniya')}
          value={fuel.wataniya}
          link={links.chargingCompany('wataniya')}
        />
        <Key
          dot={COMPANY.chillout.dot}
          label={t('fleet.dash.summaries.chillout')}
          value={fuel.chillout}
          link={links.chargingCompany('chillout')}
        />
      </div>
      <div className="mt-3">
        <SplitBar
          parts={[
            {
              pct: share(fuel.wataniya, total) ?? 0,
              cls: COMPANY.wataniya.bar,
              title: t('fleet.dash.summaries.wataniya'),
            },
            {
              pct: share(fuel.chillout, total) ?? 0,
              cls: COMPANY.chillout.bar,
              title: t('fleet.dash.summaries.chillout'),
            },
          ]}
        />
      </div>
    </Kpi>
  );
};

const CustodyKpi = ({
  custody,
  branch,
}: {
  custody: CustodyFigures;
  branch: boolean;
}): JSX.Element => {
  const t = useT();
  const stat = (
    icon: IconPath,
    ink: string,
    label: string,
    value: number | null,
    metric: string,
    className?: string,
  ): JSX.Element => (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold',
          MUTED,
        )}
      >
        <Icon d={icon} className={cn('h-3.5 w-3.5 shrink-0', ink)} />
        {label}
      </div>
      <div className="mt-1">
        <Headline
          value={value}
          link={custodyDashboardLink(metric)}
          className={cn('text-[15px] font-bold leading-6', STRONG)}
        />
      </div>
    </div>
  );
  return (
    <Kpi
      data="custody"
      tone="slate"
      fund
      icon={I.wallet}
      title={
        <>
          {t('fleet.dash.summaries.custodyTotal')}
          <CompanyWide show={branch} />
        </>
      }
      figure={
        <Headline value={custody.fundTotal} link={custodyDashboardLink('custodyFund.total')} />
      }
    >
      <div className="grid grid-cols-2">
        {stat(
          I.refresh,
          OP_INK.replenish,
          t('fleet.dash.summaries.waiting'),
          custody.waiting,
          'custodyFund.waiting',
        )}
        {stat(
          I.clipboardCheck,
          OP_INK.settle,
          t('fleet.dash.summaries.settle'),
          custody.settle,
          'custodyFund.settle',
          cn('border-s ps-4 2xl:ps-5', RULE),
        )}
      </div>
    </Kpi>
  );
};

const OpenKpi = ({
  accidents,
  violations,
  links,
}: {
  accidents: Accidents | null;
  violations: Violations | null;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const both = accidents !== null && violations !== null;
  const total = (accidents?.remaining ?? 0) + (violations?.total ?? 0);
  const figure = both ? (
    <Headline value={total} link={null} />
  ) : accidents !== null ? (
    <Headline value={accidents.remaining} link={links.accidentsOpen()} />
  ) : (
    <Headline
      value={violations?.total ?? 0}
      link={violations === null ? null : links.violationsDrivers(violations.year)}
    />
  );
  return (
    <Kpi
      data="open"
      tone="red"
      icon={I.warn}
      title={t('fleet.dash.summaries.openTitle')}
      figure={figure}
    >
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {accidents !== null && (
          <Key
            dot={TONE.red.dot}
            label={
              <Phrase
                text={t('fleet.dash.summaries.openAccidentsKey')}
                parts={{ count: <N>{count(accidents.count)}</N> }}
              />
            }
            value={accidents.remaining}
            link={links.accidentsOpen()}
          />
        )}
        {violations !== null && (
          <Key
            dot={TONE.amber.dot}
            label={
              <Phrase
                text={t('fleet.dash.summaries.openFinesKey')}
                parts={{ year: <N>{violations.year}</N> }}
              />
            }
            value={violations.total}
            link={null}
          />
        )}
      </div>
      {both && (
        <div className="mt-3">
          <SplitBar
            parts={[
              {
                pct: share(accidents.remaining, total) ?? 0,
                cls: TONE.red.bar,
                title: t('fleet.dash.summaries.openAccidentsPart'),
              },
              {
                pct: share(violations.total, total) ?? 0,
                cls: TONE.amber.bar,
                title: t('fleet.dash.summaries.openFinesPart'),
              },
            ]}
          />
        </div>
      )}
    </Kpi>
  );
};

// ── (c) The three columns ─────────────────────────────────────────────────────────────────────

const FuelColumn = ({
  fuel,
  links,
  branch,
}: {
  fuel: Fuel;
  links: NowLinks;
  branch: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const total = fuel.wataniya + fuel.chillout;
  return (
    <Column
      data="fuel"
      dot="emerald"
      title={t('fleet.dash.summaries.fuelNow')}
      sub={t('fleet.dash.summaries.fuelNowSub')}
      end={<CompanyWide show={branch} />}
      foot={
        <Wide link={links.charging('requested')} icon={I.fuel}>
          {t('fleet.dash.summaries.chargingScreen')}
        </Wide>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {(['wataniya', 'chillout'] as const).map((company) => (
          <div
            key={company}
            className={cn('min-w-0 rounded-xl border px-3 pb-3 pt-2.5', COMPANY[company].head)}
          >
            <div
              className={cn(
                'flex items-center justify-between gap-2 text-[13px] font-bold',
                COMPANY[company].heading,
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 rounded-full', COMPANY[company].dot)}
                />
                {t(`fleet.dash.summaries.${company}`)}
              </span>
              <Icon d={I.card} className="h-4 w-4 opacity-70" />
            </div>
            <div className={cn('mt-1.5 text-[11px] font-semibold', MUTED)}>
              {t('fleet.dash.summaries.cardsBalance')}
            </div>
            <div className="mt-0.5">
              <Fig
                link={links.chargingCompany(company)}
                className={cn('text-lg font-black dark:font-bold', STRONG)}
              >
                <Amount value={fuel[company]} className="!font-[inherit]" />
              </Fig>
            </div>
            <div className={cn('mt-2.5 h-1.5 overflow-hidden rounded-full', TRACK)}>
              <div
                className={cn('h-full rounded-full', COMPANY[company].bar)}
                style={{ width: `${share(fuel[company], total) ?? 0}%` }}
              />
            </div>
            <div className={cn('mt-1.5 flex items-center gap-1 text-[11px] font-semibold', MUTED)}>
              <N
                className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', COMPANY[company].pct)}
              >
                {shareText(fuel[company], total)}
              </N>{' '}
              {t('fleet.dash.summaries.ofBalances')}
            </div>
          </div>
        ))}
      </div>
      <Row
        icon={I.clock}
        tone="amber"
        end={<Amount value={fuel.requested.amount} className={STRONG} />}
      >
        <Phrase
          text={t('fleet.dash.summaries.requested')}
          parts={{
            count: (
              <Fig link={links.charging('requested')} className={cn('font-bold', STRONG)}>
                <N>{count(fuel.requested.count)}</N>
              </Fig>
            ),
            noun: noun('request', fuel.requested.count),
          }}
        />
      </Row>
      <Row
        icon={I.warn}
        tone="red"
        kind="red"
        end={
          fuel.low.belowRed > 0 ? (
            <Tag tone="red" dot>
              {t('fleet.dash.summaries.critical')}
            </Tag>
          ) : undefined
        }
        sub={
          <>
            <span className="whitespace-nowrap">
              <Phrase
                text={t('fleet.dash.summaries.lowUnder')}
                parts={{
                  amount: (
                    <Amount
                      value={fuel.low.yellowAt}
                      className="text-slate-600 dark:text-slate-300"
                    />
                  ),
                }}
              />
            </span>{' '}
            <span className={cn('whitespace-nowrap font-bold', RED)}>
              <Phrase
                text={t('fleet.dash.summaries.lowRed')}
                parts={{
                  count: <N>{count(fuel.low.belowRed)}</N>,
                  amount: <Amount value={fuel.low.redAt} />,
                }}
              />
            </span>
          </>
        }
      >
        <Phrase
          text={t('fleet.dash.summaries.low')}
          parts={{
            count: (
              <Fig link={links.charging('low')} className={cn('font-bold', STRONG)}>
                <N>{count(fuel.low.belowYellow)}</N>
              </Fig>
            ),
            noun: noun('card', fuel.low.belowYellow),
          }}
        />
      </Row>
      <Row
        icon={I.bolt}
        tone="emerald"
        end={
          <Fig link={links.charging('charged')} className={TONE.emerald.text}>
            <Amount value={fuel.charged24h} />
          </Fig>
        }
      >
        {t('fleet.dash.summaries.charged24h')}
      </Row>
    </Column>
  );
};

const CustodyColumn = ({
  custody,
  links,
  branch,
}: {
  custody: CustodyFigures;
  links: NowLinks | null;
  branch: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return (
    <Column
      data="custody"
      dot="slate"
      title={t('fleet.dash.summaries.custodyNow')}
      sub={t('fleet.dash.summaries.custodyNowSub')}
      end={<CompanyWide show={branch} />}
      foot={
        <Wide link={custodyDashboardLink('custodyFund.open')} icon={I.wallet}>
          {t('fleet.dash.summaries.openCustody')}
        </Wide>
      }
    >
      <div className={cn('rounded-xl border px-4 py-3.5', FUND.box)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-xs', FUND.label)}>
            {t('fleet.dash.summaries.custodyTotal')}
          </span>
          <Icon d={I.wallet} className={cn('h-4 w-4', FUND.icon)} />
        </div>
        <div className="mt-1.5">
          <Headline
            value={custody.fundTotal}
            link={custodyDashboardLink('custodyFund.total')}
            className={cn(
              'text-[24px] font-black leading-tight tracking-tight 2xl:text-[28px]',
              STRONG,
            )}
          />
        </div>
      </div>
      <Row
        icon={I.refresh}
        tone="sky"
        end={
          <Headline
            value={custody.waiting}
            link={custodyDashboardLink('custodyFund.waiting')}
            className={cn('text-[15px] font-bold', STRONG)}
          />
        }
        sub={t('fleet.dash.summaries.waitingSub')}
      >
        <span className="font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.dash.summaries.waiting')}
        </span>
      </Row>
      <Row
        icon={I.clipboardCheck}
        tone="emerald"
        end={
          <Headline
            value={custody.settle}
            link={custodyDashboardLink('custodyFund.settle')}
            className={cn('text-[15px] font-bold', STRONG)}
          />
        }
        sub={t('fleet.dash.summaries.settleSub')}
      >
        <span className="font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.dash.summaries.settle')}
        </span>
      </Row>
      <Row icon={I.shield} tone="amber" kind="amber">
        <Phrase
          text={t('fleet.dash.summaries.custodyAlerts')}
          parts={{
            count: (
              <Fig
                link={custodyDashboardLink('custodyFund.lines')}
                className={cn('font-bold', TONE.amber.text)}
              >
                <N>{count(custody.lines)}</N>
              </Fig>
            ),
            noun: noun('alert', custody.lines),
          }}
        />
      </Row>
      <div className="grid grid-cols-1 gap-2.5 2xl:grid-cols-2">
        <ScreenTile link={custodyDashboardLink('custodyFund.dashboard')} icon={I.grid}>
          {t('fleet.dash.summaries.custodyDashboard')}
        </ScreenTile>
        {links !== null && (
          <ScreenTile link={links.custodyExpenses()} icon={I.cash}>
            {t('fleet.dash.summaries.custodyExpenses')}
          </ScreenTile>
        )}
      </div>
    </Column>
  );
};

const FineLine = ({
  icon,
  label,
  n,
  value,
  link,
  strong,
}: {
  icon?: IconPath;
  label: string;
  n?: number;
  value: number;
  link: DashLink | null;
  strong?: boolean;
}): JSX.Element => {
  const noun = useNoun();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex min-w-0 items-baseline gap-1.5">
        {icon !== undefined && (
          <Icon d={icon} className="h-3.5 w-3.5 shrink-0 translate-y-[2px] text-slate-400" />
        )}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span
            className={cn(
              'whitespace-nowrap',
              strong === true
                ? 'font-bold text-slate-800 dark:text-slate-100'
                : 'text-slate-600 dark:text-slate-300',
            )}
          >
            {label}
          </span>
          {n !== undefined && (
            <span className={cn('whitespace-nowrap', MUTED)}>
              · <N>{count(n)}</N> {noun('violation', n)}
            </span>
          )}
        </span>
      </span>
      <Fig link={link} className={strong === true ? STRONG : 'text-slate-800 dark:text-slate-100'}>
        <Amount value={value} unitClassName={UNIT_SMALL} />
      </Fig>
    </div>
  );
};

const OpenColumn = ({
  accidents,
  violations,
  links,
}: {
  accidents: Accidents | null;
  violations: Violations | null;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const foot =
    violations !== null ? (
      <Wide link={links.violationsCompany(violations.year)} icon={I.receipt}>
        {t('fleet.dash.summaries.openViolations')}
      </Wide>
    ) : accidents !== null ? (
      <Wide link={links.accidentsOpen()} icon={I.warn}>
        {t('fleet.dash.summaries.openAccidents')}
      </Wide>
    ) : null;
  return (
    <Column
      data="open"
      dot="red"
      title={t('fleet.dash.summaries.openNow')}
      sub={t('fleet.dash.summaries.openNowSub')}
      foot={foot}
    >
      {accidents !== null && (
        <div className={cn('px-3.5 py-3', BOX_LOOK.red)}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-red-700 dark:font-semibold dark:text-red-300">
              <Icon d={I.warn} className="h-4 w-4" />
              {t('fleet.dash.summaries.openAccidentsTitle')}
            </span>
            <Tag tone="red">
              <Fig
                link={links.accidentsOpen()}
                linkedClassName={LINKED_TIGHT}
                className="font-bold"
              >
                <N>{count(accidents.count)}</N>
              </Fig>{' '}
              {noun('file', accidents.count)}
            </Tag>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className={cn('text-xs font-semibold', MUTED)}>
              {t('fleet.dash.summaries.remaining')}
            </span>
            <Headline
              value={accidents.remaining}
              link={links.accidentsOpen()}
              className={cn('text-[20px] font-black', RED)}
            />
          </div>
        </div>
      )}
      {violations !== null && (
        <div className={cn('px-3.5 py-3', BOX_LOOK.amber)}>
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-amber-800 dark:font-semibold dark:text-amber-300">
            <Icon d={I.receipt} className="h-4 w-4" />
            <Phrase
              text={t('fleet.dash.summaries.finesTitle')}
              parts={{ year: <N>{violations.year}</N> }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className={cn('text-xs font-semibold', MUTED)}>
              {t('fleet.dash.summaries.companyAndDrivers')}
            </span>
            <Headline
              value={violations.total}
              link={null}
              className={cn('text-[20px] font-black', TONE.amber.text)}
            />
          </div>
          <div className={cn('mt-2.5 space-y-2 px-3 py-2.5 text-[12px] leading-5', BOX)}>
            <FineLine
              icon={I.building}
              label={t('fleet.dash.summaries.onCompany')}
              value={violations.company}
              link={links.violationsCompany(violations.year)}
              strong
            />
            <div className={cn('border-t pt-2', RULE)}>
              <FineLine
                icon={I.users}
                label={t('fleet.dash.summaries.onDrivers')}
                value={violations.drivers.total}
                link={links.violationsDrivers(violations.year)}
                strong
              />
              <div className="mt-1.5 space-y-1 border-s-2 border-amber-200 ps-2.5 text-[11.5px] dark:border-amber-500/30">
                <FineLine
                  label={t('fleet.dash.summaries.knownDriver')}
                  value={violations.drivers.attributed}
                  link={null}
                />
                <FineLine
                  label={t('fleet.dash.summaries.unknownDriver')}
                  n={violations.drivers.unknown.count}
                  value={violations.drivers.unknown.amount}
                  link={links.violationsUnknown(violations.year)}
                />
                <FineLine
                  label={t('fleet.dash.summaries.unlinkedName')}
                  n={violations.drivers.unlinked.count}
                  value={violations.drivers.unlinked.amount}
                  link={null}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {violations !== null && (
        <div className={cn('flex items-start gap-2 px-1 text-[12px] leading-5', MUTED)}>
          <Icon d={I.info} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('fleet.dash.summaries.annualNote')}</span>
        </div>
      )}
    </Column>
  );
};

// ── (d) Quick links to existing screens ───────────────────────────────────────────────────────

const QuickLinks = ({
  now,
  custody,
  links,
  can,
}: {
  now: FleetDashboardNowDto | null;
  custody: CustodyFigures | null;
  links: NowLinks | null;
  can: (p: string) => boolean;
}): JSX.Element | null => {
  const t = useT();
  const items: { link: DashLink; icon: IconPath; label: string; n?: number }[] = [];
  if (links !== null && now?.fuelCharging != null && can('fleetFuelCharge.view'))
    items.push({
      link: links.reconcile(),
      icon: I.card,
      label: t('fleet.dash.summaries.quickReconcile'),
    });
  if (custody !== null)
    items.push({
      link: custodyDashboardLink('custodyFund.quick'),
      icon: I.grid,
      label: t('fleet.dash.summaries.custodyDashboard'),
    });
  if (custody !== null && links !== null)
    items.push({
      link: links.custodyExpenses(),
      icon: I.cash,
      label: t('fleet.dash.summaries.custodyExpenses'),
    });
  const v = now?.violationsYear;
  if (links !== null && v != null)
    items.push({
      link: links.violationsUnknown(v.year),
      icon: I.userX,
      label: t('fleet.dash.summaries.quickUnknown'),
      n: v.drivers.unknown.count,
    });
  const a = now?.accidentsOpen;
  if (links !== null && a != null)
    items.push({
      link: links.accidentsOpen(),
      icon: I.warn,
      label: t('fleet.dash.summaries.openAccidentsTitle'),
      n: a.count,
    });
  if (items.length === 0) return null;
  return (
    <Card className="mt-5" data-summary-card="quick">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
        <h3 className={cn(TITLE, 'flex shrink-0 basis-full items-center gap-2 2xl:basis-auto')}>
          <IconTile d={I.link} tone="slate" size="sm" />
          {t('fleet.dash.summaries.quickTitle')}
        </h3>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {items.map((item) => (
            <Fig
              key={item.link.metric}
              link={item.link}
              linkedClassName=""
              className={cn(BTN.outline, 'flex-1')}
            >
              <Icon d={item.icon} className={cn('h-4 w-4', MUTED)} />
              {item.label}
              {item.n !== undefined && (
                <N className="rounded border border-slate-200 bg-slate-200/80 px-1.5 text-xs font-bold text-slate-700 dark:border-slate-700/60 dark:bg-[#142135] dark:font-medium dark:text-slate-300">
                  {count(item.n)}
                </N>
              )}
            </Fig>
          ))}
        </div>
      </div>
    </Card>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

const SUMMARY_SECTIONS = ['fuelCharging', 'accidentsOpen', 'violationsYear'] as const;

export const SummariesTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now, custody } = props;
  const links = now === null ? null : nowLinks(now);
  const branch = now?.branchId != null;
  const fuel = now?.fuelCharging ?? null;
  const accidents = now?.accidentsOpen ?? null;
  const violations = now?.violationsYear ?? null;
  const failed = SUMMARY_SECTIONS.filter((section) => now?.unavailable.includes(section) ?? false);
  const tops: JSX.Element[] = [];
  if (fuel !== null && links !== null)
    tops.push(<FuelKpi key="fuel" fuel={fuel} links={links} branch={branch} />);
  if (custody !== null) tops.push(<CustodyKpi key="custody" custody={custody} branch={branch} />);
  if ((accidents !== null || violations !== null) && links !== null)
    tops.push(<OpenKpi key="open" accidents={accidents} violations={violations} links={links} />);
  return (
    <div data-dash-tab-body="summaries">
      <TabHead
        icon={I.wallet}
        title={t('fleet.dash.shell.tab.summaries')}
        sub={t('fleet.dash.summaries.sub')}
        end={
          <RefreshTools
            updatedAt={props.updatedAt}
            onRefresh={props.onRefresh}
            refreshing={props.refreshing}
            {...(props.clock === undefined ? {} : { clock: props.clock })}
          />
        }
      />
      {(failed.length > 0 || custody?.error === true) && (
        <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-3">
          {failed.map((section) => (
            <SectionError key={section} section={section} onRetry={props.onRetry} />
          ))}
          {custody?.error === true && (
            <SectionError section="custodyFund" onRetry={custody.refetch} />
          )}
        </div>
      )}
      {tops.length > 0 && <div className="grid grid-cols-1 gap-5 md:grid-cols-3">{tops}</div>}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {fuel !== null && links !== null && (
          <FuelColumn fuel={fuel} links={links} branch={branch} />
        )}
        {custody !== null && <CustodyColumn custody={custody} links={links} branch={branch} />}
        {(accidents !== null || violations !== null) && links !== null && (
          <OpenColumn accidents={accidents} violations={violations} links={links} />
        )}
      </div>
      <QuickLinks now={now} custody={custody} links={links} can={props.can} />
    </div>
  );
};
