// The nav model's routing rules. `requiresExactMatch` exists because NavLink highlights by
// prefix: a module landing page like /fleet stayed lit while the user was on /fleet/vehicles, so
// two rows read as "you are here" at once. The rule is derived from the catalog's own routes —
// these cases pin that derivation down.
import { describe, expect, it } from 'vitest';
import {
  flattenApps,
  moduleApps,
  moduleEntryRoute,
  moduleOfPathname,
  requiresExactMatch,
  toModules,
  visibleModules,
} from './nav-model';

const ROUTES = [
  '/fleet',
  '/fleet/vehicles',
  '/fleet/drivers',
  '/applicants',
  '/employees',
  '/organization/company',
  '/organization/branches',
];

describe('requiresExactMatch', () => {
  it('is true for a route another page lives under', () => {
    expect(requiresExactMatch('/fleet', ROUTES)).toBe(true);
  });

  it('is false for a leaf route', () => {
    expect(requiresExactMatch('/fleet/vehicles', ROUTES)).toBe(false);
    expect(requiresExactMatch('/applicants', ROUTES)).toBe(false);
  });

  it('does not treat a shared prefix without a boundary as nesting', () => {
    // /employees must not be forced exact by /employee-files: it is a different word, not a child.
    expect(requiresExactMatch('/employees', ['/employees', '/employee-files'])).toBe(false);
  });

  it('leaves sibling namespaces alone', () => {
    expect(requiresExactMatch('/organization/company', ROUTES)).toBe(false);
  });

  it('is false when the route is the only one', () => {
    expect(requiresExactMatch('/leave', ['/leave'])).toBe(false);
  });
});

describe('moduleOfPathname — the sidebar scope comes from the URL', () => {
  const modules = toModules([
    {
      id: 'hr',
      name: { ar: 'الموارد البشرية', en: 'HR' },
      icon: 'users',
      applications: [
        { id: 'a1', name: { ar: 'المتقدمون', en: 'Applicants' }, icon: 'user', route: '/applicants' },
      ],
      sections: [],
    },
    {
      id: 'fleet',
      name: { ar: 'المركبات', en: 'Fleet' },
      icon: 'truck',
      applications: [
        { id: 'b1', name: { ar: 'اللوحة', en: 'Dashboard' }, icon: 'grid', route: '/fleet' },
        { id: 'b2', name: { ar: 'المركبات', en: 'Vehicles' }, icon: 'truck', route: '/fleet/vehicles' },
      ],
      sections: [],
    },
  ]);

  it('resolves a deep link to the module that owns it', () => {
    expect(moduleOfPathname(modules, '/fleet/vehicles')).toBe('fleet');
    expect(moduleOfPathname(modules, '/applicants')).toBe('hr');
  });

  it('resolves a nested detail page to its module', () => {
    expect(moduleOfPathname(modules, '/fleet/vehicles/v-123')).toBe('fleet');
  });

  it('answers null for a system page so the caller can fall back', () => {
    expect(moduleOfPathname(modules, '/account/security')).toBeNull();
    expect(moduleOfPathname(modules, '/')).toBeNull();
  });
});

describe('moduleEntryRoute — switching returns you to your desk', () => {
  const fleet = toModules([
    {
      id: 'fleet',
      name: { ar: 'المركبات', en: 'Fleet' },
      icon: 'truck',
      applications: [
        { id: 'b1', name: { ar: 'اللوحة', en: 'Dashboard' }, icon: 'grid', route: '/fleet' },
        { id: 'b2', name: { ar: 'المركبات', en: 'Vehicles' }, icon: 'truck', route: '/fleet/vehicles' },
      ],
      sections: [],
    },
  ])[0]!;

  it('lands on the first page when nothing is remembered', () => {
    expect(moduleEntryRoute(fleet, null)).toBe('/fleet');
  });

  it('returns to the remembered page', () => {
    expect(moduleEntryRoute(fleet, '/fleet/vehicles')).toBe('/fleet/vehicles');
  });

  it('returns to a remembered DETAIL page under a module page', () => {
    expect(moduleEntryRoute(fleet, '/fleet/vehicles/v-42')).toBe('/fleet/vehicles/v-42');
  });

  it('falls back when the remembered page is no longer in the catalog', () => {
    // The page was revoked (or renamed) since it was stored: never navigate into nothing.
    expect(moduleEntryRoute(fleet, '/fleet/roster')).toBe('/fleet');
  });

  it('ignores a remembered page belonging to another module', () => {
    expect(moduleEntryRoute(fleet, '/applicants')).toBe('/fleet');
  });
});

// ── Sections: grouping must never cost a page ───────────────────────────────
//
// The failure this guards is specific and easy to ship: teach the model about sections, forget one
// of the traversals, and a grouped page silently stops matching the URL, stops being searchable in
// ⌘K, or stops being a valid module entry point. Each of those reads to a user as "the page is
// gone" even though the server still returns it.
describe('sections do not hide pages from the model', () => {
  const withSections = toModules([
    {
      id: 'hr',
      name: { ar: 'الموارد البشرية', en: 'HR' },
      icon: 'users',
      applications: [
        { id: 'loose', name: { ar: 'حر', en: 'Loose' }, icon: 'file', route: '/loose' },
      ],
      sections: [
        {
          id: 's1',
          name: { ar: 'التوظيف', en: 'Recruitment' },
          applications: [
            { id: 'a1', name: { ar: 'المتقدمون', en: 'Applicants' }, icon: 'user', route: '/applicants' },
            { id: 'a2', name: { ar: 'الفرز', en: 'Screening' }, icon: 'clip', route: '/screening' },
          ],
        },
      ],
    },
  ]);
  const hr = withSections[0]!;

  it('keeps ungrouped pages on the module and grouped ones in their section', () => {
    expect(hr.apps.map((a) => a.route)).toEqual(['/loose']);
    expect(hr.sections.map((s) => s.name.en)).toEqual(['Recruitment']);
    expect(hr.sections[0]?.apps.map((a) => a.route)).toEqual(['/applicants', '/screening']);
  });

  it('counts every page — sectioned or not — as the module’s', () => {
    expect(moduleApps(hr).map((a) => a.route)).toEqual(['/loose', '/applicants', '/screening']);
  });

  it('flattens sectioned pages into the palette and the route set', () => {
    const flat = flattenApps([
      {
        id: 'hr',
        name: { ar: 'الموارد البشرية', en: 'HR' },
        icon: 'users',
        applications: [{ id: 'loose', name: { ar: 'حر', en: 'Loose' }, icon: 'file', route: '/loose' }],
        sections: [
          {
            id: 's1',
            name: { ar: 'التوظيف', en: 'Recruitment' },
            applications: [
              { id: 'a1', name: { ar: 'المتقدمون', en: 'Applicants' }, icon: 'user', route: '/applicants' },
            ],
          },
        ],
      },
    ]);
    expect(flat.map((a) => a.route).sort()).toEqual(['/applicants', '/loose']);
    // The module identity travels with the row, so a ⌘K jump still knows where it belongs.
    expect(flat.every((a) => a.moduleId === 'hr')).toBe(true);
  });

  it('scopes the column from a SECTIONED page’s URL', () => {
    expect(moduleOfPathname(withSections, '/screening')).toBe('hr');
    expect(moduleOfPathname(withSections, '/applicants/a-1')).toBe('hr');
  });

  it('remembers a sectioned page as a valid module entry point', () => {
    expect(moduleEntryRoute(hr, '/screening')).toBe('/screening');
    // And still falls back for a page that is no longer served.
    expect(moduleEntryRoute(hr, '/gone')).toBe('/loose');
  });

  it('treats a payload with no sections exactly as before', () => {
    const legacy = toModules([
      {
        id: 'fleet',
        name: { ar: 'المركبات', en: 'Fleet' },
        icon: 'truck',
        applications: [{ id: 'b1', name: { ar: 'اللوحة', en: 'Dashboard' }, icon: 'grid', route: '/fleet' }],
        sections: [],
      },
    ]);
    expect(legacy[0]?.sections).toEqual([]);
    expect(moduleApps(legacy[0]!).map((a) => a.route)).toEqual(['/fleet']);
  });
});

// ── visibleModules: a fully-organized module is still a module ──────────────
//
// The bug this pins down shipped and was visible in production: HR — the one module that had
// filed every one of its twenty-three pages into a section — was absent from the launchpad's
// module grid and from ⌘K's module rows, while every one of its pages was entitled, catalogued,
// routed and reachable by URL. Each surface was filtering on `apps.length`, the count of the
// pages that belong to NO section, so organizing a module completely was what removed it.
describe('visibleModules — which modules earn chrome', () => {
  const page = (id: string, route: string) => ({
    id,
    name: { ar: id, en: id },
    icon: 'file',
    route,
  });
  const section = (id: string, en: string, applications: ReturnType<typeof page>[]) => ({
    id,
    name: { ar: en, en },
    applications,
  });
  const module = (
    id: string,
    applications: ReturnType<typeof page>[],
    sections: ReturnType<typeof section>[] = [],
  ) => ({ id, name: { ar: id, en: id }, icon: 'users', applications, sections });

  const hrFullyGrouped = module(
    'hr',
    [],
    [
      section('s1', 'Recruitment', [page('a1', '/applicants')]),
      section('s2', 'Payroll', [page('a2', '/payroll/runs')]),
    ],
  );

  it('keeps a module whose pages are ALL in sections', () => {
    expect(visibleModules([hrFullyGrouped]).map((m) => m.id)).toEqual(['hr']);
  });

  it('keeps a module with ungrouped pages, and one with both', () => {
    const flat = module('fleet', [page('b1', '/fleet')]);
    const mixed = module(
      'it',
      [page('c1', '/it')],
      [section('s3', 'Devices', [page('c2', '/it/devices')])],
    );
    expect(visibleModules([flat, mixed]).map((m) => m.id)).toEqual(['fleet', 'it']);
  });

  it('drops a module with no pages at all — including one whose only section is empty', () => {
    const bare = module('gold', []);
    const emptySection = module('atm', [], [section('s4', 'Empty', [])]);
    expect(visibleModules([bare, emptySection])).toEqual([]);
  });

  it('preserves the payload order and the grouping of what it keeps', () => {
    const kept = visibleModules([
      hrFullyGrouped,
      module('empty', []),
      module('fleet', [page('b1', '/fleet')]),
    ]);
    expect(kept.map((m) => m.id)).toEqual(['hr', 'fleet']);
    // And the module the shells then render still carries its groups — filtering is not flattening.
    expect(kept[0]?.sections.map((sec) => sec.name.en)).toEqual(['Recruitment', 'Payroll']);
    expect(moduleApps(kept[0]!).map((a) => a.route)).toEqual(['/applicants', '/payroll/runs']);
  });

  it('gives a fully-grouped module a first page to jump into', () => {
    // ⌘K's module row navigates to `moduleApps(m)[0]`; on `m.apps[0]` it was undefined, which is
    // the same defect wearing its other face — the row was either missing or it went nowhere.
    const [only] = visibleModules([hrFullyGrouped]);
    expect(moduleApps(only!)[0]?.route).toBe('/applicants');
    expect(moduleEntryRoute(only!, null)).toBe('/applicants');
  });
});
