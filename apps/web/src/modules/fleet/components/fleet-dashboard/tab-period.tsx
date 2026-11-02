// Tab 6 «أرقام الفترة» — the approved Phase-1 sample (zz-fleetdash-p1.tsx, `PPeriod`) over R2's `km`,
// `visits`, `accidents`, `opex` and `dealership` (T6.1–T6.9), in the system palette.
//
// The rules the cards carry in their words (plan R-14, R-18…R-23):
//   · Kilometres exclude the readings that need review, and say how many (the odometer screen shows
//     the same count over the same filters).
//   · A visit belongs to the period by its check-in day and carries no money; «خرجت · ما زالت» and
//     «مفتوحة · المتبقي» are the rows' state NOW («حتى الآن»).
//   · Operating expenses are the receipts alone; the dealership invoices sit BESIDE them and are
//     never added to them anywhere on the page (Q-05) — the note under the two says why.
//   · A money card whose data starts after the period's first day says «البيانات متاحة من …».
//
// Also the period tabs' shared pieces: the props every tab body takes, the km figure's face.
import { Fragment, type ReactNode } from 'react';
import {
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodSection,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { type DashLink, type PeriodLinks } from '../../lib/fleet-dashboard-links';
import { shareText, share, slashDay } from '../../lib/fleet-dashboard-tabs';
import { useMoney } from '../custody-dashboard-parts';
import {
  AMBER,
  CAIRO,
  Card,
  Fig,
  I,
  Icon,
  IconTile,
  Meter,
  NOTE,
  N,
  PCT,
  RULE,
  STRONG,
  UNIT,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { Phrase, SectionError, count, useNoun } from './dash-shell';

// ── What every period tab body is given ─────────────────────────────────────────────────────────

export interface PeriodBodyProps {
  /** R2's answer: the echo (`range`, `vehicleScope`) and the sections this reader may see. */
  data: FleetDashboardPeriodDto;
  /** Every link of the period tabs, from the echo (`periodLinks`). */
  links: PeriodLinks;
  can: (permission: string) => boolean;
  /** «إعادة المحاولة» on a section that failed. */
  onRetry: () => void;
}

/** The server could not compute this section (it is also `null`). */
export const sectionFailed = (
  data: FleetDashboardPeriodDto,
  section: FleetDashboardPeriodSection,
): boolean => (data.unavailable as readonly string[]).includes(section);

const KM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** Kilometres as the boards write them: whole, comma-grouped. */
export const kmText = (value: number): string => KM.format(value);

/** «… · …» — the separator between two parts of a sub-line. */
export const Dot = (): JSX.Element => <span className="mx-1 text-slate-400">·</span>;

// ── The KPI card of the sample ────────────────────────────────────────────────────────────────

const FIG = cn('text-2xl font-black tracking-tight', STRONG, CAIRO);
const SUB = 'text-xs leading-5 text-slate-600 dark:text-slate-400';

/** The thin share bar under a card: one or two parts, its words, the share at its end. */
const ShareBar = ({
  parts,
  text,
  pct,
}: {
  parts: readonly { pct: number; tone: Tone }[];
  text: ReactNode;
  pct: string;
}): JSX.Element => (
  <div className="mt-2.5">
    <Meter parts={parts} height="h-1.5" />
    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="min-w-0">{text}</span>
      <span dir="ltr" className={cn(PCT, 'shrink-0')}>
        {pct}
      </span>
    </div>
  </div>
);

const Kpi = ({
  section,
  label,
  figure,
  icon,
  tone,
  sub,
  bar,
}: {
  section: FleetDashboardPeriodSection;
  label: string;
  figure: ReactNode;
  icon: IconPath;
  tone: Tone;
  sub: ReactNode;
  bar: ReactNode;
}): JSX.Element => (
  <Card accent={tone} data-period-card={section} className="p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300">
          {label}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-1">{figure}</div>
      </div>
      <IconTile d={icon} tone={tone} />
    </div>
    <div className={cn('mt-3 border-t pt-2', RULE, SUB)}>{sub}</div>
    <div className="mt-auto">{bar}</div>
  </Card>
);

/** A whole figure that opens its screen, and its unit after it. */
const Figure = ({
  value,
  link,
  unit,
}: {
  value: string;
  link: DashLink | null;
  unit?: string;
}): JSX.Element => (
  <>
    <Fig link={link} className={FIG}>
      <span dir="ltr">{value}</span>
    </Fig>
    {unit !== undefined && <span className={UNIT}>{unit}</span>}
  </>
);

/** An amount inside a sentence: the figure face, «ج.م.» after it. */
const Money = ({ value, link }: { value: number; link?: DashLink | null }): JSX.Element => {
  const { figure, currency } = useMoney()(value);
  return (
    <span className="whitespace-nowrap">
      <Fig link={link ?? null} className="font-bold">
        <N>{figure}</N>
      </Fig>{' '}
      <span className={UNIT}>{currency}</span>
    </span>
  );
};

/** «البيانات متاحة من …» — only when the period starts before the source's first day (R-21). */
const DataFrom = ({
  from,
  dataFrom,
}: {
  from: string;
  dataFrom: string | null;
}): JSX.Element | null => {
  const t = useT();
  if (dataFrom === null || from >= dataFrom) return null;
  return (
    <span data-data-from={dataFrom} className={cn('block', AMBER)}>
      <Phrase text={t('fleet.dash.period.dataFrom')} parts={{ day: <N>{slashDay(dataFrom)}</N> }} />
    </span>
  );
};

const pctOf = (part: number, whole: number): number => share(part, whole) ?? 0;

// ── The five cards ────────────────────────────────────────────────────────────────────────────

const KmCard = ({ data, links }: PeriodBodyProps): JSX.Element | null => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const km = data.km;
  if (km === null) return null;
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  const openDays = [
    ...km.buckets.filter((b) => b.pending > 0 && b.key !== data.today).map((b) => slashDay(b.key)),
    ...(km.buckets.some((b) => b.key === data.today && b.hasRows)
      ? [t('fleet.dash.period.today')]
      : []),
  ];
  // «2026/10/31 واليوم»: the reading's own list words; each day in the figure face.
  const days = list
    .formatToParts(openDays)
    .map((part, i) =>
      part.type === 'element' && /^\d/u.test(part.value) ? (
        <N key={i}>{part.value}</N>
      ) : (
        <Fragment key={i}>{part.value}</Fragment>
      ),
    );
  return (
    <Kpi
      section="km"
      label={t('fleet.dash.period.km.title')}
      icon={I.pin}
      tone="emerald"
      figure={
        <Figure
          value={kmText(km.total)}
          link={links.km('km.total')}
          unit={t('fleet.dash.km.unit')}
        />
      }
      sub={
        <>
          {km.perVehicleAvg !== null && (
            <>
              <Phrase
                text={t('fleet.dash.period.km.average')}
                parts={{ km: <N>{kmText(km.perVehicleAvg)}</N> }}
              />
              <Dot />
            </>
          )}
          <strong className="font-bold text-slate-700 dark:text-slate-200">
            {km.confirmedThrough === null ? (
              t('fleet.dash.period.km.noneConfirmed')
            ) : (
              <Phrase
                text={t('fleet.dash.period.km.confirmedThrough')}
                parts={{ day: <N>{slashDay(km.confirmedThrough)}</N> }}
              />
            )}
          </strong>
          <span className="block">
            {openDays.length > 0 && (
              <>
                <Phrase text={t('fleet.dash.period.km.open')} parts={{ days: <>{days}</> }} />
                {km.invalidRows > 0 && <Dot />}
              </>
            )}
            {km.invalidRows > 0 && (
              <Fig link={links.km('km.invalidRows')} className={AMBER}>
                <Phrase
                  text={t('fleet.dash.period.km.invalid')}
                  parts={{ count: <N>{count(km.invalidRows)}</N> }}
                />
              </Fig>
            )}
          </span>
        </>
      }
      bar={
        <ShareBar
          parts={[{ pct: pctOf(km.coverage.withReadings, km.coverage.of), tone: 'emerald' }]}
          text={
            <Phrase
              text={t('fleet.dash.period.km.coverage')}
              parts={{
                with: <N>{count(km.coverage.withReadings)}</N>,
                of: <N>{count(km.coverage.of)}</N>,
                noun: noun('car', km.coverage.of),
              }}
            />
          }
          pct={shareText(km.coverage.withReadings, km.coverage.of)}
        />
      }
    />
  );
};

const VisitsCard = ({ data, links }: PeriodBodyProps): JSX.Element | null => {
  const t = useT();
  const visits = data.visits;
  if (visits === null) return null;
  return (
    <Kpi
      section="visits"
      label={t('fleet.dash.period.visits.title')}
      icon={I.cog}
      tone="sky"
      figure={<Figure value={count(visits.count)} link={links.visits('visits.count')} />}
      sub={
        <>
          <Phrase
            text={t('fleet.dash.period.visits.split')}
            parts={{
              closed: (
                <Fig link={links.visits('visits.closed', { state: 'closed' })}>
                  <N>{count(visits.closed)}</N>
                </Fig>
              ),
              open: (
                <Fig link={links.visits('visits.open', { state: 'open' })}>
                  <N>{count(visits.open)}</N>
                </Fig>
              ),
            }}
          />
          <span className="block">{t('fleet.dash.period.visits.note')}</span>
        </>
      }
      bar={
        <ShareBar
          parts={[{ pct: pctOf(visits.closed, visits.count), tone: 'sky' }]}
          text={t('fleet.dash.period.visits.bar')}
          pct={shareText(visits.closed, visits.count)}
        />
      }
    />
  );
};

const AccidentsCard = ({ data, links }: PeriodBodyProps): JSX.Element | null => {
  const t = useT();
  const accidents = data.accidents;
  if (accidents === null) return null;
  return (
    <Kpi
      section="accidents"
      label={t('fleet.dash.period.accidents.title')}
      icon={I.warn}
      tone="rose"
      figure={<Figure value={count(accidents.count)} link={links.accidents('accidents.count')} />}
      sub={
        <>
          <Phrase
            text={t('fleet.dash.period.accidents.split')}
            parts={{
              open: (
                <Fig link={links.accidents('accidents.open', 'open')}>
                  <N>{count(accidents.open)}</N>
                </Fig>
              ),
              amount: (
                <Money
                  value={accidents.openRemaining}
                  link={links.accidents('accidents.openRemaining', 'open')}
                />
              ),
            }}
          />
          {accidents.undated !== null && accidents.undated > 0 && (
            <span data-undated="true" className="block">
              <Phrase
                text={t('fleet.dash.period.accidents.undated')}
                parts={{ count: <N>{count(accidents.undated)}</N> }}
              />
            </span>
          )}
        </>
      }
      bar={
        <ShareBar
          parts={[{ pct: pctOf(accidents.open, accidents.count), tone: 'rose' }]}
          text={t('fleet.dash.period.accidents.bar')}
          pct={shareText(accidents.open, accidents.count)}
        />
      }
    />
  );
};

const OpexCard = ({ data, links, can }: PeriodBodyProps): JSX.Element | null => {
  const t = useT();
  const money = useMoney();
  const opex = data.opex;
  if (opex === null) return null;
  const total = money(opex.total);
  // D20: the custody part opens «مصروفات العهدة» when nothing but codes narrows — a screen of its own
  // guard; without that grant the part is shown as it is.
  const custody = links.opexCustody();
  const custodyLink =
    custody.to.startsWith('/fleet/custody-expenses') && !can('fleetCustody.view')
      ? links.opex('opex.custody', 'custody')
      : custody;
  return (
    <Kpi
      section="opex"
      label={t('fleet.dash.period.opex.title')}
      icon={I.cash}
      tone="amber"
      figure={<Figure value={total.figure} link={links.opex('opex.total')} unit={total.currency} />}
      sub={
        <>
          <Phrase
            text={t('fleet.dash.period.opex.split')}
            parts={{
              card: <Money value={opex.card} link={links.opex('opex.card', 'card')} />,
              custody: <Money value={opex.custody} link={custodyLink} />,
            }}
          />
          <span className="block">{t('fleet.dash.period.opex.note')}</span>
          <DataFrom from={data.range.from} dataFrom={opex.dataFrom} />
        </>
      }
      bar={
        <ShareBar
          parts={[
            { pct: pctOf(opex.card, opex.total), tone: 'amber' },
            { pct: pctOf(opex.custody, opex.total), tone: 'slate' },
          ]}
          text={t('fleet.dash.period.opex.bar')}
          pct={`${shareText(opex.card, opex.total)} · ${shareText(opex.custody, opex.total)}`}
        />
      }
    />
  );
};

const DealershipCard = ({ data, links }: PeriodBodyProps): JSX.Element | null => {
  const t = useT();
  const noun = useNoun();
  const money = useMoney();
  const dealership = data.dealership;
  if (dealership === null) return null;
  const amount = money(dealership.amount);
  const priced = dealership.rows - dealership.pending;
  return (
    <Kpi
      section="dealership"
      label={t('fleet.dash.period.dealership.title')}
      icon={I.briefcase}
      tone="blue"
      figure={
        <Figure
          value={amount.figure}
          link={links.dealership('dealership.amount')}
          unit={amount.currency}
        />
      }
      sub={
        <>
          <Fig link={links.dealership('dealership.rows')}>
            <N>{count(dealership.rows)}</N> {noun('row', dealership.rows)}
          </Fig>
          {dealership.pending > 0 && (
            <>
              <Dot />
              <Fig link={links.dealership('dealership.pending', 'pending')} className={AMBER}>
                <Phrase
                  text={t('fleet.dash.period.dealership.pending')}
                  parts={{ count: <N>{count(dealership.pending)}</N> }}
                />
              </Fig>
            </>
          )}
          <span className="block">{t('fleet.dash.period.dealership.note')}</span>
          <DataFrom from={data.range.from} dataFrom={dealership.dataFrom} />
        </>
      }
      bar={
        <ShareBar
          parts={[{ pct: pctOf(priced, dealership.rows), tone: 'blue' }]}
          text={t('fleet.dash.period.dealership.bar')}
          pct={shareText(priced, dealership.rows)}
        />
      }
    />
  );
};

const SECTIONS = ['km', 'visits', 'accidents', 'opex', 'dealership'] as const;

export const PeriodFiguresTab = (props: PeriodBodyProps): JSX.Element => {
  const t = useT();
  const { data, onRetry } = props;
  const failed = SECTIONS.filter((section) => sectionFailed(data, section));
  const both = data.opex !== null && data.dealership !== null;
  return (
    <div data-dash-tab-body="period">
      {failed.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-3">
          {failed.map((section) => (
            <SectionError key={section} section={section} onRetry={onRetry} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2 [&:empty]:hidden [&>*]:h-full">
          <KmCard {...props} />
        </div>
        <div className="lg:col-span-2 [&:empty]:hidden [&>*]:h-full">
          <VisitsCard {...props} />
        </div>
        <div className="lg:col-span-2 [&:empty]:hidden [&>*]:h-full">
          <AccidentsCard {...props} />
        </div>
        <div className="lg:col-span-3 [&:empty]:hidden [&>*]:h-full">
          <OpexCard {...props} />
        </div>
        <div className="lg:col-span-3 [&:empty]:hidden [&>*]:h-full">
          <DealershipCard {...props} />
        </div>
        {both && (
          <div
            data-not-summed="true"
            className={cn(
              'flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-2.5 sm:col-span-2 lg:col-span-6 dark:border-[#26324a] dark:bg-[#0a101b]/70',
              NOTE,
            )}
          >
            <Icon d={I.warn} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {t('fleet.dash.period.notSummed')}
          </div>
        )}
      </div>
    </div>
  );
};
