import { describe, expect, it } from 'vitest';
import { EMPLOYEE_SEQUENCE_KEY, formatEmployeeCode } from './employee-number';

describe('formatEmployeeCode', () => {
  it('prefixes the branch code and pads the global sequence to at least 3 digits', () => {
    expect(formatEmployeeCode('001', 1)).toBe('001001');
    expect(formatEmployeeCode('001', 2)).toBe('001002');
    expect(formatEmployeeCode('002', 3)).toBe('002003');
    expect(formatEmployeeCode('001', 25)).toBe('001025');
  });

  it('is a GLOBAL running number — the suffix follows the global sequence, not per-branch', () => {
    // Branches 001, 001, 002, 003, 001 hired in order → global sequence 1..5.
    expect(formatEmployeeCode('001', 1)).toBe('001001');
    expect(formatEmployeeCode('001', 2)).toBe('001002');
    expect(formatEmployeeCode('002', 3)).toBe('002003');
    expect(formatEmployeeCode('003', 4)).toBe('003004');
    expect(formatEmployeeCode('001', 5)).toBe('001005');
  });

  it('does not truncate sequences longer than the minimum width', () => {
    expect(formatEmployeeCode('001', 1234)).toBe('0011234');
    expect(formatEmployeeCode('010', 98765)).toBe('01098765');
  });

  it('exposes a single global sequence key (distinct from the applicant/offer counters)', () => {
    expect(EMPLOYEE_SEQUENCE_KEY).toBe('employee:global');
  });
});
