// The IT-1 contract guards that carry business rules — the ones a careless caller would violate
// first: status is not writable (FR-2), the code is not writable (FR-1), warranty dates are
// ordered, and the label batch is bounded.
import { describe, expect, it } from 'vitest';
import {
  CreateItAssetSchema,
  CreateItCatalogItemSchema,
  ItAssetLabelsSchema,
  ItAssetWarrantySchema,
  UpdateItAssetSchema,
} from './it.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');

describe('it contracts', () => {
  it('rejects a client-supplied assetCode and status on create — both are server facts', () => {
    const base = { name: 'ThinkPad T14', categoryId: oid(1), branchId: oid(2) };
    expect(CreateItAssetSchema.safeParse(base).success).toBe(true);
    expect(CreateItAssetSchema.safeParse({ ...base, assetCode: 'AST-99999' }).success).toBe(false);
    expect(CreateItAssetSchema.safeParse({ ...base, status: 'assigned' }).success).toBe(false);
  });

  it('rejects status on update too — FR-2 has no back door', () => {
    expect(UpdateItAssetSchema.safeParse({ version: 0, status: 'disposed' }).success).toBe(false);
    expect(UpdateItAssetSchema.safeParse({ version: 0, name: 'renamed' }).success).toBe(true);
  });

  it('orders warranty dates', () => {
    const ok = { start: '2026-01-01', end: '2027-01-01' };
    expect(ItAssetWarrantySchema.safeParse(ok).success).toBe(true);
    const flipped = { start: '2027-01-01', end: '2026-01-01' };
    expect(ItAssetWarrantySchema.safeParse(flipped).success).toBe(false);
  });

  it('bounds the label batch (1..100)', () => {
    expect(ItAssetLabelsSchema.safeParse({ assetIds: [] }).success).toBe(false);
    expect(ItAssetLabelsSchema.safeParse({ assetIds: [oid(1)] }).success).toBe(true);
    const over = Array.from({ length: 101 }, (_, i) => oid(i + 1));
    expect(ItAssetLabelsSchema.safeParse({ assetIds: over }).success).toBe(false);
  });

  it('accepts only the two declared catalog kinds', () => {
    const name = { ar: 'حواسيب', en: 'Computers' };
    expect(
      CreateItCatalogItemSchema.safeParse({ kind: 'assetCategory', name }).success,
    ).toBe(true);
    expect(CreateItCatalogItemSchema.safeParse({ kind: 'sparePart', name }).success).toBe(false);
  });
});
