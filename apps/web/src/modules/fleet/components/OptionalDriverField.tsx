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
//     The picker lists the whole roster the moment it opens.
//
// «تحسين اختيار السواقيين»: it is `DriverPicker` now — the same roster, each driver drawn with
// the badge, the name and the code under it, searched by either, with the picked one in the box.
//
// The seat is still OPTIONAL: a reading taken with nobody named is a real state, and so is a car
// that arrived at the workshop without one. What is picked comes from the registry; what is left
// empty stays empty.
import { cn } from '../../../shared/lib/cn';
import { DriverPicker } from './DriverPerson';

/** The design forms' box, around the picker's own. Red with the design's glow while missing. */
export const DRIVER_BOX = cn(
  'rounded-xl px-3 py-1.5 text-[15px] shadow-inner transition-all',
  'border-slate-200 bg-slate-50 text-slate-900 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-white',
  'hover:border-indigo-400/60 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
  'aria-[invalid=true]:!border-rose-500/70 aria-[invalid=true]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
);

export const OptionalDriverField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (employeeId: string) => void;
}): JSX.Element => (
  // The seat stays optional: the picker's ✕ hands back '' — onChange('') — and empty is empty.
  <DriverPicker value={value} onChange={onChange} className={DRIVER_BOX} />
);
