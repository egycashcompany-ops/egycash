import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_SEQUENCE_KEY,
  buildEmployeeCode,
  formatEmployeeNumber,
} from './employee-number';

describe('formatEmployeeNumber (permanent Global Employee Number)', () => {
  it('zero-pads the global sequence to at least 6 digits', () => {
    expect(formatEmployeeNumber(1)).toBe('000001');
    expect(formatEmployeeNumber(125)).toBe('000125');
  });

  it('does not truncate sequences longer than the minimum width', () => {
    expect(formatEmployeeNumber(1234567)).toBe('1234567');
  });

  it('exposes a single global sequence key (distinct from the applicant/offer counters)', () => {
    expect(EMPLOYEE_SEQUENCE_KEY).toBe('employee:global');
  });
});

describe('buildEmployeeCode (derived <CurrentBranchCode><GlobalEmployeeNumber>)', () => {
  it('prefixes the current branch code onto the Global Employee Number', () => {
    expect(buildEmployeeCode('001', '000125')).toBe('001000125');
  });

  it('on transfer only the branch prefix changes — the Global Employee Number is fixed', () => {
    const number = '000125';
    expect(buildEmployeeCode('001', number)).toBe('001000125'); // before transfer
    expect(buildEmployeeCode('004', number)).toBe('004000125'); // after transfer to branch 004
  });
});
