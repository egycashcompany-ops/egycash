// «متى وصلوا اليوم» as a classic column chart, the same one the branch server's dashboard draws.
//
// One column per quarter hour, from the first arrival to the last, on a hairline grid with a
// counted y axis. On-time quarters are brand, late ones amber; the busiest quarter is a deeper
// step with its count written above it. A dashed line marks where the day starts. Hovering (or
// focusing) a column shades it and names it: the quarter, how many people, on time or late.
// Nothing moves on hover. A hidden table carries every value for screen readers.
//
// Time runs from the inline start, so in Arabic the earliest quarter is on the right.
import { useId, useLayoutEffect, useState } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { FIG, INK, INK2, INK3 } from './view-parts';
import { clock, hourTick, num, timeSpan } from './view-format';
import type { ArrivalSlot } from './view-charts';

export interface BarsLabels {
  dayStarts: string;
  onTime: string;
  late: string;
  peak: string;
  people: (n: number) => string;
  empty: string;
}

const SLOT = 15;
const HEIGHT = 250;
const PAD_S = 34; // the y axis, on the inline start
const PAD_E = 8;
const PAD_T = 30; // room for the peak's label
const PAD_B = 28; // the hour ticks

export default function ArrivalsBars({
  slots,
  dayStart,
  grace,
  labels,
}: {
  slots: ArrivalSlot[];
  dayStart: number | null;
  grace: number;
  labels: BarsLabels;
}): JSX.Element {
  // A callback ref: the plot mounts only once there are arrivals, which can be after the first render.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const gid = useId().replace(/:/g, '');
  const [width, setWidth] = useState(0);
  const [rtl, setRtl] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (el === null) return undefined;
    setRtl(getComputedStyle(el).direction === 'rtl');
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const filled = slots.filter((s) => s.count > 0);
  const total = filled.reduce((n, s) => n + s.count, 0);
  if (total === 0) return <p className={cn('py-16 text-center text-sm', INK3)}>{labels.empty}</p>;

  // The quarters shown: from the hour of the first arrival to the quarter of the last, and the
  // day's start inside that range so its line always has a place.
  const counts = new Map(filled.map((s) => [s.slot, s.count]));
  const lo = Math.floor(Math.min(...filled.map((s) => s.slot), dayStart ?? Infinity) / 60) * 60;
  const hi = Math.max(...filled.map((s) => s.slot), dayStart ?? -Infinity);
  const data: ArrivalSlot[] = [];
  for (let m = lo; m <= hi; m += SLOT) data.push({ slot: m, count: counts.get(m) ?? 0 });

  const lateFrom = dayStart === null ? null : dayStart + grace;
  const isLate = (slot: number): boolean => lateFrom !== null && slot >= lateFrom;
  const onTime = lateFrom === null ? null : filled.filter((s) => s.slot < lateFrom).reduce((n, s) => n + s.count, 0);
  const peak = data.reduce((p, s, i) => (s.count > (data[p]?.count ?? 0) ? i : p), 0);

  const max = Math.max(1, ...data.map((d) => d.count));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotH = HEIGHT - PAD_T - PAD_B;
  const plotW = Math.max(0, width - PAD_S - PAD_E);
  const col = data.length > 0 ? plotW / data.length : 0;
  const barW = Math.max(3, Math.min(col - 3, col * 0.62, 26));
  const y = (v: number): number => PAD_T + plotH - (v / top) * plotH;
  // x from the inline start: mirrored in RTL so time reads the way the page reads.
  const fromStart = (d: number): number => (rtl ? width - d : d);
  const cx = (i: number): number => fromStart(PAD_S + col * i + col / 2);
  const colX = (i: number): number => (rtl ? width - PAD_S - col * (i + 1) : PAD_S + col * i);
  const axisX = fromStart(PAD_S - 8);
  const gridA = fromStart(PAD_S);
  const gridB = fromStart(width - PAD_E);
  const startX = dayStart === null ? null : fromStart(PAD_S + ((dayStart - lo) / SLOT) * col);
  const a = active === null ? null : data[active] ?? null;

  return (
    <div>
      <div ref={setEl} className="relative select-none" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-hidden className="overflow-visible">
            <defs>
              <linearGradient id={`${gid}-ok`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--att-brand)" />
                <stop offset="100%" stopColor="var(--att-brand)" stopOpacity={0.62} />
              </linearGradient>
              <linearGradient id={`${gid}-late`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--att-warn)" />
                <stop offset="100%" stopColor="var(--att-warn)" stopOpacity={0.6} />
              </linearGradient>
            </defs>

            {/* grid and counted y axis */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={gridA} x2={gridB} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--att-line-strong)' : 'var(--att-line)'} />
                <text x={axisX} y={y(v)} dy="0.32em" textAnchor={rtl ? 'start' : 'end'} className="fill-[color:var(--att-ink-3)] text-[11.5px] tabular-nums">
                  {num(v)}
                </text>
              </g>
            ))}

            {/* the hovered column, shaded */}
            {active !== null && <rect x={colX(active)} y={PAD_T - 8} width={col} height={plotH + 8} rx={6} fill="var(--att-sheet-2)" />}

            {/* where the day starts */}
            {startX !== null && (
              <line x1={startX} x2={startX} y1={PAD_T - 4} y2={y(0)} stroke="var(--att-ink-2)" strokeWidth={1.25} strokeDasharray="4 4" opacity={0.6} />
            )}

            {data.map((d, i) => {
              const h = Math.max(d.count > 0 ? 3 : 0, y(0) - y(d.count));
              const late = isLate(d.slot);
              const strong = i === peak;
              const fill = strong ? (late ? 'var(--att-warn)' : 'var(--att-brand-strong)') : `url(#${gid}-${late ? 'late' : 'ok'})`;
              return (
                <g key={d.slot}>
                  {d.count > 0 && <path d={roundedTop(cx(i) - barW / 2, y(0) - h, barW, h, Math.min(5, barW / 2))} fill={fill} />}
                  {d.slot % 60 === 0 && (
                    <text x={fromStart(PAD_S + col * i)} y={HEIGHT - 8} textAnchor="middle" className="fill-[color:var(--att-ink-3)] text-[11.5px]">
                      {hourTick(d.slot)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* the peak's count, written on it */}
            {data[peak] !== undefined && (
              <text
                x={Math.min(Math.max(cx(peak), 40), width - 40)}
                y={y(data[peak].count) - 9}
                textAnchor="middle"
                stroke="var(--att-sheet)"
                strokeWidth={5}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="fill-[color:var(--att-ink)] text-[12px] font-semibold tabular-nums"
              >
                {`${labels.peak} · ${num(data[peak].count)}`}
              </text>
            )}

            {/* the day-start pill, above the plot */}
            {startX !== null && dayStart !== null && (
              <g>
                <rect x={startX - pillW(labels.dayStarts, dayStart) / 2} y={2} width={pillW(labels.dayStarts, dayStart)} height={18} rx={9} fill="var(--att-sheet)" stroke="var(--att-line)" />
                <text x={startX} y={11} dy="0.32em" textAnchor="middle" className="fill-[color:var(--att-ink-2)] text-[11.5px] font-medium">
                  {`${labels.dayStarts} ${clock(dayStart)}`}
                </text>
              </g>
            )}

            {/* hit targets: the whole column */}
            {data.map((d, i) => (
              <rect
                key={d.slot}
                x={colX(i)}
                y={0}
                width={col}
                height={HEIGHT - PAD_B}
                fill="transparent"
                tabIndex={0}
                aria-label={`${timeSpan(d.slot, d.slot + SLOT)}: ${labels.people(d.count)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              />
            ))}
          </svg>
        )}

        {a !== null && active !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-[color:var(--att-line)] bg-[var(--att-sheet)] px-3.5 py-2.5 shadow-lg"
            style={{ left: Math.min(Math.max(cx(active), 80), width - 80), top: Math.max(y(a.count) - 12, 64) }}
          >
            <p className={cn('whitespace-nowrap text-[12px]', FIG, INK3)}>
              <bdi>{timeSpan(a.slot, a.slot + SLOT)}</bdi>
            </p>
            <p className={cn('mt-0.5 whitespace-nowrap text-[15px] font-semibold', FIG, INK)}>{labels.people(a.count)}</p>
            {lateFrom !== null && a.count > 0 && (
              <p className="whitespace-nowrap text-[12px] font-medium" style={{ color: isLate(a.slot) ? 'var(--att-warn)' : 'var(--att-brand)' }}>
                {isLate(a.slot) ? labels.late : labels.onTime}
              </p>
            )}
          </div>
        )}
      </div>

      {/* the key, with the two totals */}
      {onTime !== null && (
        <div className={cn('mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]', FIG, INK2)}>
          <Key color="var(--att-brand)" label={labels.onTime} value={onTime} />
          <Key color="var(--att-warn)" label={labels.late} value={total - onTime} />
        </div>
      )}

      <table className="sr-only">
        <tbody>
          {data.map((d) => (
            <tr key={d.slot}>
              <th scope="row">{timeSpan(d.slot, d.slot + SLOT)}</th>
              <td>{labels.people(d.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Key = ({ color, label, value }: { color: string; label: string; value: number }): JSX.Element => (
  <span className="inline-flex items-center gap-2">
    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
    <span>{label}</span>
    <bdi className={cn('font-semibold', INK)}>{num(value)}</bdi>
  </span>
);

const pillW = (label: string, at: number): number => (label.length + clock(at).length + 1) * 6.4 + 16;

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}
