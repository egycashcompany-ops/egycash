import { describe, expect, it } from 'vitest';
import {
  ChangeEmployeeStatusSchema,
  EMPLOYEE_STATUS_TRANSITIONS,
  canTransitionEmployeeStatus,
  employeeBaseStatus,
} from './hr-employee.js';

describe('employee status transition matrix', () => {
  it('allows the documented transitions', () => {
    expect(canTransitionEmployeeStatus('probation', 'active')).toBe(true);
    expect(canTransitionEmployeeStatus('probation', 'suspended')).toBe(true);
    expect(canTransitionEmployeeStatus('probation', 'exited')).toBe(true);
    expect(canTransitionEmployeeStatus('active', 'onLeave')).toBe(true);
    expect(canTransitionEmployeeStatus('active', 'suspended')).toBe(true);
    expect(canTransitionEmployeeStatus('active', 'exited')).toBe(true);
    expect(canTransitionEmployeeStatus('onLeave', 'active')).toBe(true);
    expect(canTransitionEmployeeStatus('onLeave', 'probation')).toBe(true);
    expect(canTransitionEmployeeStatus('onLeave', 'exited')).toBe(true);
    expect(canTransitionEmployeeStatus('suspended', 'active')).toBe(true);
    expect(canTransitionEmployeeStatus('suspended', 'probation')).toBe(true);
    expect(canTransitionEmployeeStatus('suspended', 'exited')).toBe(true);
  });

  it('rejects same-status and illegal transitions', () => {
    expect(canTransitionEmployeeStatus('active', 'active')).toBe(false);
    expect(canTransitionEmployeeStatus('onLeave', 'onLeave')).toBe(false);
    // A suspended employee must be reinstated before they can go on leave.
    expect(canTransitionEmployeeStatus('suspended', 'onLeave')).toBe(false);
    // Probation is entered at hire/rehire only — never from active.
    expect(canTransitionEmployeeStatus('active', 'probation')).toBe(false);
  });

  it('treats exited as terminal except for rehire', () => {
    expect(EMPLOYEE_STATUS_TRANSITIONS.exited).toEqual(['probation']);
    expect(canTransitionEmployeeStatus('exited', 'probation')).toBe(true);
    expect(canTransitionEmployeeStatus('exited', 'active')).toBe(false);
    expect(canTransitionEmployeeStatus('exited', 'onLeave')).toBe(false);
  });
});

describe('employeeBaseStatus (return from suspension/leave — frozen design F4)', () => {
  it('returns probation while probation is unconfirmed and not failed', () => {
    expect(employeeBaseStatus({ confirmedAt: null, failed: false })).toBe('probation');
  });

  it('returns active once probation was confirmed, failed, or never existed', () => {
    expect(employeeBaseStatus({ confirmedAt: '2026-01-01T00:00:00Z', failed: false })).toBe('active');
    expect(employeeBaseStatus({ confirmedAt: null, failed: true })).toBe('active');
    expect(employeeBaseStatus(null)).toBe('active');
  });
});

describe('ChangeEmployeeStatusSchema (deprecated alias)', () => {
  it('requires a reason to suspend', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'suspended', version: 0 }).success).toBe(false);
    expect(
      ChangeEmployeeStatusSchema.safeParse({ status: 'suspended', reason: 'inquiry', version: 0 }).success,
    ).toBe(true);
  });

  it('does not require a reason for leave or reinstatement', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave', version: 3 }).success).toBe(true);
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'active', version: 3 }).success).toBe(true);
  });

  it('rejects a missing version and unknown keys', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave' }).success).toBe(false);
    expect(
      ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave', version: 1, foo: 'bar' }).success,
    ).toBe(false);
  });
});
