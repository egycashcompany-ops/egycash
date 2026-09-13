// «مين السائق؟» on the odometer log and at the workshop door — asked of the DRIVERS REGISTRY.
//
// This was `OptionalEmployeeField`, and it searched the whole payroll. Two things were wrong with
// that, and the violations screen had already met both:
//
//   · it offered COLLEAGUES WHO ARE NOT DRIVERS. Every other «مين السائق؟» in this module means
//     one thing — whoever holds a seat whose job title requires a driving test — and the server
//     agrees. A picker that answers a different question puts a name on a reading and a workshop
//     visit that the rest of the module cannot reconcile;
//   · it showed NOTHING until a letter was typed. Clear the box and come back to it and there is
//     an empty field with no way to discover who could go in it — «مش لازم يدخله ك انبوت كتبه».
//     `RegistryDriverPicker` lists a page of drivers the moment it opens.
//
// The seat is still OPTIONAL: a reading taken with nobody named is a real state, and so is a car
// that arrived at the workshop without one. What is picked comes from the registry; what is left
// empty stays empty.
import { useT } from '../../../platform/localization/useT';
import { EmployeeName } from './EmployeeName';
import { CloseIcon } from '../../../shared/ui/icons';
import { RegistryDriverPicker } from './RegistryDriverPicker';

export const OptionalDriverField = ({
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
  return (
    <RegistryDriverPicker
      value={[]}
      onChange={(next) => onChange(next[0] ?? '')}
      fullWidth
      className="w-full"
    />
  );
};
