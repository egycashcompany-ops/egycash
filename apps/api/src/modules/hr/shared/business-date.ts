// HR business dates (Leave design R10): the business calendar is Africa/Cairo; storage is
// UTC-midnight date-only. Every "today"/dueness comparison in the leave domain (and later
// Attendance) goes through these helpers so a UTC server never off-by-ones a Cairo date.
import { cairoCalendarDate } from '@ecms/contracts';

/**
 * UTC-midnight Date of the Cairo calendar date the instant falls on. MOVED to contracts (the fleet
 * dashboard's Cairo day is the same rule) and re-exported here, so every HR caller is unchanged.
 */
export { cairoCalendarDate };

/** UTC-midnight Date of "today" on the Cairo business calendar. */
export const cairoToday = (): Date => cairoCalendarDate(new Date());

/** Normalize any incoming business date to its UTC-midnight date-only form. */
export const toDateOnly = (input: Date): Date =>
  new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));

export const addDays = (dateOnly: Date, days: number): Date =>
  new Date(dateOnly.getTime() + days * 24 * 60 * 60 * 1000);

/** ISO weekday (Mon=1 … Sun=7) of a UTC-midnight date-only value. */
export const isoWeekday = (dateOnly: Date): number => {
  const wd = dateOnly.getUTCDay();
  return wd === 0 ? 7 : wd;
};

export const dateOnlyIso = (dateOnly: Date): string => dateOnly.toISOString().slice(0, 10);

/** Inclusive calendar-day span between two date-only values (same day = 1). */
export const calendarDaysInclusive = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;

/** The leave-year a date-only value belongs to (calendar year, decision L3). */
export const leaveYearOf = (dateOnly: Date): number => dateOnly.getUTCFullYear();
