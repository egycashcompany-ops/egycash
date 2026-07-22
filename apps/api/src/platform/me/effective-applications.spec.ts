import { describe, expect, it } from 'vitest';
import {
  assembleEffectiveApplications,
  type EffectiveAppInput,
  type EffectiveCategoryInput,
} from './effective-applications';

const cat = (
  id: string,
  sortOrder: number,
  extra: Partial<EffectiveCategoryInput> = {},
): EffectiveCategoryInput => ({
  id,
  name: { ar: `ar-${id}`, en: `en-${id}` },
  icon: `icon-${id}`,
  sortOrder,
  ...extra,
});

const app = (
  id: string,
  categoryId: string,
  sortOrder: number,
  extra: Partial<EffectiveAppInput> = {},
): EffectiveAppInput => ({
  id,
  name: { ar: `ar-${id}`, en: `en-${id}` },
  icon: `icon-${id}`,
  route: `/${id}`,
  sortOrder,
  status: 'active',
  categoryId,
  ...extra,
});

describe('assembleEffectiveApplications', () => {
  it('returns an empty list when there are no applications', () => {
    expect(assembleEffectiveApplications([], [cat('c1', 0)])).toEqual([]);
  });

  it('groups applications under their category', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c1', 1)],
      [cat('c1', 0)],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('orders categories by sortOrder, then applications by sortOrder within each', () => {
    const result = assembleEffectiveApplications(
      [app('a2', 'c2', 5), app('a1', 'c2', 1), app('b1', 'c1', 0)],
      [cat('c2', 10), cat('c1', 1)],
    );
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result[1]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('removes duplicate applications, keeping the first occurrence', () => {
    // Same application arriving from both the department and the direct grant.
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a1', 'c1', 0)],
      [cat('c1', 0)],
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  it('ignores inactive applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { status: 'inactive' }), app('a2', 'c1', 1)],
      [cat('c1', 0)],
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a2']);
  });

  it('omits categories that have no active applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c2', 0, { status: 'inactive' })],
      [cat('c1', 0), cat('c2', 1)],
    );
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('drops applications whose category is not present', () => {
    const result = assembleEffectiveApplications([app('a1', 'missing', 0)], [cat('c1', 0)]);
    expect(result).toEqual([]);
  });

  it('returns only the fields the navigation needs', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0)],
      [cat('c1', 0, { icon: null })],
    );
    expect(result).toEqual([
      {
        id: 'c1',
        name: { ar: 'ar-c1', en: 'en-c1' },
        icon: null,
        applications: [{ id: 'a1', name: { ar: 'ar-a1', en: 'en-a1' }, icon: 'icon-a1', route: '/a1' }],
      },
    ]);
  });
});
