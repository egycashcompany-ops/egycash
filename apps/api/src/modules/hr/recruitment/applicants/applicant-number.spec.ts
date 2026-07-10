import { describe, expect, it } from 'vitest';
import {
  applicantSequenceKey,
  formatApplicantNumber,
  parseApplicantNumber,
} from './applicant-number';

describe('formatApplicantNumber', () => {
  it('pads the sequence to six digits (BD-002 format)', () => {
    expect(formatApplicantNumber(2026, 1)).toBe('APP-2026-000001');
    expect(formatApplicantNumber(2026, 42)).toBe('APP-2026-000042');
    expect(formatApplicantNumber(2026, 123456)).toBe('APP-2026-123456');
  });

  it('does not truncate a sequence beyond six digits', () => {
    expect(formatApplicantNumber(2026, 1234567)).toBe('APP-2026-1234567');
  });
});

describe('applicantSequenceKey', () => {
  it('is per-year so numbering resets each year', () => {
    expect(applicantSequenceKey(2026)).toBe('applicant:2026');
    expect(applicantSequenceKey(2027)).not.toBe(applicantSequenceKey(2026));
  });
});

describe('parseApplicantNumber', () => {
  it('round-trips a formatted number', () => {
    expect(parseApplicantNumber('APP-2026-000042')).toEqual({ year: 2026, seq: 42 });
  });

  it('returns null for malformed input', () => {
    expect(parseApplicantNumber('APP-2026-12')).toBeNull();
    expect(parseApplicantNumber('EMP-2026-000001')).toBeNull();
    expect(parseApplicantNumber('nonsense')).toBeNull();
  });
});
