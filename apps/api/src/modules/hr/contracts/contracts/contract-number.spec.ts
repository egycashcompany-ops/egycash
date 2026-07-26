// A1 — pure pattern rendering for the configurable contract numbering.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTRACT_NUMBER_FORMAT, formatContractNumber } from './contract-number';

describe('formatContractNumber', () => {
  it('renders the default pattern as ECMS-CON-<year>-<seq:6>', () => {
    expect(formatContractNumber(DEFAULT_CONTRACT_NUMBER_FORMAT, 2026, 1)).toBe('ECMS-CON-2026-000001');
  });

  it('honours a custom pad width', () => {
    expect(formatContractNumber('C-{year}/{seq:4}', 2027, 42)).toBe('C-2027/0042');
  });

  it('defaults {seq} without a pad to 6 digits', () => {
    expect(formatContractNumber('{seq}', 2026, 7)).toBe('000007');
  });

  it('never truncates a sequence longer than the pad', () => {
    expect(formatContractNumber('{seq:2}', 2026, 12345)).toBe('12345');
  });

  it('substitutes repeated tokens', () => {
    expect(formatContractNumber('{year}-{seq:3}-{year}', 2026, 9)).toBe('2026-009-2026');
  });
});
