// «عايزك تعمل فى الـ /it الرئيسية.. Dashboard … بس أقدر أفلتر بـالفئة.. من خلال Drop Down بـ
// Multiselection» — the dashboard's rules without a browser: what the request carries, what a
// click on a category row or a branch row writes, and where every figure leads — under the target
// page's OWN parameter names, so the list it opens is the very view that was counted.
import { describe, expect, it } from 'vitest';
import {
  ItDashboardQuerySchema,
  ListItAssetsQuerySchema,
  ListItAssignmentsQuerySchema,
} from '@ecms/contracts';
import { FILTER_LIST_MAX } from './category-name-filter';
import {
  assetsLink,
  consumablesLink,
  custodyLink,
  dashboardQuery,
  largestFirst,
  mobileLinesLink,
  pickBranch,
  share,
  toggleCategory,
  warrantyLink,
} from './it-dashboard';

const C1 = '6650a1b2c3d4e5f6a7b8c9d1';
const C2 = '6650a1b2c3d4e5f6a7b8c9d2';
const B1 = '6650a1b2c3d4e5f6a7b8c9e1';

const none = { categoryIds: [], branchId: '' };
const both = { categoryIds: [C1, C2], branchId: B1 };

/** A link's path and its parameters, order aside. */
const parse = (href: string): { path: string; params: Record<string, string> } => {
  const [path = '', query = ''] = href.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
};

describe('the request', () => {
  it('carries nothing when nothing is narrowed — every category, every branch in scope', () => {
    expect(dashboardQuery(none)).toEqual({});
  });

  it('carries the categories as one comma list and the branch — and the API reads it so', () => {
    const query = dashboardQuery(both);
    expect(query).toEqual({ categoryId: `${C1},${C2}`, branchId: B1 });
    expect(ItDashboardQuerySchema.parse(query)).toEqual({ categoryId: [C1, C2], branchId: B1 });
  });
});

describe('a click on «حسب الفئة»', () => {
  it('adds the category to the filter, and a second click takes it out', () => {
    expect(toggleCategory([], C1)).toEqual([C1]);
    expect(toggleCategory([C1], C2)).toEqual([C1, C2]);
    expect(toggleCategory([C1, C2], C1)).toEqual([C2]);
  });

  it('never writes more than the API takes', () => {
    const full = Array.from({ length: FILTER_LIST_MAX }, (_, i) => `c-${String(i)}`);
    expect(toggleCategory(full, 'c-new')).toEqual(full);
  });
});

describe('a click on «حسب الفرع»', () => {
  it('shows that branch alone, and clears it when it is the one shown', () => {
    expect(pickBranch('', B1)).toBe(B1);
    expect(pickBranch('b-other', B1)).toBe(B1);
    expect(pickBranch(B1, B1)).toBe('');
  });
});

describe('every figure opens its list, with the dashboard’s filters', () => {
  it('a state’s count opens the asset register in that state', () => {
    expect(parse(assetsLink(both, 'inStock'))).toEqual({
      path: '/it/assets',
      params: { category: `${C1},${C2}`, branch: B1, status: 'inStock' },
    });
    expect(parse(assetsLink(none, 'disposed')).params).toEqual({ status: 'disposed' });
  });

  it('«إجمالي الأصول» opens every state — and never on a bare URL a remembered view would fill', () => {
    expect(parse(assetsLink(both, null)).params).toEqual({ category: `${C1},${C2}`, branch: B1 });
    // Bare, the register would restore yesterday's filters and show another number.
    expect(assetsLink(none, null)).toBe('/it/assets?status=');
    expect(new URLSearchParams('status=').toString()).not.toBe('');
  });

  it('the custody rows open the register as it names them', () => {
    expect(parse(custodyLink(both, 'heldByLeavers'))).toEqual({
      path: '/it/custody',
      params: { open: 'true', holderExited: 'true', category: `${C1},${C2}`, branch: B1 },
    });
    expect(parse(custodyLink(none, 'receiptsAwaitingSignature')).params).toEqual({
      open: 'true',
      receipt: 'unsigned',
    });
    expect(parse(custodyLink(none, 'overdueReturns')).params).toEqual({ overdue: 'true' });
  });

  it('the warranty row opens the asset list on the setting’s window', () => {
    expect(parse(warrantyLink(both, 45))).toEqual({
      path: '/it/assets',
      params: { warrantyEndsWithinDays: '45', category: `${C1},${C2}`, branch: B1 },
    });
  });

  it('the lines and the consumables carry the branch — they have no category', () => {
    // Never bare: a bare arrival would restore the lines page's remembered view.
    expect(mobileLinesLink('')).toBe('/it/mobile-lines?status=');
    expect(parse(mobileLinesLink(B1)).params).toEqual({ branch: B1 });
    expect(parse(consumablesLink('')).params).toEqual({ belowMin: 'true' });
    expect(parse(consumablesLink(B1)).params).toEqual({ belowMin: 'true', branch: B1 });
  });

  // The target lists' params are an open record and their schemas strict: the API names must be
  // the ones the pages translate these into, or the list would answer 400.
  it('ask the target lists only for what their APIs declare', () => {
    expect(
      ListItAssetsQuerySchema.safeParse({ warrantyEndsWithinDays: '45', status: 'inStock' })
        .success,
    ).toBe(true);
    expect(
      ListItAssignmentsQuerySchema.safeParse({ open: 'true', holderExited: 'true' }).success,
    ).toBe(true);
  });
});

describe('the figures', () => {
  it('a share is a whole percent, and nothing of nothing is 0', () => {
    expect(share(1, 3)).toBe(33);
    expect(share(2, 3)).toBe(67);
    expect(share(0, 0)).toBe(0);
  });

  it('rows are largest first, then by name', () => {
    const row = (id: string, total: number) => ({
      categoryId: id,
      inStock: total,
      assigned: 0,
      underMaintenance: 0,
      disposed: 0,
      total,
    });
    const sorted = largestFirst([row('b', 2), row('a', 2), row('c', 9)], (r) => r.categoryId);
    expect(sorted.map((r) => r.categoryId)).toEqual(['c', 'a', 'b']);
  });
});
