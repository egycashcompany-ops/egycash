// «الوقود والمصروفات» — the tab's own words and the small faces its two bands share (tab-fuel-now.tsx,
// tab-fuel-period.tsx, tab-fuel-chart.tsx): the counted words the approved sample writes with a
// dual («كارت واحد»، «كارتان»، «طلبان»، «صفّان», zz-fuel.tsx), the company word in its register
// colour, an amount muted at 0.00, a day as the boards write it, and which of the tab's sections a
// reader meets drawn, failed or not at all.
//
// The kit's counted noun (`useNoun`) has one / few / other only, so «2 كروت» is all it can say; the
// approved wording says one and two IN WORDS inside a sentence and on a chip. That form lives here,
// under the tab's own keys (`fleet.dash.fuel.count.<noun>.{one,two,few,other}`) — no kit change.
// Nothing is counted: every `n` is a server field.
import { type ReactNode } from 'react';
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetFuelCardCompany,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { sectionPermitted, slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyCountForm } from '../custody-dashboard-parts';
import { Amount, Phrase, count } from './dash-shell';
import { FOOT_BAND, Small } from './dash-blocks';
import { Fig, MUTED, N, RULE, STRONG, TONE, cn, type Tone } from './dash-kit';

/** The word of a key under the tab's own namespace. */
export const useFuelWords = (): ((
  key: string,
  params?: Record<string, string | number>,
) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.fuel.${key}`, params);
};

// ── Counted words with a dual ─────────────────────────────────────────────────────────────────

export type FuelNoun = 'card' | 'request' | 'row' | 'receipt' | 'litre';
export type DualForm = 'one' | 'two' | 'few' | 'other';

/** One and two in words («كارت واحد»، «كارتان»); every other count keeps its figure and takes the
 *  dashboard's counting rule (`custodyCountForm`: «3 كروت»، «14 كارتًا»). */
export const dualForm = (locale: Locale, n: number): DualForm => {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  return custodyCountForm(locale, n) === 'few' ? 'few' : 'other';
};

/**
 * «5 طلبات», «كارت واحد», «طلبان» — the figure (or the words for one or two) in the figure's colour,
 * opening its list when given a link, the noun in the line's colour. `data-fuel-count` carries the
 * server's figure.
 */
export const Dual = ({
  n,
  noun,
  link = null,
  figure = STRONG,
}: {
  n: number;
  noun: FuelNoun;
  link?: DashLink | null;
  /** The figure's colour (STRONG by default, as the approved counts). */
  figure?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const form = dualForm(locale, n);
  const key = `fleet.dash.fuel.count.${noun}.${form}`;
  return (
    <span data-fuel-count={String(n)} data-fuel-noun={noun} className="whitespace-nowrap">
      {form === 'one' || form === 'two' ? (
        <Fig link={link} className={cn('font-bold', figure)}>
          {t(key)}
        </Fig>
      ) : (
        <Phrase
          text={t(key)}
          parts={{
            count: (
              <Small link={link} className={figure}>
                {count(n)}
              </Small>
            ),
          }}
        />
      )}
    </span>
  );
};

// ── The companies ─────────────────────────────────────────────────────────────────────────────

/** The register's company colour (FuelCardBoard): وطنية emerald, شل أوت amber (critic C1). */
export const COMPANY_TONE: Record<FleetFuelCardCompany, Tone> = {
  wataniya: 'emerald',
  chillout: 'amber',
};

/** «وطنية» / «شل أوت» in its register colour. */
export const CompanyWord = ({
  company,
  className,
}: {
  company: FleetFuelCardCompany;
  className?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <span data-fuel-company={company} className={cn(TONE[COMPANY_TONE[company]].text, className)}>
      {t(`fleet.fuelCards.company.${company}`)}
    </span>
  );
};

// ── Figures ───────────────────────────────────────────────────────────────────────────────────

/** A 0.00 amount reads muted wherever it stands. */
const ZERO = '!text-slate-500 dark:!text-slate-400';

/** An amount and «ج.م.», muted at 0.00, opening its list when given a link. */
export const Money = ({
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

/** A day as the dashboard writes it: «2026/11/09», no time. */
export const Day = ({ ymd, className }: { ymd: string; className?: string }): JSX.Element => (
  <N className={cn('font-semibold text-slate-700 dark:text-slate-200', className)}>
    {slashDay(ymd)}
  </N>
);

/** «—» where a value is not known (no request, no expiry, no invoice number). */
export const Dash = (): JSX.Element => <span className={cn('font-semibold', MUTED)}>—</span>;

/** The grey foot band of a card; its height kept so a row of cards' bands stand level. */
export const FOOT = cn(FOOT_BAND, 'min-h-[46px] whitespace-nowrap max-sm:whitespace-normal', MUTED);

/** A block's end in words: that it is empty. */
export const EndLine = ({
  marker,
  children,
}: {
  marker: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-fuel-end={marker}
    className={cn(
      'flex items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
      RULE,
      MUTED,
    )}
  >
    {children}
  </div>
);

// ── Which sections this reader meets ──────────────────────────────────────────────────────────

/** A section as this reader meets it: not theirs (or not sent), drawn, or failed (its error). */
export type SectionView = 'hidden' | 'shown' | 'failed';

export type FuelNowSection = 'fuelCards' | 'fuelCharging' | 'fuelCardList' | 'fuelSheets';
export type FuelPeriodSection = 'opex' | 'opexSeries' | 'dealership' | 'dealershipList';

/** An R1 section of this tab: only when the reader holds every key of its gate. */
export const nowView = (
  now: FleetDashboardNowDto | null,
  can: (permission: string) => boolean,
  section: FuelNowSection,
): SectionView => {
  if (now === null || !sectionPermitted(section, can)) return 'hidden';
  if (now.unavailable.includes(section)) return 'failed';
  return now[section] === null ? 'hidden' : 'shown';
};

/** An R2 section of this tab, the same way. */
export const periodView = (
  data: FleetDashboardPeriodDto,
  can: (permission: string) => boolean,
  section: FuelPeriodSection,
): SectionView => {
  if (!sectionPermitted(section, can)) return 'hidden';
  if (data.unavailable.includes(section)) return 'failed';
  return data[section] === null ? 'hidden' : 'shown';
};
