// The vehicle set (plan R-13, D9, D10): which cars a «النوع / التشغيل / الفرع / الأكواد» filter names,
// resolved the way the SCREENS resolve them — every status, deleted cars INCLUDED, because their
// visits, readings, accidents and receipts are still history the registers show
// (`vehicle.repository.ts`, `idsWithOperations`). The dashboard's old `idsMatching` left the deleted
// cars out, so every linked screen showed more than the figure that linked to it.
//
// Two answers, one family:
// - `resolveVehicleFilterIds` — the set half (types ∩ operations ∩ branches) a screen intersects with
//   its OWN code resolution; each screen keeps its own way of reading codes (D9).
// - `vehicleSet` — the dashboard's set: codes (`idsByCodes`) ∩ types ∩ operations ∩ the switcher's
//   branch, with the echo the links are built from.
//
// `undefined` is «nothing narrows» — no vehicle clause at all, so rows without a car and the
// history of deleted cars count exactly as on the unfiltered screen. `[]` is a real answer (no car
// matched) and narrows to nothing.
import { type FleetDashboardVehicleScopeDto } from '@ecms/contracts';
import { fleetVehicleRepository, intersectVehicleIds } from './vehicle.repository';
import { memoisedVehicleIds as memoised, withVehicleFilterMemo } from './vehicle-filter-memo';

/** The dashboard reads run inside it (see `vehicle-filter-memo.ts`). */
export { withVehicleFilterMemo };

/**
 * The screen-shaped vehicle filter every owning module accepts (D9, D10). Every key optional, and
 * `undefined` means «not asked» — structurally the repository's `VehicleFilterQuery`, so a parsed
 * query's fields pass straight through.
 */
export interface VehicleFilter {
  vehicleCodes?: readonly string[] | undefined;
  typeIds?: readonly string[] | undefined;
  operationIds?: readonly string[] | undefined;
  branchIds?: readonly string[] | undefined;
}

/** Every car, deleted ones included, whose type is one of these — the twin of `idsWithOperations`. */
export const idsWithTypes = (typeIds: readonly string[]): Promise<string[]> =>
  fleetVehicleRepository.idsWithTypes(typeIds);

/** Folds every asked narrowing into one list; `undefined` when none was asked. */
const intersectAll = (lists: readonly (readonly string[] | undefined)[]): string[] | undefined =>
  lists.reduce<string[] | undefined>((acc, ids) => intersectVehicleIds(acc, ids), undefined);

/** A resolver run only for a key that was asked; `undefined` (not asked) otherwise. */
const asked = (
  ids: readonly string[] | undefined,
  resolve: (ids: readonly string[]) => Promise<string[]>,
): Promise<string[] | undefined> => (ids === undefined ? Promise.resolve(undefined) : resolve(ids));

/**
 * `typeIds ∩ operationIds ∩ branchIds`, each through the screens' own resolvers (deleted cars
 * INCLUDED); `undefined` when none is given (no clause). Codes are NOT resolved here — each screen
 * keeps its own code resolution and intersects it with this.
 */
export const resolveVehicleFilterIds = async (f: {
  typeIds?: readonly string[] | undefined;
  operationIds?: readonly string[] | undefined;
  branchIds?: readonly string[] | undefined;
}): Promise<string[] | undefined> =>
  intersectAll(
    await Promise.all([
      asked(f.typeIds, (ids) => memoised('types', ids, idsWithTypes)),
      asked(f.operationIds, (ids) =>
        memoised('operations', ids, (asked) => fleetVehicleRepository.idsWithOperations(asked)),
      ),
      asked(f.branchIds, (ids) =>
        memoised('branches', ids, (asked) => fleetVehicleRepository.idsInBranches(asked)),
      ),
    ]),
  );

/** The display count of a resolved set — `null` when nothing narrows or it was not asked for. */
const liveCount = (ids: readonly string[] | undefined, asked: boolean): Promise<number | null> =>
  ids === undefined || !asked ? Promise.resolve(null) : fleetVehicleRepository.countLive(ids);

/**
 * R-13 for the dashboard: codes (`idsByCodes`) ∩ types ∩ operations ∩ the switcher's branch.
 *
 * The branch is `activeBranchId` — what the reader narrowed themselves to in the command bar — and
 * NEVER their home branch (`currentBranchId`): «الشركة كلها» with a home branch is the whole
 * company, so it adds no branch clause. `ids` is `undefined` when nothing narrows.
 *
 * The echo carries the FILTERS, not the resolved ids, so every link opens its screen with the same
 * question and the screen resolves it itself (§5.7).
 *
 * `scope.count` is the DISPLAY count «المجموعة المختارة: N سيارة»: the set's cars that are in the
 * registry today (deleted ones left out, as /fleet/vehicles counts them), and only when the caller
 * asks for it (`opts.count`: the reader may see the registry). Otherwise `null`, with no extra read.
 */
export const vehicleSet = async (
  f: {
    vehicleCodes?: readonly string[] | undefined;
    typeIds?: readonly string[] | undefined;
    operationIds?: readonly string[] | undefined;
  },
  activeBranchId: string | null,
  opts: { count?: boolean } = {},
): Promise<{ ids: string[] | undefined; scope: FleetDashboardVehicleScopeDto }> => {
  const [byCode, bySet] = await Promise.all([
    asked(f.vehicleCodes, (codes) => fleetVehicleRepository.idsByCodes(codes)),
    resolveVehicleFilterIds({
      typeIds: f.typeIds,
      operationIds: f.operationIds,
      branchIds: activeBranchId === null ? undefined : [activeBranchId],
    }),
  ]);
  const ids = intersectVehicleIds(byCode, bySet);
  return {
    ids,
    scope: {
      count: await liveCount(ids, opts.count === true),
      typeIds: [...(f.typeIds ?? [])],
      operationIds: [...(f.operationIds ?? [])],
      vehicleCodes: [...(f.vehicleCodes ?? [])],
      branchId: activeBranchId,
    },
  };
};
