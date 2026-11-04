// The IT home dashboard's rules (design §11) — «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل اللى
// موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop Down
// بـ Multiselection».
//
// Pure on purpose: what each filter means, how the grouped counts become the panels, and how a
// history entry becomes a line of «آخر الحركات» are decided here and pinned by this folder's spec;
// the service only reads. Derived on every read — no collection and no stored figure (§11).
import { Types, type FilterQuery } from 'mongoose';
import {
  IT_DASHBOARD_ACTIVITY_KINDS,
  type ItAssetStatusCountsDto,
  type ItDashboardActivityItemDto,
  type ItDashboardActivityKind,
  type ItDashboardQuery,
} from '@ecms/contracts';
import { type ItAssetDoc } from '../assets/asset.model';
import { type ItAssetEventDoc } from '../assets/asset-event.model';

/** «آخر الحركات» shows a handful — the latest few, never a page. */
export const ACTIVITY_LIMIT = 8;

/**
 * The history kinds the panel reads from `it_asset_events` — all of its kinds but `registered`,
 * which no history entry carries: a registration writes none (FR-5), so it is read from the
 * asset's own `createdAt` instead.
 */
export const ACTIVITY_EVENT_TYPES = IT_DASHBOARD_ACTIVITY_KINDS.filter(
  (kind): kind is Exclude<ItDashboardActivityKind, 'registered'> => kind !== 'registered',
);

/**
 * The dashboard's two filters over the ASSETS: an asset in ANY of the chosen categories, in the
 * chosen branch. Each section passes only the filters that apply to it — the by-category panel
 * keeps the branch alone (so the categories not chosen still show beside the chosen ones), the
 * by-branch panel the categories alone.
 */
export const dashboardAssetFilter = (
  filters: Pick<ItDashboardQuery, 'categoryId' | 'branchId'>,
): FilterQuery<ItAssetDoc> => {
  const filter: FilterQuery<ItAssetDoc> = {};
  if (filters.categoryId !== undefined) {
    filter.categoryId = { $in: filters.categoryId.map((id) => new Types.ObjectId(id)) };
  }
  if (filters.branchId !== undefined) filter.branchId = new Types.ObjectId(filters.branchId);
  return filter;
};

/**
 * One `$group`'s answer as the five figures. «إجمالي الأصول» is every asset in the four states,
 * the disposed included — the KPI row prints each state's share of it, and the shares add up.
 */
export const statusCounts = (
  byStatus: Readonly<Record<string, number>>,
): ItAssetStatusCountsDto => {
  const inStock = byStatus.inStock ?? 0;
  const assigned = byStatus.assigned ?? 0;
  const underMaintenance = byStatus.underMaintenance ?? 0;
  const disposed = byStatus.disposed ?? 0;
  return {
    inStock,
    assigned,
    underMaintenance,
    disposed,
    total: inStock + assigned + underMaintenance + disposed,
  };
};

/** The largest first, and a tie in a stable order, so the panel does not reshuffle on refresh. */
const largestFirst = (
  grouped: Readonly<Record<string, Readonly<Record<string, number>>>>,
): { id: string; counts: ItAssetStatusCountsDto }[] =>
  Object.entries(grouped)
    .map(([id, byStatus]) => ({ id, counts: statusCounts(byStatus) }))
    .sort((a, b) => b.counts.total - a.counts.total || a.id.localeCompare(b.id));

export const countsByCategory = (
  grouped: Readonly<Record<string, Readonly<Record<string, number>>>>,
): ItDashboardCategoryCounts[] =>
  largestFirst(grouped).map(({ id, counts }) => ({ categoryId: id, ...counts }));

export const countsByBranch = (
  grouped: Readonly<Record<string, Readonly<Record<string, number>>>>,
): ItDashboardBranchCounts[] =>
  largestFirst(grouped).map(({ id, counts }) => ({ branchId: id, ...counts }));

export type ItDashboardCategoryCounts = ItAssetStatusCountsDto & { categoryId: string };
export type ItDashboardBranchCounts = ItAssetStatusCountsDto & { branchId: string };

/**
 * A line of «آخر الحركات» before it is labelled — the facts the history entry (or the asset, for a
 * registration) holds. Labels are read once for the lines that survive the cut, never per entry.
 */
export interface ItDashboardMovement {
  id: string;
  kind: ItDashboardActivityKind;
  at: Date;
  assetId: string;
  /**
   * Where it went, for a transfer — the one entry that records a branch. `null` reads the asset's
   * own branch at response time: where it is now, which is what the line's reader can open.
   */
  branchId: string | null;
  employeeId: string | null;
  fromBranchId: string | null;
  toBranchId: string | null;
}

/** A metadata value as an id — anything else (absent, empty, not a string) is no id at all. */
const idOf = (value: unknown): string | null =>
  typeof value === 'string' && Types.ObjectId.isValid(value) ? value : null;

/**
 * A history entry as a movement. The person is whom it was handed to (`assigned`), returned from
 * (`returned`) or handed on to (`transferred`), as the custody actions record them; maintenance
 * and disposal name nobody. A transfer names its branches only when it crossed one — a transfer to
 * another holder in the same branch moved nobody between branches, and printing «أكتوبر ← أكتوبر»
 * would say it did.
 */
export const movementOfEvent = (
  event: Pick<ItAssetEventDoc, '_id' | 'type' | 'at' | 'subjectId' | 'metadata'>,
): ItDashboardMovement => {
  const metadata = event.metadata ?? {};
  const base = {
    id: String(event._id),
    kind: event.type as ItDashboardActivityKind,
    at: event.at,
    assetId: String(event.subjectId),
    branchId: null,
    employeeId: null,
    fromBranchId: null,
    toBranchId: null,
  };
  if (event.type === 'assigned' || event.type === 'returned') {
    return { ...base, employeeId: idOf(metadata.employeeId) };
  }
  if (event.type === 'transferred') {
    const from = idOf(metadata.fromBranchId);
    const to = idOf(metadata.toBranchId);
    const crossed = from !== null && to !== null && from !== to;
    return {
      ...base,
      branchId: to,
      employeeId: idOf(metadata.toEmployeeId),
      fromBranchId: crossed ? from : null,
      toBranchId: crossed ? to : null,
    };
  }
  return base;
};

/** A registration as a movement — the asset's own id and creation time, in its branch. */
export const movementOfRegistration = (
  asset: Pick<ItAssetDoc, '_id' | 'createdAt' | 'branchId'>,
): ItDashboardMovement => ({
  id: String(asset._id),
  kind: 'registered',
  at: asset.createdAt,
  assetId: String(asset._id),
  branchId: String(asset.branchId),
  employeeId: null,
  fromBranchId: null,
  toBranchId: null,
});

/**
 * The two streams as one: newest first, a tie broken by id so the order is stable, cut at
 * `limit`. Each stream was read already cut at `limit`, which is enough — the newest `limit` of the
 * union always lie within the newest `limit` of each.
 */
export const latestMovements = (
  movements: readonly ItDashboardMovement[],
  limit: number = ACTIVITY_LIMIT,
): ItDashboardMovement[] =>
  [...movements]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id))
    .slice(0, limit);

/**
 * A movement as the panel prints it — the asset's code and name, the person's code and name as HR
 * keeps them. `null` when the asset cannot be named (it cannot happen for an asset read under the
 * reader's scope a moment ago; a line that could not say what moved is better left out). A person
 * HR does not know keeps their id and loses only the label, as every IT screen shows them.
 */
export const toActivityItem = (
  movement: ItDashboardMovement,
  asset: Pick<ItAssetDoc, 'assetCode' | 'name' | 'branchId'> | undefined,
  employee: { code: string; fullNameAr: string } | undefined,
): ItDashboardActivityItemDto | null => {
  if (asset === undefined) return null;
  return {
    id: movement.id,
    kind: movement.kind,
    at: movement.at.toISOString(),
    assetId: movement.assetId,
    assetCode: asset.assetCode,
    assetName: asset.name,
    branchId: movement.branchId ?? String(asset.branchId),
    employeeId: movement.employeeId,
    employeeCode: movement.employeeId === null ? null : (employee?.code ?? null),
    employeeName: movement.employeeId === null ? null : (employee?.fullNameAr ?? null),
    fromBranchId: movement.fromBranchId,
    toBranchId: movement.toBranchId,
  };
};
