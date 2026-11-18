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
  HrAttendanceTemplates,
  ImportPunchesSchema,
  RecomputeAttendanceDaysSchema,
} from './hr-attendance.js';

describe('closed vocabularies', () => {
  it('pins the thirteen day statuses of §2 — one enum, one value per day', () => {
    // `checkedIn` is a deliberate contract change (owner ruling, 2026-11-17). The branch devices
    // show 70–90% of employees scan on arrival and never scan out, so a check-in with no
    // check-out is the ordinary working day here; it used to derive as `incomplete`, which is
    // toned as a fault and priced at nothing. It counts as an attended day.
    //
    // `incomplete` STAYS in the vocabulary although nothing derives it any more: rows written
    // before that ruling carry it, and a value that exists in the database must stay nameable by
    // the enum that reads it. Payroll deliberately leaves it out of the attended statuses so no
    // frozen month is restated — see `attendance-quantities.ts`.
    //
    // `noSchedule` is the thirteenth: nobody has said when this person works. It was reported as
    // `dayOff` until production showed a whole branch marked «يوم راحة» on a Tuesday — a claim
    // that the company owed them no work, which nobody had made. `dayOff` stays in the enum for
    // the rows already carrying it, and nothing derives it any more.
    //
    // `pending` is the twelfth (stage 2): the day that is still being lived. It is written only
    // for a date in progress and is payroll-neutral by construction, and once the date is past the
    // read paths resolve it to `absent` — so it is a status that can be stored but can never be a
    // date's final answer.
    expect([...ATTENDANCE_DAY_STATUSES]).toEqual([
      'present',
      'checkedIn',
      'late',
      'earlyLeave',
      'lateAndEarly',
      'pending',
      'absent',
      'onLeave',
      'weekend',
      'holiday',
      'incomplete',
      'dayOff',
      'noSchedule',
    ]);
  });

  it('pins sources, directions and flags', () => {
    // AT-D2 (D12.3/D12.4) added `regularization` and `regularizedPunch`. Both are deliberate
    // contract changes, made by the rule the flag vocabulary's own comment states: an approved
    // two-step correction and an HR hand-entry used to write the same source and raise the same
    // day flag, so a reviewer could not tell a decision from a keystroke.
    expect([...ATTENDANCE_PUNCH_SOURCES]).toEqual(['device', 'manual', 'regularization', 'web']);
    expect([...ATTENDANCE_PUNCH_DIRECTIONS]).toEqual(['in', 'out', 'unknown']);
    // Stage 3 added `overriddenByManager`: a day whose status a manager DECIDED rather than the
    // engine derived. It is a flag and not a status because the status is still a real answer
    // about the day — the flag says where that answer came from, and that the device's punches
    // are still standing underneath it.
    expect([...ATTENDANCE_DAY_FLAGS]).toEqual([
      'crossBranchPunch',
      'manualPunch',
      'regularizedPunch',
      'overriddenByManager',
    ]);
  });

  it('pins the event names and the hr.attendance.* setting keys (D-PR-01)', () => {
    expect(Object.values(HrAttendanceEvents)).toEqual([
      'hr.attendance.punchRecorded',
      'hr.attendance.punchesImported',
      'hr.attendance.dayComputed',
      'hr.attendance.dayAbsent',
      'hr.attendance.periodFrozen',
      'hr.attendance.regularizationRequested',
      'hr.attendance.regularizationDecided',
      'hr.attendance.overtimeApproved',
    ]);
    expect(Object.values(HrAttendanceSettingKeys)).toEqual([
      'hr.attendance.selfPunchEnabled',
      'hr.attendance.autoComputeHour',
      'hr.attendance.overtimeRequiresApproval',
      'hr.attendance.absenceNotify',
      // The default working pattern (stage 1b) — six scalars rather than one object, because the
      // settings screen can only edit boolean, number and string, and HR owns these hours. All
      // six take a per-branch override; `enabled` ships false so the pattern is inert.
      'hr.attendance.defaultPattern.enabled',
      'hr.attendance.defaultPattern.startTime',
      'hr.attendance.defaultPattern.endTime',
      'hr.attendance.defaultPattern.breakMinutes',
      'hr.attendance.defaultPattern.graceInMinutes',
      'hr.attendance.defaultPattern.graceOutMinutes',
      // Stage 3: how far back a manager decides alone before HR has to approve.
      'hr.attendance.decisionApprovalAfterDays',
      // Stage 4: the volume above which the review screen flags a manager for a LOOK. It blocks
      // nothing — a broken reader produces many legitimate changes — so it is a prompt, not a cap.
      'hr.attendance.decisionWeeklyReviewThreshold',
      // Task 2: how old a scan may be and still be imported, 0 meaning no limit. It replaces the
      // 90-day constant that was keeping two years of the branch machines' history out of ECMS.
      'hr.attendance.importMaxAgeDays',
    ]);
    // §9 names five notification templates; these are the module's own five.
    expect(Object.values(HrAttendanceTemplates)).toEqual([
      'hr.attendance.regularizationSubmitted',
      'hr.attendance.regularizationDecided',
      'hr.attendance.overtimeApproved',
      'hr.attendance.absenceRecorded',
      'hr.attendance.missingCheckout',
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
