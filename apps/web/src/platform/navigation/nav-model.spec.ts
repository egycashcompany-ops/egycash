// The nav model's routing rules. `requiresExactMatch` exists because NavLink highlights by
// prefix: a module landing page like /fleet stayed lit while the user was on /fleet/vehicles, so
// two rows read as "you are here" at once. The rule is derived from the catalog's own routes —
// these cases pin that derivation down.
import { describe, expect, it } from 'vitest';
import { moduleEntryRoute, moduleOfPathname, requiresExactMatch, toModules } from './nav-model';

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
    },
    {
      id: 'fleet',
      name: { ar: 'المركبات', en: 'Fleet' },
      icon: 'truck',
      applications: [
        { id: 'b1', name: { ar: 'اللوحة', en: 'Dashboard' }, icon: 'grid', route: '/fleet' },
        { id: 'b2', name: { ar: 'المركبات', en: 'Vehicles' }, icon: 'truck', route: '/fleet/vehicles' },
      ],
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
