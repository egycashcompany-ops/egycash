// «يعمل / لا يعمل» — one device's answer: a radio group of two narrow buttons at the END of the
// item's row (the owner: «زرارين يعمل ولا يعمل خليهم على نفس الصف مش تحت البند وصغر عرضهم»).
//
// Each button is as wide as its icon and word and 48px tall; the pair never shrinks or wraps, so a
// long label wraps beside it instead. Nothing is chosen at first, and tapping the chosen button
// again clears it (`answerTapped`): nothing is mandatory, so a tap made by mistake has to be
// undoable. A chosen «يعمل» is green and a chosen «لا يعمل» red — and the ✓ / ✕ says which without
// the colour, for a reader who cannot tell the two apart in daylight.
import { IT_VEHICLE_CHECK_ANSWERS, type ItVehicleCheckAnswer } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CheckIcon, CloseIcon } from '../../../shared/ui/icons';

export const VehicleCheckAnswer = ({
  label,
  value,
  onTap,
  disabled = false,
}: {
  /** The device's name — the group's accessible name. */
  label: string;
  value: ItVehicleCheckAnswer | undefined;
  /** A tap on one of the two; the caller clears the answer when it is the one already chosen. */
  onTap: (answer: ItVehicleCheckAnswer) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const words: Record<ItVehicleCheckAnswer, string> = {
    works: t('it.vehicleCheck.answer.works'),
    notWorking: t('it.vehicleCheck.answer.notWorking'),
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-vehicle-check-answer="true"
      className="flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-0.5 shadow-inner dark:border-slate-700 dark:bg-slate-950/60"
    >
      {IT_VEHICLE_CHECK_ANSWERS.map((answer) => {
        const on = value === answer;
        const Icon = answer === 'works' ? CheckIcon : CloseIcon;
        return (
          <button
            key={answer}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            data-vehicle-check-choice={answer}
            onClick={() => onTap(answer)}
            className={cn(
              // ps-1.5 on the icon's side: the ✓ / ✕ carry about 3px of their own white space.
              'flex min-h-12 items-center justify-center gap-1 whitespace-nowrap rounded-lg pe-2 ps-1.5 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60',
              // Chosen: the system's success green or danger red. Green is emerald-700, not 600:
              // white 14px bold on emerald-600 is 3.8:1, under the 4.5:1 text needs outdoors; on
              // emerald-700 it is 5.5:1 (red-600 is already 4.8:1).
              on && answer === 'works' && 'bg-emerald-700 text-white shadow-md shadow-emerald-800/30',
              on && answer === 'notWorking' && 'bg-red-600 text-white shadow-md shadow-red-700/30',
              // Not chosen: neutral, icon and all — colour IS the answer, so an unanswered row
              // carries none.
              !on &&
                'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn('h-4 w-4 shrink-0', !on && 'text-slate-400 dark:text-slate-500')}
            />
            {words[answer]}
          </button>
        );
      })}
    </div>
  );
};
