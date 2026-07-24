// Team calendar (frozen design §11): a month grid of approved/active/completed leave within
// the caller's scope, with weekends and public holidays greyed. RTL-safe (CSS grid).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, LoadingState } from '../../../../shared/ui';
import { useLeaveCalendar, useWorkCalendar } from '../api/leave-queries';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const TeamCalendarPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const monthStart = anchor;
  const monthEnd = useMemo(
    () => new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)),
    [anchor],
  );
  const from = iso(monthStart);
  const to = iso(monthEnd);
  const { data: spans, isLoading } = useLeaveCalendar(from, to);
  const { data: workCalendar } = useWorkCalendar(from, to);

  const holidaySet = useMemo(
    () => new Set((workCalendar?.holidays ?? []).map((h) => h.date)),
    [workCalendar],
  );
  const weekend = useMemo(() => new Set(workCalendar?.weekendDays ?? [5, 6]), [workCalendar]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(monthStart); d.getTime() <= monthEnd.getTime(); d = new Date(d.getTime() + 86_400_000)) {
      out.push(new Date(d));
    }
    return out;
  }, [monthStart, monthEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, { id: string; label: string; typeCode: string }[]>();
    for (const r of spans ?? []) {
      for (const d of days) {
        const key = iso(d);
        if (key >= r.startDate && key <= r.endDate) {
          const list = map.get(key) ?? [];
          list.push({ id: r.id, label: r.employeeName, typeCode: r.typeCode });
          map.set(key, list);
        }
      }
    }
    return map;
  }, [spans, days]);

  const monthLabel = anchor.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
  const move = (delta: number): void => {
    setAnchor(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, 1)));
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.calendar.title')}
        description={t('leave.calendar.subtitle')}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.calendar.title') }]}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => move(-1)}>←</Button>
            <span className="min-w-32 text-center text-sm font-medium" dir="ltr">{monthLabel}</span>
            <Button size="sm" variant="secondary" onClick={() => move(1)}>→</Button>
          </div>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : (
        <Card>
          <CardBody>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => {
                const key = iso(d);
                const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
                const off = weekend.has(wd) || holidaySet.has(key);
                const entries = byDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className={`min-h-20 rounded border p-1 text-xs ${
                      off
                        ? 'border-slate-100 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="mb-1 font-mono">{d.getUTCDate()}</div>
                    {entries.slice(0, 3).map((e, i) => (
                      <button
                        key={`${e.id}:${String(i)}`}
                        type="button"
                        onClick={() => navigate(`/leave/requests/${e.id}`)}
                        className="mb-0.5 block w-full truncate rounded bg-brand-50 px-1 text-start text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                        title={`${e.label} (${e.typeCode})`}
                      >
                        {e.label}
                      </button>
                    ))}
                    {entries.length > 3 && (
                      <span className="text-slate-400">+{entries.length - 3}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
};
