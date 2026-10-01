// «يقدر يختار اكتر من عربيه بس لازم يوصل ل 0 فى العربيه اللى بينقص منها عشان يبدا ينقاص من
// العربيه التانيه» — what each picked car gives, in the order picked, as the server will draw it.
//
// In piastres, like the server: the parts must add up to exactly the amount typed.

export interface TakeSource {
  vehicleId: string;
  code: string;
  /** What the car can give — its remaining, never below zero. */
  available: number;
}

export interface TakeRow extends TakeSource {
  /** What this car gives. Zero when the cars before it already covered the amount. */
  take: number;
  /** What it has left afterwards. */
  left: number;
}

export interface TakePlan {
  rows: TakeRow[];
  /** Everything the picked cars have, together. */
  total: number;
  /** True when the amount is more than `total`. */
  short: boolean;
}

const piastres = (egp: number): number => Math.round(egp * 100);

export const planTakes = (sources: readonly TakeSource[], amount: number): TakePlan => {
  let left = Math.max(0, piastres(amount));
  let total = 0;
  const rows = sources.map((source) => {
    const available = Math.max(0, piastres(source.available));
    total += available;
    const take = Math.min(left, available);
    left -= take;
    return {
      ...source,
      available: available / 100,
      take: take / 100,
      left: (available - take) / 100,
    };
  });
  return { rows, total: total / 100, short: left > 0 };
};

/**
 * «مش انا اللى هكتب المبلغ الماخوذ» — the amount is not typed: the picked cars, in the order
 * picked, cover this accident's NEGATIVE remaining, each down to zero before the next, until the
 * accident reaches zero or the cars have nothing left. A remaining of zero or more takes nothing.
 */
export const coverDeficit = (
  sources: readonly TakeSource[],
  remaining: number,
): TakePlan & { amount: number } => {
  const deficit = Math.max(0, -piastres(remaining));
  const total = sources.reduce((sum, source) => sum + Math.max(0, piastres(source.available)), 0);
  const plan = planTakes(sources, Math.min(deficit, total) / 100);
  return { ...plan, amount: plan.rows.reduce((sum, row) => sum + piastres(row.take), 0) / 100 };
};
