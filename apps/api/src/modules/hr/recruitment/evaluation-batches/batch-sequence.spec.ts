// Pure numbering rules (RW8) — no database involved.
import { describe, expect, it } from 'vitest';
import { batchPrefixFor, batchSequenceKey, formatBatchNumber } from './batch-sequence';

describe('evaluation batch numbering', () => {
  it('gives the two business phases their own prefixes', () => {
    expect(batchPrefixFor('securityCheck')).toBe('SEC');
    expect(batchPrefixFor('drivingTest')).toBe('DRV');
  });

  it('derives a readable prefix for an admin-created batch phase', () => {
    expect(batchPrefixFor('warehouseAptitude')).toBe('WAR');
    // Non-letters never leak into a code.
    expect(batchPrefixFor('lab-2')).toBe('LAB');
  });

  it('keeps the counter per prefix AND per year', () => {
    expect(batchSequenceKey('SEC', 2026)).toBe('evaluationBatch:SEC:2026');
    expect(batchSequenceKey('DRV', 2026)).not.toBe(batchSequenceKey('SEC', 2026));
    expect(batchSequenceKey('SEC', 2027)).not.toBe(batchSequenceKey('SEC', 2026));
  });

  it('pads the sequence to six digits', () => {
    expect(formatBatchNumber('SEC', 2026, 1)).toBe('SEC-2026-000001');
    expect(formatBatchNumber('DRV', 2026, 123456)).toBe('DRV-2026-123456');
  });
});
