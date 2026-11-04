// «ضمان ينتهي خلال ٣٠ يومًا» — the ONE rule for a warranty that ends soon, shared by the asset
// list's `warrantyEndsWithinDays` filter and the dashboard's «يحتاج متابعة» row, so the figure on
// the dashboard is the number of rows the list it opens shows.
//
// It is the expiry sweep's window (shared/expiry-sweeps.ts) asked as a query: a warranty has ENDED
// once its end is at or before now — the sweep's `expired` — and ends soon while its end falls
// after now and no later than `days` days on. A disposed asset is left out exactly as the sweep
// leaves it out: the machine is gone, and its warranty is nobody's problem.
import { type FilterQuery } from 'mongoose';
import { type ItAssetDoc } from './asset.model';

const DAY_MS = 86_400_000;

export const warrantyEndingWithin = (days: number, now: Date): FilterQuery<ItAssetDoc> => ({
  status: { $ne: 'disposed' },
  'warranty.end': { $gt: now, $lte: new Date(now.getTime() + days * DAY_MS) },
});
