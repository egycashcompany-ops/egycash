// The map's filters and figures (spec §9.4): values ⇄ the params the page read, the defaults, the
// zone tokens, the stale-value prune (branch first), and §6.4's figure formulas.
import { describe, expect, it } from 'vitest';
import { type AtmMapPointDto } from '@ecms/contracts';
import {
  BRANCH_ALL,
  DEFAULT_MAP_FILTERS,
  applyMapFilters,
  branchIdOf,
  defaultMapBranch,
  mapFigures,
  mapFilterParams,
  parseMapFilters,
  pruneStale,
  type MapFilterParams,
  type MapFilters,
} from './map-filters';
import { type Membership } from './map-geometry';

const NONE: MapFilterParams = {
  banks: null,
  areas: null,
  zones: null,
  status: null,
  loc: null,
  branch: null,
  q: null,
  machine: null,
};

const point = (machineId: string, overrides: Partial<AtmMapPointDto> = {}): AtmMapPointDto => ({
  machineId,
  code: machineId.toUpperCase(),
  name: machineId,
  branchId: 'b1',
  area: 'سموحة',
  bankName: '',
  bankCode: 'NBE',
  active: true,
  lat: 30,
  lng: 31,
  state: 'located',
  source: 'registerUrl',
  reason: null,
  warnings: [],
  lastSet: null,
  ...overrides,
});

describe('values ⇄ params', () => {
  it('a bare URL is the default view: status active, every location', () => {
    expect(parseMapFilters(NONE)).toEqual(DEFAULT_MAP_FILTERS);
    expect(DEFAULT_MAP_FILTERS.status).toBe('active');
    expect(mapFilterParams(DEFAULT_MAP_FILTERS)).toEqual(NONE);
  });

  it('round-trips every filter, an area holding a comma included', () => {
    const filters: MapFilters = {
      banks: ['NBE', 'none'],
      areas: ['سموحة', 'Smouha, East'],
      zones: ['z1', 'none', 'multi'],
      status: 'archived',
      loc: 'review',
      branch: 'b1',
      q: 'ATM-01',
      machine: 'm1',
    };
    expect(parseMapFilters(mapFilterParams(filters))).toEqual(filters);
  });

  it('reads `zones=none,multi` as the two tokens', () => {
    expect(parseMapFilters({ ...NONE, zones: 'none,multi' }).zones).toEqual(['none', 'multi']);
  });

  it('drops what is not on offer by its nature: an unknown bank, status or location', () => {
    const f = parseMapFilters({ ...NONE, banks: 'NBE,XYZ', status: 'deleted', loc: 'nowhere' });
    expect(f.banks).toEqual(['NBE']);
    expect(f.status).toBe('active');
    expect(f.loc).toBe('all');
  });

  it('«كل الفروع» asks the server for every branch in reach', () => {
    expect(branchIdOf(BRANCH_ALL)).toBeNull();
    expect(branchIdOf(null)).toBeNull();
    expect(branchIdOf('b1')).toBe('b1');
  });
});

describe('pruneStale', () => {
  const context = {
    branches: [{ id: 'b1' }, { id: 'b2' }],
    organizationWide: true,
    editBranchId: null,
  };

  it('replaces a branch not in context.branches with the default', () => {
    const pruned = pruneStale({ ...DEFAULT_MAP_FILTERS, branch: 'remembered-elsewhere' }, context);
    expect(pruned.branch).toBe(BRANCH_ALL);
    expect(pruneStale({ ...DEFAULT_MAP_FILTERS, branch: null }, context).branch).toBe(BRANCH_ALL);
    expect(pruneStale({ ...DEFAULT_MAP_FILTERS, branch: 'b2' }, context).branch).toBe('b2');
  });

  it('replaces «كل الفروع» when the grant is not organization-wide', () => {
    const narrowed = { ...context, organizationWide: false };
    expect(pruneStale({ ...DEFAULT_MAP_FILTERS, branch: BRANCH_ALL }, narrowed).branch).toBe('b1');
  });

  it('removes zone ids not offered — once the zones have arrived — and keeps the tokens', () => {
    const chosen = { ...DEFAULT_MAP_FILTERS, branch: 'b1', zones: ['z1', 'gone', 'none', 'multi'] };
    expect(pruneStale(chosen, context).zones).toEqual(chosen.zones);
    expect(pruneStale(chosen, { ...context, zones: ['z1', 'z2'] }).zones).toEqual([
      'z1',
      'none',
      'multi',
    ]);
  });

  it('the default branch: the edit branch, else the only one, else all, else the first', () => {
    expect(defaultMapBranch({ ...context, editBranchId: 'b2' })).toBe('b2');
    expect(defaultMapBranch({ ...context, editBranchId: 'not-offered' })).toBe(BRANCH_ALL);
    expect(
      defaultMapBranch({ branches: [{ id: 'b9' }], organizationWide: true, editBranchId: null }),
    ).toBe('b9');
    expect(defaultMapBranch({ ...context, organizationWide: false })).toBe('b1');
    expect(
      defaultMapBranch({ branches: [], organizationWide: true, editBranchId: null }),
    ).toBeNull();
  });
});

describe('visible points and figures (§6.4)', () => {
  const points = [
    point('in-a'),
    point('in-a-and-b', { bankCode: 'CIB' }),
    point('outside', { bankCode: null }),
    point('review', { state: 'review', warnings: ['viewportOnly'] }),
    point('unlocated', { state: 'unlocated', lat: null, lng: null, reason: 'shortLink' }),
    point('not-synced', { state: 'unlocated', lat: null, lng: null, reason: 'notSynced' }),
    point('archived', { active: false, area: 'العجمي' }),
  ];
  const membership = new Map<string, Membership>([
    ['in-a', { primary: 'a', all: ['a'] }],
    ['in-a-and-b', { primary: 'a', all: ['a', 'b'] }],
    ['outside', { primary: null, all: [] }],
    ['review', { primary: 'b', all: ['b'] }],
    ['archived', { primary: 'a', all: ['a'] }],
  ]);
  const visible = (f: Partial<MapFilters>) =>
    applyMapFilters(points, membership, { ...DEFAULT_MAP_FILTERS, ...f }).map((p) => p.machineId);

  it('mapFigures: onMap = located + review, inZones by primary zone, unlocated incl. notSynced', () => {
    const shown = applyMapFilters(points, membership, DEFAULT_MAP_FILTERS);
    expect(mapFigures(shown, membership)).toEqual({
      onMap: 4,
      inZones: 3,
      outZones: 1,
      unlocated: 2,
    });
  });

  it('status, bank (with «بنك غير محدد») and area narrow the points', () => {
    expect(visible({ status: 'archived' })).toEqual(['archived']);
    expect(visible({ status: 'all' })).toHaveLength(7);
    expect(visible({ banks: ['CIB', 'none'] })).toEqual(['in-a-and-b', 'outside']);
    expect(visible({ status: 'all', areas: ['العجمي'] })).toEqual(['archived']);
  });

  it('the location filter: on the map (located + review) or under review', () => {
    expect(visible({ loc: 'located' })).toEqual(['in-a', 'in-a-and-b', 'outside', 'review']);
    expect(visible({ loc: 'review' })).toEqual(['review']);
  });

  it('zones: by primary zone, «بلا قطاع» and «في أكثر من قطاع» — located machines only', () => {
    expect(visible({ zones: ['a'] })).toEqual(['in-a', 'in-a-and-b']);
    expect(visible({ zones: ['b'] })).toEqual(['review']);
    expect(visible({ zones: ['none'] })).toEqual(['outside']);
    expect(visible({ zones: ['multi'] })).toEqual(['in-a-and-b']);
    const shown = applyMapFilters(points, membership, { ...DEFAULT_MAP_FILTERS, zones: ['none'] });
    expect(mapFigures(shown, membership)).toEqual({
      onMap: 1,
      inZones: 0,
      outZones: 1,
      unlocated: 0,
    });
  });

  it('q and machine filter nothing', () => {
    expect(visible({ q: 'in-a', machine: 'outside' })).toHaveLength(6);
  });
});
