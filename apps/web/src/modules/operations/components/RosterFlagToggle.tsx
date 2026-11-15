// One flag of one member on «كشف طاقم العمليات» — the legacy roster's round toggle (Round 19).
//
// The owner put the legacy screen beside this one: every flag there is a CIRCLE, green with a ✓
// when it is set and grey when it is not, and a row reads at a glance as a line of green and grey.
// The small grey checkboxes it replaced all looked alike set or not. So this is that circle — a
// `switch` to a screen reader and the keyboard (Tab to it, Space or Enter to press it), named for
// the flag AND the member, since twenty «سلاح» switches named «سلاح» alone could not be told apart.
//
// A tick is not saved when it is pressed (the page saves them together, «حفظ (n)»); a cell that
// differs from what is saved wears an amber ring until then, and says so on hover.
import { cn } from '../../../shared/lib/cn';

/** The ✓ — the boards' own check (`SHIPMENT_PATH.check`), heavier for a 12px mark. */
const CHECK = 'M5 13l4 4L19 7';

export const RosterFlagToggle = ({
  on,
  pending,
  label,
  pendingNote,
  disabled,
  onToggle,
  flag,
}: {
  /** What the cell shows: the waiting tick, or else what is saved. */
  on: boolean;
  /** It differs from what is saved — ringed until «حفظ». */
  pending: boolean;
  /** «سلاح — أحمد سيد محمود»: the flag, then whose. */
  label: string;
  /** Said on hover after the label while the cell is waiting — «تغيير لم يُحفظ بعد». */
  pendingNote: string;
  /** No plan grant (or a save under way): shown, not pressable. */
  disabled: boolean;
  onToggle: () => void;
  flag: string;
}): JSX.Element => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    title={pending ? `${label} — ${pendingNote}` : label}
    disabled={disabled}
    onClick={onToggle}
    data-roster-flag={flag}
    data-roster-pending={pending ? 'true' : undefined}
    className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-full transition',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#111827]',
      on
        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-700/30 enabled:hover:bg-emerald-600 dark:bg-emerald-500'
        : 'bg-slate-200 text-transparent enabled:hover:bg-slate-300 dark:bg-slate-700/70 dark:enabled:hover:bg-slate-600',
      // Waiting for «حفظ»: an amber ring around the circle, the circle itself still saying on/off.
      pending &&
        'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-amber-400 dark:ring-offset-[#111827]',
      'enabled:cursor-pointer enabled:active:scale-90 disabled:cursor-default',
    )}
  >
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
    >
      <path d={CHECK} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);
