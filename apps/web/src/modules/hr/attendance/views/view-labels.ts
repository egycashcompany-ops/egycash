// The attendance views' vocabulary, read from the one dictionary the rest of the product reads.
//
// The wording is the owner's, word for word; it lives in `i18n.ts` under `attendanceView.*` like
// every other string a screen says, so the formal-Arabic guard, the placeholder guard and the
// locale switch all reach it by the same path. This file is the small typed door the views knock
// on: `t('dailyAttendance')` rather than `t('attendanceView.dailyAttendance')`, so the views that
// were handed over stay exactly as they were written.
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import type { ViewStatus } from './view-types';

/** Every label the views ask for. A typo is a compile error, not a key printed on the screen. */
export const VIEW_LABEL_KEYS = [
  'dailyAttendance',
  'sheetStory',
  'inToday',
  'usualDay',
  'attendance',
  'of',
  'showAll',
  'arrivalsTitle',
  'arrivalsNote',
  'arrivalsEmpty',
  'arrivalsNoteNoRoster',
  'dayStarts',
  'now',
  'people',
  'onTimeRate',
  'ofPresentDays',
  'calendarTitle',
  'calendarNote',
  'weekdays',
  'punctualityTitle',
  'punctualityNote',
  'punctualityNoteNoRoster',
  'onTime',
  'lateAfter',
  'weekN',
  'employees',
  'present',
  'late',
  'notYetIn',
  'absent',
  'onLeave',
  // The three counters that make the band add up, and the line that names what it cannot count.
  'noSchedule',
  'noRecord',
  'offDay',
  'unlinkedScans',
  'ofEmployees',
  'rate',
  'allToday',
  'expected',
  'inOut',
  'day',
  'lateCol',
  'overtime',
  'tags',
  'actions',
  'employee',
  'status',
  'prevDay',
  'nextDay',
  'noRows',
  'daysPresent',
  'outOf',
  'usualArrival',
  'usualDeparture',
  'hoursPerDay',
  'inTotal',
  'avgFirstIn',
  'avgLastOut',
  'lateDays',
  'lateTotal',
  'absentDays',
  'incomplete',
  'hoursChart',
  'hoursChartNote',
  'hoursChartEmpty',
  'avg',
  'dailyRecord',
  'newestFirst',
  'date',
  'arrived',
  'left',
  'worked',
  'lastPunch',
  'firstArrival',
  'exportCsv',
  'noDays',
  'hours',
  'minutes',
  // The sortable sheet, and the two figures the flexible-hours rule added.
  'codeCol',
  'shortfallCol',
  'shortfallTotal',
  'sortAscending',
  'sortDescending',
  'oldestFirst',
] as const;
export type ViewLabelKey = (typeof VIEW_LABEL_KEYS)[number];

export interface ViewLabels {
  locale: 'ar' | 'en';
  t: (key: ViewLabelKey, params?: Record<string, string | number>) => string;
  status: (s: ViewStatus) => string;
}

export const useViewLabels = (): ViewLabels => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale) === 'en' ? 'en' : 'ar';
  return {
    locale,
    t: (key, params) => t(`attendanceView.${key}`, params),
    status: (s) => t(`attendanceView.status.${s}`),
  };
};
