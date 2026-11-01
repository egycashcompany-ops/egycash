// What the map's panels say about the machines and the zones (docs/12-planning/atm-map-zones.md
// §6.4 figures, §8.8 ZoneDetail, SaveSummaryDialog, DeleteZoneDialog, MoveConfirmDialog). Pure:
// the page hands in the points and the memberships it already computed, and renders the answers.
//
// ONE MEMBERSHIP, MANY READINGS. Every count here is "primary membership" (D-M7, DM-9): a machine
// counts for the first zone of its branch, in list order, that contains it. Which machines are
// counted is the caller's choice and differs by screen (§6.4): the view counts the points that pass
// the view filters; edit mode, the save summary and the delete dialog count all the edit branch's
// active points, whatever the filters say.
import {
  ATM_MAP_EARTH_RADIUS_METERS,
  ATM_SEED_BANK_CODES,
  type AtmBankCode,
  type AtmMapPointDto,
  type Locale,
} from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';
import { NO_MEMBERSHIP, type Membership } from './map-geometry';
import { type DraftZone } from './zone-editor';

/** Great-circle distance in metres (the api's `haversineMeters`, same radius). */
export const haversineMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * ATM_MAP_EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Kilometres with one decimal, for «تحرّك الموقع {{km}} كم» — in the UI's digits (DM-21). */
export const kilometresText = (meters: number, locale: Locale): string =>
  new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.round(meters / 100) / 10);

/**
 * When the map fits itself to what it shows (§8.4 "Default view"): once the data of a branch and
 * a status has arrived, and again only when that branch or status changes. Entering or leaving
 * edit mode on the same branch is not a new view, so the person keeps the place they zoomed to;
 * `null` while the data is still on its way (the canvas fits nothing yet).
 */
export const mapFitKey = (view: {
  editing: boolean;
  viewBranch: string | null;
  editBranch: string | null;
  status: string;
  viewReady: boolean;
  editReady: boolean;
}): string | null => {
  const ready = view.editing ? view.editReady : view.viewReady;
  if (!ready) return null;
  return `${String(view.editing ? view.editBranch : view.viewBranch)}|${view.status}`;
};

// ── ZoneDetail ──────────────────────────────────────────────────────────────────────────────────

export interface ZoneBreakdown {
  count: number;
  /**
   * Bank codes in the catalog's order (any code it does not hold after them, sorted), then «بنك غير
   * محدد» (null); zero rows left out.
   */
  banks: { code: AtmBankCode | null; count: number; pct: number }[];
  /** Areas by count, then by name. */
  areas: { name: string; count: number }[];
  /** The zone's machines, by code. */
  machines: AtmMapPointDto[];
}

/**
 * One zone's figures over the points the caller counts (§8.8 ZoneDetail: visible points only).
 * `bankOrder` is the catalog's (`BankLookup.codes`); the six seeds when the caller has none.
 */
export const zoneBreakdown = (
  zoneId: string,
  points: readonly AtmMapPointDto[],
  membership: ReadonlyMap<string, Membership>,
  bankOrder: readonly AtmBankCode[] = ATM_SEED_BANK_CODES,
): ZoneBreakdown => {
  const machines = points
    .filter((p) => (membership.get(p.machineId) ?? NO_MEMBERSHIP).primary === zoneId)
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const count = machines.length;
  const byBank = new Map<AtmBankCode | null, number>();
  const byArea = new Map<string, number>();
  for (const p of machines) {
    byBank.set(p.bankCode, (byBank.get(p.bankCode) ?? 0) + 1);
    byArea.set(p.area, (byArea.get(p.area) ?? 0) + 1);
  }
  // A bank the order does not name is still counted — after the named ones, sorted — so the rows
  // always add up to the zone's count (the report's fold does the same with an unlisted bank).
  const unlisted = [...byBank.keys()]
    .filter((code): code is AtmBankCode => code !== null && !bankOrder.includes(code))
    .sort();
  const order: (AtmBankCode | null)[] = [...bankOrder, ...unlisted, null];
  return {
    count,
    banks: order
      .filter((code) => (byBank.get(code) ?? 0) > 0)
      .map((code) => {
        const n = byBank.get(code) ?? 0;
        return { code, count: n, pct: count === 0 ? 0 : (n * 100) / count };
      }),
    areas: [...byArea.entries()]
      .map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar')),
    machines,
  };
};

/**
 * Whether ZoneDetail offers «تعديل» (§8.8): only for a zone of the edit branch, because edit mode
 * always opens that branch (§8.6) — a button on another branch's zone would open other zones.
 */
export const zoneEditableFromDetail = (
  zoneBranchId: string,
  editBranchId: string | null,
  canEditZones: boolean,
): boolean => canEditZones && editBranchId !== null && zoneBranchId === editBranchId;

// ── SaveSummaryDialog / DeleteZoneDialog ────────────────────────────────────────────────────────

export interface SaveSummaryRow {
  id: string;
  name: string;
  color: string;
  /** Null for a zone this save creates («—»). */
  before: number | null;
  /** Null for a zone this save deletes («محذوف»). */
  after: number | null;
}

export interface SaveSummary {
  created: number;
  updated: number;
  deleted: number;
  rows: SaveSummaryRow[];
  /** Machines in a zone before the save and in none after it. */
  orphaned: number;
}

const sameRing = (
  a: readonly { lat: number; lng: number }[],
  b: readonly { lat: number; lng: number }[],
): boolean =>
  a.length === b.length && a.every((p, i) => p.lat === b[i]?.lat && p.lng === b[i]?.lng);

/**
 * «مراجعة التغييرات قبل الحفظ» — the approved mockup's table: every zone of the base in its order,
 * then every new zone, with its count before and after; and how many machines lose their zone.
 * `machineIds` are the machines counted (all the edit branch's active points, §6.4).
 */
export const saveSummary = (
  base: readonly DraftZone[],
  draft: readonly DraftZone[],
  machineIds: readonly string[],
  before: ReadonlyMap<string, Membership>,
  after: ReadonlyMap<string, Membership>,
): SaveSummary => {
  const countIn = (membership: ReadonlyMap<string, Membership>): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const id of machineIds) {
      const primary = membership.get(id)?.primary ?? null;
      if (primary !== null) counts.set(primary, (counts.get(primary) ?? 0) + 1);
    }
    return counts;
  };
  const was = countIn(before);
  const now = countIn(after);
  const baseById = new Map(base.map((zone) => [zone.id, zone]));
  const draftById = new Map(draft.map((zone) => [zone.id, zone]));

  let updated = 0;
  for (const zone of draft) {
    const old = baseById.get(zone.id);
    if (
      old !== undefined &&
      (old.name !== zone.name ||
        old.color.toLowerCase() !== zone.color.toLowerCase() ||
        !sameRing(old.points, zone.points))
    ) {
      updated += 1;
    }
  }
  const rows: SaveSummaryRow[] = [
    ...base.map((zone) => {
      const kept = draftById.get(zone.id);
      return {
        id: zone.id,
        name: (kept ?? zone).name,
        color: (kept ?? zone).color,
        before: was.get(zone.id) ?? 0,
        after: kept === undefined ? null : (now.get(zone.id) ?? 0),
      };
    }),
    ...draft
      .filter((zone) => !baseById.has(zone.id))
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        before: null,
        after: now.get(zone.id) ?? 0,
      })),
  ];
  const orphaned = machineIds.filter(
    (id) => (before.get(id)?.primary ?? null) !== null && (after.get(id)?.primary ?? null) === null,
  ).length;
  return {
    created: draft.filter((zone) => !baseById.has(zone.id)).length,
    updated,
    deleted: base.filter((zone) => !draftById.has(zone.id)).length,
    rows,
    orphaned,
  };
};

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The machine «رقم الماكينة أو اسمها» names: an exact code first, then the first code that starts
 * with the text, then the first name that contains it (Arabic spelling folded).
 */
export const findMachine = (
  points: readonly AtmMapPointDto[],
  query: string,
): AtmMapPointDto | null => {
  const q = query.trim();
  if (q === '') return null;
  const lower = q.toLowerCase();
  return (
    points.find((p) => p.code.toLowerCase() === lower) ??
    points.find((p) => p.code.toLowerCase().startsWith(lower)) ??
    points.find((p) => foldIncludes(p.name, q)) ??
    null
  );
};

/** The areas the points carry, for the «المنطقة» filter. */
export const areasOf = (points: readonly AtmMapPointDto[]): string[] =>
  [...new Set(points.map((p) => p.area).filter((a) => a.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b, 'ar'),
  );
