// The list's ID card dialog: the card, ready to print — or, for a reader who may not print, how
// often it was printed.
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { formatDate } from '../../../../../shared/lib/format';
import { IdCardPanel } from './IdCardPanel';

export const IdCardDialog = ({
  employee,
  onClose,
}: {
  employee: EmployeeDto | null;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (employee === null) return null;
  const count = employee.idCard?.receivedCount ?? 0;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`${t('employees.idCard.title')} — ${employee.personal.fullNameAr}`}
    >
      {can('employee.editPersonal') ? (
        <IdCardPanel employee={employee} />
      ) : (
        <div className="space-y-2 py-4 text-center text-sm text-slate-600 dark:text-slate-300">
          <p>
            {count === 0
              ? t('employees.idCard.neverReceived')
              : t('employees.idCard.receivedSummary', {
                  count,
                  date: formatDate(employee.idCard?.lastReceivedAt ?? null, locale),
                })}
          </p>
          <p className="text-xs text-slate-400">{t('employees.idCard.noAccess')}</p>
        </div>
      )}
    </Dialog>
  );
};
