import { describe, expect, it } from 'vitest';
import { initialStatusFor, statusAfterChainDecision } from './leave-request.routing';

// Leave's answer to each answer of the engine (leave design §16.2, PXQ-1): a chain nobody staffs
// takes the manager and HR path at submission, and a decision that leaves nobody on the rungs that
// remain hands the request to HR's step.
describe('initialStatusFor (leave design §16.2 item 1)', () => {
  it('puts a request on the chain when a rung of it is staffed, with or without a manager', () => {
    expect(initialStatusFor('pending', true)).toBe('pendingApproval');
    expect(initialStatusFor('pending', false)).toBe('pendingApproval');
  });

  it('sends a chain nobody staffs down the manager and HR path, as no chain does', () => {
    expect(initialStatusFor('unstaffed', true)).toBe('pendingManager');
    expect(initialStatusFor('unstaffed', false)).toBe('pendingHr');
    expect(initialStatusFor('noChain', true)).toBe('pendingManager');
    expect(initialStatusFor('noChain', false)).toBe('pendingHr');
  });

  it('sends approved and rejected, which cannot come back before any decision, down that path too', () => {
    for (const status of ['approved', 'rejected'] as const) {
      expect(initialStatusFor(status, true)).toBe('pendingManager');
      expect(initialStatusFor(status, false)).toBe('pendingHr');
    }
  });
});

describe('statusAfterChainDecision (leave design §16.2 item 2)', () => {
  it('keeps approved, rejected and pending as the engine answers them', () => {
    expect(statusAfterChainDecision('approved')).toBe('approved');
    expect(statusAfterChainDecision('rejected')).toBe('rejected');
    expect(statusAfterChainDecision('pending')).toBe('pendingApproval');
  });

  it('hands a request with nobody left on its remaining rungs to HR’s step', () => {
    expect(statusAfterChainDecision('unstaffed')).toBe('pendingHr');
    expect(statusAfterChainDecision('noChain')).toBe('pendingHr');
  });
});
