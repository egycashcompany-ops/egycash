// The shipment form's pure decisions — the parts that encode LEGACY BEHAVIOUR rather than layout.
//
// The legacy form had four non-exclusive branches over seventeen fixed currency slots, and wrote a
// scalar in one path where it wrote an array in another (quirks Q6, Q7). These functions are what
// replaced that, so each one is pinned against the legacy behaviour it preserves or normalizes.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LINE,
  MAX_SHIPMENT_LINES,
  deliveryDateFor,
  hasUsableLine,
  toShipmentLines,
} from './ShipmentFormDialog';

describe('toShipmentLines — one shape, replacing the legacy scalar-or-array split (Q6)', () => {
  it('keeps complete lines and converts the amount to a number', () => {
    expect(toShipmentLines([{ currencyId: 'egp', amount: '1500.50' }])).toEqual([
      { currencyId: 'egp', amount: 1500.5 },
    ]);
  });

  it('drops a row the operator added but never filled — legacy compacted the same way', () => {
    expect(
      toShipmentLines([
        { currencyId: 'egp', amount: '100' },
        EMPTY_LINE,
        { currencyId: 'usd', amount: '  ' },
        { currencyId: '', amount: '50' },
      ]),
    ).toEqual([{ currencyId: 'egp', amount: 100 }]);
  });

  it('keeps several currencies on one shipment — the multi-currency case', () => {
    expect(
      toShipmentLines([
        { currencyId: 'egp', amount: '100' },
        { currencyId: 'usd', amount: '20' },
      ]),
    ).toHaveLength(2);
  });

  it('is empty for an all-blank draft rather than producing a zero line', () => {
    expect(toShipmentLines([EMPTY_LINE, EMPTY_LINE])).toEqual([]);
  });
});

describe('hasUsableLine — the legacy server guard (contad_app.js:313)', () => {
  it('is false when nothing is filled in', () => {
    expect(hasUsableLine([EMPTY_LINE])).toBe(false);
    expect(hasUsableLine([{ currencyId: 'egp', amount: '' }])).toBe(false);
    expect(hasUsableLine([{ currencyId: '', amount: '100' }])).toBe(false);
  });

  it('is true as soon as one complete line exists', () => {
    expect(hasUsableLine([EMPTY_LINE, { currencyId: 'egp', amount: '1' }])).toBe(true);
  });
});

describe('deliveryDateFor — daily shipments carry no delivery date', () => {
  it('is null for a daily shipment even when a date was typed', () => {
    // Legacy wrote del_date: "" for daily (contad_app.js:353) and the contract rejects one.
    expect(deliveryDateFor('daily', '2026-10-05')).toBeNull();
  });

  it('is null for a secured shipment with no date given', () => {
    expect(deliveryDateFor('secured', '')).toBeNull();
  });

  it('is a Date for a secured shipment with a date', () => {
    const value = deliveryDateFor('secured', '2026-10-05');
    expect(value).toBeInstanceOf(Date);
    expect(value?.toISOString().slice(0, 10)).toBe('2026-10-05');
  });
});

describe('MAX_SHIPMENT_LINES', () => {
  it('matches the legacy form\'s seventeen currency slots, which the contract caps at', () => {
    expect(MAX_SHIPMENT_LINES).toBe(17);
  });
});
