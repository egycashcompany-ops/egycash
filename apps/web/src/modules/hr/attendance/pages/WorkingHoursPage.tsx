// «ساعات العمل» — how many hours each department works per day. Everyone with no shift assignment
// is measured against their department's hours (late / short / early leave follow from it); a
// department left on «افتراضي» uses the company's default pattern (eight hours). A 24-hour
// department (security) ends at the same time the next day.
import { useEffect, useMemo, useState } from 'react';
import { type DepartmentHoursMap, type DepartmentHoursRule, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer } from '../../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { useSaveWorkingHours, useWorkingHours } from '../api/attendance-queries';
import type { WorkingHoursDepartment } from '../api/attendance-api';
import { WorkingHoursLog } from '../components/WorkingHoursLog';
import { AttendanceCanvas, FIG, INK, INK2, INK3, PageHeader, Sheet } from '../views/view-parts';

const PRESETS = [8, 9, 10, 12, 24];

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const toClock = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** End of the day for a rule: start + hours (+ break), and whether it lands on the next day. */
const endOf = (start: string, hours: number, breakMinutes: number): { time: string; nextDay: boolean } => {
  const end = toMinutes(start) + Math.round(hours * 60) + breakMinutes;
  return { time: toClock(end), nextDay: end >= 1440 };
};

export const WorkingHoursPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const query = useWorkingHours();
  const save = useSaveWorkingHours();
  const [draft, setDraft] = useState<DepartmentHoursMap>({});
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState(false);

  // The server's map becomes the draft whenever it (re)loads.
  useEffect(() => {
    if (query.data === undefined) return;
    const map: DepartmentHoursMap = {};
    for (const d of query.data.departments) if (d.rule !== null) map[d.id] = d.rule;
    setDraft(map);
  }, [query.data]);

  const data = query.data;
  const company = data?.companyDefault;
  const departments = data?.departments ?? [];

  const changed = useMemo(() => {
    let n = 0;
    for (const d of departments) {
      const a = d.rule;
      const b = draft[d.id] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) n += 1;
    }
    return n;
  }, [departments, draft]);

  const visible = departments
    .filter((d) => {
      const q = search.trim().toLowerCase();
      if (q === '') return true;
      return [d.name.ar, d.name.en, d.code, d.branchName?.ar ?? '', d.branchName?.en ?? ''].some((v) => v.toLowerCase().includes(q));
    })
    .sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale) || (a.branchName?.[locale] ?? '').localeCompare(b.branchName?.[locale] ?? '', locale));

  const setRule = (id: string, rule: DepartmentHoursRule | null): void => {
    setSaved(false);
    setDraft((current) => {
      const next = { ...current };
      if (rule === null) delete next[id];
      else next[id] = rule;
      return next;
    });
  };
  /** «Apply to this department in every branch» — the same company-wide department, or the same name. */
  const applyEverywhere = (source: WorkingHoursDepartment): void => {
    const rule = draft[source.id] ?? null;
    for (const d of departments) {
      const same = source.catalogId !== null ? d.catalogId === source.catalogId : d.name.ar === source.name.ar;
      if (same) setRule(d.id, rule);
    }
  };

  const onSave = (): void => {
    save.mutate(draft, { onSuccess: () => setSaved(true) });
  };

  return (
    <PageContainer>
      <AttendanceCanvas>
        <PageHeader
          eyebrow={t('attendanceView.attendance')}
          title={t('attendance.workingHours.title')}
          meta={<span className="block max-w-3xl">{t('attendance.workingHours.lead')}</span>}
          actions={
            <>
              {changed > 0 && (
                <span className={cn('text-[13px] font-medium text-[color:var(--att-warn)]')}>
                  {t('attendance.workingHours.changed', { n: changed })}
                </span>
              )}
              {saved && changed === 0 && (
                <span role="status" className="text-[13px] font-medium text-[color:var(--att-ok)]">
                  {t('attendance.workingHours.saved')}
                </span>
              )}
              <button type="button" className="att-btn att-btn-accent" disabled={changed === 0 || save.isPending} onClick={onSave}>
                {t('attendance.workingHours.save')}
              </button>
            </>
          }
        />

        {save.isError && (
          <p role="alert" className="rounded-xl bg-[var(--att-bad-soft)] px-4 py-3 text-sm text-[color:var(--att-bad)]">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Sheet className="px-5 py-5 sm:px-6">
            <p className={cn('text-[13px] font-medium', INK3)}>{t('attendance.workingHours.companyDefault')}</p>
            <p className={cn('mt-2 flex items-baseline gap-2 text-[44px] font-semibold leading-none', FIG, INK)}>
              {company === undefined ? '—' : company.hours}
              <span className={cn('text-base font-medium', INK3)}>{t('attendance.workingHours.hours')}</span>
            </p>
            {company !== undefined && (
              <p className={cn('mt-3 text-[13px]', INK2)}>
                {t('attendance.workingHours.companyDefaultNote', { start: company.startTime, end: company.endTime })}
              </p>
            )}
          </Sheet>
          <Sheet className="flex items-start gap-3 px-5 py-5 sm:px-6">
            <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--att-accent-soft)] text-[color:var(--att-accent)]" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            </span>
            <p className={cn('text-[14px] leading-relaxed', INK2)}>{t('attendance.workingHours.rule')}</p>
          </Sheet>
        </div>

        <Sheet className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <input
              type="search"
              className="att-input w-full sm:w-72"
              placeholder={t('attendance.workingHours.search')}
              aria-label={t('attendance.workingHours.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className={cn('text-[13px]', INK3)}>
              <bdi className={FIG}>{visible.length}</bdi> {t('attendance.workingHours.department')}
            </span>
          </div>

          {query.isLoading && <p className={cn('px-6 py-12 text-center text-sm', INK3)}>{t('common.loading')}</p>}
          {query.isError && (
            <p role="alert" className="px-6 py-12 text-center text-sm text-[color:var(--att-bad)]">
              {query.error instanceof Error ? query.error.message : String(query.error)}
            </p>
          )}

          <ul className="border-t border-[var(--att-line)]">
            {visible.map((d) => {
              const rule = draft[d.id] ?? null;
              const custom = rule !== null;
              const start = rule?.startTime ?? company?.startTime ?? '09:00';
              const hours = rule?.hours ?? company?.hours ?? 8;
              const end = endOf(start, hours, company?.breakMinutes ?? 0);
              const dirty = JSON.stringify(d.rule) !== JSON.stringify(rule);
              return (
                <li
                  key={d.id}
                  className={cn(
                    'grid gap-4 border-b border-[var(--att-line)] px-5 py-4 last:border-b-0 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,2.4fr)] lg:items-center',
                    dirty && 'bg-[var(--att-warn-soft)]',
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn('truncate text-[15px] font-semibold', INK)}>{d.name[locale]}</p>
                    <p className={cn('mt-0.5 text-[12.5px]', INK3)}>
                      {d.branchName?.[locale] ?? '—'} · <bdi className={FIG}>{d.employees}</bdi> {t('attendance.workingHours.employees')}
                    </p>
                  </div>

                  <div className="inline-flex w-fit rounded-[10px] border border-[var(--att-line)] bg-[var(--att-sheet-2)] p-1" role="radiogroup" aria-label={d.name[locale]}>
                    {[false, true].map((isCustom) => (
                      <button
                        key={String(isCustom)}
                        type="button"
                        role="radio"
                        aria-checked={custom === isCustom}
                        onClick={() =>
                          setRule(d.id, isCustom ? { hours: company?.hours ?? 8, startTime: company?.startTime ?? '09:00' } : null)
                        }
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors',
                          custom === isCustom ? 'bg-[var(--att-sheet)] text-[color:var(--att-ink)] shadow-sm' : INK3,
                        )}
                      >
                        {t(isCustom ? 'attendance.workingHours.custom' : 'attendance.workingHours.default')}
                      </button>
                    ))}
                  </div>

                  <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', !custom && 'opacity-60')}>
                    <label className="flex items-center gap-2">
                      <span className={cn('text-[12.5px]', INK3)}>{t('attendance.workingHours.hours')}</span>
                      <input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.5}
                        dir="ltr"
                        disabled={!custom}
                        className={cn('att-input w-20 text-center', FIG)}
                        value={hours}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isFinite(value) || value < 0.5 || value > 24) return;
                          setRule(d.id, { hours: value, startTime: start });
                        }}
                      />
                    </label>
                    <div className="flex gap-1" aria-label={t('attendance.workingHours.presets')}>
                      {PRESETS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          disabled={!custom}
                          onClick={() => setRule(d.id, { hours: h, startTime: start })}
                          className={cn(
                            'h-8 min-w-[2.25rem] rounded-lg border px-2 text-[12.5px] font-semibold transition-colors',
                            FIG,
                            hours === h && custom
                              ? 'border-[var(--att-accent)] bg-[var(--att-accent-soft)] text-[color:var(--att-accent)]'
                              : cn('border-[var(--att-line)] hover:border-[var(--att-line-strong)]', INK2),
                          )}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2">
                      <span className={cn('text-[12.5px]', INK3)}>{t('attendance.workingHours.start')}</span>
                      <input
                        type="time"
                        dir="ltr"
                        disabled={!custom}
                        className={cn('att-input w-28', FIG)}
                        value={start}
                        onChange={(e) => {
                          if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
                          setRule(d.id, { hours, startTime: e.target.value });
                        }}
                      />
                    </label>
                    <span className={cn('text-[12.5px]', INK3)}>
                      {t('attendance.workingHours.ends')}{' '}
                      <bdi className={cn('font-semibold', FIG, INK)}>{end.time}</bdi>
                      {end.nextDay && <span className="ms-1 rounded-md bg-[var(--att-info-soft)] px-1.5 py-px text-[11px] font-semibold text-[color:var(--att-info)]">{t('attendance.workingHours.nextDay')}</span>}
                    </span>
                    {custom && (
                      <button type="button" className={cn('text-[12.5px] font-medium underline-offset-2 hover:underline', 'text-[color:var(--att-accent)]')} onClick={() => applyEverywhere(d)}>
                        {t('attendance.workingHours.applyAll')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Sheet>

        <WorkingHoursLog locale={locale} />
      </AttendanceCanvas>
    </PageContainer>
  );
};
