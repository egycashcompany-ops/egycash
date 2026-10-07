// «حطلى فى الفلاتر ايقونات»: each filter of the dark boards carries a small icon at its start, as
// the charging screen's car filter did — the box itself keeps its text, the icon says what it is.
import { type ReactNode } from 'react';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, PATH } from './FuelCardBoard';

export const FILTER_ICON = {
  car: PATH.truck,
  card: PATH.card,
  calendar: PATH.calendar,
  plate: ['M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z', 'M7 12h10'],
  chassis: ['M7 20l4-16m2 16l4-16M6 9h14M4 15h14'],
  motor: [
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  make: [
    'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  ],
  licence: [
    'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2',
  ],
  branch: [
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  ],
  operation: [
    'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  ],
  insurance: [
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  ],
  status: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  company: ['M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9'],
  charge: ['M13 10V3L4 14h7v7l9-11h-7z'],
  person: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
  phone: [
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  ],
  map: [
    'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  ],
  image: PATH.image,
} as const;

/**
 * A filter with its icon. The icon sits over the control's start edge and the control's text is
 * pushed past it — the box keeps its size, its value and its list.
 */
export const FilterWithIcon = ({
  icon,
  tone = 'text-slate-500 dark:text-slate-400',
  className,
  children,
}: {
  icon: readonly string[];
  /** The icon's colour. */
  tone?: string;
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    className={cn(
      'relative',
      // The control's own text starts after the icon — the trigger of a list, or a typed box. On
      // the PAGE's start side: a code or a chassis box is written left to right inside an Arabic
      // page, so its own «start» is the wrong side for the icon.
      'rtl:[&_button[aria-haspopup]]:!pr-6 ltr:[&_button[aria-haspopup]]:!pl-6',
      'rtl:[&>input]:!pr-6 rtl:[&>input]:!pl-1.5 ltr:[&>input]:!pl-6 ltr:[&>input]:!pr-1.5',
      className,
    )}
  >
    {children}
    <span className="pointer-events-none absolute start-0 top-0 z-[1] flex h-9 items-center ps-2">
      <BoardIcon d={icon} className={cn('h-3.5 w-3.5', tone)} />
    </span>
  </div>
);
