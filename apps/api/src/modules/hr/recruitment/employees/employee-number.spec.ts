import { describe, expect, it } from 'vitest';
import { employeeSequenceKey, formatEmployeeNumber, parseEmployeeNumber } from './employee-number';

describe('formatEmployeeNumber', () => {
  it('pads the sequence to six digits (EMP-{YYYY}-{seq:6})', () => {
    expect(formatEmployeeNumber(2026, 1)).toBe('EMP-2026-000001');
    expect(formatEmployeeNumber(2026, 42)).toBe('EMP-2026-000042');
    expect(formatEmployeeNumber(2026, 123456)).toBe('EMP-2026-123456');
  });

  it('does not truncate a sequence beyond six digits', () => {
    expect(formatEmployeeNumber(2026, 1234567)).toBe('EMP-2026-1234567');
  });
});

describe('employeeSequenceKey', () => {
  it('is namespaced per year and distinct from the applicant/offer counters', () => {
    expect(employeeSequenceKey(2026)).toBe('employee:2026');
    expect(employeeSequenceKey(2027)).toBe('employee:2027');
  });
});

describe('parseEmployeeNumber', () => {
  it('round-trips a formatted number', () => {
    expect(parseEmployeeNumber('EMP-2026-000042')).toEqual({ year: 2026, seq: 42 });
  });

  it('rejects malformed / foreign codes', () => {
    expect(parseEmployeeNumber('JO-2026-000042')).toBeNull();
    expect(parseEmployeeNumber('EMP-2026-42')).toBeNull();
    expect(parseEmployeeNumber('nonsense')).toBeNull();
  });
});
