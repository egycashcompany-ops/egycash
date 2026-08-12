// Public surface of the Attendance sub-module (ADR-003 barrels per feature).
export * from './shifts';
export * from './assignments';
export * from './punches';
export * from './day-records';
export * from './regularizations';
export * from './overtime';
export { registerHrAttendanceSettings } from './attendance.settings';
export { migrateAttendance } from './attendance.migration';
