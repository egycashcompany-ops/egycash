// The top of «الحضور اليومي»: today at a glance — one card, two halves.
//
//   ┌──────────────────────────────┬──────────────────────────────────────────────────────────┐
//   │ IN NOW                       │ When people arrived                                      │
//   │ 33 / 42                      │                                                          │
//   │ 79% of today's staff         │   (3D pie: before 8:00 · 8:00–8:15 · … · after 9:00,     │
//   │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ one bar   │    green → red, each wedge's %; legend with counts)      │
//   │ ● Present ............ 25    │                                                          │
//   │ ● Late ................ 8    │                                                          │
//   │ ─────────────                │                                                          │
//   │ First arrival      7:30      │                                                          │
//   │ Busiest            7:45–8:00 │                                                          │
//   │ On time            27%       │                                                          │
//   └──────────────────────────────┴──────────────────────────────────────────────────────────┘
//
// Editorial rather than a grid of icon tiles: one big number, one bar, a plain list (each row filters
// the table), and the chart as the centerpiece. Presentational: every figure comes from the page.
import { cn } from '../../../../shared/lib/cn';
import type { ArrivalSlot } from './view-charts';
import ArrivalsBars from './arrivals-bars';
import { DOT, FIG, INK, INK2, INK3, Sheet, type Tone } from './view-parts';
import { clock, num, timeSpan } from './view-format';
import { useViewLabels } from './view-labels';
import type { SheetFilter, SheetSummary } from './view-types';


export interface HeroTab {
  key: SheetFilter;
  label: string;
  value: number;
  tone: Tone;
}

export const SheetHero = ({
  summary: s,
  tabs,
  activeFilter,
  onFilter,
  arrivals,
  dayStart,
  grace,
}: {
  summary: SheetSummary;
  tabs: HeroTab[];
  activeFilter: SheetFilter;
  onFilter: (f: SheetFilter) => void;
  arrivals: ArrivalSlot[];
  dayStart: number | null;
  grace: number;
  now: number | null;
}): JSX.Element => {
  const { t } = useViewLabels();
  const barLabels = {
    dayStarts: t('dayStarts'),
    onTime: t('onTime'),
    late: t('late'),
    peak: t('peakArrivals'),
    people: (n: number) => t('people', { n }),
    empty: t('arrivalsEmpty'),
  };
  const inCount = s.present + s.late;
  const share = (v: number): number => (s.employees > 0 ? Math.round((v / s.employees) * 100) : 0);
  const shown = tabs.filter((x) => x.key !== 'all' && x.value > 0);

  const arrived = arrivals.reduce((n, a) => n + a.count, 0);
  const first = arrivals.filter((a) => a.count > 0).reduce<ArrivalSlot | null>((f, a) => (f === null || a.slot < f.slot ? a : f), null);
  const busiest = arrivals.reduce<ArrivalSlot | null>((b, a) => (a.count > (b?.count ?? 0) ? a : b), null);
  const onTime = dayStart === null ? null : arrivals.filter((a) => a.slot < dayStart + grace).reduce((n, a) => n + a.count, 0);
  return (
    <Sheet className="att-hero overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        {/* THE NUMBER, THE BAR, THE LIST */}
        <div className="flex flex-col gap-6 border-b border-[var(--att-line)] p-6 sm:p-7 lg:border-b-0 lg:border-e">
          <div>
            <p className={cn('text-[12px] font-semibold uppercase tracking-[0.14em]', INK3)}>{t('attendanceRate')}</p>
            <p className="mt-3 flex items-baseline gap-2">
              <bdi className={cn('text-[64px] font-light leading-[0.9] tracking-[-0.04em]', FIG, INK)}>{num(inCount)}</bdi>
              <span className={cn('text-[20px] font-light', INK3)}>
                {t('of')} <bdi className={FIG}>{num(s.employees)}</bdi>
              </span>
            </p>
            <p className={cn('mt-2 text-[13.5px]', INK2)}>
              <bdi className={cn('font-semibold text-[color:var(--att-ok)]', FIG)}>{share(inCount)}%</bdi> {t('arrivedWord')}
            </p>
          </div>

          <div>
            <div className="flex h-2 gap-[3px] overflow-hidden rounded-full bg-[var(--att-muted-soft)]" aria-hidden>
              {shown.map((x) => (
                <span key={x.key} className={cn('h-full first:rounded-s-full last:rounded-e-full', DOT[x.tone])} style={{ width: `${share(x.value)}%` }} />
              ))}
            </div>
            <ul className="mt-3 -mx-2">
              {shown.map((x) => {
                const on = activeFilter === x.key;
                return (
                  <li key={x.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onFilter(on ? 'all' : x.key)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-[13.5px] transition-colors',
                        on ? 'bg-[var(--att-accent-soft)]' : 'hover:bg-[var(--att-sheet-2)]',
                      )}
                    >
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[x.tone])} aria-hidden />
                      <span className={cn('flex-1', on ? INK : INK2)}>{x.label}</span>
                      <span className="mx-1 h-px flex-1 border-t border-dotted border-[var(--att-line-strong)] opacity-60" aria-hidden />
                      <bdi className={cn('min-w-[2ch] text-end font-semibold', FIG, INK)}>{num(x.value)}</bdi>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <dl className="mt-auto grid gap-2.5 border-t border-[var(--att-line)] pt-5 text-[13px]">
            <Fact label={t('firstArrival')} value={first === null ? '—' : clock(first.slot)} />
            <Fact
              label={t('peakArrivals')}
              value={busiest === null || arrived === 0 ? '—' : timeSpan(busiest.slot, busiest.slot + 15)}
              note={busiest === null || arrived === 0 ? undefined : t('people', { n: busiest.count })}
            />
            <Fact
              label={t('onTimeShare')}
              value={onTime === null || arrived === 0 ? '—' : `${Math.round((onTime / arrived) * 100)}%`}
              note={onTime === null || arrived === 0 ? undefined : `${num(onTime)} ${t('of')} ${num(arrived)}`}
            />
          </dl>

          {s.unlinked !== null && s.unlinked.identities > 0 && (
            <p className="rounded-xl bg-[var(--att-warn-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[color:var(--att-warn)]">
              {t('unlinkedScans', { people: num(s.unlinked.identities), rows: num(s.unlinked.rows) })}
            </p>
          )}
        </div>

        {/* WHEN THEY ARRIVED — a column per quarter hour, on time in brand, late in amber */}
        <div className="min-w-0 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={cn('text-[16px] font-semibold', INK)}>{t('arrivalsTitle')}</h2>
          </div>
          <div className="mt-5">
            <ArrivalsBars slots={arrivals} dayStart={dayStart} grace={grace} labels={barLabels} />
          </div>
        </div>
      </div>
    </Sheet>
  );
};

const Fact = ({ label, value, note }: { label: string; value: string; note?: string | undefined }): JSX.Element => (
  <div className="flex items-start justify-between gap-3">
    <dt className={cn('whitespace-nowrap', INK3)}>{label}</dt>
    <dd className="text-end">
      <bdi className={cn('block whitespace-nowrap font-semibold', FIG, INK)}>{value}</bdi>
      {note !== undefined && <span className={cn('block text-[11.5px]', INK3)}>{note}</span>}
    </dd>
  </div>
);
