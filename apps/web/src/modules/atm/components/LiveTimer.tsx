// The live "Taken Time" cell — one shared 1-second tick for the whole grid (the legacy ran one
// setInterval over all rows too, atm_replenishment.ejs:1902), and the colour ladder from
// operation-view so the thresholds stay a tested fact.
import { useEffect, useState } from 'react';
import { elapsedSeconds, formatElapsed, timerLevel, type TimerLevel } from '../lib/operation-view';

export const useNowTick = (intervalMs = 1000): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

/** The legacy colours verbatim: LawnGreen / Yellow / Crimson (:1915-1921), on their thresholds. */
const LEVEL_CLASS: Record<TimerLevel, string> = {
  none: '',
  green: 'bg-green-400 text-green-950',
  yellow: 'bg-yellow-300 text-yellow-950',
  red: 'bg-red-600 text-white',
};

export const LiveTimerCell = ({ openedAt, now }: { openedAt: string; now: Date }): JSX.Element => {
  const seconds = elapsedSeconds(openedAt, now);
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 font-mono text-xs tabular-nums ${LEVEL_CLASS[timerLevel(seconds)]}`}
    >
      {formatElapsed(seconds)}
    </span>
  );
};
