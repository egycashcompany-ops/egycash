import { describe, expect, it } from 'vitest';
import {
  ChangeEmployeeStatusSchema,
  EMPLOYEE_STATUS_TRANSITIONS,
  canTransitionEmployeeStatus,
} from './hr-employee.js';

describe('employee status transition matrix', () => {
  it('allows the documented transitions', () => {
    expect(canTransitionEmployeeStatus('active', 'onLeave')).toBe(true);
    expect(canTransitionEmployeeStatus('active', 'suspended')).toBe(true);
    expect(canTransitionEmployeeStatus('active', 'terminated')).toBe(true);
    expect(canTransitionEmployeeStatus('onLeave', 'active')).toBe(true);
    expect(canTransitionEmployeeStatus('onLeave', 'terminated')).toBe(true);
    expect(canTransitionEmployeeStatus('suspended', 'active')).toBe(true);
    expect(canTransitionEmployeeStatus('suspended', 'terminated')).toBe(true);
  });

  it('rejects same-status and illegal transitions', () => {
    expect(canTransitionEmployeeStatus('active', 'active')).toBe(false);
    expect(canTransitionEmployeeStatus('onLeave', 'onLeave')).toBe(false);
    // A suspended employee must be reinstated (→ active) before they can go on leave.
    expect(canTransitionEmployeeStatus('suspended', 'onLeave')).toBe(false);
  });

  it('treats terminated as terminal', () => {
    expect(EMPLOYEE_STATUS_TRANSITIONS.terminated).toHaveLength(0);
    expect(canTransitionEmployeeStatus('terminated', 'active')).toBe(false);
    expect(canTransitionEmployeeStatus('terminated', 'onLeave')).toBe(false);
  });
});

describe('ChangeEmployeeStatusSchema', () => {
  it('requires a reason to suspend or terminate', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'terminated', version: 0 }).success).toBe(false);
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'suspended', version: 0 }).success).toBe(false);
    expect(
      ChangeEmployeeStatusSchema.safeParse({ status: 'terminated', reason: 'redundancy', version: 0 }).success,
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
