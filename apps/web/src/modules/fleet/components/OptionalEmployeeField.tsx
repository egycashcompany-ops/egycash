// Optional employee slot for dialogs (odometer drivers, workshop custody): empty → the
// directory picker; picked → the resolved name with a clear affordance. Clearing submits null
// downstream — an erased fact, per the module's form convention.
import { useT } from '../../../platform/localization/useT';
import { CloseIcon } from '../../../shared/ui/icons';
import { EmployeeName } from './EmployeeName';
import { EmployeeSearchPicker } from './EmployeeSearchPicker';

export const OptionalEmployeeField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (employeeId: string) => void;
}): JSX.Element => {
  const t = useT();
  if (value !== '') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="text-sm">
          <EmployeeName employeeId={value} />
        </span>
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
          aria-label={t('common.clear')}
          title={t('common.clear')}
          onClick={() => onChange('')}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return <EmployeeSearchPicker value={value} onPick={(id) => onChange(id)} />;
};
