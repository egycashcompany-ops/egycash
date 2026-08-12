// What this employee's pay items come to over one month (PY-3).
//
// It sits inside the Pay Items tab rather than on a screen of its own, because it answers a
// question about the rows immediately above it: the table says what is assigned, this says what
// that assignment is worth in March.
//
// Every line shows its DERIVATION, not just its figure — the base, the fraction of the month, and
// the day counts on both sides of it. A number an employee will ask about has to be able to
// answer.
//
// Quantity lines (PY-4) show WHAT was counted beside the figure — ten days attended, ninety
// approved minutes — and the stamp of the frozen period they came from. They carry no proration
// fraction, because the count already is one.
//
// Leave lines (PY-5) are the ones nobody assigned: they are derived from the run's leave snapshot
// and charge the SHORTFALL — what the leave was not paid at. So they appear among the deductions
// with the rate written on them, leave paid in full shows no line at all, and the days behind them
// are summarised separately so a reader can see the leave even when it cost nothing.
//
// What this is NOT: a payslip. There is no tax here and no insurance, because neither exists in
// this system. `net` is earnings minus deductions and is labelled as exactly that.
import { useState } from 'react';
import {
  type CompensationEffectsDto,
  type CompensationLineDto,
  type EmployeeDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Field, Input } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { formatDateTime, formatMoney, localized } from '../../../../shared/lib/format';
import { useEmployeeCompensation } from '../api/payroll-queries';

/** `YYYY-MM` of the current Cairo month — the same period key the API speaks. */
const thisPeriod = (): string => new Date().toISOString().slice(0, 7);

/**
 * A stable row key for a line that may have no assignment behind it (PY-5).
 *
 * A derived leave line is identified by what makes it unique — its type and the rate it was
 * consumed at — which is exactly how the engine grouped it in the first place.
 */
const lineKey = (line: CompensationLineDto): string =>
  line.sourceAssignmentId ??
  `leave:${line.leaveTypeCode ?? ''}:${line.leavePayRate === null ? 'pending' : String(line.leavePayRate)}`;

const Amount = ({ value, currency }: { value: number; currency: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(value, currency, locale)}
    </span>
  );
};

export const CompensationCard = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [period, setPeriod] = useState(thisPeriod);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const query = useEmployeeCompensation(employee.id, period, valid);

  const columns: Column<CompensationLineDto>[] = [
    {
      key: 'item',
      header: t('payroll.compensation.line'),
      render: (l) => (
        <span className="flex items-center gap-2">
          <span>{localized(l.name, locale)}</span>
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {l.code}
          </span>
        </span>
      ),
    },
    {
      key: 'basis',
      header: t('payroll.payItems.calcBasis'),
      render: (l) => t(`payroll.payItems.basis.${l.calcBasis}`),
    },
    {
      key: 'base',
      header: t('payroll.compensation.base'),
      render: (l) =>
        l.calcBasis === 'percentOfBase' ? (
          <span dir="ltr" className="tabular-nums">{`${String(l.baseAmount)}%`}</span>
        ) : (
          <Amount value={l.baseAmount} currency={l.currency} />
        ),
    },
    {
      key: 'proration',
      header: t('payroll.compensation.inForce'),
      render: (l) => (
        <span dir="ltr" className="tabular-nums text-slate-500">
          {`${String(l.daysInForce)} / ${String(l.daysInPeriod)}`}
        </span>
      ),
    },
    {
      // PY-4 — what was counted, and what it was a count OF. A quantity line is priced from this
      // and NOT prorated, so showing the count is the only way the figure explains itself.
      key: 'quantity',
      header: t('payroll.compensation.quantity'),
      render: (l) => {
        // A leave line counts days too, but of a different thing — so it names the leave type and
        // the rate it was paid at rather than an attendance source it never read.
        if (l.origin === 'leaveSnapshot') {
          return l.quantity === null ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="flex flex-col">
              <span dir="ltr" className="tabular-nums">
                {`${String(l.quantity)} ${t('payroll.compensation.unit.days')}`}
              </span>
              <span className="text-xs text-slate-400">
                {t('payroll.compensation.leaveAtRate', {
                  type: l.leaveTypeCode ?? '',
                  rate: String(l.leavePayRate ?? 0),
                })}
              </span>
            </span>
          );
        }
        return l.quantitySource === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span className="flex flex-col">
            <span dir="ltr" className="tabular-nums">
              {l.quantity === null
                ? '—'
                : `${String(l.quantity)} ${t(`payroll.compensation.unit.${l.quantityUnit ?? 'days'}`)}`}
            </span>
            <span className="text-xs text-slate-400">
              {t(`payroll.quantitySource.${l.quantitySource}`)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: t('payroll.compensation.amount'),
      align: 'end',
      render: (l) =>
        l.amount === null ? (
          // Two different unknowns, two different words: one waits for attendance to be frozen,
          // the other for a payroll run to exist at all.
          <Badge tone="neutral">
            {t(
              l.state === 'pendingLeaveSnapshot'
                ? 'payroll.compensation.pendingLeave'
                : 'payroll.compensation.pending',
            )}
          </Badge>
        ) : (
          <Amount value={l.amount} currency={l.currency} />
        ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t('payroll.compensation.title')}
        actions={
          <div className="w-40">
            <Field label={t('payroll.compensation.period')}>
              <Input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label={t('payroll.compensation.period')}
              />
            </Field>
          </div>
        }
      />
      <CardBody>
        {!valid && <EmptyState title={t('payroll.compensation.pickPeriod')} />}
        {valid && query.isLoading && <LoadingState />}
        {valid && query.isError && (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
        {valid && query.data !== undefined && (
          <Effects effects={query.data} columns={columns} />
        )}
      </CardBody>
    </Card>
  );
};

const Effects = ({
  effects,
  columns,
}: {
  effects: CompensationEffectsDto;
  columns: Column<CompensationLineDto>[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // Which version of the attendance truth was priced — one stamp for the whole card, because
  // every quantity line on it came from the same frozen period.
  const frozenAt =
    [...effects.earnings, ...effects.deductions].find((l) => l.feedFrozenAt !== null)
      ?.feedFrozenAt ?? null;
  const empty =
    effects.earnings.length === 0 &&
    effects.deductions.length === 0 &&
    effects.deferred.length === 0 &&
    effects.leave === null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {t('payroll.compensation.employed', {
          days: String(effects.employmentDaysInPeriod),
          of: String(effects.daysInPeriod),
        })}
      </p>

      {effects.warnings.map((warning) => (
        <p
          key={warning}
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {t(`payroll.compensation.warning.${warning}`)}
        </p>
      ))}

      {empty && <EmptyState title={t('payroll.compensation.empty')} />}

      {effects.earnings.length > 0 && (
        <Section title={t('payroll.compensation.earnings')}>
          <DataTable columns={columns} rows={effects.earnings} rowKey={lineKey} />
        </Section>
      )}
      {effects.deductions.length > 0 && (
        <Section title={t('payroll.compensation.deductions')}>
          <DataTable
            columns={columns}
            rows={effects.deductions}
            rowKey={lineKey}
          />
        </Section>
      )}
      {effects.deferred.length > 0 && (
        <Section
          title={t('payroll.compensation.deferred')}
          hint={t('payroll.compensation.deferredHint')}
        >
          <DataTable columns={columns} rows={effects.deferred} rowKey={lineKey} />
        </Section>
      )}

      {/*
        The leave BEHIND the lines. Shown whenever a run pinned any, including when it cost
        nothing at all: leave paid in full produces no deduction, and a card that then said
        nothing about it would look like a month with no leave in it.
      */}
      {effects.leave !== null && effects.leave.totalDays > 0 && (
        <p className="rounded border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
          {t('payroll.compensation.leaveFacts', {
            days: String(effects.leave.totalDays),
            paid: String(effects.leave.paidDays),
            unpaid: String(effects.leave.unpaidDays),
          })}
          {' · '}
          {t('payroll.compensation.leaveSnapshotAt', {
            at: formatDateTime(effects.leave.snapshotAt, locale),
          })}
        </p>
      )}

      {frozenAt !== null && (
        <p className="text-xs text-slate-400">
          {t('payroll.compensation.frozenAt', { at: formatDateTime(frozenAt, locale) })}
        </p>
      )}

      {!empty && (
        <dl className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
          <Total label={t('payroll.compensation.totalEarnings')} value={effects.totalEarnings} currency={effects.currency} />
          <Total label={t('payroll.compensation.totalDeductions')} value={effects.totalDeductions} currency={effects.currency} />
          <Total label={t('payroll.compensation.net')} value={effects.net} currency={effects.currency} strong />
          <p className="pt-1 text-xs text-slate-400">{t('payroll.compensation.netHint')}</p>
        </dl>
      )}
    </div>
  );
};

const Section = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element => (
  <section className="space-y-1">
    <h4 className="text-sm font-semibold">{title}</h4>
    {hint !== undefined && <p className="text-xs text-slate-400">{hint}</p>}
    {children}
  </section>
);

const Total = ({
  label,
  value,
  currency,
  strong = false,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd dir="ltr" className="tabular-nums">
        {formatMoney(value, currency, locale)}
      </dd>
    </div>
  );
};
