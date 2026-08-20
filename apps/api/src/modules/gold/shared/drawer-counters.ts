// Keeping the drawers' denormalized counters honest (gold `utils/drawerCounters.js`).
//
// A drawer's `barsCount` / `totalWeight` / `status` are RECOMPUTED from the bars that physically
// sit in it, never incremented. Every operation that could move a bar calls this for each drawer
// it touched, so a partially-applied operation can never leave a drawer claiming weight it does
// not hold — which is the property the visual fill bar and the weight-limit warning both rely on.
import { Types } from 'mongoose';
import { GoldBarModel } from '../bars/bar.model';
import { GoldDrawerModel } from '../vaults/drawer.model';

export const recountDrawer = async (drawerId: string | null | undefined): Promise<void> => {
  if (drawerId === null || drawerId === undefined || !Types.ObjectId.isValid(drawerId)) return;
  const id = new Types.ObjectId(drawerId);
  const [totals] = await GoldBarModel.aggregate<{ count: number; weight: number }>([
    { $match: { currentDrawerId: id, status: 'in_vault', isDeleted: false } },
    { $group: { _id: null, count: { $sum: 1 }, weight: { $sum: '$weight' } } },
  ]).exec();
  const count = totals?.count ?? 0;
  const weight = totals?.weight ?? 0;
  await GoldDrawerModel.updateOne(
    { _id: id },
    { $set: { barsCount: count, totalWeight: weight, status: count > 0 ? 'occupied' : 'empty' } },
  ).exec();
};

/** Recount several drawers — the shape every confirm/revert needs. Duplicates are collapsed. */
export const recountDrawers = async (
  drawerIds: readonly (string | null | undefined)[],
): Promise<void> => {
  const unique = [...new Set(drawerIds.filter((id): id is string => typeof id === 'string'))];
  await Promise.all(unique.map(async (id) => recountDrawer(id)));
};
