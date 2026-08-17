// The state machine as a pure decision — no database, no HTTP. If these fail, the sequential
// workflow is wrong no matter what the integration tests say.
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_EXECUTION_ACTIONS,
  canExecute,
  executionTransition,
  isExecutionDone,
  isStopSettled,
} from './execution-state';
import {
  OPERATIONS_EXECUTION_STATUSES,
  type OperationsExecutionStatus,
} from '@ecms/contracts';

const ALL = OPERATIONS_EXECUTION_STATUSES;

describe('captain execution state machine (OP-7)', () => {
  it('walks the happy path exactly once, in order', () => {
    let state: OperationsExecutionStatus = 'pending';
    const walked: OperationsExecutionStatus[] = [state];
    for (const action of OPERATIONS_EXECUTION_ACTIONS) {
      expect(canExecute(action, state)).toBe(true);
      state = executionTransition(action).to;
      walked.push(state);
    }
    expect(walked).toEqual(['pending', 'active', 'pickedUp', 'delivered', 'completed']);
  });

  it('gives every action exactly one legal predecessor', () => {
    for (const action of OPERATIONS_EXECUTION_ACTIONS) {
      const legal = ALL.filter((from) => canExecute(action, from));
      expect(legal).toHaveLength(1);
      expect(legal[0]).toBe(executionTransition(action).from);
    }
  });

  it('cannot complete a stop that was never started', () => {
    expect(canExecute('complete', 'pending')).toBe(false);
    expect(canExecute('complete', 'active')).toBe(false);
    expect(canExecute('complete', 'pickedUp')).toBe(false);
  });

  it('cannot complete the same stop twice — `completed` is nobody\'s predecessor', () => {
    for (const action of OPERATIONS_EXECUTION_ACTIONS) {
      expect(canExecute(action, 'completed')).toBe(false);
    }
  });

  it('never moves backward — no action targets an earlier state', () => {
    const rank: Record<string, number> = {
      pending: 0,
      active: 1,
      pickedUp: 2,
      delivered: 3,
      completed: 4,
    };
    for (const action of OPERATIONS_EXECUTION_ACTIONS) {
      const { from, to } = executionTransition(action);
      expect(rank[to]).toBeGreaterThan(rank[from] ?? -1);
    }
  });

  it('cannot skip a step inside a stop', () => {
    expect(canExecute('confirmPickup', 'pending')).toBe(false);
    expect(canExecute('confirmDelivery', 'active')).toBe(false);
  });

  it('leaves `cancelled` unreachable — no action produces or consumes it', () => {
    for (const action of OPERATIONS_EXECUTION_ACTIONS) {
      const { from, to } = executionTransition(action);
      expect(from).not.toBe('cancelled');
      expect(to).not.toBe('cancelled');
    }
  });

  it('stamps a distinct timestamp field per step', () => {
    const stamps = OPERATIONS_EXECUTION_ACTIONS.map((a) => executionTransition(a).stamps);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  describe('settled — the predicate the lock and the read share', () => {
    it('treats terminal execution as settled', () => {
      expect(isExecutionDone('completed')).toBe(true);
      expect(isExecutionDone('cancelled')).toBe(true);
      for (const s of ['pending', 'active', 'pickedUp', 'delivered'] as const) {
        expect(isExecutionDone(s)).toBe(false);
      }
    });

    it('treats a back-office completed shipment as settled, so a route cannot deadlock', () => {
      expect(isStopSettled('pending', 'completed')).toBe(true);
      expect(isStopSettled('active', 'completed')).toBe(true);
    });

    it('does not settle an unfinished stop on an unfinished shipment', () => {
      for (const s of ['pending', 'active', 'pickedUp', 'delivered'] as const) {
        for (const ship of ['draft', 'inVault', 'dispatched'] as const) {
          expect(isStopSettled(s, ship)).toBe(false);
        }
      }
    });
  });
});
