// Public surface of the device registry (ADR-003).
export { attendanceDeviceService, toAttendanceDeviceDto } from './attendance-device.service';
export { attendanceDeviceRepository } from './attendance-device.repository';
export { AttendanceDeviceModel, type AttendanceDeviceDoc } from './attendance-device.model';
export { buildAttendanceDevicesRouter } from './attendance-device.routes';
