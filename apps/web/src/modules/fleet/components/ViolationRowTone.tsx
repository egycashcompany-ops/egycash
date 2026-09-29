// A violation row's COLOUR, decided once for every table that lists fines.
//
// «وكل اللى فى الملف ضيفه ويكون الصف لونه اخضر» — the rows the old system's book was reloaded with
// are green, and the rows people type here keep the normal colour. The drivers' board and the
// (car, year) ledger behind the company board both list fines row by row, and a colour that means
// «came from the old book» has to be the same colour in both, or it means nothing in either.
//
// THE GREEN WAS ALREADY SPOKEN FOR. A settled fine has been tinted `emerald-50` since the owner
// asked for it — «المبلغ موجود عادى … بس الخلفية خضرا» — and painting the book's rows that same
// pale green would make a legend that says «green came from the old system» untrue of every fine
// somebody typed and then ticked. So the book's rows take a DEEPER green of their own, which the
// legend shows as a swatch, and a typed fine that is settled keeps the pale one it always had.
//
// ONE colour per row, never two classes fighting: `cn` joins classes without resolving conflicts,
// and which of two `bg-*` utilities wins is decided by stylesheet order, not by the order they are
// written in. A row from the book is green whether or not it is settled — the tick in its actions
// column still says which — because the owner's instruction is about the row, and a row that
// changed colour when ticked would stop saying where it came from.
import { type FleetViolationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';

/** The book's rows — a green distinct from the settled tint, readable through on both themes. */
export const FROM_OLD_BOOK_ROW = 'bg-green-100 dark:bg-green-900/40';

/** A settled fine that somebody typed here — the tint the boards have always used for it. */
export const COLLECTED_ROW = 'bg-emerald-50 dark:bg-emerald-950/40';

/**
 * The tint for one fine's row, or `undefined` for an ordinary one — which is what `rowClassName`
 * is typed to receive for «nothing to flag».
 */
export const violationRowTone = (
  row: Pick<FleetViolationDto, 'fromOldBook' | 'collected'>,
): string | undefined => {
  if (row.fromOldBook) return FROM_OLD_BOOK_ROW;
  return row.collected ? COLLECTED_ROW : undefined;
};

/**
 * One line under the table that says what the green is — with the green itself beside the words,
 * so the swatch and the rows can be compared rather than the words remembered.
 *
 * Callers render it only when a row of the book is actually on screen: a legend for a colour the
 * reader cannot see is one more line to read for nothing.
 */
export const FromOldBookLegend = ({
  className,
}: {
  className?: string | undefined;
}): JSX.Element => {
  const t = useT();
  return (
    <p
      data-from-old-book-legend="true"
      className={cn(
        'flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-3 w-3 shrink-0 rounded-sm border border-green-300 dark:border-green-800',
          FROM_OLD_BOOK_ROW,
        )}
      />
      {t('fleet.violations.fromOldBookLegend')}
    </p>
  );
};
