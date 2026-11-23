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

    const secured = (status: 'draft' | 'inVault' | 'dispatched' | 'completed') =>
      ({ shipmentType: 'secured', status }) as const;
    const daily = (status: 'draft' | 'completed') => ({ shipmentType: 'daily', status }) as const;

    it('treats a back-office completed shipment as settled, so a route cannot deadlock', () => {
      for (const leg of ['pickup', 'delivery'] as const) {
        expect(isStopSettled({ leg, executionStatus: 'pending' }, secured('completed'))).toBe(true);
        expect(isStopSettled({ leg, executionStatus: 'active' }, secured('completed'))).toBe(true);
      }
      expect(isStopSettled({ leg: 'pickup', executionStatus: 'pending' }, daily('completed'))).toBe(
        true,
      );
    });

    // Round 13 — «والخزنه تستلم عادي»: the vault may receive a محصنة nobody recorded collecting. A
    // pickup leg the captain never started must not stand in front of his later stops then.
    it('settles an UNSTARTED secured pickup leg once the vault holds the shipment', () => {
      for (const status of ['inVault', 'dispatched'] as const) {
        expect(isStopSettled({ leg: 'pickup', executionStatus: 'pending' }, secured(status))).toBe(
          true,
        );
      }
      // Still in draft — the vault has not got it: he still has to fetch it.
      expect(isStopSettled({ leg: 'pickup', executionStatus: 'pending' }, secured('draft'))).toBe(
        false,
      );
      // The delivery leg is not the vault's to settle — it leaves the vault on it.
      for (const status of ['inVault', 'dispatched'] as const) {
        expect(
          isStopSettled({ leg: 'delivery', executionStatus: 'pending' }, secured(status)),
        ).toBe(false);
      }
      // A daily shipment never goes to the vault.
      expect(isStopSettled({ leg: 'pickup', executionStatus: 'pending' }, daily('draft'))).toBe(
        false,
      );
    });

    // …but a stop he has BEGUN stays his to finish: the usual path is his ✓ at the bank, the
    // vault's ✓, then his «تم التسليم» at the vault's door.
    it('keeps a STARTED secured pickup leg his to finish, wherever the shipment stands', () => {
      for (const executionStatus of ['active', 'pickedUp', 'delivered'] as const) {
        for (const status of ['draft', 'inVault', 'dispatched'] as const) {
          expect(isStopSettled({ leg: 'pickup', executionStatus }, secured(status))).toBe(false);
        }
      }
    });

    it('does not settle an unfinished stop on an unfinished shipment otherwise', () => {
      for (const s of ['pending', 'active', 'pickedUp', 'delivered'] as const) {
        for (const ship of ['draft', 'inVault', 'dispatched'] as const) {
          expect(isStopSettled({ leg: 'delivery', executionStatus: s }, secured(ship))).toBe(false);
        }
        expect(isStopSettled({ leg: 'pickup', executionStatus: s }, secured('draft'))).toBe(false);
        expect(isStopSettled({ leg: 'pickup', executionStatus: s }, daily('draft'))).toBe(false);
      }
    });

    it('settles a finished stop whatever the shipment says', () => {
      for (const s of ['completed', 'cancelled'] as const) {
        for (const leg of ['pickup', 'delivery'] as const) {
          expect(isStopSettled({ leg, executionStatus: s }, secured('draft'))).toBe(true);
        }
      }
    });
  });
});
