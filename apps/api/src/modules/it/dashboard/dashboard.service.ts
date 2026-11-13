// The IT home dashboard's reads (design §11). Every figure is derived at request time under the
// reader's own `itAsset.view` scope — a branch-scoped technician's dashboard counts their branch and
// nothing else — and every section reads in a bounded number of round trips, whatever the size of
// the register: never a read per row, and never a count taken over documents fetched to be counted.
import {
  ItSettingKeys,
  type ItDashboardActivityDto,
  type ItDashboardAssetsDto,
  type ItDashboardQuery,
} from '@ecms/contracts';
import { getDirectoryEmployees, type DirectoryEmployee } from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { type ScopeSelector } from '../../../shared/types';
import { itAssetRepository } from '../assets/asset.repository';
import { itAssetEventRepository } from '../assets/asset-event.repository';
import {
  assignmentRegisterFilter,
  itAssetAssignmentRepository,
} from '../assets/assignment.repository';
import { leaverHoldings } from '../assets/assignment.service';
import { type ItAssetDoc } from '../assets/asset.model';
import { itCustodyReceiptRepository } from '../assets/receipt.repository';
import { warrantyEndingWithin } from '../assets/warranty-window';
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_LIMIT,
  countsByBranch,
  countsByCategory,
  dashboardAssetFilter,
  latestMovements,
  movementOfEvent,
  movementOfRegistration,
  statusCounts,
  toActivityItem,
} from './dashboard-rules';

/** Organization scope — the warn window is a company policy, as the expiry sweep reads it. */
const ORG = { userId: null, branchId: null };

class ItDashboardService {
  /**
   * «ضمان ينتهي خلال …» is the window the expiry sweep warns inside (`it.warrantyWarnDays`), so the
   * row counts exactly the warranties the sweep has announced as ending. 0 switches the early
   * warning off, and the row with it: nothing is «ending soon» when nobody is warned.
   */
  private async warrantyWindowDays(): Promise<number> {
    const days = await settingsService.resolve<number>(ItSettingKeys.WarrantyWarnDays, ORG);
    return typeof days === 'number' && days >= 0 ? days : 0;
  }

  /**
   * The counts. «إجمالي الأصول وإيه فى المخزن وإيه متسلم» under both filters; by category under the
   * branch alone and by branch under the categories alone — each panel keeps the rows the other
   * filter would hide, so a click on one adds to the choice instead of being the only row left.
   */
  async assets(query: ItDashboardQuery, scope: ScopeSelector): Promise<ItDashboardAssetsDto> {
    const [totals, byCategory, byBranch, attention] = await Promise.all([
      itAssetRepository.countByStatus(dashboardAssetFilter(query), scope),
      itAssetRepository.countByStatusGrouped(
        'categoryId',
        dashboardAssetFilter({ branchId: query.branchId }),
        scope,
      ),
      itAssetRepository.countByStatusGrouped(
        'branchId',
        dashboardAssetFilter({ categoryId: query.categoryId }),
        scope,
      ),
      this.attention(query, scope, new Date()),
    ]);
    return {
      totals: statusCounts(totals),
      byCategory: countsByCategory(byCategory),
      byBranch: countsByBranch(byBranch),
      attention,
    };
  }

  /**
   * «يحتاج متابعة» under both filters, each row the very rule of the list its «عرض» opens — the
   * custody register's `holderExited`, `receipt: 'unsigned'` and `overdue`, the asset list's
   * `warrantyEndsWithinDays` — so the figure is the number of rows the reader then sees.
   *
   * The categories reach the intervals as the register's do: the assets in them, read once under
   * the reader's scope. The branch is the interval's own, which a transfer moves with the asset.
   */
  private async attention(
    query: ItDashboardQuery,
    scope: ScopeSelector,
    now: Date,
  ): Promise<ItDashboardAssetsDto['attention']> {
    const [assetIds, signedReceiptIds, warrantyWindowDays] = await Promise.all([
      query.categoryId === undefined
        ? undefined
        : itAssetRepository.idsMatching(
            dashboardAssetFilter({ categoryId: query.categoryId }),
            scope,
          ),
      itCustodyReceiptRepository.signedIds(),
      this.warrantyWindowDays(),
    ]);
    const intervals = { assetIds, branchId: query.branchId };
    const [leavers, receiptsAwaitingSignature, overdueReturns, warrantyEndingSoon] =
      await Promise.all([
        leaverHoldings(assignmentRegisterFilter({ ...intervals, open: true }, now), scope),
        itAssetAssignmentRepository.count(
          assignmentRegisterFilter(
            { ...intervals, open: true, receipt: { state: 'unsigned', signedReceiptIds } },
            now,
          ),
          scope,
        ),
        itAssetAssignmentRepository.count(
          assignmentRegisterFilter({ ...intervals, overdue: true }, now),
          scope,
        ),
        warrantyWindowDays === 0
          ? 0
          : itAssetRepository.count(
              { ...dashboardAssetFilter(query), ...warrantyEndingWithin(warrantyWindowDays, now) },
              scope,
            ),
      ]);
    return {
      heldByLeavers: leavers.intervals,
      receiptsAwaitingSignature,
      overdueReturns,
      warrantyEndingSoon,
      warrantyWindowDays,
    };
  }

  /**
   * «آخر الحركات» — the newest movements of the assets the reader may see under the filters:
   * history entries (handed over, returned, moved, serviced, disposed) and registrations, which
   * write no entry (FR-5) and are read from the asset itself.
   *
   * `it_asset_events` carries no branch, so the assets decide whose history is read: their ids
   * under the reader's scope and the filters, then the newest entries among them. Labelled once
   * for the lines that survive the cut — the assets in one read, the people in one directory batch.
   */
  async activity(query: ItDashboardQuery, scope: ScopeSelector): Promise<ItDashboardActivityDto> {
    const filter = dashboardAssetFilter(query);
    const [assetIds, registered] = await Promise.all([
      itAssetRepository.idsMatching(filter, scope),
      itAssetRepository.newestRegistered(filter, scope, ACTIVITY_LIMIT),
    ]);
    const events = await itAssetEventRepository.latestOfTypes({
      assetIds,
      types: ACTIVITY_EVENT_TYPES,
      limit: ACTIVITY_LIMIT,
    });
    const movements = latestMovements([
      ...events.map(movementOfEvent),
      ...registered.map(movementOfRegistration),
    ]);

    const known = new Map<string, ItAssetDoc>(
      registered.map((asset) => [String(asset._id), asset]),
    );
    const unread = [...new Set(movements.map((m) => m.assetId))].filter((id) => !known.has(id));
    const employeeIds = [
      ...new Set(movements.flatMap((m) => (m.employeeId === null ? [] : [m.employeeId]))),
    ];
    const [assets, employees] = await Promise.all([
      unread.length === 0 ? [] : itAssetRepository.findByIdsSystem(unread),
      employeeIds.length === 0
        ? new Map<string, DirectoryEmployee>()
        : getDirectoryEmployees(employeeIds),
    ]);
    for (const asset of assets) known.set(String(asset._id), asset);

    return {
      items: movements.flatMap((movement) => {
        const item = toActivityItem(
          movement,
          known.get(movement.assetId),
          movement.employeeId === null ? undefined : employees.get(movement.employeeId),
        );
        return item === null ? [] : [item];
      }),
    };
  }
}

export const itDashboardService = new ItDashboardService();
