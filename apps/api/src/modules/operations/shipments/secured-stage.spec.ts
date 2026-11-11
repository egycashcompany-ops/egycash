// The محصنة row's stage and legs (Round 8) — «هيبقى الصف باللون الاصفر … هتبقى اخضر».
import { describe, expect, it } from 'vitest';
import { OPERATIONS_EXECUTION_STATUSES } from '@ecms/contracts';
import {
  crewLegOf,
  deliveryLegOf,
  isPickedUp,
  pickedUpByOf,
  securedStageOf,
} from './secured-stage';

describe('the secured stage — derived from the status and the pickup leg', () => {
  it('a draft not yet collected by its captain is awaitingPickup (white)', () => {
    expect(securedStageOf('draft', null)).toBe('awaitingPickup');
    // No pickup leg at all — booked, crewed later.
    expect(securedStageOf('draft', undefined)).toBe('awaitingPickup');
    expect(securedStageOf('draft', 'pending')).toBe('awaitingPickup');
    expect(securedStageOf('draft', 'active')).toBe('awaitingPickup');
    // A cancelled leg did not hand anything to anyone.
    expect(securedStageOf('draft', 'cancelled')).toBe('awaitingPickup');
  });

  it('a draft whose captain pressed ✓ on collecting it is withCaptain (yellow) — and stays so', () => {
    for (const execution of ['pickedUp', 'delivered', 'completed'] as const) {
      expect(securedStageOf('draft', execution)).toBe('withCaptain');
    }
  });

  // Round 10 — «ممكن القائد اللى يعمل صح انه استلم او العمليات».
  it('a draft the desk confirmed and its captain did not pick up is withOperations (yellow)', () => {
    const at = new Date('2026-11-11T08:00:00.000Z');
    expect(securedStageOf('draft', null, at)).toBe('withOperations');
    expect(securedStageOf('draft', 'pending', at)).toBe('withOperations');
    expect(securedStageOf('draft', 'cancelled', at)).toBe('withOperations');
    // No desk ✓ (absent on a row written before Round 10, or taken back): white again.
    expect(securedStageOf('draft', 'active', null)).toBe('awaitingPickup');
    expect(securedStageOf('draft', 'active', undefined)).toBe('awaitingPickup');
  });

  it('the captain wins when both picked it up — his ✓ is the record of the collection itself', () => {
    const at = new Date('2026-11-11T08:00:00.000Z');
    expect(securedStageOf('draft', 'pickedUp', at)).toBe('withCaptain');
    expect(pickedUpByOf('pickedUp', at)).toBe('captain');
    expect(pickedUpByOf('pending', at)).toBe('operations');
    expect(pickedUpByOf('pending', null)).toBeNull();
    expect(pickedUpByOf(undefined, undefined)).toBeNull();
  });

  it('from the vault on, the shipment’s own status is the stage, whatever the pickup leg says', () => {
    for (const execution of [...OPERATIONS_EXECUTION_STATUSES, null]) {
      expect(securedStageOf('inVault', execution)).toBe('inVault');
      expect(securedStageOf('dispatched', execution)).toBe('dispatched');
      expect(securedStageOf('completed', execution)).toBe('completed');
      // …and whatever the desk confirmed: the vault's ✓ moved it on.
      expect(securedStageOf('inVault', execution, new Date())).toBe('inVault');
    }
  });

  it('reads the picked-up states as exactly pickedUp, delivered and completed', () => {
    expect(OPERATIONS_EXECUTION_STATUSES.filter((s) => isPickedUp(s))).toEqual([
      'pickedUp',
      'delivered',
      'completed',
    ]);
    expect(isPickedUp(null)).toBe(false);
  });
});

describe('which leg a board row is about', () => {
  it('a daily row prints its pickup leg, in every status', () => {
    expect(crewLegOf('daily', 'draft')).toBe('pickup');
    expect(crewLegOf('daily', 'completed')).toBe('pickup');
    expect(deliveryLegOf('daily')).toBe('pickup');
  });

  it('a secured row prints the pickup leg until it is in the vault, then the delivery leg', () => {
    expect(crewLegOf('secured', 'draft')).toBe('pickup');
    expect(crewLegOf('secured', 'inVault')).toBe('delivery');
    expect(crewLegOf('secured', 'dispatched')).toBe('delivery');
    expect(crewLegOf('secured', 'completed')).toBe('delivery');
    // …but its captain «تم التسليم» is always the delivery leg's — to the branch, not the vault.
    expect(deliveryLegOf('secured')).toBe('delivery');
  });
});
