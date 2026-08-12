// Public surface of the Shifts feature (ADR-003 barrel).
export { shiftService, toShiftDto } from './shift.service';
export { shiftRepository } from './shift.repository';
export { buildAttendanceShiftsRouter } from './shift.routes';
export { ShiftModel, type ShiftDoc } from './shift.model';
