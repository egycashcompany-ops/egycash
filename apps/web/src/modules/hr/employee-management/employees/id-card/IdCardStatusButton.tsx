// The list's ID card cell: one glance says whether this person has a card, and how many.
//
// Received: the card lights up in the brand colour with a soft glow, and the number of cards the
// person has RECEIVED sits on its corner (printing alone never counts — see the API). Waiting for
// its handover, by whose turn it is: amber with a pulsing dot while HR still has the receipt to
// print, sky blue once the receipt is out and the employee has to sign and take the card. Never
// received: the same card, dimmed and outlined in dashes — present, but not yet real.
// It is a button of its own, so opening the card never also opens the profile behind the row.
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate } from '../../../../../shared/lib/format';

/** An ID card: the photo on the left, two lines of text beside it. */
export const IdCardGlyph = ({ className }: { className?: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <rect x="5.5" y="8.5" width="4.5" height="6" rx="1" />
    <path d="M13 10h5.5M13 13.5h4" />
  </svg>
);

export const IdCardStatusButton = ({
  employee,
  onOpen,
}: {
  employee: EmployeeDto;
  onOpen: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const count = employee.idCard?.receivedCount ?? 0;
  const printed = count > 0;
  const awaiting = employee.idCard?.awaitingHandover === true;
  const waitingEmployee = awaiting && (employee.idCard?.receiptPrintedAt ?? null) !== null;
  const label = waitingEmployee
    ? t('employees.idCard.waitingEmployee')
    : awaiting
      ? t('employees.idCard.awaitingHandover')
      : printed
        ? t('employees.idCard.receivedSummary', {
            count,
            date: formatDate(employee.idCard?.lastReceivedAt ?? null, locale),
          })
        : t('employees.idCard.neverReceived');

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label={`${t('employees.idCard.open')} — ${label}`}
      title={label}
      className={cn(
        'relative mx-auto grid h-9 w-11 place-items-center rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        printed
          ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_0_0_3px_rgba(99,102,241,0.15),0_6px_16px_-6px_rgba(79,70,229,0.75)] hover:-translate-y-0.5 hover:shadow-[0_0_0_4px_rgba(99,102,241,0.22),0_10px_22px_-8px_rgba(79,70,229,0.85)]'
          : waitingEmployee
            ? 'border-2 border-dashed border-sky-400 bg-sky-50 text-sky-600 hover:bg-sky-100 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300'
            : awaiting
              ? 'border-2 border-dashed border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300'
              : 'border border-dashed border-slate-300 text-slate-300 hover:border-slate-400 hover:text-slate-500 dark:border-slate-600 dark:text-slate-600 dark:hover:text-slate-400',
      )}
    >
      <IdCardGlyph className="h-5 w-5" />
      {awaiting && (
        <span className="absolute -start-1 -top-1 flex h-3 w-3" aria-hidden>
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              waitingEmployee ? 'bg-sky-400' : 'bg-amber-400',
            )}
          />
          <span
            className={cn(
              'relative inline-flex h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900',
              waitingEmployee ? 'bg-sky-500' : 'bg-amber-500',
            )}
          />
        </span>
      )}
      {printed && (
        <span className="absolute -end-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white px-1 text-[10px] font-bold tabular-nums text-brand-700 shadow ring-1 ring-brand-200 dark:bg-slate-900 dark:text-brand-300 dark:ring-brand-800">
          {count}
        </span>
      )}
    </button>
  );
};
