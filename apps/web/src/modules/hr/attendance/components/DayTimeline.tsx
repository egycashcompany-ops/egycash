// One day as a strip of clock: where the scans landed, and how much of the day they span.
//
// WHY A PICTURE OF TWO TIMES THAT ARE ALREADY PRINTED BESIDE IT. A column of times is read one
// row at a time; this is read down the column in one pass. Fifteen rows whose dots all sit under
// the 8 AM tick and one that sits under noon is a fact nobody extracts from fifteen printed
// times, and it is the fact a supervisor opens the screen for.
//
// THE SCALE IS FIXED at 8 AM → midnight, for every row and every employee. A scale that fitted
// itself to each row's own times would put every arrival at the left edge and say nothing; a
// shared scale is what makes two rows comparable, which is the whole point of drawing it.
//
// LTR-LOCKED, like every other time in this product (R10): 8 AM sits on the left in both
// languages. Mirroring a clock under RTL would put the morning on the right on one screen and on
// the left on the next, and the dots would stop meaning anything at a glance.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cairoMinutes } from './attendance-stats';
import { cairoTime } from './minutes';

/** The window the strip covers, in minutes past Cairo midnight. */
const START = 8 * 60;
const END = 24 * 60;
const SPAN = END - START;
const MINUTES_IN_DAY = 1440;

/** The hours the ticks and the column header mark. */
export const TIMELINE_TICKS = [8, 12, 16, 20, 24] as const;

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Where a minute-of-day sits on the strip, as a percentage. Outside the window it sits at the edge. */
const position = (minuteOfDay: number): number => clamp(((minuteOfDay - START) / SPAN) * 100);

/**
 * `8 AM · 12 PM · 4 PM · 8 PM · 12 AM` — the strip's column header, drawn once above the rows.
 *
 * Each label is PLACED BY THE SAME `position()` the row's ticks use, rather than spread across
 * the width by the layout. A flex row would look identical in English and could not be trusted to
 * stay in step under RTL — and a scale whose labels disagree with its marks is worse than no
 * scale at all.
 */
export const TimelineScale = ({ sparse = false }: { sparse?: boolean }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const format = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  });
  // The marks stay five either way; `sparse` labels three of them, for the daily sheet, whose
  // timeline shares a row with seven other columns and cannot give five labels room to stand
  // apart. Three still say which way the day runs, which is all the scale has to do.
  const labelled = sparse ? ([8, 16, 24] as const) : TIMELINE_TICKS;
  const last = labelled.length - 1;
  return (
    <span
      dir="ltr"
      className="relative block h-4 w-full min-w-[7rem] text-[10px] font-normal normal-case tracking-normal text-slate-400"
    >
      {labelled.map((hour, index) => (
        <span
          key={hour}
          className="absolute whitespace-nowrap"
          style={{
            insetInlineStart: `${position(hour * 60)}%`,
            // The ends are pulled inside the strip; the rest are centred on their mark.
            transform:
              index === 0 ? 'none' : index === last ? 'translateX(-100%)' : 'translateX(-50%)',
          }}
        >
          {format.format(new Date(Date.UTC(2000, 0, 1, hour % 24)))}
        </span>
      ))}
    </span>
  );
};

export const DayTimeline = ({
  inAt,
  outAt,
}: {
  inAt: string | null;
  outAt: string | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const inMinutes = inAt === null ? null : cairoMinutes(inAt);
  // A check-out EARLIER on the clock than the check-in happened after midnight (a night shift,
  // keyed to the day it started). Counted past 24:00 so the bar runs to the right edge instead of
  // doubling back across the whole morning.
  const rawOut = outAt === null ? null : cairoMinutes(outAt);
  const outMinutes =
    rawOut === null
      ? null
      : inMinutes !== null && rawOut < inMinutes
        ? rawOut + MINUTES_IN_DAY
        : rawOut;

  const label =
    inAt === null
      ? t('attendance.timeline.nothing')
      : `${cairoTime(inAt, locale)} → ${outAt === null ? t('attendance.timeline.noOut') : cairoTime(outAt, locale)}`;

  return (
    <span
      dir="ltr"
      role="img"
      aria-label={label}
      title={label}
      className="relative block h-5 w-full min-w-[7rem]"
    >
      {/* The hour grid: a hairline for the whole window and a tick on each labelled hour. */}
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-slate-700" />
      {TIMELINE_TICKS.map((hour) => (
        <span
          key={hour}
          className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-slate-200 dark:bg-slate-700"
          style={{ insetInlineStart: `${position(hour * 60)}%` }}
        />
      ))}

      {/* The worked span. Drawn only when both ends are known — a bar to an imagined check-out
          would be the same lie the old table's confident `0:00` told. */}
      {inMinutes !== null && outMinutes !== null && (
        <span
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-500/70"
          style={{
            insetInlineStart: `${position(inMinutes)}%`,
            width: `${Math.max(0, position(outMinutes) - position(inMinutes))}%`,
          }}
        />
      )}

      {inMinutes !== null && (
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
          style={{ insetInlineStart: `${position(inMinutes)}%`, marginInlineStart: '-0.25rem' }}
        />
      )}
      {outMinutes !== null && (
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-slate-900"
          style={{ insetInlineStart: `${position(outMinutes)}%`, marginInlineStart: '-0.25rem' }}
        />
      )}
    </span>
  );
};
