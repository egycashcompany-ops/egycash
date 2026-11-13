// «تاريخ ميلاده وكام يوم باقى عليه (ولو اليوم عيد ميلاده يقوله كل سنة وأنت طيب)».
//
// Both dates are CALENDAR days in Cairo, compared as `YYYY-MM-DD`: a device in another timezone,
// or a page left open past midnight, must not move the birthday a day early or late. The caller
// passes today's Cairo day in, so this file never reads a clock and its tests never race one.
//
// Somebody born on 29 February has a birthday every year: on the 28th in a year without a 29th.
import { daysBetweenYmd } from '@ecms/contracts';

export interface BirthdayCountdown {
  /** The next birthday, today included: `YYYY-MM-DD`. */
  next: string;
  /** Whole days until `next`; 0 means today is the birthday. */
  days: number;
  /** The age the person turns on `next`. */
  turning: number;
  /** How far through the year since the last birthday, 0..1 — the bar on the card. */
  progress: number;
}

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const pad = (n: number): string => String(n).padStart(2, '0');

/** That month-day in `year`, with 29 February falling back to the 28th in a common year. */
const inYear = (year: number, month: number, day: number): string =>
  month === 2 && day === 29 && !isLeap(year)
    ? `${year}-02-28`
    : `${year}-${pad(month)}-${pad(day)}`;

const parts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
};

export const birthdayCountdown = (birthYmd: string, todayYmd: string): BirthdayCountdown => {
  const [birthYear, month, day] = parts(birthYmd);
  const [year] = parts(todayYmd);
  const thisYear = inYear(year, month, day);
  const next = thisYear >= todayYmd ? thisYear : inYear(year + 1, month, day);
  const previous = next === thisYear ? inYear(year - 1, month, day) : thisYear;
  const days = daysBetweenYmd(todayYmd, next);
  const span = daysBetweenYmd(previous, next);
  return {
    next,
    days,
    turning: Number(next.slice(0, 4)) - birthYear,
    progress: days === 0 ? 1 : span > 0 ? (span - days) / span : 0,
  };
};
