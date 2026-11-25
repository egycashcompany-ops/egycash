// The module's business calendar is Africa/Cairo (design §3.5, RK-13): a number's year is the
// Cairo year of its business date (OD-57 A), and a day picked in a filter runs from Cairo's
// midnight to the next one. The calendar itself lives in `@ecms/contracts`, where the browser
// reads it too, so it is re-exported here and nothing is copied — HR's `business-date.ts` does the
// same — while IT, ATM and Fleet still carry copies of their own.
//
//  · `cairoCalendarDate(instant)` — the act's business date, stored as UTC midnight;
//  · `cairoYmd(instant)` — the Cairo date of an instant as 'YYYY-MM-DD';
//  · `cairoDayStart(ymd)` and `addDaysYmd(ymd, 1)` — a filter's bounds: from the start of `from`
//    to before the start of the day after `to`.
export { addDaysYmd, cairoCalendarDate, cairoDayStart, cairoYmd } from '@ecms/contracts';
