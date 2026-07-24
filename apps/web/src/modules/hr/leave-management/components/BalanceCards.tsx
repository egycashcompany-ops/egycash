// Balance cards per banked type (My Leave + the profile Leave tab + HR balances view).
import { type LeaveBalanceDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody } from '../../../../shared/ui';
import { useEmployeeLeaveBalances } from '../api/leave-queries';
import { typeLabel } from './typeLabel';

export const BalanceCards = ({ employeeId, year }: { employeeId: string; year?: number }): JSX.Element => {
  const t = useT();
  const { data } = useEmployeeLeaveBalances(employeeId, year);
  const rows: LeaveBalanceDto[] = data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{t('leave.balances.none')}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((b) => (
        <Card key={`${b.typeId}:${String(b.year)}`}>
          <CardBody>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{typeLabel(t, b.typeCode)}</span>
              <span className="text-xs text-slate-500">{b.year}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {b.available}
              <span className="ms-1 text-xs font-normal text-slate-500">{t('leave.balances.days')}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
              <span>{t('leave.balances.granted')}: {b.granted + b.carriedOver + b.adjusted}</span>
              <span>{t('leave.balances.reserved')}: {b.reserved}</span>
              <span>{t('leave.balances.consumed')}: {b.consumed}</span>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
};
