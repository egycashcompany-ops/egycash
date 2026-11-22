// The TIMELINE ROW — the one visual both the daily board and the employee's days are built on.
//
// A shared hour ruler; on each row the EXPECTED shift as a faint band and the WORKED span as a solid
// bar from the first check-in to the first check-out, with the two times at its ends. Early, late,
// short and overtime read off the geometry: a bar that starts right of the band is a late arrival,
// one that stops before it ended is an early leave. Every scan can be drawn on the track as well —
// the two counted ones as dots, repeats as small ticks — which is how the employee page shows the
// extra presses without a warning anywhere.
//
// Minutes are minutes after the work date's midnight and MAY EXCEED 1440 (a night or 24-hour shift's
// check-out lands the next day), so the range is computed per list rather than fixed at one day.
import { cn } from '../../../../shared/lib/cn';
import { FIG, INK3, type Tone } from './view-parts';
import { clock } from './view-format';
import type { TimeSpan } from './view-types';

export interface TrackRange {
  from: number;
  to: number;
}

export interface TrackScan {
  at: number;
  role: 'arrival' | 'departure' | 'repeat';
}

/**
 * One range for a whole list, so every row's bars line up on the same ruler: at least 06:00–20:00,
 * widened to whole hours to hold every expected shift and every scan on the list.
 */
export const trackRangeFor = (
  rows: readonly { inAt: number | null; outAt: number | null; expected: TimeSpan | null; scans?: readonly TrackScan[] }[],
): TrackRange => {
  let from = 6 * 60;
  let to = 20 * 60;
  for (const r of rows) {
    const points = [r.inAt, r.outAt, r.expected?.start ?? null, r.expected?.end ?? null, ...(r.scans ?? []).map((s) => s.at)];
    for (const p of points) {
      if (p === null) continue;
      from = Math.min(from, p);
      to = Math.max(to, p);
    }
  }
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
};

export const pct = (m: number, r: TrackRange): number => ((Math.min(r.to, Math.max(r.from, m)) - r.from) / (r.to - r.from)) * 100;

/** Hour labels every 2–4 hours depending on how wide the range is. */
export const ticksOf = (r: TrackRange): number[] => {
  const hours = (r.to - r.from) / 60;
  const step = hours > 24 ? 4 : hours > 14 ? 3 : 2;
  const out: number[] = [];
  for (let m = r.from; m <= r.to; m += step * 60) out.push(m);
  return out;
};

export const hourLabel = (m: number): string => {
  const h = Math.floor((((m % 1440) + 1440) % 1440) / 60);
  return `${String(h).padStart(2, '0')}`;
};

/** The ruler above a list of tracks: hour numbers, aligned with the rows' grid lines. */
export const HourRuler = ({ range, className }: { range: TrackRange; className?: string }): JSX.Element => (
  <div className={cn('relative h-5', className)} aria-hidden dir="ltr">
    {ticksOf(range).map((m) => (
      <span key={m} className={cn('absolute -translate-x-1/2 text-[10.5px]', FIG, INK3)} style={{ left: `${pct(m, range)}%` }}>
        {hourLabel(m)}
      </span>
    ))}
  </div>
);

const BAR: Record<Tone, string> = {
  ok: 'bg-[var(--att-ok)]',
  warn: 'bg-[var(--att-warn)]',
  bad: 'bg-[var(--att-bad)]',
  info: 'bg-[var(--att-info)]',
  muted: 'bg-[var(--att-muted)]',
  accent: 'bg-[var(--att-accent)]',
};

/**
 * One row's track. Drawn left-to-right on purpose (`dir="ltr"`), like every clock and chart axis —
 * an hour line that ran backwards in Arabic would put 08:00 to the right of 17:00.
 */
export const TimelineTrack = ({
  range,
  inAt,
  outAt,
  expected,
  tone,
  scans,
  now,
}: {
  range: TrackRange;
  inAt: number | null;
  outAt: number | null;
  expected: TimeSpan | null;
  tone: Tone;
  scans?: readonly TrackScan[];
  /** Minutes now, on today's rows only: an open day's bar runs to it, dashed. */
  now?: number | null;
}): JSX.Element => {
  const openEnd = inAt !== null && outAt === null && now != null && now > inAt ? now : null;
  const end = outAt ?? openEnd;
  return (
    <div className="relative h-9" dir="ltr" aria-hidden>
      {/* hour grid */}
      {ticksOf(range).map((m) => (
        <span key={m} className="absolute inset-y-1 w-px bg-[var(--att-line)]" style={{ left: `${pct(m, range)}%` }} />
      ))}
      {/* the expected shift */}
      {expected !== null && (
        <span
          className="absolute top-1/2 h-5 -translate-y-1/2 rounded-md border border-dashed border-[var(--att-line-strong)] bg-[var(--att-sheet-2)]"
          style={{ left: `${pct(expected.start, range)}%`, width: `${Math.max(0.5, pct(expected.end, range) - pct(expected.start, range))}%` }}
        />
      )}
      {/* the worked span */}
      {inAt !== null && end !== null && (
        <span
          className={cn('absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full', BAR[tone], openEnd !== null && 'opacity-60')}
          style={{ left: `${pct(inAt, range)}%`, width: `${Math.max(0.6, pct(end, range) - pct(inAt, range))}%` }}
        />
      )}
      {/* every scan: counted ones as dots, repeats as ticks */}
      {(scans ?? []).map((s, i) =>
        s.role === 'repeat' ? (
          <span key={i} className="absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--att-ink-3)]" style={{ left: `${pct(s.at, range)}%` }} />
        ) : null,
      )}
      {inAt !== null && (
        <span
          className={cn('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--att-sheet)]', BAR[tone])}
          style={{ left: `${pct(inAt, range)}%` }}
        />
      )}
      {outAt !== null && (
        <span
          className={cn('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--att-sheet)]', BAR[tone])}
          style={{ left: `${pct(outAt, range)}%` }}
        />
      )}
      {/* the two times, outside the bar's ends */}
      {inAt !== null && (
        <span
          className={cn('absolute top-0 -translate-x-full pe-2 text-[11px] font-semibold leading-none text-[color:var(--att-ink-2)]', FIG)}
          style={{ left: `${pct(inAt, range)}%` }}
        >
          {clock(inAt)}
        </span>
      )}
      {outAt !== null && (
        <span className={cn('absolute bottom-0 ps-2 text-[11px] font-semibold leading-none text-[color:var(--att-ink-2)]', FIG)} style={{ left: `${pct(outAt, range)}%` }}>
          {clock(outAt)}
        </span>
      )}
    </div>
  );
};

/**
 * The tile-sized track: no ruler, no labels — a thin line holding the expected shift as a faint
 * band and the worked span as a bar, with repeats as ticks. Every tile on a board shares one range,
 * so the bars still compare at a glance.
 */
export const MiniTrack = ({
  range,
  inAt,
  outAt,
  expected,
  tone,
  scans,
  now,
}: {
  range: TrackRange;
  inAt: number | null;
  outAt: number | null;
  expected: TimeSpan | null;
  tone: Tone;
  scans?: readonly TrackScan[];
  now?: number | null;
}): JSX.Element => {
  const openEnd = inAt !== null && outAt === null && now != null && now > inAt ? now : null;
  const end = outAt ?? openEnd;
  return (
    <div className="relative h-2.5 rounded-full bg-[var(--att-muted-soft)]" dir="ltr" aria-hidden>
      {expected !== null && (
        <span
          className="absolute inset-y-0 rounded-full bg-[var(--att-line-strong)] opacity-60"
          style={{ left: `${pct(expected.start, range)}%`, width: `${Math.max(0.5, pct(expected.end, range) - pct(expected.start, range))}%` }}
        />
      )}
      {inAt !== null && end !== null && (
        <span
          className={cn('absolute inset-y-0 rounded-full', BAR[tone], openEnd !== null && 'att-live-soft opacity-70')}
          style={{ left: `${pct(inAt, range)}%`, width: `${Math.max(1.5, pct(end, range) - pct(inAt, range))}%` }}
        />
      )}
      {inAt !== null && end === null && (
        <span className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full', BAR[tone])} style={{ left: `${pct(inAt, range)}%` }} />
      )}
      {(scans ?? []).map((s, i) =>
        s.role === 'repeat' ? (
          <span key={i} className="absolute -inset-y-0.5 w-[2px] -translate-x-1/2 rounded bg-[var(--att-ink)] opacity-50" style={{ left: `${pct(s.at, range)}%` }} />
        ) : null,
      )}
    </div>
  );
};
