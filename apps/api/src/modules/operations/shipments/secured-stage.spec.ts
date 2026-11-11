// The محصنة row's stage and legs (Round 8) — «هيبقى الصف باللون الاصفر … هتبقى اخضر» — and, since
// Round 10, the shipment's one pickup record («ممكن القائد اللى يعمل صح انه استلم او العمليات»).
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { OPERATIONS_EXECUTION_STATUSES, OPERATIONS_SHIPMENT_STATUSES } from '@ecms/contracts';
import {
  crewLegOf,
  deliveryLegOf,
  isPickedUp,
  securedPickupOf,
  securedStageOf,
  type SecuredPickup,
} from './secured-stage';
import { type OperationsShipmentPickup } from './shipment.model';

const AT = new Date('2026-11-11T08:00:00.000Z');
const LEG_AT = new Date('2026-11-11T07:30:00.000Z');
const record = (by: OperationsShipmentPickup['by']): OperationsShipmentPickup => ({
  by,
  at: AT,
  userId: new Types.ObjectId(),
});
const leg = (executionStatus: (typeof OPERATIONS_EXECUTION_STATUSES)[number] | null) => ({
  executionStatus,
  pickedUpAt: isPickedUp(executionStatus) ? LEG_AT : null,
});

describe('the pickup a secured shipment has — the shipment’s own record', () => {
  it('reads the record as it is, whoever wrote it', () => {
    expect(securedPickupOf(record('captain'), leg('pickedUp'))).toEqual({ by: 'captain', at: AT });
    expect(securedPickupOf(record('operations'), leg(null))).toEqual({ by: 'operations', at: AT });
    // The desk's ✓ on a shipment the captain never picked up in the app — and on one he did NOT:
    // the record is what counts, not the leg.
    expect(securedPickupOf(record('operations'), leg('pending'))).toEqual({
      by: 'operations',
      at: AT,
    });
  });

  it('an explicit null is nobody — even when the captain’s leg says picked up (his ✓ was undone)', () => {
    for (const execution of [...OPERATIONS_EXECUTION_STATUSES, null]) {
      expect(securedPickupOf(null, leg(execution))).toBeNull();
    }
    expect(securedPickupOf(null, null)).toBeNull();
  });

  // A row from before Round 10 has no record at all — absent, not null.
  it('a record NEVER WRITTEN falls back to the leg: picked up in the app → the captain’s', () => {
    for (const execution of ['pickedUp', 'delivered', 'completed'] as const) {
      expect(securedPickupOf(undefined, leg(execution))).toEqual({ by: 'captain', at: LEG_AT });
    }
    for (const execution of ['pending', 'active', 'cancelled', null] as const) {
      expect(securedPickupOf(undefined, leg(execution))).toBeNull();
    }
    // No pickup leg at all — booked, crewed later.
    expect(securedPickupOf(undefined, null)).toBeNull();
    expect(securedPickupOf(undefined, undefined)).toBeNull();
    // A leg picked up but never stamped still reads as his, with no instant.
    expect(securedPickupOf(undefined, { executionStatus: 'pickedUp' })).toEqual({
      by: 'captain',
      at: null,
    });
  });
});

describe('the secured stage — derived from the status and the pickup record', () => {
  const captain: SecuredPickup = { by: 'captain', at: AT };
  const desk: SecuredPickup = { by: 'operations', at: AT };

  it('a draft nobody has picked up is awaitingPickup (white)', () => {
    expect(securedStageOf('draft', null)).toBe('awaitingPickup');
  });

  it('a draft the captain picked up is withCaptain, one the desk picked up withOperations (both yellow)', () => {
    expect(securedStageOf('draft', captain)).toBe('withCaptain');
    expect(securedStageOf('draft', desk)).toBe('withOperations');
  });

  it('from the vault on, the shipment’s own status is the stage, whoever picked it up', () => {
    for (const status of OPERATIONS_SHIPMENT_STATUSES.filter((s) => s !== 'draft')) {
      for (const pickup of [captain, desk, null]) {
        expect(securedStageOf(status, pickup)).toBe(status);
      }
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
