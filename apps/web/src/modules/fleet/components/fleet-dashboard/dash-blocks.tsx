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
//   WORDS / COUNT_CHIP / FOOT_BAND   the class strings the harnesses share
import { type ReactNode } from 'react';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { Amount, count, useNoun, type DashNoun } from './dash-shell';
import {
  BAND,
  BIG,
  Card,
  Fig,
  Icon,
  IconTile,
  N,
  NUM,
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
