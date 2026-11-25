// The units' and categories' form state against the contracts (design §2.3.2–§2.3.3): a create
// sends both names and a whole sort order, an empty box left out; an edit sends only what moved,
// `null` to clear the code, the description or the parent; a sort order that is no whole number is
// caught before it is sent.
import { describe, expect, it } from 'vitest';
import {
  CreateAdministrationCatalogItemSchema,
  CreateAdministrationItemCategorySchema,
  UpdateAdministrationItemCategorySchema,
} from '@ecms/contracts';
import { category, unit } from '../screen-fixtures';
import {
  catalogFormFrom,
  catalogRequired,
  categoryChanges,
  categoryCreateBody,
  sortOrderOf,
  unitChanges,
  unitCreateBody,
} from './catalog-form';

describe('the catalog form', () => {
  it('needs both names, nothing else', () => {
    expect(catalogRequired(catalogFormFrom(null))).toEqual({ nameAr: false, nameEn: false });
    expect(catalogRequired({ ...catalogFormFrom(null), nameAr: 'قطعة', nameEn: 'Piece' })).toEqual({
      nameAr: true,
      nameEn: true,
    });
  });

  it('reads the sort order as a whole number, empty as the contract’s 0', () => {
    expect(sortOrderOf('')).toBe(0);
    expect(sortOrderOf(' 7 ')).toBe(7);
    expect(sortOrderOf('1.5')).toBeNaN();
    expect(sortOrderOf('99999999999999999999')).toBeNaN();
  });

  it('creates a unit as the contract takes it — its kind added by the call, empty boxes left out', () => {
    const body = unitCreateBody({
      ...catalogFormFrom(null),
      nameAr: ' قطعة ',
      nameEn: 'Piece',
      code: 'pcs',
    });
    expect(body).toEqual({ name: { ar: 'قطعة', en: 'Piece' }, sortOrder: 0, code: 'pcs' });
    expect(CreateAdministrationCatalogItemSchema.safeParse({ kind: 'unit', ...body }).success).toBe(
      true,
    );
  });

  it('creates a category under its parent, or at the top level', () => {
    const top = categoryCreateBody({ ...catalogFormFrom(null), nameAr: 'الأحبار', nameEn: 'Inks' });
    expect(top).not.toHaveProperty('parentId');
    const sub = categoryCreateBody({
      ...catalogFormFrom(null),
      nameAr: 'حبر ليزر',
      nameEn: 'Laser toner',
      parentId: '650000000000000000000001',
    });
    expect(sub.parentId).toBe('650000000000000000000001');
    expect(CreateAdministrationItemCategorySchema.safeParse(sub).success).toBe(true);
  });

  it('edits only what moved, `null` to clear', () => {
    const PIECE = unit();
    expect(unitChanges(catalogFormFrom(PIECE), PIECE)).toEqual({});
    expect(unitChanges({ ...catalogFormFrom(PIECE), code: '', isActive: false }, PIECE)).toEqual({
      code: null,
      isActive: false,
    });
    const LASER = category({ id: 'c-laser', parentId: '650000000000000000000001' });
    const toTop = categoryChanges({ ...catalogFormFrom(LASER), parentId: '' }, LASER);
    expect(toTop).toEqual({ parentId: null });
    expect(UpdateAdministrationItemCategorySchema.safeParse({ ...toTop, version: 0 }).success).toBe(
      true,
    );
  });
});
