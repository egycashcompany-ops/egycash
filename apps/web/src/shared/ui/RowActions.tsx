// Secondary row controls: present, but not shouting from every row at once.
//
// A table where every row carries four visible buttons stops looking like a list of records and
// starts looking like a control panel — the buttons repeat down the page and out-weigh the data
// they belong to. GitHub, Linear and Vercel all solve it the same way: the row's secondary actions
// appear when the pointer is on the row, and the row itself stays readable until then.
//
// Not a menu. Everything stays in the DOM, in the tab order and reachable — this only changes when
// the controls are PAINTED, never whether they exist:
//
//   • below `sm` there is no pointer to hover with, so they are simply always visible;
//   • `group-focus-within` brings them back the moment anything inside the row takes focus, so a
//     keyboard user never chases an invisible button.
//
// Requires the row to be a `group` — `DataTable` marks every row as one.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

export const RowActions = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <span
    className={cn(
      'flex items-center gap-0.5 transition-opacity',
      'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
      className,
    )}
  >
    {children}
  </span>
);
