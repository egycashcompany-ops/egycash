import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_NUMBER_MIN_DIGITS,
  EMPLOYEE_SEQUENCE_KEY,
  buildEmployeeCode,
  formatEmployeeNumber,
} from './employee-number';

describe('formatEmployeeNumber (permanent Global Employee Number)', () => {
  it('zero-pads the global sequence to at least 4 digits', () => {
    expect(formatEmployeeNumber(1)).toBe('0001');
    expect(formatEmployeeNumber(125)).toBe('0125');
    expect(formatEmployeeNumber(2718)).toBe('2718');
  });

  it('does not truncate sequences longer than the minimum width', () => {
    expect(formatEmployeeNumber(12345)).toBe('12345');
    expect(formatEmployeeNumber(1234567)).toBe('1234567');
  });

  it('is four digits wide — the width the company already numbers by', () => {
    expect(EMPLOYEE_NUMBER_MIN_DIGITS).toBe(4);
  });

  it('exposes a single global sequence key (distinct from the applicant/offer counters)', () => {
    expect(EMPLOYEE_SEQUENCE_KEY).toBe('employee:global');
  });
});

describe('buildEmployeeCode (<BranchCodeAtHire><GlobalEmployeeNumber>, composed once)', () => {
  it('reproduces the codes the company already issued on paper', () => {
    // The four values below are real shapes from the go-live workforce: branch 010 is Mohandseen,
    // 040 October, 070 Shorouk. If this test ever fails, every legacy employee code is wrong.
    expect(buildEmployeeCode('010', '0000')).toBe('0100000');
    expect(buildEmployeeCode('010', '0004')).toBe('0100004');
    expect(buildEmployeeCode('040', '1250')).toBe('0401250');
    expect(buildEmployeeCode('070', '2717')).toBe('0702717');
  });

  it('carries a number past the minimum width without reformatting it', () => {
    expect(buildEmployeeCode('010', '12345')).toBe('01012345');
  });
});
