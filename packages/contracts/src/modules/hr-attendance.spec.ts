// The attendance vocabularies and boundary rules, pinned. The enums are CONTRACTS — the feed's
// §15.1 consumers key on them — so a value added or renamed must move a value here on purpose.
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_DAY_FLAGS,
  ATTENDANCE_FEED_FIELDS,
  AttendancePeriodFrozenPayloadV1,
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_PUNCH_DIRECTIONS,
  ATTENDANCE_PUNCH_SOURCES,
  CreateShiftSchema,
  CreateShiftAssignmentSchema,
  HrAttendanceEvents,
  HrAttendanceSettingKeys,
  ImportPunchesSchema,
  RecomputeAttendanceDaysSchema,
} from './hr-attendance.js';

describe('closed vocabularies', () => {
  it('pins the ten day statuses of §2 — one enum, one value per day', () => {
    expect([...ATTENDANCE_DAY_STATUSES]).toEqual([
      'present',
      'late',
      'earlyLeave',
      'lateAndEarly',
      'absent',
      'onLeave',
      'weekend',
      'holiday',
      'incomplete',
      'dayOff',
    ]);
  });

  it('pins sources, directions and flags', () => {
    expect([...ATTENDANCE_PUNCH_SOURCES]).toEqual(['device', 'manual', 'web']);
    expect([...ATTENDANCE_PUNCH_DIRECTIONS]).toEqual(['in', 'out', 'unknown']);
    expect([...ATTENDANCE_DAY_FLAGS]).toEqual(['crossBranchPunch', 'manualPunch']);
  });

  it('pins the event names and the hr.attendance.* setting keys (D-PR-01)', () => {
    expect(Object.values(HrAttendanceEvents)).toEqual([
      'hr.attendance.punchRecorded',
      'hr.attendance.punchesImported',
      'hr.attendance.dayComputed',
      'hr.attendance.dayAbsent',
      'hr.attendance.periodFrozen',
    ]);
    expect(Object.values(HrAttendanceSettingKeys)).toEqual([
      'hr.attendance.selfPunchEnabled',
      'hr.attendance.autoComputeHour',
    ]);
  });

  it('pins the §15.1 feed contract — twelve fields, by name and in order (D10)', () => {
    expect([...ATTENDANCE_FEED_FIELDS]).toEqual([
      'employeeId',
      'workDate',
      'status',
      'shiftId',
      'workedMinutes',
      'lateMinutes',
      'earlyLeaveMinutes',
      'approvedOvertimeMinutes',
      'leaveId',
      'branchId',
      'flags',
      'frozenAt',
    ]);
  });

  it('the periodFrozen payload names a YYYY-MM period and counts the newly stamped rows', () => {
    expect(
      AttendancePeriodFrozenPayloadV1.safeParse({
        period: '2026-07',
        from: '2026-07-01',
        to: '2026-07-31',
        frozenRows: 310,
      }).success,
    ).toBe(true);
    expect(
      AttendancePeriodFrozenPayloadV1.safeParse({
        period: '2026-07',
        from: '2026-07-01',
        to: '2026-07-31',
        frozenRows: -1,
      }).success,
    ).toBe(false);
  });
});

describe('shift time coherence', () => {
  const shift = {
    code: 'GENERAL',
    name: { ar: 'عامة', en: 'General' },
    startTime: '09:00',
    endTime: '17:00',
  };

  it('accepts a same-day shift and a midnight-crossing one', () => {
    expect(CreateShiftSchema.safeParse(shift).success).toBe(true);
    expect(
      CreateShiftSchema.safeParse({
        ...shift,
        code: 'NIGHT',
        startTime: '22:00',
        endTime: '06:00',
        crossesMidnight: true,
      }).success,
    ).toBe(true);
  });

  it('refuses a same-day shift that ends before it starts, and the inverse night error', () => {
    expect(
      CreateShiftSchema.safeParse({ ...shift, startTime: '17:00', endTime: '09:00' }).success,
    ).toBe(false);
    expect(
      CreateShiftSchema.safeParse({
        ...shift,
        startTime: '09:00',
        endTime: '17:00',
        crossesMidnight: true,
      }).success,
    ).toBe(false);
  });

  it('refuses a lowercase code and a bad time', () => {
    expect(CreateShiftSchema.safeParse({ ...shift, code: 'general' }).success).toBe(false);
    expect(CreateShiftSchema.safeParse({ ...shift, startTime: '25:00' }).success).toBe(false);
  });
});

describe('assignment and recompute boundaries', () => {
  it('an assignment interval may not end before it starts', () => {
    const id = '0123456789abcdef01234567';
    expect(
      CreateShiftAssignmentSchema.safeParse({
        employeeId: id,
        shiftId: id,
        fromDate: '2026-07-15',
        toDate: '2026-07-14',
      }).success,
    ).toBe(false);
  });

  it('recompute is capped at 92 days — repair tool, not batch job', () => {
    const ok = RecomputeAttendanceDaysSchema.safeParse({ from: '2026-06-01', to: '2026-08-30' });
    expect(ok.success).toBe(true);
    const tooWide = RecomputeAttendanceDaysSchema.safeParse({
      from: '2026-01-01',
      to: '2026-06-01',
    });
    expect(tooWide.success).toBe(false);
  });

  it('an import batch is bounded and rows carry the permanent employeeNumber', () => {
    expect(
      ImportPunchesSchema.safeParse({
        rows: [{ employeeNumber: '000125', at: '2026-07-15T09:00:00Z', deviceId: 'dev-1' }],
      }).success,
    ).toBe(true);
    expect(ImportPunchesSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});
