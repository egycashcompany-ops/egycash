// The pop-up a supervisor gets by pressing a person on the daily board — their recent days without
// leaving the board. A header (who, today's status, previous/next person, open profile), a period
// switch, one strip of six figures from the server, and the days on an hour ruler (the same
// `DayTimelineList` the employee's own daily record uses).
import { useEffect } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { useT } from '../../../../platform/localization/useT';
import { FIG, INK, INK2, INK3, PersonAvatar, StatusPill, type Tone } from './view-parts';
import { hm } from './view-format';
import { useViewLabels } from './view-labels';
import { DayLegend, DayTimelineList } from './day-timeline';
import type { EmployeeDay, ViewStatus } from './view-types';

export interface QuickViewKpis {
  daysPresent: number;
  daysExpected: number;
  lateDays: number;
  lateMinutesTotal: number;
  absentDays: number;
  incompleteDays: number;
  shortfallTotal: number;
  avgWorked: number | null;
}

export interface EmployeeQuickViewProps {
  person: { name: string; code: string; photoUrl?: string | null; department?: string | null; status: ViewStatus };
  position: { index: number; total: number; onPrev: (() => void) | null; onNext: (() => void) | null };
  period: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string };
  kpis: QuickViewKpis | null;
  /** Newest first. */
  days: EmployeeDay[];
  today: string;
  locale: 'ar' | 'en';
  loading?: boolean;
  onOpenProfile: () => void;
  onClose: () => void;
}

const NOTE: Record<Tone, string> = {
  ok: 'text-[color:var(--att-ok)]',
  warn: 'text-[color:var(--att-warn)]',
  bad: 'text-[color:var(--att-bad)]',
  info: 'text-[color:var(--att-info)]',
  muted: 'text-[color:var(--att-ink-3)]',
  accent: 'text-[color:var(--att-accent)]',
};

export const EmployeeQuickView = (p: EmployeeQuickViewProps): JSX.Element => {
  const { t, status } = useViewLabels();
  const tt = useT();
  const { onClose } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const k = p.kpis;
  const presence = k === null || k.daysExpected === 0 ? 0 : Math.round((k.daysPresent / k.daysExpected) * 100);

  return (
    <div className="att fixed inset-0 z-50 grid place-items-center p-3 sm:p-6" role="presentation">
      <button type="button" aria-label={tt('common.close')} className="absolute inset-0 cursor-default bg-[rgba(2,6,23,0.6)] backdrop-blur-[3px]" onClick={p.onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="att-quick-title"
        className="att-open relative flex max-h-[min(54rem,calc(100vh-1.5rem))] w-full max-w-[60rem] flex-col overflow-hidden rounded-2xl border border-[var(--att-line)] bg-[var(--att-canvas,var(--att-sheet))] shadow-[0_30px_80px_-20px_rgba(2,6,23,0.7)]"
      >
        {/* HEADER */}
        <header className="flex flex-wrap items-center gap-4 bg-[var(--att-sheet)] px-5 py-4 sm:px-6">
          <PersonAvatar name={p.person.name} photoUrl={p.person.photoUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="att-quick-title" className={cn('truncate text-[18px] font-semibold', INK)}>
                {p.person.name}
              </h2>
              <StatusPill status={p.person.status} label={status(p.person.status)} />
            </div>
            <p className={cn('mt-1 truncate text-[12.5px]', INK3)}>
              <bdi className={FIG}>{p.person.code}</bdi>
              {p.person.department ? ` · ${p.person.department}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('whitespace-nowrap text-[12.5px]', FIG, INK3)}>{t('position', { i: p.position.index + 1, n: p.position.total })}</span>
            <div className="flex items-center overflow-hidden rounded-lg border border-[var(--att-line)]">
              <NavBtn label={t('prevPerson')} onClick={p.position.onPrev} next={false} />
              <span className="h-5 w-px bg-[var(--att-line)]" aria-hidden />
              <NavBtn label={t('nextPerson')} onClick={p.position.onNext} next />
            </div>
            <button type="button" onClick={p.onOpenProfile} className="att-btn whitespace-nowrap">
              {t('openProfile')}
            </button>
            <button type="button" onClick={p.onClose} aria-label={tt('common.close')} className={cn('grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-[var(--att-sheet-2)]', INK2)}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto border-t border-[var(--att-line)] px-5 py-5 sm:px-6">
          {/* PERIOD */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-[var(--att-sheet-2)] p-1" role="tablist">
              {p.period.options.map((o) => {
                const on = o.value === p.period.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => p.period.onChange(o.value)}
                    className={cn(
                      'h-8 whitespace-nowrap rounded-lg px-3.5 text-[12.5px] font-medium transition-colors',
                      on ? cn('bg-[var(--att-sheet)] shadow-[0_1px_2px_rgba(2,6,23,0.35)]', INK) : cn(INK2, 'hover:text-[color:var(--att-ink)]'),
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <span className={cn('inline-flex items-center gap-2 text-[12.5px]', FIG, INK3)}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
                <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
              </svg>
              {p.period.label}
            </span>
          </div>

          {/* FIGURES — four, in words; absent / arrived-only only when there are any. */}
          <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--att-line)] bg-[var(--att-sheet)] lg:grid-cols-4 [&>*]:border-[var(--att-line)] [&>*]:border-b [&>*]:border-e">
            <Figure label={t('daysPresent')} value={k === null ? null : `${k.daysPresent} ${t('of')} ${k.daysExpected}`} note={k === null ? undefined : `${presence}%`} tone="ok" />
            <Figure label={t('lateDays')} value={k === null ? null : `${k.lateDays}`} note={k === null || k.lateMinutesTotal === 0 ? undefined : hm(k.lateMinutesTotal, p.locale)} tone="bad" />
            <Figure label={t('shortfallCol')} value={k === null ? null : hm(k.shortfallTotal, p.locale)} tone="warn" />
            <Figure label={t('hoursPerDay')} value={k === null ? null : hm(k.avgWorked, p.locale)} tone="ok" />
          </div>
          {k !== null && (k.absentDays > 0 || k.incompleteDays > 0) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              {k.absentDays > 0 && (
                <span className="rounded-full bg-[var(--att-bad-soft)] px-2.5 py-1 font-semibold text-[color:var(--att-bad)]">
                  {t('absentDays')}: <bdi className={FIG}>{k.absentDays}</bdi>
                </span>
              )}
              {k.incompleteDays > 0 && (
                <span className="rounded-full bg-[var(--att-muted-soft)] px-2.5 py-1 font-semibold text-[color:var(--att-ink-2)]">
                  {tt('attendanceView.checkedInOnly')}: <bdi className={FIG}>{k.incompleteDays}</bdi>
                </span>
              )}
            </div>
          )}

          <div className="mb-3 mt-6">
            <DayLegend />
          </div>
          <DayTimelineList days={p.days} today={p.today} locale={p.locale} />
          {p.days.length === 0 && p.loading !== true && <p className={cn('py-12 text-center text-sm', INK3)}>{t('noDays')}</p>}
          {p.loading === true && p.days.length === 0 && <p className={cn('py-12 text-center text-sm', INK3)}>{tt('common.loading')}</p>}
        </div>
      </section>
    </div>
  );
};

const NavBtn = ({ label, onClick, next }: { label: string; onClick: (() => void) | null; next: boolean }): JSX.Element => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={onClick === null}
    onClick={onClick ?? undefined}
    className={cn('grid h-9 w-9 place-items-center transition-colors hover:bg-[var(--att-sheet-2)] disabled:opacity-35 disabled:hover:bg-transparent', INK2)}
  >
    {/* «Next» points the way the page reads: right in English, left in Arabic. */}
    <svg viewBox="0 0 16 16" className={cn('h-4 w-4', next ? 'rtl:-scale-x-100' : '-scale-x-100 rtl:scale-x-100')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  </button>
);

const Figure = ({ label, value, suffix, note, tone }: { label: string; value: string | null; suffix?: string | undefined; note?: string | undefined; tone: Tone }): JSX.Element => (
  <div className="px-4 py-3">
    <p className={cn('truncate text-[11.5px]', INK3)}>{label}</p>
    <p className="mt-1.5 flex items-baseline gap-1.5">
      <span className={cn('text-[20px] font-semibold leading-none', FIG, INK)}>{value ?? '—'}</span>
      {suffix !== undefined && <span className={cn('text-[12px]', FIG, INK3)}>{suffix}</span>}
      {note !== undefined && <span className={cn('ms-auto text-[11.5px] font-semibold', FIG, NOTE[tone])}>{note}</span>}
    </p>
  </div>
);
