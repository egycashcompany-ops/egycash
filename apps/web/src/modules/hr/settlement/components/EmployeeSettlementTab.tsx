// The employee profile's Settlement tab (P-HR-11) — default export, lazy-loaded by the profile hub
// exactly as the Pay Items, Adjustments and Loans tabs are.
//
// WHAT THIS SCREEN IS FOR. Settling with somebody who has left used to mean opening four screens
// and adding up by hand: the exit month's pay in payroll, the loan balance on the loans tab, the
// leave that was lost in the ledger, and whatever adjustment was still sitting in a queue. Nothing
// brought them together. This does, and it computes NOTHING — every figure on it is quoted from
// the feature that owns it, so the screen cannot disagree with the screen it came from.
//
// AND WHAT IT DELIBERATELY DOES NOT SHOW. There is no severance figure, no leave encashment and no
// notice-period pay, because this system has no rule for any of the three (design §5). Rather than
// print a 0 — which would look like an answer — the screen NAMES them as outstanding decisions. An
// incomplete settlement that says so is safe; one that looks complete and is not is the thing worth
// preventing.
import {
  type EmployeeDto,
  type EmployeeSettlementDto,
  type Locale,
  type SettlementUnresolvedItem,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { formatDate, formatMoney } from '../../../../shared/lib/format';
import { useLeaveTypes } from '../../leave-management/api/leave-queries';
import { useEmployeeSettlement } from '../api/settlement-queries';

type Leave = EmployeeSettlementDto['expiredLeave'][number];
type Pending = EmployeeSettlementDto['pendingAdjustments'][number];

const Row = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm">{value}</dd>
  </div>
);

const EmployeeSettlementTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const summary = useEmployeeSettlement(employee.id);
  const { data: leaveTypes } = useLeaveTypes();

  if (summary.isLoading) return <LoadingState />;
  if (summary.isError || summary.data === undefined) {
    return <ErrorState onRetry={() => void summary.refetch()} />;
  }
  const s = summary.data;

  const typeName = (typeId: string): string => {
    const found = (leaveTypes ?? []).find((type) => type.id === typeId);
    return found === undefined ? typeId : found.name[locale === 'ar' ? 'ar' : 'en'];
  };

  const leaveColumns: Column<Leave>[] = [
    { key: 'typeId', header: t('settlement.leave.type'), render: (r) => typeName(r.typeId) },
    { key: 'year', header: t('settlement.leave.year'), render: (r) => String(r.year) },
    { key: 'expiredDays', header: t('settlement.leave.days'), render: (r) => String(r.expiredDays) },
  ];

  const pendingColumns: Column<Pending>[] = [
    { key: 'kind', header: t('settlement.pending.kind'), render: (r) => t(`payroll.adjustments.kind.${r.kind}`) },
    {
      key: 'amount',
      header: t('settlement.pending.amount'),
      render: (r) => formatMoney(r.amount, r.currency, locale),
    },
    {
      key: 'status',
      header: t('settlement.pending.status'),
      render: (r) => <Badge tone="warning">{t(`payroll.adjustments.status.${r.status}`)}</Badge>,
    },
    { key: 'reason', header: t('settlement.pending.reason'), render: (r) => r.reason },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('settlement.exit.title')} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Row label={t('settlement.exit.type')} value={t(`employees.exitType.${s.exitType}`)} />
            <Row label={t('settlement.exit.date')} value={formatDate(s.effectiveDate, locale)} />
            <Row label={t('settlement.exit.period')} value={s.exitPeriod} />
            <Row
              label={t('settlement.exit.frozen')}
              value={s.finalPeriodFrozen ? t('settlement.frozen.yes') : t('settlement.frozen.no')}
            />
          </dl>
        </CardBody>
      </Card>

      {/*
        The exit month's pay — the payroll engine's own answer, not a final-pay calculation of our
        own. A leaver is already in that month's batch and already prorated to their last day.
      */}
      <Card>
        <CardHeader
          title={t('settlement.finalPeriod.title')}
          description={t('settlement.finalPeriod.hint')}
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Row
              label={t('settlement.finalPeriod.earnings')}
              value={formatMoney(s.finalPeriod.totalEarnings, s.finalPeriod.currency, locale)}
            />
            <Row
              label={t('settlement.finalPeriod.deductions')}
              value={formatMoney(s.finalPeriod.totalDeductions, s.finalPeriod.currency, locale)}
            />
            <Row
              label={t('settlement.finalPeriod.net')}
              value={formatMoney(s.finalPeriod.net, s.finalPeriod.currency, locale)}
            />
            <Row
              label={t('settlement.finalPeriod.days')}
              // Two counts and the word between them — the separator belongs to the translation,
              // not to the code, which is also what keeps this file free of anything resembling a
              // calculation.
              value={t('settlement.finalPeriod.daysValue', {
                days: s.finalPeriod.employmentDaysInPeriod,
                total: s.finalPeriod.daysInPeriod,
              })}
            />
          </dl>
        </CardBody>
      </Card>

      {/*
        The loan, if one is still owing. D8 already ruled what this means: not a failure and not an
        error, but a fact somebody has to act on OUTSIDE this system. So the balance is stated and
        nothing here offers to recover it from the final pay.
      */}
      <Card>
        <CardHeader title={t('settlement.loan.title')} description={t('settlement.loan.hint')} />
        <CardBody>
          {s.outstandingLoan === null ? (
            <EmptyState title={t('settlement.loan.none')} />
          ) : (
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Row
                label={t('settlement.loan.remaining')}
                value={formatMoney(s.outstandingLoan.remaining, s.outstandingLoan.currency, locale)}
              />
              <Row
                label={t('settlement.loan.repaid')}
                value={formatMoney(s.outstandingLoan.repaid, s.outstandingLoan.currency, locale)}
              />
              <Row label={t('settlement.loan.type')} value={t(`loans.type.${s.outstandingLoan.type}`)} />
              <Row
                label={t('settlement.loan.status')}
                value={t(`loans.status.${s.outstandingLoan.status}`)}
              />
            </dl>
          )}
        </CardBody>
      </Card>

      {/* The leave the exit took away. Read from the ledger — the balance itself was zeroed. */}
      <Card>
        <CardHeader title={t('settlement.leave.title')} description={t('settlement.leave.hint')} />
        <CardBody>
          <DataTable
            columns={leaveColumns}
            rows={s.expiredLeave}
            rowKey={(r) => `${r.typeId}-${String(r.year)}`}
            empty={<EmptyState title={t('settlement.leave.none')} />}
          />
        </CardBody>
      </Card>

      {/* Money about this month that nobody has decided — and so is in nobody's total above. */}
      <Card>
        <CardHeader title={t('settlement.pending.title')} description={t('settlement.pending.hint')} />
        <CardBody>
          <DataTable
            columns={pendingColumns}
            rows={s.pendingAdjustments}
            rowKey={(r) => r.adjustmentId}
            empty={<EmptyState title={t('settlement.pending.none')} />}
          />
        </CardBody>
      </Card>

      {/*
        THE POINT OF THE SCREEN, and the reason it is a warning rather than a table of zeroes: these
        three amounts are not calculated anywhere in this system because no rule for them exists in
        it. Naming them is what stops an incomplete settlement from looking finished.
      */}
      <Card>
        <CardHeader
          title={t('settlement.unresolved.title')}
          description={t('settlement.unresolved.hint')}
        />
        <CardBody>
          <ul className="space-y-2">
            {s.unresolved.map((item: SettlementUnresolvedItem) => (
              <li
                key={item}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <span className="font-medium">{t(`settlement.unresolved.${item}`)}</span>
                <span className="ms-2 text-xs opacity-80">
                  {t(`settlement.unresolved.${item}.why`)}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
};

export default EmployeeSettlementTab;
