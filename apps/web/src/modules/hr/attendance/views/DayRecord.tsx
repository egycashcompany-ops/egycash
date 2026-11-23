// The daily record on the employee's attendance page — one line per day on an hour ruler (the same
// `DayTimelineList` the daily board's pop-up uses): date and status, hours worked, the arrival
// time, the bar, the departure time. Every scan is on the bar (repeats as ticks), and a day's scan
// log — every scan to the second, its direction, device and branch, and which two counted — opens
// under it.
//
// The owner's rule: a day shows only the first check-in and the first check-out; extra presses
// never appear as a warning anywhere else. Here, and only here, they are visible.
import { useViewLabels } from './view-labels';
import { SortMenu } from './toolbar';
import { DayLegend, DayTimelineList } from './day-timeline';
import type { EmployeeDay, EmployeeDaySort, EmployeeDaysSort } from './view-types';

const SORTS: [EmployeeDaySort, 'date' | 'arrived' | 'left' | 'worked'][] = [
  ['date', 'date'],
  ['checkIn', 'arrived'],
  ['checkOut', 'left'],
  ['worked', 'worked'],
];

export const DayRecord = ({
  days,
  locale,
  today,
  sort,
  onSort,
}: {
  days: EmployeeDay[];
  locale: 'ar' | 'en';
  /** Kept for the calendar's link to a day; the record scrolls to `att-day-<date>`. */
  picked?: string | null | undefined;
  today: string;
  sort: EmployeeDaysSort;
  onSort?: ((by: EmployeeDaySort, dir: 'asc' | 'desc') => void) | undefined;
}): JSX.Element => {
  const { t } = useViewLabels();
  const sortHint = (dir: 'asc' | 'desc'): string => t(dir === 'asc' ? 'sortAscending' : 'sortDescending');
  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DayLegend />
        {onSort !== undefined && (
          <SortMenu
            options={SORTS.map(([key, labelKey]) => ({ key, label: t(labelKey) }))}
            by={sort.by}
            dir={sort.dir}
            onSort={onSort}
            sortByLabel={t('sortBy')}
            reverseLabel={t('reverseOrder')}
            hint={sortHint}
          />
        )}
      </div>
      <DayTimelineList days={days} today={today} locale={locale} actionsLabel={t('actions')} />
    </div>
  );
};
