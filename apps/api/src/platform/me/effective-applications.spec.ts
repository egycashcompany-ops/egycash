import { describe, expect, it } from 'vitest';
import { type DataScope } from '@ecms/contracts';
import {
  assembleEffectiveApplications,
  type EffectiveAppInput,
  type EffectiveCategoryInput,
  type EffectiveSectionInput,
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

/**
 * Every application declares a permission — `<id>.view` unless overridden — because an application
 * without one is entitled to nobody, which would make every case below assert the same empty list.
 */
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
  sectionId: null,
  permissionKey: `${id}.view`,
  ...extra,
});

/** The caller's effective permissions, in the shape the resolver receives them. */
const holding = (...keys: string[]): Record<string, DataScope> =>
  Object.fromEntries(keys.map((key) => [key, 'organization' as const]));

/** Holds the default key of every application named — for cases that are not about permissions. */
const holdingAll = (...ids: string[]): Record<string, DataScope> =>
  holding(...ids.map((id) => `${id}.view`));

const NOTHING: Record<string, DataScope> = {};

describe('assembleEffectiveApplications', () => {
  it('returns an empty list when there are no applications', () => {
    expect(assembleEffectiveApplications([], [cat('c1', 0)], NOTHING)).toEqual([]);
  });

  it('groups applications under their category', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c1', 1)],
      [cat('c1', 0)],
      holdingAll('a1', 'a2'),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('orders categories by sortOrder, then applications by sortOrder within each', () => {
    const result = assembleEffectiveApplications(
      [app('a2', 'c2', 5), app('a1', 'c2', 1), app('b1', 'c1', 0)],
      [cat('c2', 10), cat('c1', 1)],
      holdingAll('a1', 'a2', 'b1'),
    );
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result[1]?.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('removes duplicate applications, keeping the first occurrence', () => {
    // Defensive: the caller now loads each application once, so a repeat cannot arise from the
    // resolver's own inputs. The rule is kept so any future caller cannot reintroduce one.
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a1', 'c1', 0)],
      [cat('c1', 0)],
      holdingAll('a1'),
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  it('ignores inactive applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { status: 'inactive' }), app('a2', 'c1', 1)],
      [cat('c1', 0)],
      holdingAll('a1', 'a2'),
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a2']);
  });

  it('omits categories that have no active applications', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0), app('a2', 'c2', 0, { status: 'inactive' })],
      [cat('c1', 0), cat('c2', 1)],
      holdingAll('a1', 'a2'),
    );
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('drops applications whose category is not present', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'missing', 0)],
      [cat('c1', 0)],
      holdingAll('a1'),
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

  it('drops applications with no permission key — they are entitled to nobody', () => {
    // Rows catalogued before the field existed carry null. Under the old model null meant "no
    // permission needed" and was harmless, because a grant was still required to see the row at
    // all. Grants are gone, so that reading would hand every undeclared application to every
    // signed-in user. Fail closed: invisible until somebody declares a key.
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { permissionKey: null }), app('a2', 'c1', 1)],
      [cat('c1', 0)],
      holdingAll('a1', 'a2'),
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a2']);
  });

  it('drops a null-key application even for a caller holding every permission there is', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { permissionKey: null })],
      [cat('c1', 0)],
      holding('a1.view', 'anything.else'),
    );
    expect(result).toEqual([]);
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
      holdingAll('a1'),
    );
    expect(result).toEqual([
      {
        id: 'c1',
        name: { ar: 'ar-c1', en: 'en-c1' },
        icon: null,
        applications: [{ id: 'a1', name: { ar: 'ar-a1', en: 'en-a1' }, icon: 'icon-a1', route: '/a1' }],
        sections: [],
      },
    ]);
  });
});

// ── Sections: grouping only, never entitlement ──────────────────────────────
const sec = (
  id: string,
  categoryId: string,
  sortOrder: number,
  extra: Partial<EffectiveSectionInput> = {},
): EffectiveSectionInput => ({
  id,
  name: { ar: `ar-${id}`, en: `en-${id}` },
  categoryId,
  sortOrder,
  status: 'active',
  ...extra,
});

describe('sections group what the caller may already see', () => {
  it('puts each application under its section, in section then application order', () => {
    const result = assembleEffectiveApplications(
      [
        app('a1', 'c1', 10, { sectionId: 's1' }),
        app('a2', 'c1', 0, { sectionId: 's1' }),
        app('b1', 'c1', 0, { sectionId: 's2' }),
      ],
      [cat('c1', 0)],
      holdingAll('a1', 'a2', 'b1'),
      [sec('s2', 'c1', 10), sec('s1', 'c1', 0)],
    );
    expect(result[0]?.sections.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result[0]?.sections[0]?.applications.map((a) => a.id)).toEqual(['a2', 'a1']);
    expect(result[0]?.applications).toEqual([]);
  });

  // The backward-compatibility contract: a row nobody has grouped is not a row that disappears.
  it('leaves an unsectioned application directly under its module', () => {
    const result = assembleEffectiveApplications(
      [app('loose', 'c1', 0), app('a1', 'c1', 0, { sectionId: 's1' })],
      [cat('c1', 0)],
      holdingAll('loose', 'a1'),
      [sec('s1', 'c1', 0)],
    );
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['loose']);
    expect(result[0]?.sections[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  // A heading over nothing is noise — and, since emptiness here usually means "you may open none
  // of these", printing it would advertise exactly what the caller cannot have.
  it('omits a section whose applications the caller may not open', () => {
    const result = assembleEffectiveApplications(
      [app('secret', 'c1', 0, { sectionId: 's1' }), app('mine', 'c1', 0, { sectionId: 's2' })],
      [cat('c1', 0)],
      holdingAll('mine'),
      [sec('s1', 'c1', 0), sec('s2', 'c1', 10)],
    );
    expect(result[0]?.sections.map((s) => s.id)).toEqual(['s2']);
  });

  // Grouping must never become a way to hide a page: an inactive — or deleted — section drops its
  // heading, and its applications fall back to the module's own list rather than vanishing.
  it('falls back to the module for an inactive or unknown section', () => {
    const inactive = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { sectionId: 's1' })],
      [cat('c1', 0)],
      holdingAll('a1'),
      [sec('s1', 'c1', 0, { status: 'inactive' })],
    );
    expect(inactive[0]?.sections).toEqual([]);
    expect(inactive[0]?.applications.map((a) => a.id)).toEqual(['a1']);

    const dangling = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { sectionId: 'gone' })],
      [cat('c1', 0)],
      holdingAll('a1'),
      [],
    );
    expect(dangling[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });

  // The permission filter is upstream of grouping and untouched by it.
  it('grants nothing: a section never puts an unentitled application in the sidebar', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { sectionId: 's1' })],
      [cat('c1', 0)],
      NOTHING,
      [sec('s1', 'c1', 0)],
    );
    expect(result).toEqual([]);
  });

  it('keeps a module whose every visible page sits in a section', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { sectionId: 's1' })],
      [cat('c1', 0)],
      holdingAll('a1'),
      [sec('s1', 'c1', 0)],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.applications).toEqual([]);
    expect(result[0]?.sections[0]?.applications).toHaveLength(1);
  });

  it('ignores a section belonging to another category', () => {
    const result = assembleEffectiveApplications(
      [app('a1', 'c1', 0, { sectionId: 's-other' })],
      [cat('c1', 0)],
      holdingAll('a1'),
      [sec('s-other', 'c2', 0)],
    );
    expect(result[0]?.sections).toEqual([]);
    expect(result[0]?.applications.map((a) => a.id)).toEqual(['a1']);
  });
});
