// The one answer, and the disagreement it retires.
import { describe, expect, it } from 'vitest';
import { applicabilityOf, isDriversOnlyPhase } from './phase-applicability';

describe('a phase’s applicability is read from the typed field first', () => {
  it('answers from `applicability` when it is present', () => {
    expect(applicabilityOf({ applicability: 'driversOnly', driversOnly: true })).toBe('driversOnly');
    expect(applicabilityOf({ applicability: 'all', driversOnly: false })).toBe('all');
  });

  /**
   * A document written before the typed field existed. The migration backfills it from exactly
   * this expression, so reading it here gives the same answer the migration would have written —
   * which is what makes the fallback a fallback and not a second rule.
   */
  it('falls back to the legacy flag on a document that predates the field', () => {
    expect(applicabilityOf({ driversOnly: true })).toBe('driversOnly');
    expect(applicabilityOf({ driversOnly: false })).toBe('all');
    expect(applicabilityOf({})).toBe('all');
  });

  /**
   * THE CASE THE THREE READERS DISAGREED ON. The typed field says drivers-only; the legacy flag,
   * for whatever reason, still says otherwise. The materializer would skip the phase for a
   * non-driver and the gate would demand an approval that could never arrive — so that candidate
   * would never clear their checks and never reach the offers queue.
   */
  it('lets the typed field win when the legacy flag contradicts it', () => {
    expect(isDriversOnlyPhase({ applicability: 'driversOnly', driversOnly: false })).toBe(true);
    expect(isDriversOnlyPhase({ applicability: 'all', driversOnly: true })).toBe(false);
  });

  it('answers the boolean question consistently with the vocabulary one', () => {
    for (const phase of [
      { applicability: 'driversOnly' as const },
      { applicability: 'all' as const },
      { driversOnly: true },
      { driversOnly: false },
      {},
    ]) {
      expect(isDriversOnlyPhase(phase)).toBe(applicabilityOf(phase) === 'driversOnly');
    }
  });
});
