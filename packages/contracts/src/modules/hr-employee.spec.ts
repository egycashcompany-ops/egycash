import { describe, expect, it } from 'vitest';
import {
  ChangeEmployeeStatusSchema,
  CreateEmployeeLoginSchema,
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
    expect(employeeBaseStatus({ confirmedAt: '2026-01-01T00:00:00Z', failed: false })).toBe(
      'active',
    );
    expect(employeeBaseStatus({ confirmedAt: null, failed: true })).toBe('active');
    expect(employeeBaseStatus(null)).toBe('active');
  });
});

describe('ChangeEmployeeStatusSchema (deprecated alias)', () => {
  it('requires a reason to suspend', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'suspended', version: 0 }).success).toBe(
      false,
    );
    expect(
      ChangeEmployeeStatusSchema.safeParse({ status: 'suspended', reason: 'inquiry', version: 0 })
        .success,
    ).toBe(true);
  });

  it('does not require a reason for leave or reinstatement', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave', version: 3 }).success).toBe(
      true,
    );
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'active', version: 3 }).success).toBe(
      true,
    );
  });

  it('rejects a missing version and unknown keys', () => {
    expect(ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave' }).success).toBe(false);
    expect(
      ChangeEmployeeStatusSchema.safeParse({ status: 'onLeave', version: 1, foo: 'bar' }).success,
    ).toBe(false);
  });
});

// ── The login an employee is given ───────────────────────────────────────────

describe('CreateEmployeeLoginSchema — what a login actually needs', () => {
  const names = {
    firstName: { ar: 'محمد', en: 'Mohamed' },
    lastName: { ar: 'أحمد علي', en: 'Ahmed Ali' },
  };

  it('accepts a request with NO email', () => {
    // The change this schema exists to record. An account needs a login IDENTIFIER, and on this
    // path the username always supplies one — it defaults to the Employee Code server-side. Most
    // employee records carry no email, and the auto-provisioning path has always created their
    // accounts without one; requiring it here only forced HR to invent an address.
    const parsed = CreateEmployeeLoginSchema.parse({ ...names });
    expect(parsed.email).toBeUndefined();
    expect(parsed.locale).toBe('ar');
  });

  it('still accepts and validates one when given', () => {
    expect(CreateEmployeeLoginSchema.parse({ ...names, email: 'a@b.co' }).email).toBe('a@b.co');
    expect(CreateEmployeeLoginSchema.safeParse({ ...names, email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('an empty string is NOT an email — the box must be omitted, not blanked', () => {
    // The form sends the field only when it holds something; this is what makes that necessary.
    expect(CreateEmployeeLoginSchema.safeParse({ ...names, email: '' }).success).toBe(false);
  });

  it('still requires both name sides, which is why the dialog prefills them', () => {
    expect(CreateEmployeeLoginSchema.safeParse({ ...names, firstName: { ar: 'م', en: '' } }).success).toBe(
      false,
    );
    expect(CreateEmployeeLoginSchema.safeParse({ lastName: names.lastName }).success).toBe(false);
  });
});
