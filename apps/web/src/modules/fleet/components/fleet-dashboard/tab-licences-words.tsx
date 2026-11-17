// «التراخيص والتجديدات» — the tab's own words and the small faces its parts share
// (tab-licences-now.tsx, tab-licences-chart.tsx, tab-licences-tables.tsx, tab-licences-period.tsx),
// as the approved sample writes them (approved/lic-dark.png, lic-branch-dark.png; harness
// zz-licences-tab.tsx; DECISIONS §11):
//
//   · the counted words with a dual, in the custody pages' five forms («سيارة واحدة»، «سيارتان»،
//     «8 سيارات»، «13 سيارة»، «100 سيارة»; «يومين» after «منذ» / «بعد» / «خلال»): the kit's counted
//     noun (`useNoun`) has no dual, so the chips, the readout and the day phrases count here;
//   · ONE spelling per licence state (critic B8): «منتهٍ اليوم»، «منتهٍ منذ يومين»، «بعد 13 يومًا»,
//     and the board's colour of a licence day — red past, amber within the warning days, neutral
//     after;
//   · an amount, a day as the boards write it;
//   · whether the figures are narrowed to the reader's branches (one branch or «كل فروعي»), and
//     which of the tab's sections a reader meets drawn, failed or not at all.
//
// Nothing is counted here: every `n` is a server field.
import { type ReactNode } from 'react';
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { sectionPermitted, slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyPlural } from '../../lib/custody-words';
import { Amount, Phrase, count, type MixedTabProps } from './dash-shell';
import { FOOT_BAND, Small } from './dash-blocks';
import { Fig, MUTED, N, RULE, STRONG, cn, type Tone } from './dash-kit';

/** The word of a key under the tab's own namespace. */
export const useLicenceWords = (): ((
  key: string,
  params?: Record<string, string | number>,
) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.licences.${key}`, params);
};

// ── Counted words with a dual ─────────────────────────────────────────────────────────────────

export type LicenceNoun = 'car' | 'driver' | 'day';

/**
 * «13 سيارة», «سائقان», «سيارة واحدة» — the figure (or the words for one and two) in the figure's
 * colour, opening its list when given a link, the noun in the line's colour. `data-lic-count`
 * carries the server's figure.
 */
export const Counted = ({
  n,
  noun,
  link = null,
  figure = STRONG,
}: {
  n: number;
  noun: Exclude<LicenceNoun, 'day'>;
  link?: DashLink | null;
  /** The figure's colour (STRONG by default, as the approved counts). */
  figure?: string;
}): JSX.Element => {
  const w = useLicenceWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const text = w(`count.${noun}.${custodyPlural(locale, n)}`);
  return (
    <span data-lic-count={String(n)} data-lic-noun={noun} className="whitespace-nowrap">
      {text.includes('{{count}}') ? (
        <Phrase
          text={text}
          parts={{
            count: (
              <Small link={link} className={figure}>
                {count(n)}
              </Small>
            ),
          }}
        />
      ) : (
        <Fig link={link} className={cn('font-bold', figure)}>
          {text}
        </Fig>
      )}
    </span>
  );
};

/** The same count as plain words, for a phrase that is itself a string («خلال 30 يومًا»). */
export const useCountedText = (): ((noun: LicenceNoun, n: number) => string) => {
  const w = useLicenceWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (noun, n) => w(`count.${noun}.${custodyPlural(locale, n)}`, { count: count(n) });
};

// ── A licence's state ─────────────────────────────────────────────────────────────────────────

/** The board's colour of a licence day: red on or past it, amber within the warning days, neutral
 *  after (the vehicles list's date colour). `days` = the server's expiry − Cairo today. */
export type LicenceTone = Extract<Tone, 'red' | 'amber' | 'slate'>;
export const licenceTone = (days: number, warnDays: number): LicenceTone =>
  days <= 0 ? 'red' : days <= warnDays ? 'amber' : 'slate';

export const DATE_TONE: Record<LicenceTone, string> = {
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-700 dark:text-amber-400',
  slate: 'text-slate-700 dark:text-slate-200',
};

/** «يومين», «3 أيام», «13 يومًا» — the days after «منذ» / «بعد», the figure in the figure face. */
const Days = ({ n }: { n: number }): JSX.Element => {
  const w = useLicenceWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <Phrase
      text={w(`count.day.${custodyPlural(locale, n)}`)}
      parts={{ count: <N>{count(n)}</N> }}
    />
  );
};

/** «منتهٍ اليوم» · «منتهٍ منذ يومين» · «بعد 13 يومًا» — one spelling on the whole tab (critic B8). */
export const DayPhrase = ({ days }: { days: number }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  return (
    <span data-lic-days={String(days)} className="whitespace-nowrap">
      {days === 0 ? (
        t('fleet.dash.licences.expiredToday')
      ) : (
        <Phrase
          text={w(days < 0 ? 'state.expiredSince' : 'state.expiresIn')}
          parts={{ days: <Days n={Math.abs(days)} /> }}
        />
      )}
    </span>
  );
};

// ── Figures and days ──────────────────────────────────────────────────────────────────────────

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

/** A day as the dashboard writes it: «2026/11/09», no time. `tone` REPLACES the neutral colour (the
 *  kit's `cn` merges nothing: two colours in one class list would leave the stylesheet to choose). */
export const Day = ({ ymd, tone }: { ymd: string; tone?: string }): JSX.Element => (
  <N className={cn('font-semibold', tone ?? DATE_TONE.slate)}>{slashDay(ymd)}</N>
);

/** The grey foot band of a card; its height kept so a row of cards' bands stand level. */
export const FOOT = cn(FOOT_BAND, 'min-h-[46px]', MUTED);

/** A block's end in words: that it is empty. */
export const EndLine = ({
  marker,
  children,
}: {
  marker: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-lic-end={marker}
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

export type LicenceNowSection = 'licenceVehicles' | 'licenceDrivers' | 'papers';

/** The tab's R1 sections, in the order its cards draw them: the cars, the papers, the drivers. */
export const LICENCE_NOW_SECTIONS: readonly LicenceNowSection[] = [
  'licenceVehicles',
  'papers',
  'licenceDrivers',
];

/** An R1 section of this tab: only when the reader holds every key of its gate. */
export const nowView = (
  now: FleetDashboardNowDto | null,
  can: (permission: string) => boolean,
  section: LicenceNowSection,
): SectionView => {
  if (now === null || !sectionPermitted(section, can)) return 'hidden';
  if (now.unavailable.includes(section)) return 'failed';
  return now[section] === null ? 'hidden' : 'shown';
};

/** The period's `licenceSpend` the same way. */
export const spendView = (
  data: FleetDashboardPeriodDto,
  can: (permission: string) => boolean,
): SectionView => {
  if (!sectionPermitted('licenceSpend', can)) return 'hidden';
  if (data.unavailable.includes('licenceSpend')) return 'failed';
  return data.licenceSpend === null ? 'hidden' : 'shown';
};

/** The figures are narrowed to the reader's branches — one branch, or «كل فروعي» (R1's echo, else
 *  R2's): the drivers' note and the period band's «الشركة كلها» say so. */
export const narrowedView = (props: Pick<MixedTabProps, 'now' | 'period'>): boolean =>
  (props.now?.scopeBranches ?? props.period.data?.vehicleScope.scopeBranches ?? null) !== null;
