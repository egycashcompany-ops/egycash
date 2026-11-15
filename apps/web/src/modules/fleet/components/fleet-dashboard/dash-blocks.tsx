// «لوحة تحكم الحركة» — the blocks the redesigned tabs share, lifted from the owner-approved harnesses
// («نظرة عامة» layout B and «الحركة اليوم»: the same KPI card, figure faces and chips), so every new
// tab draws them from ONE place. Drawn from the kit's tokens only (dash-kit.tsx); render-only — no
// block counts anything: every figure arrives from the server as it is shown.
//
//   Kpi        the approved KPI card: the 4-px coloured edge, the dot title, the tag row, the icon
//              tile, the figure row, the line under it, then the grey band at its foot — a breakdown
//              (`box`) and/or a one-line foot (`foot`)
//   Big        a card's big figure (Cairo black), the dotted line when it opens its list
//   BigMoney   a big amount with «ج.م.»
//   Small      a figure inside a sentence
//   Counted    «2 سيارات», «1 سائق» — a count and its counted noun
//   Tally      «عاجل 4» — a heading's tally chip, red or amber
//   WORDS / COUNT_CHIP / FOOT_BAND / SHARE   the class strings the harnesses share
//
// And the pieces «توزيع السيارات» and «الصيانة والورش» add (zz-distribution.tsx / zz-maintenance.tsx):
//
//   HBars      named horizontal bars, each against the longest (moved here from the old «الصيانة»
//              body; the old «الكيلومترات» tab draws them too); `columns={2}` runs a long list down
//              two columns from 1024 px
//   HeadChip   a title chip that opens its screen
//   BlockHead / BlockFoot / NoteLine   a bordered block's head (icon tile, title, chips, note, an end
//              piece), its ruled foot, and a muted «ⓘ» line
//   BandHead   a band's head inside a tab that holds «الآن» and a period both (data-dash-band)
//   NowChip    «لقطة الآن» — a «now» card standing in a period band
//   Since      «منذ اليوم» / «منذ 12 يومًا»
//   RangeChip  the period a read answered for: «هذا الشهر · نوفمبر 2026», «آخر 30 يومًا · من … إلى …»
//   ReadBand   one read's face inside a tab of several reads: its skeleton, its error, or the band
import { type ReactNode } from 'react';
import { type FleetDashboardPeriodDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { Amount, Phrase, ReadError, count, useNoun, type DashNoun } from './dash-shell';
import {
  BAND,
  BIG,
  CHIP,
  Card,
  Fig,
  HEAD_CHIP,
  I,
  Icon,
  IconTile,
  MUTED,
  N,
  NOTE,
  NUM,
  RULE,
  STRONG,
  TITLE,
  TONE,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';

// ── Class strings ─────────────────────────────────────────────────────────────────────────────

/** The words beside a big figure («من 40 سيارة»). */
export const WORDS = 'text-[13px] font-bold text-slate-600 dark:font-semibold dark:text-slate-400';

/** A round chip holding a count and its noun («2 سيارات بلا سائق»); add a tone's `soft`. */
export const COUNT_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold dark:font-semibold';

/** The grey band at a card's foot (the approved Kpi look); add its text colour (a tone's `text`, or
 *  the slate the Kpi uses). */
export const FOOT_BAND = cn(
  BAND,
  'mt-auto flex items-center gap-2 px-5 py-3 text-[12.5px] font-bold leading-5 dark:font-semibold',
);
const FOOT_TEXT = 'text-slate-600 dark:text-slate-300';

/** A share («44%») beside a figure, in a small slate box: the bars', the columns', the matrix's. */
export const SHARE =
  'rounded bg-slate-100 px-1 text-[11px] text-slate-600 dark:bg-[#162135] dark:text-slate-300';

/** « · » between the parts of a line: real spaces, so the line reads (and copies) as words. */
export const Sep = (): JSX.Element => (
  <>
    {' '}
    <span aria-hidden="true" className="mx-0.5 text-slate-300 dark:text-slate-600">
      ·
    </span>{' '}
  </>
);

// ── Figures ───────────────────────────────────────────────────────────────────────────────────

/** A card's big figure (Cairo black, tight), the dotted line of a figure that opens its list. */
export const Big = ({
  children,
  link = null,
  className,
}: {
  children: ReactNode;
  link?: DashLink | null | undefined;
  className?: string | undefined;
}): JSX.Element => (
  <Fig link={link} className={cn(BIG, 'tabular-nums', className)}>
    <span dir="ltr">{children}</span>
  </Fig>
);

/** A big amount and «ج.م.»: the figure in the big face, the unit a size down; the figure alone wears
 *  the link's dotted line. */
export const BigMoney = ({
  value,
  link = null,
  className,
}: {
  value: number;
  link?: DashLink | null | undefined;
  className?: string | undefined;
}): JSX.Element => (
  <span className={cn(BIG, 'tabular-nums', className)}>
    <Fig link={link}>
      <Amount value={value} className="!font-[inherit]" />
    </Fig>
  </span>
);

/** A small figure in a sentence, opening its list when given a link. */
export const Small = ({
  children,
  link = null,
  className,
}: {
  children: ReactNode;
  link?: DashLink | null | undefined;
  className?: string | undefined;
}): JSX.Element => (
  <Fig link={link} className={cn('font-bold', className ?? STRONG)}>
    <N>{children}</N>
  </Fig>
);

/** «2 سيارات», «1 سائق» — a count and its noun, by the dashboard's own counting rule. */
export const Counted = ({
  n,
  noun,
  className,
}: {
  n: number;
  noun: DashNoun;
  className?: string | undefined;
}): JSX.Element => {
  const word = useNoun();
  return (
    <>
      <N className={cn(className)}>{count(n)}</N> {word(noun, n)}
    </>
  );
};

// ── The KPI card ──────────────────────────────────────────────────────────────────────────────

/**
 * The approved KPI card («نظرة عامة» B = «الحركة اليوم»): the edge, the dot title, the tag row, the
 * icon tile, the figure row, the line under it — then the grey band: `box` (a breakdown: tiles, an
 * exclusion list) and/or `foot` (one line, its icon and tone). The tag and sub rows keep their height
 * when empty, so the figures of a row of cards stand on one line.
 */
export const Kpi = ({
  id,
  tone,
  title,
  tag,
  icon,
  figure,
  sub,
  foot,
  footIcon,
  footTone,
  box,
  className,
  ...data
}: {
  id: string;
  tone: Tone;
  title: ReactNode;
  /** One or more `Tag`s (a state, a share, «الشركة كلها»). */
  tag?: ReactNode;
  icon: IconPath;
  figure: ReactNode;
  sub?: ReactNode;
  /** The one-line foot in the grey band. */
  foot?: ReactNode;
  footIcon?: IconPath | undefined;
  /** The foot's words in a tone's text colour; slate by default. */
  footTone?: Tone | undefined;
  /** The breakdown in the grey band (fills the card's remaining height). */
  box?: ReactNode;
  className?: string | undefined;
  [marker: `data-${string}`]: string | undefined;
}): JSX.Element => (
  <Card {...data} accent={tone} data-dash-kpi={id} className={className}>
    <div className={cn('flex flex-col px-5 pb-4 pt-5', box === undefined && 'flex-1')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap')}>
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
            />
            {title}
          </h3>
          <div className="mt-2 flex h-5 items-center gap-1.5">{tag}</div>
        </div>
        <IconTile d={icon} tone={tone} />
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">{figure}</div>
      <div className="mt-3 flex min-h-6 items-center text-[13px] leading-6">{sub}</div>
    </div>
    {box !== undefined && (
      <div data-dash-box={id} className={cn(BAND, 'flex flex-1 flex-col px-4 pb-4 pt-3')}>
        {box}
      </div>
    )}
    {foot !== undefined && (
      <div
        data-dash-foot={id}
        className={cn(FOOT_BAND, footTone === undefined ? FOOT_TEXT : TONE[footTone].text)}
      >
        {footIcon !== undefined && <Icon d={footIcon} className="h-4 w-4 shrink-0" />}
        <span className="min-w-0">{foot}</span>
      </div>
    )}
  </Card>
);

// ── A heading's tally ─────────────────────────────────────────────────────────────────────────

const TALLY =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-[13px] font-bold text-slate-700 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40 dark:font-semibold dark:text-slate-200';
const BUBBLE = cn(
  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
  NUM,
);

/** «عاجل 4» · «للمتابعة 25» — the dot, the word, the count in its bubble. */
export const Tally = ({
  tone,
  label,
  n,
}: {
  tone: 'red' | 'amber';
  label: string;
  n: number;
}): JSX.Element => (
  <span data-dash-tally={tone} className={TALLY}>
    <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE[tone].dot)} />
    {label}
    <span
      className={cn(
        BUBBLE,
        tone === 'red'
          ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
      )}
    >
      {count(n)}
    </span>
  </span>
);

// ── Named bars (moved from the old «الصيانة» body; the old «الكيلومترات» tab draws them too) ──────

export interface HBarRow {
  key: string;
  name: string;
  /** The figure as written («55,780»). */
  value: string;
  /** The figure as a number, for the bar's length. */
  n: number;
  unit?: string;
  /** The share beside the figure («44%»). */
  extra?: string;
  link: DashLink | null;
}

/**
 * A horizontal bar per row: the name, the figure (a link), its share; each bar's length against the
 * LONGEST row (the share is the one written beside it). Every data bar of the redesigned tabs is the
 * brand's (DECISIONS §5), the default; an old tab passes its own tone. `columns={2}`: from 1024 px
 * the same rows run down two columns (top to bottom, then the next column), still against the
 * longest — a list across a page's full width would set a name and its figure far apart.
 */
export const HBars = ({
  rows,
  tone = 'brand',
  columns = 1,
}: {
  rows: readonly HBarRow[];
  tone?: Tone;
  columns?: 1 | 2;
}): JSX.Element => {
  const max = Math.max(0, ...rows.map((row) => row.n));
  const two = columns === 2;
  return (
    <ul
      data-bars-columns={columns}
      className={cn(
        'space-y-3',
        two &&
          'lg:grid lg:auto-cols-[minmax(0,1fr)] lg:grid-flow-col lg:gap-x-14 lg:gap-y-3 lg:space-y-0',
      )}
      style={
        two
          ? { gridTemplateRows: `repeat(${Math.max(1, Math.ceil(rows.length / 2))}, auto)` }
          : undefined
      }
    >
      {rows.map((row) => (
        <li key={row.key} data-bar={row.key}>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">
              {row.name}
            </span>
            <span className="shrink-0 whitespace-nowrap">
              <Fig link={row.link} className={cn('font-bold', STRONG)}>
                <N>{row.value}</N>
              </Fig>
              {row.unit !== undefined && (
                <span className={cn('ms-1 text-xs', MUTED)}>{row.unit}</span>
              )}
              {row.extra !== undefined && <N className={cn('ms-1.5', SHARE)}>{row.extra}</N>}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
            <div
              data-bar-fill={row.key}
              className={cn('h-2 rounded-full', TONE[tone].bar)}
              style={{ width: `${max > 0 ? (row.n / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};

/** A title chip that opens its screen. */
export const HeadChip = ({
  link,
  children,
}: {
  link: DashLink | null;
  children: ReactNode;
}): JSX.Element => (
  <Fig link={link} className={HEAD_CHIP} linkedClassName="">
    {children}
  </Fig>
);

// ── A bordered block: its head, its foot, a note line ─────────────────────────────────────────

/** The head of a bordered block: the icon tile, the title and its chips, the note under it, and
 *  an end piece (a legend, a button) at the far side, wrapping under on a narrow card. */
export const BlockHead = ({
  icon,
  tone,
  title,
  note,
  chips,
  end,
}: {
  icon: IconPath;
  tone: Tone;
  title: ReactNode;
  note?: ReactNode;
  chips?: ReactNode;
  end?: ReactNode;
}): JSX.Element => (
  <div
    data-dash-block-head="true"
    className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-4"
  >
    <div className="flex min-w-0 items-center gap-3">
      <IconTile d={icon} tone={tone} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* One line from `sm` up; on a phone a long title («كيلومترات الفرع هذا الشهر حسب النوع»)
              wraps inside the card rather than over its edge. */}
          <h3 className={cn(TITLE, 'text-balance sm:whitespace-nowrap')}>{title}</h3>
          {chips}
        </div>
        {note !== undefined && <p className={cn('mt-0.5', NOTE)}>{note}</p>}
      </div>
    </div>
    {end !== undefined && <div className="min-w-0">{end}</div>}
  </div>
);

/**
 * The ruled foot of a block: its link and the lines that say what its figures count — side by side,
 * wrapping (the maintenance blocks' foot); `stack`: one line under another (the km chart's foot: the
 * average, then the note).
 */
export const BlockFoot = ({
  children,
  stack = false,
}: {
  children: ReactNode;
  stack?: boolean;
}): JSX.Element => (
  <div
    data-dash-block-foot="true"
    className={cn(
      'mt-auto border-t px-5 py-3.5 text-[13px] leading-6 text-slate-600 dark:text-slate-300',
      stack ? 'space-y-1' : 'flex flex-wrap items-center gap-x-5 gap-y-1.5',
      RULE,
    )}
  >
    {children}
  </div>
);

/** A muted line led by «ⓘ»: what a figure counts, or why one is missing. */
export const NoteLine = ({ children }: { children: ReactNode }): JSX.Element => (
  <p
    data-dash-note="true"
    className={cn('flex items-start gap-2 text-xs font-semibold leading-5', MUTED)}
  >
    <Icon d={I.info} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
    <span>{children}</span>
  </p>
);

// ── A band inside a tab of «الآن» and a period both ──────────────────────────────────────────

/**
 * A band's head: the dot, the title and its chips, the rule under them, and a muted line when the
 * band has something to add to the tab's own sub-line. «الآن» wears emerald and the live chip; the
 * period band sky and its range. The head carries `data-dash-band={id}`.
 */
export const BandHead = ({
  id,
  tone,
  title,
  sub,
  chips,
  first = false,
}: {
  id: string;
  tone: Tone;
  title: ReactNode;
  sub?: ReactNode;
  chips?: ReactNode;
  /** The tab's first band (a step less room above it). */
  first?: boolean;
}): JSX.Element => (
  <div
    data-dash-band={id}
    className={cn(
      'mb-4 border-b border-slate-200 pb-2.5 dark:border-[#1c263b]',
      first ? 'mt-1' : 'mt-2',
    )}
  >
    <div className="flex flex-wrap items-center gap-2.5">
      <h3 className={cn(TITLE, 'flex items-center gap-2 text-[17px]')}>
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)} />
        {title}
      </h3>
      {chips}
    </div>
    {sub !== undefined && (
      <p data-dash-band-sub={id} className={cn('mt-1 ps-4 text-xs font-semibold', MUTED)}>
        {sub}
      </p>
    )}
  </div>
);

/** «لقطة الآن» — the live chip's short form, on a «now» card that stands in a period band (it
 *  ignores the period); the same pinging dot as LiveChip. */
export const NowChip = (): JSX.Element => {
  const t = useT();
  return (
    <span data-now-chip="true" className={cn(CHIP, 'inline-flex items-center gap-1.5 py-1')}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      </span>
      {t('fleet.dash.common.liveShort')}
    </span>
  );
};

/** «منذ اليوم» on the day itself, else «منذ 12 يومًا» — amber and bold unless told otherwise. The
 *  days are the server's (Cairo today − the day); nothing is counted here. */
export const Since = ({ days, className }: { days: number; className?: string }): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return (
    <span
      data-since={days}
      className={cn('whitespace-nowrap', className ?? cn('font-bold', TONE.amber.text))}
    >
      {days === 0 ? (
        t('fleet.dash.common.sinceToday')
      ) : (
        <Phrase
          text={t('fleet.dash.common.since')}
          parts={{ count: <N>{count(days)}</N>, noun: noun('day', days) }}
        />
      )}
    </span>
  );
};

// ── The period a read answered for ────────────────────────────────────────────────────────────

/** «نوفمبر» — a month's name in the reader's language; the year is written apart, Latin digits. */
export const monthName = (ymd: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${ymd.slice(0, 7)}-01T00:00:00.000Z`));

/**
 * The range a read echoed, as a head chip: a whole calendar month by its name («هذا الشهر · نوفمبر
 * 2026», «الشهر الماضي · أكتوبر 2026»), any other range by its two days («آخر 30 يومًا · من
 * 2026/10/03 إلى 2026/11/01»). From the server's echo, never the browser's clock.
 */
export const RangeChip = ({ range }: { range: FleetDashboardPeriodDto['range'] }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const preset = t(`fleet.dash.filters.preset.${range.preset}`);
  const month = range.preset === 'thisMonth' || range.preset === 'lastMonth';
  return (
    <span data-dash-range={range.preset} className={HEAD_CHIP}>
      {month ? (
        <Phrase
          text={t('fleet.dash.common.monthChip')}
          parts={{
            preset,
            month: monthName(range.from, locale),
            year: <N>{range.from.slice(0, 4)}</N>,
          }}
        />
      ) : (
        <Phrase
          text={t('fleet.dash.common.rangeChip')}
          parts={{
            preset,
            from: <N>{slashDay(range.from)}</N>,
            to: <N>{slashDay(range.to)}</N>,
          }}
        />
      )}
    </span>
  );
};

// ── One read's face inside a tab of several reads ─────────────────────────────────────────────

/** A band's read on its way: a row of KPI-sized greys, never zeroes pretending to be data. */
const BandSkeleton = (): JSX.Element => (
  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-44 rounded-2xl" />
    ))}
  </div>
);

/**
 * One read's face in a tab that holds several (the «الآن» band reads R1, the period band R2): its
 * skeleton while it is on its way (`skeleton`, or a row of KPI greys), its error and «إعادة
 * المحاولة» when it failed with nothing to show, else the band. One read failing never blanks the
 * other's band.
 */
export const ReadBand = ({
  state,
  error = null,
  onRetry,
  skeleton,
  children,
}: {
  state: 'loading' | 'error' | 'ready';
  error?: unknown;
  onRetry: () => void;
  skeleton?: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <div data-read-band={state} aria-busy={state === 'loading'}>
    {state === 'loading' ? (
      <div data-dash-loading="true">{skeleton ?? <BandSkeleton />}</div>
    ) : state === 'error' ? (
      <ReadError error={error} onRetry={onRetry} />
    ) : (
      children
    )}
  </div>
);
