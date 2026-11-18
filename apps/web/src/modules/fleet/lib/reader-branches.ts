// The branches a figure that "counts what the dashboard counts" covers, folded in the browser the
// way the server folds the command bar's branch into a grant (`scopeSelector`) — for the screens
// whose own read takes no branch scope (the drivers' roster, the receipts' summary), so their
// figures stay beside the tiles and the dashboard figures that do narrow.
import { FLEET_DASHBOARD_SCOPE_KEYS, widerScope, type DataScope } from '@ecms/contracts';

/**
 * The branches the drivers' «الإحصائيات» count (audit D31): the branches the dashboard's driver figures cover,
 * so «رخص منتهية» here and the dashboard's figure that opens this screen count the same drivers.
 *
 * `/fleet/drivers` reads no branch scope of its own — every reader's token answers the whole
 * roster — so the header used to count the whole company under a switcher on «فرع ب» (4 beside
 * the dashboard's 0). The vehicles header narrows through its API's scope; this one asks for the
 * branches by name, folded the way the server folds the command bar's branch into a grant
 * (`scopeSelector`):
 * - an `organization` grant: the switcher's branch, or `null` — the whole company — without one;
 * - a branch reach («فرعي» / «كل فروعي»): the switcher's branch when it is one of them, else every
 *   branch the reach holds;
 * - `[]`: a reach that holds no branch at all (a branch user moved out of their branch). The
 *   figures then count nobody, as the dashboard's and the vehicles header's do — never the whole
 *   company under a reach of none.
 *
 * The TABLE is not narrowed by this: it follows the URL's «الفرع», as before.
 */
export const registryBranchesOf = (reader: {
  /** The reader's widest grant among the dashboard's keys (`dashboardScopeOf`). */
  scope: DataScope | undefined;
  /** The command bar's branch — the `X-Active-Branch` every request carries. */
  active: string | null;
  /** The reader's own branch (`MeDto.branchId`). */
  home: string | null;
  /** Every branch the reader's grants reach (`MeDto.branchIds`; empty for a single branch). */
  reach: readonly string[];
}): readonly string[] | null => {
  // `own` reads the whole roster on the server too (`selectorBranches`), and no switcher narrows it.
  if (reader.scope === undefined || reader.scope === 'own') return null;
  if (reader.scope === 'organization') return reader.active === null ? null : [reader.active];
  const reach = [...new Set([...(reader.home === null ? [] : [reader.home]), ...reader.reach])];
  return reader.active !== null && reach.includes(reader.active) ? [reader.active] : reach;
};

/**
 * The grant that decides what the dashboard's figures cover — the WIDEST the reader holds among the
 * dashboard's own keys (`FLEET_DASHBOARD_SCOPE_KEYS`, the server's `dashboardBranches`), not
 * `fleetDriver.view` alone: a reader who sees the drivers branch-wide but the cars company-wide has a
 * company-wide dashboard, whose driver figures and their links cover the company. `undefined` when
 * the reader holds none of them (then `fleetDriver.view` — which is one of them — is not held either).
 *
 * KNOWN LIMIT, the server's own (plan D9): the browser knows ONE reach for every grant
 * (`MeDto.branchIds`), so a reader whose same-rank grants reach different branches per key is folded
 * with that account-wide reach.
 */
export const dashboardScopeOf = (
  permissions: Readonly<Record<string, DataScope | undefined>> | undefined,
): DataScope | undefined =>
  FLEET_DASHBOARD_SCOPE_KEYS.reduce<DataScope | undefined>((widest, key) => {
    const granted = permissions?.[key];
    if (granted === undefined) return widest;
    return widest === undefined ? granted : widerScope(widest, granted);
  }, undefined);
