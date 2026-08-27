// The two rules, and the two mistakes they exist to prevent.
import { describe, expect, it } from 'vitest';
import { clearedAllChecks, phasesFor, type PhaseFacts } from './offer-readiness';

const SECURITY: PhaseFacts = { id: 'p1', applicability: 'all', active: true };
const MEDICAL: PhaseFacts = { id: 'p2', applicability: 'all', active: true };
const DRIVING: PhaseFacts = { id: 'p3', applicability: 'driversOnly', active: true };
const RETIRED: PhaseFacts = { id: 'p4', applicability: 'all', active: false };

describe('which checks apply', () => {
  it('asks a driver for the driving test too', () => {
    expect(phasesFor([SECURITY, MEDICAL, DRIVING], true).map((p) => p.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('does not ask anybody else for it', () => {
    expect(phasesFor([SECURITY, MEDICAL, DRIVING], false).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('ignores a retired phase without forgetting it existed', () => {
    expect(phasesFor([SECURITY, RETIRED], false).map((p) => p.id)).toEqual(['p1']);
  });
});

describe('whether the checks are finished', () => {
  const forDriver = phasesFor([SECURITY, MEDICAL, DRIVING], true);

  it('is finished when every applicable phase is approved', () => {
    expect(clearedAllChecks(forDriver, new Set(['p1', 'p2', 'p3']))).toBe(true);
  });

  it('is NOT finished on the medical alone — a driver still owes the security check', () => {
    // The mistake this rule exists to prevent: «he passed the medical» is one answer of several.
    expect(clearedAllChecks(forDriver, new Set(['p2']))).toBe(false);
  });

  it('is not finished when the driving test is outstanding', () => {
    expect(clearedAllChecks(forDriver, new Set(['p1', 'p2']))).toBe(false);
  });

  it('does not call an EMPTY requirement finished', () => {
    // Otherwise an empty phase catalogue would put every candidate in front of a recruiter.
    expect(clearedAllChecks([], new Set())).toBe(false);
  });
});
