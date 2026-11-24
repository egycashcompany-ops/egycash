// The Administrative Affairs catalog contracts, pinned (design §19.4, §19.7): every write schema is
// strict, so an unknown key — a client-sent `nameKey`, a stock figure, a moved `kind` — is refused
// instead of dropped; a name needs both languages, and an Arabic one that folds to something; an
// update carries its version; a unit list names its kind, and a category list asks one question of
// the tree. And the two refusal vocabularies the screens word are exactly §5.15's.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../errors/index.js';
import {
  ADMINISTRATION_CATALOG_KINDS,
  ADMINISTRATION_CATEGORY_PARENT_PROBLEMS,
  ADMINISTRATION_DUPLICATE_FIELDS,
  CreateAdministrationCatalogItemSchema,
  CreateAdministrationItemCategorySchema,
  ListAdministrationCatalogItemsQuerySchema,
  ListAdministrationItemCategoriesQuerySchema,
  UpdateAdministrationCatalogItemSchema,
  UpdateAdministrationItemCategorySchema,
} from './administration-catalog.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const piece = { ar: 'قطعة', en: 'Piece' };

describe('units', () => {
  it('has one kind in Phase 1 — the unit (OD-07: one base unit per item)', () => {
    expect(ADMINISTRATION_CATALOG_KINDS).toEqual(['unit']);
  });

  it('creates a unit from a kind and a name, defaulting its order', () => {
    const parsed = CreateAdministrationCatalogItemSchema.parse({ kind: 'unit', name: piece });
    expect(parsed).toEqual({ kind: 'unit', name: piece, sortOrder: 0 });
  });

  it('trims the name and the code, so a trailing space is not a second unit', () => {
    const parsed = CreateAdministrationCatalogItemSchema.parse({
      kind: 'unit',
      code: ' pc ',
      name: { ar: ' قطعة ', en: 'Piece ' },
    });
    expect(parsed.code).toBe('pc');
    expect(parsed.name).toEqual(piece);
  });

  it.each([
    ['no Arabic name', { kind: 'unit', name: { en: 'Piece' } }],
    ['a blank English name', { kind: 'unit', name: { ar: 'قطعة', en: '  ' } }],
    ['an unknown kind', { kind: 'brand', name: piece }],
    ['a negative order', { kind: 'unit', name: piece, sortOrder: -1 }],
    ['a fractional order', { kind: 'unit', name: piece, sortOrder: 1.5 }],
  ])('refuses %s', (_label, body) => {
    expect(CreateAdministrationCatalogItemSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['nameKey', { nameKey: 'قطعه' }],
    ['isActive', { isActive: false }],
    ['an on-hand figure', { onHandQty: 5 }],
    ['a stray key inside the name', { name: { ...piece, fr: 'Pièce' } }],
  ])('refuses %s on a create — the server owns it, or nobody does', (_label, extra) => {
    expect(
      CreateAdministrationCatalogItemSchema.safeParse({ kind: 'unit', name: piece, ...extra })
        .success,
    ).toBe(false);
  });

  // Tatweel or harakat alone fold to '' (`foldName`): an empty key the database refuses on a
  // create and would store on an edit, shared by every such name.
  it.each([
    ['a tatweel', 'ـ'],
    ['a fathatan', 'ً'],
    ['two harakat with spaces', ' ً ٌ '],
  ])('refuses an Arabic name of %s alone, on a create and on an update', (_label, ar) => {
    const name = { ar, en: 'x' };
    expect(CreateAdministrationCatalogItemSchema.safeParse({ kind: 'unit', name }).success).toBe(
      false,
    );
    expect(UpdateAdministrationCatalogItemSchema.safeParse({ name, version: 0 }).success).toBe(
      false,
    );
    expect(CreateAdministrationItemCategorySchema.safeParse({ name }).success).toBe(false);
    expect(UpdateAdministrationItemCategorySchema.safeParse({ name, version: 0 }).success).toBe(
      false,
    );
  });

  it('keeps an Arabic name whose letters outlive the fold, and a digit-only one', () => {
    for (const ar of ['قُطْعَة', 'ـمترـ', '5']) {
      expect(
        CreateAdministrationCatalogItemSchema.safeParse({ kind: 'unit', name: { ar, en: 'x' } })
          .success,
        ar,
      ).toBe(true);
    }
  });

  it('updates with a version, and only with one', () => {
    expect(UpdateAdministrationCatalogItemSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(UpdateAdministrationCatalogItemSchema.safeParse({ name: piece }).success).toBe(false);
  });

  it('deactivates and clears a code through the update, and never moves the kind', () => {
    expect(
      UpdateAdministrationCatalogItemSchema.parse({ isActive: false, code: null, version: 3 }),
    ).toEqual({ isActive: false, code: null, version: 3 });
    for (const extra of [{ kind: 'unit' }, { nameKey: 'x' }, { onHandQty: 1 }]) {
      expect(
        UpdateAdministrationCatalogItemSchema.safeParse({ version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('lists one kind at a time, its page capped at 100', () => {
    expect(ListAdministrationCatalogItemsQuerySchema.safeParse({}).success).toBe(false);
    expect(
      ListAdministrationCatalogItemsQuerySchema.parse({ kind: 'unit', isActive: 'false' }),
    ).toMatchObject({ kind: 'unit', isActive: false, page: 1, pageSize: 25, sortDir: 'desc' });
    expect(
      ListAdministrationCatalogItemsQuerySchema.safeParse({ kind: 'unit', pageSize: 101 }).success,
    ).toBe(false);
    expect(
      ListAdministrationCatalogItemsQuerySchema.safeParse({ kind: 'unit', branchId: oid(1) })
        .success,
    ).toBe(false);
  });
});

describe('item categories', () => {
  const tools = { ar: 'أدوات', en: 'Tools' };

  it('creates a top-level category when no parent is named, or a null one', () => {
    expect(CreateAdministrationItemCategorySchema.parse({ name: tools })).toEqual({
      name: tools,
      sortOrder: 0,
    });
    expect(CreateAdministrationItemCategorySchema.parse({ name: tools, parentId: null })).toEqual({
      name: tools,
      parentId: null,
      sortOrder: 0,
    });
  });

  it('names a parent by id, and refuses anything else', () => {
    expect(
      CreateAdministrationItemCategorySchema.safeParse({ name: tools, parentId: oid(7) }).success,
    ).toBe(true);
    expect(
      CreateAdministrationItemCategorySchema.safeParse({ name: tools, parentId: 'tools' }).success,
    ).toBe(false);
  });

  it.each([{ nameKey: 'ادوات' }, { isActive: true }, { onHandQty: 2 }, { path: [] }])(
    'refuses %o on a create',
    (extra) => {
      expect(
        CreateAdministrationItemCategorySchema.safeParse({ name: tools, ...extra }).success,
      ).toBe(false);
    },
  );

  it('moves to the top level with a null parent, and needs its version to move at all', () => {
    expect(UpdateAdministrationItemCategorySchema.parse({ parentId: null, version: 2 })).toEqual({
      parentId: null,
      version: 2,
    });
    expect(UpdateAdministrationItemCategorySchema.safeParse({ parentId: null }).success).toBe(
      false,
    );
    expect(
      UpdateAdministrationItemCategorySchema.safeParse({ version: 0, nameKey: 'x' }).success,
    ).toBe(false);
  });

  it('lists the subcategories of one category', () => {
    expect(ListAdministrationItemCategoriesQuerySchema.parse({ parentId: oid(9) })).toMatchObject({
      parentId: oid(9),
    });
    expect(ListAdministrationItemCategoriesQuerySchema.safeParse({ parentId: 'x' }).success).toBe(
      false,
    );
  });

  it('lists the top level, where a parent is picked from, or every subcategory', () => {
    expect(ListAdministrationItemCategoriesQuerySchema.parse({ topLevel: 'true' })).toMatchObject({
      topLevel: true,
    });
    expect(ListAdministrationItemCategoriesQuerySchema.parse({ topLevel: 'false' })).toMatchObject({
      topLevel: false,
    });
    expect(ListAdministrationItemCategoriesQuerySchema.safeParse({ topLevel: 'yes' }).success).toBe(
      false,
    );
  });

  it('asks one question of the tree: a parent or the level, not both', () => {
    const both = ListAdministrationItemCategoriesQuerySchema.safeParse({
      parentId: oid(9),
      topLevel: 'true',
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues.map((issue) => issue.path)).toEqual([['topLevel']]);
  });
});

describe('the refusals the screens word (§5.15)', () => {
  it('names the five parent problems, and nothing else', () => {
    expect(ADMINISTRATION_CATEGORY_PARENT_PROBLEMS).toEqual([
      'self',
      'cycle',
      'tooDeep',
      'inactive',
      'hasChildren',
    ]);
  });

  it('names the duplicated field: a name or a code', () => {
    expect(ADMINISTRATION_DUPLICATE_FIELDS).toEqual(['name', 'code']);
  });

  it('carries both codes in the catalog, module-prefixed', () => {
    expect(ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID).toBe(
      'ADMINISTRATION_CATEGORY_PARENT_INVALID',
    );
    expect(ErrorCodes.ADMINISTRATION_DUPLICATE).toBe('ADMINISTRATION_DUPLICATE');
  });
});
