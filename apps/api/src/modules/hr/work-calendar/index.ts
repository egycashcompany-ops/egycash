// Public surface of the shared HR business calendar (ADR-003 barrel).
export { workCalendarService, toHolidayDto } from './work-calendar.service';
export { buildHolidaysRouter, buildWorkCalendarRouter } from './work-calendar.routes';
export { registerHrWorkCalendarSettings } from './work-calendar.settings';
export { HolidayModel, type HolidayDoc } from './holiday.model';
