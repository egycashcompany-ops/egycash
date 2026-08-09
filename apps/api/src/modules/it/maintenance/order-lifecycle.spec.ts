// The order state machine, tested as the pure table it is — no database, no request, no clock.
//
// The same argument as the ticket table: an edit that quietly opens a path — un-completing an
// order, cancelling one that already finished — fails here rather than in an asset's maintenance
// history six months later.
import { describe, expect, it } from 'vitest';
import { IT_MAINTENANCE_ORDER_STATUSES } from '@ecms/contracts';
import {
  ACTIVE_ORDER_STATUSES,
  MAINTENANCE_ORDER_TRANSITIONS,
  canTransitionOrder,
  isActiveOrderStatus,
} from './order-lifecycle';

describe('the maintenance-order state machine', () => {
  it('covers every status the contract declares — no status without a rule', () => {
    expect(Object.keys(MAINTENANCE_ORDER_TRANSITIONS).sort()).toEqual(
      [...IT_MAINTENANCE_ORDER_STATUSES].sort(),
    );
  });

  it('names only real statuses as targets', () => {
    for (const targets of Object.values(MAINTENANCE_ORDER_TRANSITIONS)) {
      for (const target of targets) {
        expect(IT_MAINTENANCE_ORDER_STATUSES).toContain(target);
      }
    }
  });

  it('never lets a status transition to itself', () => {
    for (const status of IT_MAINTENANCE_ORDER_STATUSES) {
      expect(canTransitionOrder(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it('walks the happy path: open → inProgress → completed', () => {
    expect(canTransitionOrder('open', 'inProgress')).toBe(true);
    expect(canTransitionOrder('inProgress', 'completed')).toBe(true);
  });

  it('cancels from either live status', () => {
    expect(canTransitionOrder('open', 'cancelled')).toBe(true);
    expect(canTransitionOrder('inProgress', 'cancelled')).toBe(true);
  });

  // An order that never started consumed nothing and repaired nothing. Completing it would put a
  // repair in the asset's history that did not happen.
  it('refuses to complete an order that was never started', () => {
    expect(canTransitionOrder('open', 'completed')).toBe(false);
  });

  // Both terminal: re-opening a completed order would make the asset's history say something that
  // did not happen, and the honest path is a new order.
  it('makes completed and cancelled terminal', () => {
    expect(MAINTENANCE_ORDER_TRANSITIONS.completed).toEqual([]);
    expect(MAINTENANCE_ORDER_TRANSITIONS.cancelled).toEqual([]);
    for (const status of IT_MAINTENANCE_ORDER_STATUSES) {
      expect(canTransitionOrder('completed', status), `completed → ${status}`).toBe(false);
      expect(canTransitionOrder('cancelled', status), `cancelled → ${status}`).toBe(false);
    }
  });

  // This set is what the custody guards read (§2.7): getting it wrong either freezes assets that
  // are free, or lets an asset walk out of a workshop.
  it('counts exactly the live statuses as active', () => {
    expect([...ACTIVE_ORDER_STATUSES].sort()).toEqual(['inProgress', 'open']);
    expect(isActiveOrderStatus('open')).toBe(true);
    expect(isActiveOrderStatus('inProgress')).toBe(true);
    expect(isActiveOrderStatus('completed')).toBe(false);
    expect(isActiveOrderStatus('cancelled')).toBe(false);
  });

  it('agrees with the table: a status is active exactly when it can still move', () => {
    for (const status of IT_MAINTENANCE_ORDER_STATUSES) {
      expect(isActiveOrderStatus(status), status).toBe(
        MAINTENANCE_ORDER_TRANSITIONS[status].length > 0,
      );
    }
  });
});
