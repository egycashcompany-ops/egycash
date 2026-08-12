// The two-step decision table (§7, D7 as ruled), proven without a database: no step is
// skippable, the subject decides nothing, the manager step accepts relationship or the HR key
// (the Leave R9 deadlock escape), and the HR step accepts the key alone.
import { describe, expect, it } from 'vitest';
import { decisionProblem, nextStatus, stepOf } from './regularization-rules';

describe('nextStatus — approval never jumps a step', () => {
  it('manager approval lands on pendingHr, never approved', () => {
    expect(nextStatus('pendingManager', 'approve')).toBe('pendingHr');
  });
  it('hr approval is the only path to approved', () => {
    expect(nextStatus('pendingHr', 'approve')).toBe('approved');
  });
  it('rejection is final at either step', () => {
    expect(nextStatus('pendingManager', 'reject')).toBe('rejected');
    expect(nextStatus('pendingHr', 'reject')).toBe('rejected');
  });
});

describe('decisionProblem', () => {
  const base = { isSubject: false, isManager: false, canDecide: false };

  it('a decided request refuses another decision', () => {
    for (const status of ['approved', 'rejected', 'cancelled', 'draft'] as const) {
      expect(decisionProblem({ ...base, status, isManager: true, canDecide: true })).toContain(
        'already been decided',
      );
    }
  });

  it('the subject decides nothing, whatever they hold (C7)', () => {
    expect(
      decisionProblem({ status: 'pendingManager', isSubject: true, isManager: true, canDecide: true }),
    ).toContain('your own');
    expect(
      decisionProblem({ status: 'pendingHr', isSubject: true, isManager: false, canDecide: true }),
    ).toContain('your own');
  });

  it('manager step: relationship or the HR key; nobody else', () => {
    expect(decisionProblem({ ...base, status: 'pendingManager', isManager: true })).toBeNull();
    expect(decisionProblem({ ...base, status: 'pendingManager', canDecide: true })).toBeNull();
    expect(decisionProblem({ ...base, status: 'pendingManager' })).toContain('current manager');
  });

  it('hr step: the key alone — the manager relationship does not reach it', () => {
    expect(decisionProblem({ ...base, status: 'pendingHr', canDecide: true })).toBeNull();
    expect(decisionProblem({ ...base, status: 'pendingHr', isManager: true })).toContain(
      'attendance.decideRegularization',
    );
  });

  it('stepOf names the pending step and nothing else', () => {
    expect(stepOf('pendingManager')).toBe('manager');
    expect(stepOf('pendingHr')).toBe('hr');
    expect(stepOf('approved')).toBeNull();
  });
});
