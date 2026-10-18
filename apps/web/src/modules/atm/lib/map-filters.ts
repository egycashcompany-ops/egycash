// The machine map's view filters and figures (docs/12-planning/atm-map-zones.md §8.5, §6.4, §7.5).
//
// THE PAGE READS THE ADDRESS BAR, NOT THIS FILE. The remembered-filters census reads each page's own
// source for the params it reads (`remembered-filters-coverage.spec.ts`), so `MachineMapPage` calls
// `sp.get(…)` itself and hands the raw strings here; this file only turns them into values and back.
//
// WHAT FILTERS AND WHAT DOES NOT. `banks`, `areas`, `zones`, `status` and `loc` narrow the visible
// points. `branch` picks what the server is asked for (it is never sent before `context` has
// offered it — `pruneStale`, §8.3). `q` (fly to a machine) and `machine` (a deep link that opens
// one popup) are carried through but filter nothing.
//
// A ZONE IS A PLACE ON THE MAP. A machine without coordinates is in no zone — not even «بلا قطاع»,
// which is the grey hollow dot of a machine on the map outside every zone. So any zone filter
// shows located machines only, and the «بدون موقع» figure then counts none.
import {
  ATM_BANK_CODES,
  ATM_MAP_STATUS_FILTERS,
  joinAtmNameList,
  splitAtmNameList,
  type AtmBankCode,
  type AtmMapPointDto,
  type AtmMapStatusFilter,
} from '@ecms/contracts';
import { NO_MEMBERSHIP, type Membership } from './map-geometry';

/** «بنك غير محدد» in the bank filter. */
export const BANK_NONE = 'none';
/** «بلا قطاع» and «في أكثر من قطاع» in the zone filter. */
export const ZONE_NONE = 'none';
export const ZONE_MULTI = 'multi';
/** «كل الفروع» in the branch param (offered only when `organizationWide`). */
export const BRANCH_ALL = 'all';

export const MAP_LOCATION_FILTERS = ['all', 'located', 'review'] as const;
export type MapLocationFilter = (typeof MAP_LOCATION_FILTERS)[number];

export type MapBankFilter = AtmBankCode | typeof BANK_NONE;

export interface MapFilters {
  banks: MapBankFilter[];
  areas: string[];
  /** Zone ids, plus `none` and `multi`. */
  zones: string[];
  status: AtmMapStatusFilter;
  loc: MapLocationFilter;
  /** A branch id, `all`, or null before the default is chosen. */
  branch: string | null;
  q: string;
  machine: string | null;
}

/** The params exactly as the page read them with `sp.get(name)`. */
export type MapFilterParams = Record<
  'banks' | 'areas' | 'zones' | 'status' | 'loc' | 'branch' | 'q' | 'machine',
  string | null
>;

export const DEFAULT_MAP_FILTERS: MapFilters = {
  banks: [],
  areas: [],
  zones: [],
  status: 'active',
  loc: 'all',
  branch: null,
  q: '',
  machine: null,
};

const BANK_VALUES: readonly string[] = [...ATM_BANK_CODES, BANK_NONE];

const list = (raw: string | null): string[] => [...new Set(splitAtmNameList(raw ?? ''))];

/** The read params as values. Anything not on offer by its nature (a bank code, a status) is dropped. */
export const parseMapFilters = (params: MapFilterParams): MapFilters => {
  const status = ATM_MAP_STATUS_FILTERS.find((s) => s === params.status) ?? 'active';
  const loc = MAP_LOCATION_FILTERS.find((l) => l === params.loc) ?? 'all';
  const branch = params.branch?.trim() ?? '';
  const machine = params.machine?.trim() ?? '';
  return {
    banks: list(params.banks).filter((b): b is MapBankFilter => BANK_VALUES.includes(b)),
    areas: list(params.areas),
    zones: list(params.zones),
    status,
    loc,
    branch: branch === '' ? null : branch,
    q: params.q ?? '',
    machine: machine === '' ? null : machine,
  };
};

/** The values as params: `null` removes one. Defaults are not written, so a bare URL is the default. */
export const mapFilterParams = (filters: MapFilters): MapFilterParams => ({
  banks: filters.banks.length === 0 ? null : joinAtmNameList(filters.banks),
  areas: filters.areas.length === 0 ? null : joinAtmNameList(filters.areas),
  zones: filters.zones.length === 0 ? null : joinAtmNameList(filters.zones),
  status: filters.status === 'active' ? null : filters.status,
  loc: filters.loc === 'all' ? null : filters.loc,
  branch: filters.branch,
  q: filters.q.trim() === '' ? null : filters.q,
  machine: filters.machine,
});

/** The branch as the server is asked for it: null = every branch in reach («كل الفروع»). */
export const branchIdOf = (branch: string | null): string | null =>
  branch === null || branch === BRANCH_ALL ? null : branch;

// ── Visible points and figures ──────────────────────────────────────────────────────────────────

const hasPoint = (p: AtmMapPointDto): boolean => p.state !== 'unlocated';

/** The points the view filters let through — "visible" in §6.4's figures. */
export const applyMapFilters = (
  points: readonly AtmMapPointDto[],
  membership: ReadonlyMap<string, Membership>,
  f: MapFilters,
): AtmMapPointDto[] =>
  points.filter((p) => {
    if (f.status === 'active' && !p.active) return false;
    if (f.status === 'archived' && p.active) return false;
    if (f.banks.length > 0 && !f.banks.includes(p.bankCode ?? BANK_NONE)) return false;
    if (f.areas.length > 0 && !f.areas.includes(p.area)) return false;
    if (f.loc === 'located' && !hasPoint(p)) return false;
    if (f.loc === 'review' && p.state !== 'review') return false;
    if (f.zones.length > 0) {
      if (!hasPoint(p)) return false;
      const m = membership.get(p.machineId) ?? NO_MEMBERSHIP;
      const matches =
        (m.primary !== null && f.zones.includes(m.primary)) ||
        (m.primary === null && f.zones.includes(ZONE_NONE)) ||
        (m.all.length > 1 && f.zones.includes(ZONE_MULTI));
      if (!matches) return false;
    }
    return true;
  });

export interface MapFigures {
  /** Visible points that have coordinates: located + review. */
  onMap: number;
  /** Of those, the ones with a primary zone (DM-9). */
  inZones: number;
  outZones: number;
  /** Visible points without a location, `notSynced` included. */
  unlocated: number;
}

export const mapFigures = (
  visible: readonly AtmMapPointDto[],
  membership: ReadonlyMap<string, Membership>,
): MapFigures => {
  let onMap = 0;
  let inZones = 0;
  for (const p of visible) {
    if (!hasPoint(p)) continue;
    onMap += 1;
    if ((membership.get(p.machineId) ?? NO_MEMBERSHIP).primary !== null) inZones += 1;
  }
  return { onMap, inZones, outZones: onMap - inZones, unlocated: visible.length - onMap };
};

// ── Stale values (§8.3) ─────────────────────────────────────────────────────────────────────────

export interface MapBranchContext {
  branches: readonly { id: string }[];
  organizationWide: boolean;
  editBranchId: string | null;
}

/**
 * The branch a view opens on (§8.3): the edit branch when it is offered; else the only branch;
 * else «كل الفروع» when the grant is organization-wide; else the first branch. Null: no branch.
 */
export const defaultMapBranch = (context: MapBranchContext): string | null => {
  const ids = context.branches.map((b) => b.id);
  if (context.editBranchId !== null && ids.includes(context.editBranchId)) {
    return context.editBranchId;
  }
  if (ids.length === 1) return ids[0] as string;
  if (ids.length === 0) return null;
  if (context.organizationWide) return BRANCH_ALL;
  return ids[0] as string;
};

/** Whether a branch value is one the context offers. */
export const branchOffered = (branch: string | null, context: MapBranchContext): boolean =>
  branch === BRANCH_ALL
    ? context.organizationWide && context.branches.length > 0
    : branch !== null && context.branches.some((b) => b.id === branch);

export interface PruneOptions extends MapBranchContext {
  /** The zone ids on offer. Undefined while the zones are loading: nothing is pruned then. */
  zones?: readonly string[];
  /** The areas on offer, under the same rule. */
  areas?: readonly string[];
}

/**
 * The filters without values that are no longer offered. `branch` FIRST, against the context — a
 * branch remembered by another account on this browser, or «كل الفروع» for a grant that no longer
 * reaches every branch, is replaced by the default before any query is enabled. Zones and areas
 * are pruned only once their list has arrived, so a list still loading never erases a choice.
 */
export const pruneStale = (filters: MapFilters, options: PruneOptions): MapFilters => {
  const branch = branchOffered(filters.branch, options)
    ? filters.branch
    : defaultMapBranch(options);
  const zoneOffers = options.zones;
  const areaOffers = options.areas;
  return {
    ...filters,
    branch,
    zones:
      zoneOffers === undefined
        ? filters.zones
        : filters.zones.filter(
            (z) => z === ZONE_NONE || z === ZONE_MULTI || zoneOffers.includes(z),
          ),
    areas:
      areaOffers === undefined
        ? filters.areas
        : filters.areas.filter((a) => areaOffers.includes(a)),
  };
};
