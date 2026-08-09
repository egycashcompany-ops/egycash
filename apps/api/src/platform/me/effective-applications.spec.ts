import { describe, expect, it } from 'vitest';
import { type DataScope } from '@ecms/contracts';
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
  permissionKey: null,
  ...extra,
});

/** The caller's effective permissions, in the shape the resolver receives them. */
const holding = (...keys: string[]): Record<string, DataScope> =>
  Object.fromEntries(keys.map((key) => [key, 'organization' as const]));

const NOTHING: Record<string, DataScope> = {};

describe('assembleEffectiveApplications', () => {
  it('returns an empty list when there are no applications', () => {
    expect(assembleEffectiveApplications([], [cat('c1', 0)], NOTHING)).toEqual([]);
  });

  it('groups applications under their category', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c1', 1)],
      [cat('c1', 0)],
      NOTHING,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('orders categories by sortOrder, then applications by sortOrder within each', () => {
    const result = assembleEffectiveApplications(
      [app('a2', 'c2', 5), app('a1', 'c2', 1), app('b1', 'c1', 0)],
      [cat('c2', 10), cat('c1', 1)],
      NOTHING,
    );
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result[1]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('removes duplicate applications, keeping the first occurrence', () => {
    // Same application arriving from both the department and the direct grant.
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a1', 'c1', 0)],
      [cat('c1', 0)],
      NOTHING,
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  it('ignores inactive applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { status: 'inactive' }), app('a2', 'c1', 1)],
      [cat('c1', 0)],
      NOTHING,
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a2']);
  });

  it('omits categories that have no active applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c2', 0, { status: 'inactive' })],
      [cat('c1', 0), cat('c2', 1)],
      NOTHING,
    );
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('drops applications whose category is not present', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'missing', 0)],
      [cat('c1', 0)],
      NOTHING,
    );
    expect(result).toEqual([]);
  });

  // ── The permission filter ────────────────────────────────────────────────
  // Navigation must not advertise what authorization will refuse. These cases are what confines an
  // HR-only account to HR even when a grant (theirs or their department's) offers another module.

  it('keeps applications the caller holds the permission for', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { permissionKey: 'applicant.view' })],
      [cat('c1', 0)],
      holding('applicant.view'),
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  it('drops applications the caller holds no permission for', () => {
    const result = assembleEffectiveApplications(
      [
        app('hr', 'c1', 0, { permissionKey: 'applicant.view' }),
        app('fleet', 'c1', 1, { permissionKey: 'fleetVehicle.view' }),
      ],
      [cat('c1', 0)],
      holding('applicant.view'),
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['hr']);
  });

  it('omits a whole category once every application in it is filtered out', () => {
    // The HR-only case exactly: the Fleet module disappears from the sidebar rather than
    // rendering as an empty group.
    const result = assembleEffectiveApplications(
      [
        app('applicants', 'hr', 0, { permissionKey: 'applicant.view' }),
        app('vehicles', 'fleet', 0, { permissionKey: 'fleetVehicle.view' }),
        app('drivers', 'fleet', 1, { permissionKey: 'fleetDriver.view' }),
      ],
      [cat('hr', 10), cat('fleet', 15)],
      holding('applicant.view'),
    );
    expect(result.map((c) => c.id)).toEqual(['hr']);
  });

  it('keeps applications with no permission key — they are open by definition', () => {
    // Catalog rows created before the field existed carry null, and must not vanish from anyone's
    // sidebar just because the filter arrived.
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { permissionKey: null })],
      [cat('c1', 0)],
      NOTHING,
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  it('does not treat a narrower data scope as a missing permission', () => {
    // Holding `leave.view` at own scope still means the page opens — scope narrows the ROWS,
    // it does not withhold the screen.
    const result = assembleEffectiveApplications(
      [app('leave', 'c1', 0, { permissionKey: 'leave.view' })],
      [cat('c1', 0)],
      { 'leave.view': 'own' },
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['leave']);
  });

  it('returns only the fields the navigation needs', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0)],
      [cat('c1', 0, { icon: null })],
      NOTHING,
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
