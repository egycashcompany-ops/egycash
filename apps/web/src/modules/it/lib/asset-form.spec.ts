// A new asset starts from the last one of its category — «لو عندي 20 جهاز بنفس المواصفات …
// هفضل أكتب نفس المواصفات !؟ أكيد لأ». Everything a batch shares is filled; what makes ONE unit
// itself (serial, printed tag, location, notes) never is, and nothing the user typed is replaced.
import { describe, expect, it } from 'vitest';
import { type ItAssetDto } from '@ecms/contracts';
import { assetFormFrom, prefillFrom, SHARED_FIELDS } from './asset-form';

const LAST: ItAssetDto = {
  id: 'a1',
  assetCode: 'AST-00016',
  name: 'Lenovo ThinkCentre',
  description: 'كمبيوتر مكتبي All in One',
  categoryId: 'cat-pc',
  status: 'assigned',
  serialNumber: 'MP30EPER',
  model: 'ThinkCentre neo 50a 24 gen 5',
  manufacturer: 'Lenovo',
  externalTag: 'TAG-016',
  branchId: 'branch-1',
  location: 'مكتب 12',
  currentAssignmentId: null,
  disposal: null,
  purchase: { date: '2026-09-01T00:00:00.000Z', cost: 32000, vendorId: 'v1', invoiceRef: 'INV-77' },
  warranty: {
    vendorId: 'v1',
    start: '2026-09-01T00:00:00.000Z',
    end: '2028-09-01T00:00:00.000Z',
    terms: null,
  },
  notes: 'شاشة بها خدش',
  specs: {
    processor: 'CORE I5 210H',
    memory: '16',
    systemType: 'microsoft windows 11 pro',
    storage: '512 SSD',
    mediaDrive: null,
    displayAdapter: null,
    graphicsMemory: 'intel graphics',
    networkAdapters: ['Intel Wi-Fi 6'],
  },
  accessories: ['ماوس', 'كيبورد'],
  version: 3,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

/** The empty form of a new asset, with the category just picked. */
const fresh = () => ({ ...assetFormFrom(null), categoryId: 'cat-pc' });

describe('a new asset filled from the last one of its category', () => {
  it('fills everything the batch shares — specifications, make, model, purchase, warranty', () => {
    const form = prefillFrom(fresh(), assetFormFrom(LAST));
    expect(form.name).toBe('Lenovo ThinkCentre');
    expect([form.manufacturer, form.model]).toEqual(['Lenovo', 'ThinkCentre neo 50a 24 gen 5']);
    expect(form.specs.processor).toBe('CORE I5 210H');
    expect(form.specs.storage).toBe('512 SSD');
    expect(form.specs.networkAdapters).toBe('Intel Wi-Fi 6');
    expect(form.accessories).toBe('ماوس\nكيبورد');
    expect([form.purchaseDate, form.purchaseCost, form.invoiceRef]).toEqual([
      '2026-09-01',
      '32000',
      'INV-77',
    ]);
    expect([form.warrantyStart, form.warrantyEnd]).toEqual(['2026-09-01', '2028-09-01']);
    expect(form.branchId).toBe('branch-1');
  });

  it('never copies what makes a unit itself — «ماعدا السيريال والـ Tag والحاجات المتغيره»', () => {
    const form = prefillFrom(fresh(), assetFormFrom(LAST));
    expect(form.serialNumber).toBe('');
    expect(form.externalTag).toBe('');
    expect(form.location).toBe('');
    expect(form.notes).toBe('');
    expect(SHARED_FIELDS).not.toContain('serialNumber');
    expect(SHARED_FIELDS).not.toContain('externalTag');
  });

  it('keeps whatever the user typed before picking the category', () => {
    const typed = { ...fresh(), name: 'جهاز الاستقبال', specs: { ...fresh().specs, memory: '32' } };
    const form = prefillFrom(typed, assetFormFrom(LAST));
    expect(form.name).toBe('جهاز الاستقبال');
    expect(form.specs.memory).toBe('32');
    expect(form.specs.processor).toBe('CORE I5 210H');
  });

  it('picking another category swaps the first template out, but never the user’s own values', () => {
    const first = assetFormFrom(LAST);
    const filled = prefillFrom(fresh(), first);
    const edited = { ...filled, model: 'neo 50a gen 6' };
    const laptop = assetFormFrom({
      ...LAST,
      name: 'Dell Latitude',
      manufacturer: 'Dell',
      model: 'Latitude 5440',
      specs: null,
      accessories: ['شاحن'],
    });
    const swapped = prefillFrom(edited, laptop, first);
    expect(swapped.name).toBe('Dell Latitude');
    expect(swapped.manufacturer).toBe('Dell');
    // Typed after the first template — the user's, and kept.
    expect(swapped.model).toBe('neo 50a gen 6');
    // The first template's specifications do not linger under the second category.
    expect(swapped.specs.processor).toBe('');
    expect(swapped.accessories).toBe('شاحن');
  });
});
