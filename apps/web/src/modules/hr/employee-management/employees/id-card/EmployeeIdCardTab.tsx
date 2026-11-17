// The profile's «الكارنيه» tab: the card, and everything about it — how many cards the person
// RECEIVED (a print counts only once HR confirms its handover), the first and the last, how many
// prints that took, and every print with who printed it and whether it was handed over.
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { ActorById, useDirectoryPage } from '../../../../../platform/directory';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { Timeline, type TimelineEntry } from '../../../../../shared/ui/Timeline';
import { formatDate, formatDateTime } from '../../../../../shared/lib/format';
import { useEmployeeIdCardPrints } from '../api/employee-id-card';
import { IdCardPanel } from './IdCardPanel';
import { IdCardGlyph } from './IdCardStatusButton';

const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}): JSX.Element => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
      {value}
    </p>
    {hint !== undefined && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
  </div>
);

const EmployeeIdCardTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const prints = useEmployeeIdCardPrints(employee.id);
  useDirectoryPage((prints.data ?? []).flatMap((p) => [p.printedBy, p.receivedBy]));
  const rows = prints.data ?? [];
  const summary = employee.idCard;
  const count = summary?.receivedCount ?? 0;
  const printCount = summary?.printCount ?? rows.length;
  const awaiting = summary?.awaitingHandover === true;
  const waitingEmployee = awaiting && (summary?.receiptPrintedAt ?? null) !== null;

  const entries: TimelineEntry[] = rows.map((p) => {
    const notes = [
      p.receivedAt === null
        ? t('employees.idCard.history.printedOnly', { date: formatDateTime(p.printedAt, locale) })
        : t('employees.idCard.history.printedThenReceived', {
            printed: formatDateTime(p.printedAt, locale),
            received: formatDateTime(p.receivedAt, locale),
          }),
      ...(p.withPhoto ? [] : [t('employees.idCard.withoutPhoto')]),
    ];
    const by = p.receivedBy ?? p.printedBy;
    return {
      id: p.id,
      title:
        p.receivedNumber === null
          ? t('employees.idCard.printNumber', { n: p.printNumber })
          : t('employees.idCard.history.received', { n: p.receivedNumber }),
      meta: formatDateTime(p.receivedAt ?? p.printedAt, locale),
      description: notes.join(' · '),
      tone: p.receivedNumber === null ? ('neutral' as const) : ('success' as const),
      actor: by === null ? undefined : <ActorById userId={by} />,
    };
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title={t('employees.idCard.title')} />
        <CardBody>
          {can('employee.editPersonal') ? (
            <IdCardPanel employee={employee} />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('employees.idCard.noAccess')}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div
            className={
              count > 0
                ? 'flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 px-4 py-3 text-white shadow-[0_8px_24px_-12px_rgba(79,70,229,0.8)]'
                : 'flex items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-slate-400 dark:border-slate-700'
            }
          >
            <IdCardGlyph className="h-7 w-7 shrink-0" />
            <div>
              <p className="text-xs opacity-80">{t('employees.idCard.stats.count')}</p>
              <p className="text-2xl font-bold tabular-nums">{count}</p>
            </div>
          </div>
          <Stat
            label={t('employees.idCard.stats.first')}
            value={
              summary?.firstReceivedAt == null ? '—' : formatDate(summary.firstReceivedAt, locale)
            }
          />
          <Stat
            label={t('employees.idCard.stats.last')}
            value={
              summary?.lastReceivedAt == null ? '—' : formatDate(summary.lastReceivedAt, locale)
            }
            hint={count === 0 ? undefined : t('employees.idCard.history.received', { n: count })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">
            {t('employees.idCard.stats.prints', { count: printCount })}
          </span>
          {awaiting && (
            <span
              className={
                waitingEmployee
                  ? 'inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-200'
                  : 'inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
              }
            >
              <span
                className={
                  waitingEmployee
                    ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500'
                    : 'h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500'
                }
              />
              {t(
                waitingEmployee
                  ? 'employees.idCard.waitingEmployee'
                  : 'employees.idCard.awaitingHandover',
              )}
            </span>
          )}
        </div>

        <Card>
          <CardHeader title={t('employees.idCard.history')} />
          <CardBody>
            {prints.isLoading ? (
              <LoadingState />
            ) : entries.length === 0 ? (
              <EmptyState title={t('employees.idCard.historyEmpty')} />
            ) : (
              <Timeline entries={entries} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default EmployeeIdCardTab;
