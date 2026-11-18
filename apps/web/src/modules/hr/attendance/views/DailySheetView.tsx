// «الحضور اليومي». Two readings up top — who is in (one number, one bar, filters) and when they came
// (the arrival river) — then the list. Presentational: the page owns data, filters and actions.
import type { ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { ArrivalRiver, PresenceSummary, type ArrivalSlot } from './view-charts';
import { AttendanceCanvas, DayStepper, DayTimeline, FIG, INK, INK2, INK3, PageHeader, PersonAvatar, Sheet, SheetHead, StatusText, Tag, TimelineScale } from './view-parts';
import { arrow, clock, num, shortDuration, timeSpan } from './view-format';
import { useViewLabels } from './view-labels';
import type { SheetFilter, SheetRow, SheetSummary } from './view-types';

export interface DailySheetViewProps {
  /** «الثلاثاء، 17 نوفمبر 2026», already formatted. */
  dateTitle: string;
  /** The page's own date input (kept so the page controls it). */
  dateInput: ReactNode;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** The page's search / branch / department controls. */
  filters: ReactNode;
  summary: SheetSummary;
  /** Arrivals per 15-minute slot for the whole (filtered) day, not just this page of rows. */
  arrivals: ArrivalSlot[];
  /**
   * Start of the working day and its grace, minutes — the roster most of the people on this sheet
   * are held to. `null` when nobody on it has one, and then no line is drawn and nothing is called
   * late: the screen must not invent an hour the company has not set.
   */
  dayStart: number | null;
  grace: number;
  /** Minutes after midnight now, only when the date is today. */
  now: number | null;
  /** Last scan received, already formatted («منذ دقيقتين»). */
  lastScan: string | null;
  activeFilter: SheetFilter;
  onFilter: (f: SheetFilter) => void;
  rows: SheetRow[];
  loading?: boolean;
  /** «عرض 1–8 من 8» and the pager, from the page. */
  footer?: ReactNode;
  onExport?: () => void;
  /** Opens the employee's attendance page. */
  onOpenEmployee?: (id: string) => void;
}

export const DailySheetView = (p: DailySheetViewProps): JSX.Element => {
  const { t, status } = useViewLabels();
  const s = p.summary;
  const busiest = p.arrivals.reduce<ArrivalSlot | null>((b, a) => (a.count > (b?.count ?? 0) ? a : b), null);
  const dayStart = p.dayStart;
  const onTime =
    dayStart === null
      ? null
      : p.arrivals.filter((a) => a.slot < dayStart + p.grace).reduce((n, a) => n + a.count, 0);
  const arrived = p.arrivals.reduce((n, a) => n + a.count, 0);

  return (
    <AttendanceCanvas>
      <PageHeader
        eyebrow={t('dailyAttendance')}
        title={p.dateTitle}
        meta={
          p.lastScan !== null ? (
            <span className="inline-flex items-center gap-2">
              <span className="att-live h-2 w-2 rounded-full bg-[var(--att-ok)]" />
              {t('lastPunch')} <span className={cn('font-semibold', INK)}>{p.lastScan}</span>
            </span>
          ) : undefined
        }
        actions={
          <>
            <DayStepper input={p.dateInput} onPrev={p.onPrevDay} onNext={p.onNextDay} prevLabel={t('prevDay')} nextLabel={t('nextDay')} />
            {p.onExport !== undefined && (
              <button type="button" className="att-btn" onClick={p.onExport}>
                {t('exportCsv')}
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-6">
        <Sheet>
          <PresenceSummary
            inCount={s.present + s.late}
            total={s.employees}
            inLabel={t('inToday')}
            ofLabel={t('of')}
            selected={p.activeFilter}
            onSelect={(k) => p.onFilter(k as SheetFilter)}
            // EVERY COUNTER THE SERVER COUNTS, so the band adds up to the total beside it. The
            // last three were missing, and on a company with no default working pattern that hid
            // most of the workforce: «5 of 100» with ninety-five people in no counter at all.
            parts={[
              { key: 'present', label: t('present'), value: s.present, tone: 'ok' },
              { key: 'late', label: t('late'), value: s.late, tone: 'warn' },
              { key: 'notYetIn', label: t('notYetIn'), value: s.notYetIn, tone: 'muted' },
              { key: 'absent', label: t('absent'), value: s.absent, tone: 'bad' },
              { key: 'onLeave', label: t('onLeave'), value: s.onLeave, tone: 'info' },
              { key: 'noSchedule', label: t('noSchedule'), value: s.noSchedule, tone: 'muted' },
              { key: 'noRecord', label: t('noRecord'), value: s.noRecord, tone: 'muted' },
              { key: 'offDay', label: t('offDay'), value: s.offDay, tone: 'muted' },
            ]}
          />
          {s.unlinked !== null && s.unlinked.identities > 0 && (
            <p className={cn('mt-4 rounded-lg px-3 py-2 text-[13px] leading-relaxed', INK2)}
               style={{ background: 'var(--att-warn-bg, rgba(180,120,0,0.08))' }}>
              {t('unlinkedScans')
                .replace('{people}', num(s.unlinked.identities))
                .replace('{rows}', num(s.unlinked.rows))}
            </p>
          )}
        </Sheet>
        <Sheet>
          <SheetHead
            title={t('arrivalsTitle')}
            note={
              arrived === 0 || busiest === null
                ? t('arrivalsEmpty')
                : onTime === null
                  ? // Nobody is rostered, so there is no «في الموعد» to report — only when they came.
                    t('arrivalsNoteNoRoster', { busy: timeSpan(busiest.slot, busiest.slot + 15) })
                  : t('arrivalsNote', {
                      busy: timeSpan(busiest.slot, busiest.slot + 15),
                      p: Math.round((onTime / arrived) * 100),
                    })
            }
          />
          <div className="pt-8">
            <ArrivalRiver
              slots={p.arrivals}
              dayStart={p.dayStart}
              grace={p.grace}
              now={p.now}
              labels={{ start: t('dayStarts'), now: t('now'), people: (n) => t('people', { n }), empty: t('arrivalsEmpty') }}
            />
          </div>
        </Sheet>
      </div>

      <Sheet className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">{p.filters}</div>
          {p.activeFilter !== 'all' && (
            <button type="button" className="att-btn" onClick={() => p.onFilter('all')}>
              {t('showAll')}
            </button>
          )}
        </div>

        <div className="mt-4 hidden lg:block">
          <table className="w-full">
            <thead>
              <tr className={cn('border-y border-[var(--att-line)] bg-[var(--att-sheet-2)] text-[12px]', INK3)}>
                <th className="py-2.5 pe-3 ps-6 text-start font-medium">{t('employee')}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t('status')}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t('inOut')}</th>
                <th className="w-[26%] px-3 py-2 text-start font-medium">
                  <TimelineScale />
                </th>
                <th className="px-3 py-2.5 text-start font-medium">{t('lateCol')}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t('overtime')}</th>
                <th className="py-2.5 pe-6 ps-3">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} className="group border-b border-[var(--att-line)] last:border-b-0 hover:bg-[var(--att-sheet-2)]">
                  <td className="max-w-[300px] py-3 pe-3 ps-6">
                    <Person row={r} onOpen={p.onOpenEmployee} />
                  </td>
                  <td className="px-3 py-3">
                    <StatusText status={r.status} label={status(r.status)} />
                    {r.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.tags.map((tag) => (
                          <Tag key={tag} tone="accent">
                            {tag}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <InOut row={r} />
                  </td>
                  <td className="px-3 py-3">
                    <DayTimeline inAt={r.inAt} outAt={r.outAt} expected={r.expected} />
                  </td>
                  <td className={cn('px-3 py-3 text-sm', FIG)}>{r.lateMinutes > 0 ? <span className="font-semibold text-[color:var(--att-warn)]">{shortDuration(r.lateMinutes)}</span> : <Dash />}</td>
                  <td className={cn('px-3 py-3 text-sm', FIG)}>
                    {r.overtimeApproved + r.overtimeDerived > 0 ? (
                      <bdi>
                        <span className={cn('font-semibold', INK)}>{shortDuration(r.overtimeApproved)}</span>
                        <span className={INK3}> / {shortDuration(r.overtimeDerived)}</span>
                      </bdi>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="py-3 pe-6 ps-3">
                    <div className="flex justify-end gap-2">{r.actions}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 border-t border-[var(--att-line)] lg:hidden">
          {p.rows.map((r) => (
            <li key={r.id} className="border-b border-[var(--att-line)] px-5 py-4 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <Person row={r} onOpen={p.onOpenEmployee} />
                <StatusText status={r.status} label={status(r.status)} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <InOut row={r} />
                <div className="flex flex-wrap justify-end gap-1">
                  {r.lateMinutes > 0 && <Tag tone="warn">{`+${shortDuration(r.lateMinutes)}`}</Tag>}
                  {r.tags.map((tag) => (
                    <Tag key={tag} tone="accent">
                      {tag}
                    </Tag>
                  ))}
                </div>
              </div>
              <div className="mt-2">
                <DayTimeline inAt={r.inAt} outAt={r.outAt} expected={r.expected} />
              </div>
              {r.actions !== undefined && <div className="mt-3 flex flex-wrap justify-end gap-2">{r.actions}</div>}
            </li>
          ))}
        </ul>

        {p.rows.length === 0 && p.loading !== true && <p className={cn('px-6 py-16 text-center text-sm', INK3)}>{t('noRows')}</p>}
        {p.footer !== undefined && <div className={cn('border-t border-[var(--att-line)] px-5 py-3 text-sm sm:px-6', INK2)}>{p.footer}</div>}
      </Sheet>
    </AttendanceCanvas>
  );
};

const Dash = (): JSX.Element => <span className="text-[color:var(--att-muted)]">—</span>;

const Person = ({ row, onOpen }: { row: SheetRow; onOpen: ((id: string) => void) | undefined }): JSX.Element => (
  <button type="button" onClick={() => onOpen?.(row.id)} className="group/p flex min-w-0 items-center gap-3 text-start">
    <PersonAvatar name={row.name} photoUrl={row.photoUrl} />
    <span className="min-w-0">
      <span className={cn('block truncate text-sm font-semibold group-hover/p:text-[color:var(--att-accent)]', INK)}>{row.name}</span>
      <span className={cn('block text-[12px]', INK3)}>
        <bdi className={FIG}>{row.code}</bdi>
        {row.department ? ` · ${row.department}` : ''}
      </span>
    </span>
  </button>
);

const InOut = ({ row }: { row: SheetRow }): JSX.Element => (
  <div className={FIG}>
    <span className={cn('whitespace-nowrap text-[13.5px]', row.inAt === null ? 'text-[color:var(--att-muted)]' : cn('font-semibold', INK))}>
      {clock(row.inAt)} <span className={INK3}>{arrow()}</span> {clock(row.outAt)}
    </span>
    {row.expected !== null && (
      <div className={cn('text-[11px]', INK3)}>
        {timeSpan(row.expected.start, row.expected.end)}
      </div>
    )}
  </div>
);

export { num };
