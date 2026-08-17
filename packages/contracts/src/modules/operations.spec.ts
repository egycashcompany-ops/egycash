// The Operations vocabulary guards — the facts a careless later slice would violate first.
//
// The single most dangerous misreading of the legacy system is treating `transactions.status` as
// an ordinal ladder: the literal 1 is TERMINAL (discovery §6). These tests pin the legacy mapping
// as a bijection with 1 = completed, so a "fix" that reorders it fails loudly here instead of
// silently corrupting migration or report parity in a later slice.
import { describe, expect, it } from 'vitest';
import {
  LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS,
  LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE,
  LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS,
  OPERATIONS_DAY_STATUSES,
  OPERATIONS_EXECUTION_STATUSES,
  OPERATIONS_SHIPMENT_LEGS,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  OperationsShipmentStatusSchema,
} from './operations.js';

describe('operations vocabulary — legacy status mapping', () => {
  it('maps legacy code 1 to completed — terminal, NOT the first step', () => {
    expect(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[1]).toBe('completed');
    expect(LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS.completed).toBe(1);
  });

  it('covers exactly the four observed legacy codes 0/1/2/3, no more', () => {
    expect(Object.keys(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE).map(Number).sort()).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('is a bijection — the two maps are exact inverses', () => {
    for (const status of OPERATIONS_SHIPMENT_STATUSES) {
      const code = LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS[status];
      expect(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[code]).toBe(status);
    }
  });

  it('walks the observed secured lifecycle in legacy codes: 0 → 2 → 3 → 1', () => {
    const walk: string[] = [0, 2, 3, 1].map(
      (code) => LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[code] as string,
    );
    expect(walk).toEqual(['draft', 'inVault', 'dispatched', 'completed']);
  });

  it('keeps the verbatim Arabic legacy type labels migration matches on', () => {
    expect(LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS.daily).toBe('يومي');
    expect(LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS.secured).toBe('محصنة');
  });
});

describe('operations vocabulary — the shape it actually has today', () => {
  // The pin-the-numbers block (the pages.spec precedent): when a later slice grows a vocabulary,
  // the assertion names it in the same PR instead of letting it drift in unnoticed.
  it('pins the enum sets', () => {
    expect(OPERATIONS_SHIPMENT_TYPES).toEqual(['daily', 'secured']);
    expect(OPERATIONS_SHIPMENT_STATUSES).toEqual(['draft', 'inVault', 'dispatched', 'completed']);
    expect(OPERATIONS_SHIPMENT_LEGS).toEqual(['pickup', 'delivery']);
    expect(OPERATIONS_EXECUTION_STATUSES).toEqual([
      'pending',
      'active',
      'pickedUp',
      'delivered',
      'completed',
      'cancelled',
    ]);
    expect(OPERATIONS_DAY_STATUSES).toEqual(['planning', 'open', 'closed']);
  });

  it('rejects a legacy numeric status where a normalized one is required', () => {
    expect(OperationsShipmentStatusSchema.safeParse(1).success).toBe(false);
    expect(OperationsShipmentStatusSchema.safeParse('completed').success).toBe(true);
  });
});
