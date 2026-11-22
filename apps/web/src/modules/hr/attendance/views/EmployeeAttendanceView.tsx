// One person's attendance — what opens when HR clicks an employee (and what an employee sees for
// themselves). Figures, then the month as a calendar beside a punctuality strip, hours per day, and
// the day-by-day record. Presentational: the page computes the figures and passes them in.
import type { ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { ArrivalTrend, HoursBars, MonthHeatmap } from './view-charts';
import { ariaSort, AttendanceCanvas, DOT, DayTimeline, FIG, INK, INK2, INK3, PageHeader, PersonAvatar, Sheet, SheetHead, SortableHead, StatusText, Tag, TimelineScale, type Tone } from './view-parts';
import { arrow, clock, dayLabel, duration, num, shortDuration } from './view-format';
import { useViewLabels } from './view-labels';
import { sortEmployeeDays } from './day-order';
import type {
  EmployeeDay,
  EmployeeDaySort,
  EmployeeDaysSort,
  EmployeeHeader,
  EmployeeKpis,
} from './view-types';

export interface EmployeeAttendanceViewProps {
  employee: EmployeeHeader;
  /** The period control (this month / last month / 30 days / custom), owned by the page. */
  periodPicker: ReactNode;
  /** «19 أكتوبر – 17 نوفمبر 2026», already formatted. */
  periodLabel: string;
  kpis: EmployeeKpis;
  /** Every day of the period, oldest → newest. */
  days: EmployeeDay[];
  /**
   * Start of this person's working day and its grace, minutes — the punctuality band. `null` when
   * they have no shift and no default pattern: no lateness line is drawn, because nobody has said
   * when they are due.
   */
  dayStart: number | null;
  grace: number;
  /** ISO date of today, to ring it on the calendar. */
  today?: string;
  /**
   * The date the reader picked on the calendar. Ringed there and highlighted in the daily record,
   * which is the point: over a year, finding the same date in 366 lines by eye is the screen's job.
   */
  picked?: string | null;
  /** Given, the calendar's cells become buttons. Omitted, it stays a plain read-only grid. */
  onPickDay?: (date: string) => void;
  onExport?: () => void;
  /**
   * The order of the daily record, and how to ask for another. Omitted, the list reads newest
   * first — a month is read backwards from its most recent day.
   */
  sort?: EmployeeDaysSort;
  onSort?: (by: EmployeeDaySort, dir: 'asc' | 'desc') => void;
}

export const EmployeeAttendanceView = (p: EmployeeAttendanceViewProps): JSX.Element => {
  const { employee, kpis, days } = p;
  const { t, status, locale } = useViewLabels();
  const dur = (m: number | null): string => duration(m, t('hours'), t('minutes'));
  const sort: EmployeeDaysSort = p.sort ?? { by: 'date', dir: 'desc' };
  const sortHint = (dir: 'asc' | 'desc'): string => t(dir === 'asc' ? 'sortAscending' : 'sortDescending');
  // `days` arrives oldest first (the calendar's contiguous run, which the heatmap needs in that
  // order); the record below is a different reading of the same days, so it gets its own order.
  const ordered = sortEmployeeDays(days, sort.by, sort.dir);
  const meta = [employee.jobTitle, employee.department, employee.branch].filter((x): x is string => typeof x === 'string' && x !== '');
  const onTimeRate = kpis.daysPresent > 0 ? Math.round(((kpis.daysPresent - kpis.lateDays) / kpis.daysPresent) * 100) : 0;

  return (
    <AttendanceCanvas>
      <PageHeader
        lead={<PersonAvatar name={employee.name} photoUrl={employee.photoUrl} size="lg" />}
        eyebrow={
          <span>
            <bdi className={FIG}>#{employee.code}</bdi>
            {meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}
          </span>
        }
        title={employee.name}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {employee.lastPunch && (
              <span>
                {t('lastPunch')} <bdi className={cn('font-semibold', INK)}>{employee.lastPunch}</bdi>
              </span>
            )}
            {kpis.incompleteDays > 0 && <Tag tone="warn">{`${num(kpis.incompleteDays)} ${t('incomplete')}`}</Tag>}
          </span>
        }
        actions={
          <>
            {p.periodPicker}
            {p.onExport !== undefined && (
              <button type="button" className="att-btn" onClick={p.onExport}>
                {t('exportCsv')}
              </button>
            )}
          </>
        }
      />

      <Sheet>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7">
          <Figure label={t('daysPresent')} value={`${kpis.daysPresent}/${kpis.daysExpected}`} note={p.periodLabel} tone="ok" />
          <Figure label={t('onTimeRate')} value={`${onTimeRate}%`} note={t('ofPresentDays')} tone="ok" />
          <Figure label={t('usualArrival')} value={clock(kpis.usualArrival)} note={t('avgFirstIn')} />
          <Figure label={t('usualDeparture')} value={clock(kpis.usualDeparture)} note={t('avgLastOut')} />
          <Figure label={t('hoursPerDay')} value={dur(kpis.avgWorked)} note={t('inTotal', { t: dur(kpis.totalWorked) })} />
          <Figure label={t('lateDays')} value={String(kpis.lateDays)} note={t('lateTotal', { t: dur(kpis.lateMinutesTotal) })} tone="warn" />
          {/* «النقص» — the period's missing time, which is the figure a deduction would read and
              the one «أيام التأخير» does NOT answer: a month of late arrivals all made up by
              staying later shows late days and no shortfall at all. */}
          <Figure
            label={t('shortfallCol')}
            value={dur(kpis.shortfallTotal === 0 ? null : kpis.shortfallTotal)}
            note={t('shortfallTotal')}
            {...(kpis.shortfallTotal > 0 ? { tone: 'warn' as const } : {})}
          />
        </div>
      </Sheet>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-6">
        <Sheet>
          <SheetHead title={t('calendarTitle')} note={t('calendarNote', { a: kpis.absentDays, l: kpis.lateDays })} />
          <div className="pt-4">
            <MonthHeatmap
              days={days}
              weekdays={t('weekdays').split(',')}
              statusLabel={status}
              locale={locale}
              {...(p.today !== undefined ? { today: p.today } : {})}
              {...(p.picked !== undefined ? { picked: p.picked } : {})}
              {...(p.onPickDay !== undefined ? { onPick: p.onPickDay } : {})}
            />
          </div>
          <Legend
            items={[
              { tone: 'ok', label: status('present') },
              { tone: 'warn', label: status('late') },
              { tone: 'bad', label: status('absent') },
              { tone: 'info', label: status('onLeave') },
            ]}
          />
        </Sheet>
        <Sheet>
          <SheetHead
            title={t('punctualityTitle')}
            note={
              p.dayStart === null
                ? t('punctualityNoteNoRoster', { u: clock(kpis.usualArrival) })
                : t('punctualityNote', { u: clock(kpis.usualArrival), s: clock(p.dayStart) })
            }
          />
          <div className="pt-6">
            <ArrivalTrend days={days} dayStart={p.dayStart} grace={p.grace} usual={kpis.usualArrival} labels={{ limit: t('lateAfter'), usual: t('usualDay'), week: (n) => t('weekN', { n }), empty: t('noDays') }} locale={locale} />
          </div>
        </Sheet>
      </div>

      <Sheet>
        <SheetHead title={t('hoursChart')} note={kpis.avgWorked !== null ? t('hoursChartNote', { t: dur(kpis.avgWorked) }) : t('hoursChartEmpty')} />
        <div className="pt-5">
          <HoursBars days={days} avg={kpis.avgWorked} locale={locale} format={dur} weekLabel={(n) => t('weekN', { n })} />
        </div>
      </Sheet>

      <Sheet className="overflow-hidden">
        <SheetHead
          title={t('dailyRecord')}
          note={`${p.periodLabel} · ${sort.by === 'date' && sort.dir === 'desc' ? t('newestFirst') : t('oldestFirst')}`}
        />
        {ordered.length === 0 ? (
          <p className={cn('px-6 py-16 text-center text-sm', INK3)}>{t('noDays')}</p>
        ) : (
          <>
            <div className="mt-4 hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className={cn('border-y border-[var(--att-line)] bg-[var(--att-sheet-2)] text-[12px]', INK3)}>
                    <th className="py-2.5 pe-3 ps-6 text-start font-medium" aria-sort={ariaSort('date', sort)}>
                      <SortableHead column="date" label={t('date')} sort={sort} onSort={p.onSort} hint={sortHint} />
                    </th>
                    <th className="px-3 py-2.5 text-start font-medium">{t('status')}</th>
                    <th className="px-3 py-2.5 text-start font-medium" aria-sort={ariaSort('checkIn', sort)}>
                      <SortableHead column="checkIn" label={t('arrived')} sort={sort} onSort={p.onSort} hint={sortHint} />
                      <span className={cn('mx-1', INK3)} aria-hidden="true">
                        ·
                      </span>
                      <SortableHead column="checkOut" label={t('left')} sort={sort} onSort={p.onSort} hint={sortHint} />
                    </th>
                    <th className="px-3 py-2.5 text-start font-medium" aria-sort={ariaSort('worked', sort)}>
                      <SortableHead column="worked" label={t('worked')} sort={sort} onSort={p.onSort} hint={sortHint} />
                    </th>
                    <th className="w-[30%] px-3 py-2 text-start font-medium">
                      <TimelineScale />
                    </th>
                    <th className="py-2.5 pe-6 ps-3" />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((d) => (
                    <tr
                      key={d.date}
                      // The anchor the calendar scrolls to, and the row it rings. One id per date
                      // on this screen, so a second table on the page cannot collide with it.
                      id={`att-day-${d.date}`}
                      className={cn(
                        'border-b border-[var(--att-line)] last:border-b-0 hover:bg-[var(--att-sheet-2)]',
                        d.date === p.picked && 'bg-[var(--att-sheet-2)] ring-2 ring-inset ring-[var(--att-accent)]',
                      )}
                    >
                      <td className={cn('whitespace-nowrap py-3 pe-3 ps-6 text-sm font-semibold', INK)}>{dayLabel(d.date, locale)}</td>
                      <td className="px-3 py-3">
                        <StatusText status={d.status} label={status(d.status)} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Span inAt={d.inAt} outAt={d.outAt} />
                          {d.lateMinutes !== null && d.lateMinutes > 0 && (
                            <Tag tone="warn">{`${status('late')} ${shortDuration(d.lateMinutes)}`}</Tag>
                          )}
                          {d.shortfall !== null && d.shortfall > 0 && (
                            <Tag tone="warn">{`${t('shortfallCol')} ${shortDuration(d.shortfall)}`}</Tag>
                          )}
                          {d.tags.map((tag) => (
                            <Tag key={tag} tone="accent">
                              {tag}
                            </Tag>
                          ))}
                        </span>
                      </td>
                      <td className={cn('px-3 py-3 text-sm', FIG, d.worked === null ? 'text-[color:var(--att-muted)]' : cn('font-semibold', INK))}>{dur(d.worked)}</td>
                      <td className="px-3 py-3">
                        <DayTimeline inAt={d.inAt} outAt={d.outAt} expected={d.expected} />
                      </td>
                      <td className="py-3 pe-6 ps-3 text-end">{d.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-4 border-t border-[var(--att-line)] md:hidden">
              {ordered.map((d) => (
                <li
                  key={d.date}
                  id={`att-day-m-${d.date}`}
                  className={cn(
                    'border-b border-[var(--att-line)] px-5 py-4 last:border-b-0',
                    d.date === p.picked && 'bg-[var(--att-sheet-2)] ring-2 ring-inset ring-[var(--att-accent)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn('text-sm font-semibold', INK)}>{dayLabel(d.date, locale)}</span>
                    <StatusText status={d.status} label={status(d.status)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Span inAt={d.inAt} outAt={d.outAt} />
                    {d.worked !== null && <span className={cn('text-sm font-semibold', FIG, INK)}>{dur(d.worked)}</span>}
                    {d.lateMinutes !== null && d.lateMinutes > 0 && (
                      <Tag tone="warn">{`${status('late')} ${shortDuration(d.lateMinutes)}`}</Tag>
                    )}
                    {d.shortfall !== null && d.shortfall > 0 && (
                      <Tag tone="warn">{`${t('shortfallCol')} ${shortDuration(d.shortfall)}`}</Tag>
                    )}
                    {d.tags.map((tag) => (
                      <Tag key={tag} tone="accent">
                        {tag}
                      </Tag>
                    ))}
                  </div>
                  <div className="mt-2">
                    <DayTimeline inAt={d.inAt} outAt={d.outAt} expected={d.expected} />
                  </div>
                  {d.action !== undefined && <div className="mt-2 flex justify-end">{d.action}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </AttendanceCanvas>
  );
};

const Figure = ({ label, value, note, tone }: { label: string; value: string; note: string; tone?: Tone }): JSX.Element => (
  <div className="border-[var(--att-line)] px-5 py-5 [&:not(:first-child)]:border-s max-sm:[&:nth-child(odd)]:border-s-0 max-sm:[&:nth-child(n+3)]:border-t sm:max-xl:[&:nth-child(3n+1)]:border-s-0 sm:max-xl:[&:nth-child(n+4)]:border-t">
    <p className={cn('flex items-center gap-2 text-[13px] font-medium', INK2)}>
      {tone !== undefined && <span className={cn('h-2 w-2 rounded-full', DOT[tone])} />}
      {label}
    </p>
    <p className={cn('mt-2 text-[28px] font-semibold leading-none', FIG, INK)}>
      <bdi>{value}</bdi>
    </p>
    <p className={cn('mt-2 truncate text-[12px]', INK3)}>{note}</p>
  </div>
);

const Legend = ({ items }: { items: { tone: Tone; label: string }[] }): JSX.Element => (
  <div className={cn('flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--att-line)] px-5 py-3 text-[12px] sm:px-6', INK2)}>
    {items.map((i) => (
      <span key={i.label} className="inline-flex items-center gap-1.5">
        <span className={cn('h-2.5 w-2.5 rounded-[3px]', DOT[i.tone])} />
        {i.label}
      </span>
    ))}
  </div>
);

const Span = ({ inAt, outAt }: { inAt: number | null; outAt: number | null }): JSX.Element => (
  <span className={cn('whitespace-nowrap text-[13.5px]', FIG, inAt === null ? 'text-[color:var(--att-muted)]' : cn('font-semibold', INK))}>
    {clock(inAt)} <span className={INK3}>{arrow()}</span> {clock(outAt)}
  </span>
);
