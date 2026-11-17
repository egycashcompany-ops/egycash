// «يقدر يختار اكتر من عربيه بس لازم يوصل ل 0 فى العربيه اللى بينقص منها عشان يبدا ينقاص من
// العربيه التانيه» — what each car gives, in order, as the server will draw it.
//
// In piastres, like the server: the parts must add up to exactly the amount taken.
//
// THE TRANSFER (owner-approved 2026-11-09, «انا عاوز يجيب العربيات اللى ممكن يخليها ب0 فى الاول
// ويكتب جنب العربية انه هو الاختارها او الاختيار كان تلقائى … ولو اختار كل العربيات اللى فيها فلوس
// ولسه العربيه عليها فلوس عادى اسمح انه يكمل ويخصم اللى اختاره … هتسمح انه يدخل المبلغ او انت
// تلقائى اعرف المبلغ اللى بالسالب كام وشيله»). This partly reverses his 2026-10-01 rule «مش انا
// اللى هكتب المبلغ الماخوذ»: the amount MAY now be typed. `planTransfer` is the whole rule, as ONE
// pure function the form draws every figure from:
//
//   1. TARGET = the typed amount; with the box EMPTY and at least one car picked, the accident's
//      whole negative. Nothing picked and nothing typed → no transfer (the section is optional).
//      A typed 0 is refused (`zero`) — an empty box means «the whole negative», a 0 means nothing.
//   2. A typed amount above the accident's negative is refused (`overDeficit`); an accident that
//      is not negative has nothing to cover (`noDeficit`).
//   3. HIS picks first, in his pick order, each down to 0 before the next. A pick that gives
//      nothing because the target was already met stays listed with 0.00 (`unneeded`).
//   4. Still short → the SYSTEM completes from the other cars with a positive balance (not his
//      picks, not a car he unticked, not the accident's own car), SMALLEST balance first (a tie →
//      the lower code), each taken WHOLE to 0; the last gives only the rest.
//   5. All the cars together short of the target → ALLOWED: everything available is taken, the
//      accident stays negative by the rest (`short`), and saving stays allowed. `short.excluded`
//      says the shortfall is his doing (a car he unticked still holds money). Nothing at all to
//      take is refused (`nothingToTake`), so a save never sends an empty transfer.
//   6. «تغطية السالب كله تلقائياً» is offered (`offerCoverAll`) only while the accident owes and
//      nothing is picked or typed.
//   7. At most `MAX_GIVING_CARS` cars give in one save — the contract's `fromVehicleIds.max(20)`.
//      If stopping there leaves the accident short, `short.limited` says so; saving stays allowed.
//
// The server's `planTransfers` draws `fromVehicleIds` in the order given, so sending the rows that
// give something, in row order, with `amount` = what is taken, makes it take exactly what this
// plan shows. The server also caps the take at the receiving file's negative
// (`FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT`) from the same figures this plan reads.

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

/** The contract's `fromVehicleIds.max(20)`: no more cars than this give in one save. */
export const MAX_GIVING_CARS = 20;

/** «اختيار يدوي» — he picked it; «اختيار تلقائي» — the system added it. */
export type PickSource = 'manual' | 'auto';

export interface PlanRow extends TakeRow {
  source: PickSource;
  /** His pick that gives nothing: the target was met before it. Listed, greyed. */
  unneeded: boolean;
  /** His pick that would have given, but `MAX_GIVING_CARS` cars already give. Listed, greyed. */
  overLimit: boolean;
}

export type PlanProblem =
  /** The accident has nothing negative to cover. */
  | { kind: 'noDeficit' }
  /** Typed more than the accident's negative — the most it may take. */
  | { kind: 'overDeficit'; max: number }
  /** Typed 0: the box is not empty, and there is nothing to take. */
  | { kind: 'zero' }
  /** No car left with anything to give (none has money, or he unticked every one that has). */
  | { kind: 'nothingToTake' };

export interface TransferPlan {
  /** `none`: nothing picked, nothing typed. `whole`: amount empty → the whole negative. `typed`. */
  mode: 'none' | 'whole' | 'typed';
  /** What is wanted: the typed amount, or the accident's whole negative. */
  target: number;
  /** His picks in his order, then the system's in the order drawn. */
  rows: PlanRow[];
  /** What is taken, together (= target, unless the cars are short). */
  amount: number;
  /** What the rows' cars have, together. */
  total: number;
  /** What the rows' cars keep, together (the «الإجمالي» row's «يتبقى عليها»). */
  leftTotal: number;
  /** This accident's remaining before taking, and after. */
  before: number;
  after: number;
  problem: PlanProblem | null;
  /**
   * The cars are short of the target: all they give is taken, `missing` is not covered.
   * `excluded`: a car he unticked still holds money — «all that is available in the SELECTED
   * cars», not «in the cars». `limited`: `MAX_GIVING_CARS` cars already give and another car
   * still holds money — the stop is the limit's, not the cars'.
   */
  short: { available: number; missing: number; excluded: boolean; limited: boolean } | null;
  /** His cars and the system's, by id, in row order. */
  manualIds: string[];
  autoIds: string[];
  /** Offer «تغطية السالب كله تلقائياً»: the accident owes, and nothing is picked or typed. */
  offerCoverAll: boolean;
}

const egp = (amount: number): number => {
  const value = amount / 100;
  return value === 0 ? 0 : value;
};

/** Codes compare as numbers where they are numbers («98» before «118»). */
const byCode = (a: TakeSource, b: TakeSource): number =>
  a.code.localeCompare(b.code, 'en', { numeric: true });

export const planTransfer = ({
  cars,
  picked,
  typed,
  remaining,
  ownVehicleId = null,
  refused = [],
}: {
  /** The cars and what each can give (its remaining, never below 0). */
  cars: readonly TakeSource[];
  /** The ids he picked, in the order he picked them. */
  picked: readonly string[];
  /**
   * The typed amount; `null` when the box is empty (a typed 0 is refused, not «empty»). A box
   * that holds no number — a lone «.» reads as NaN — is refused as a 0 is, never planned.
   */
  typed: number | null;
  /** This accident's remaining before taking. */
  remaining: number;
  /** The accident's own car — never a source. */
  ownVehicleId?: string | null;
  /** Cars he unticked — the system never adds them for him. */
  refused?: readonly string[];
}): TransferPlan => {
  const usable = cars.filter((car) => car.vehicleId !== ownVehicleId);
  const byId = new Map(usable.map((car) => [car.vehicleId, car]));
  const mine = [...new Set(picked)]
    .filter((id) => byId.has(id))
    .map((id) => byId.get(id) as TakeSource);
  const before = egp(piastres(remaining));
  const deficit = Math.max(0, -piastres(remaining));
  // NaN passes every comparison below unseen (a NaN take, a NaN amount, no refusal): read it as
  // the 0 it is, so it is refused under the field like a typed 0.
  const typedP = typed === null ? null : Number.isNaN(typed) ? 0 : Math.max(0, piastres(typed));
  const nothing = (mode: TransferPlan['mode'], problem: PlanProblem | null): TransferPlan => ({
    mode,
    target: 0,
    rows: [],
    amount: 0,
    total: 0,
    leftTotal: 0,
    before,
    after: before,
    problem,
    short: null,
    manualIds: [],
    autoIds: [],
    offerCoverAll: mode === 'none' && deficit > 0,
  });

  // 1. Nothing picked, nothing typed: no transfer — the section is optional.
  if (typedP === null && mine.length === 0) return nothing('none', null);
  const mode = typedP === null ? 'whole' : 'typed';
  if (deficit === 0) return nothing(mode, { kind: 'noDeficit' });
  // 2. Never more than this accident owes, and never a typed 0.
  if (typedP === 0) return nothing(mode, { kind: 'zero' });
  if (typedP !== null && typedP > deficit) {
    return nothing(mode, { kind: 'overDeficit', max: egp(deficit) });
  }
  const target = typedP ?? deficit;

  // 3. His picks first, in his order, each down to 0 before the next — and no more than
  //    `MAX_GIVING_CARS` of them give: a pick past the limit that would have given gives nothing.
  let giving = 0;
  const rows: PlanRow[] = planTakes(mine, egp(target)).rows.map((row) => {
    const gives = piastres(row.take) > 0;
    if (gives && giving >= MAX_GIVING_CARS) {
      return {
        ...row,
        take: 0,
        left: row.available,
        source: 'manual',
        unneeded: false,
        overLimit: true,
      };
    }
    if (gives) giving += 1;
    return {
      ...row,
      source: 'manual',
      unneeded: !gives && piastres(row.available) > 0,
      overLimit: false,
    };
  });
  let need = target - rows.reduce((sum, row) => sum + piastres(row.take), 0);

  // 4. The system completes: the smallest balance first, each to 0, the last gives only the rest —
  //    while the limit leaves room.
  const mineIds = new Set(mine.map((car) => car.vehicleId));
  const no = new Set(refused);
  const others = usable
    .filter((car) => !mineIds.has(car.vehicleId) && !no.has(car.vehicleId))
    .filter((car) => piastres(car.available) > 0)
    .sort((a, b) => piastres(a.available) - piastres(b.available) || byCode(a, b));
  const added = new Set<string>();
  if (need > 0) {
    for (const row of planTakes(others, egp(need)).rows) {
      if (piastres(row.take) <= 0 || giving >= MAX_GIVING_CARS) break;
      rows.push({ ...row, source: 'auto', unneeded: false, overLimit: false });
      added.add(row.vehicleId);
      giving += 1;
      need -= piastres(row.take);
    }
  }

  // 5. Short even with every car: allowed — what is there is taken, the rest stays on the accident.
  //    Nothing at all to take is no transfer: refused, so a save never sends an empty one.
  const taken = target - need;
  if (taken === 0) return nothing(mode, { kind: 'nothingToTake' });
  // Short because of HIM: a car he unticked (not picked again) still holds money.
  const excluded = usable.some(
    (car) => no.has(car.vehicleId) && !mineIds.has(car.vehicleId) && piastres(car.available) > 0,
  );
  // Short because of the LIMIT: a car that could still give was left out only by it.
  const limited =
    rows.some((row) => row.overLimit) || others.some((car) => !added.has(car.vehicleId));
  return {
    mode,
    target: egp(target),
    rows,
    amount: egp(taken),
    total: egp(rows.reduce((sum, row) => sum + piastres(row.available), 0)),
    leftTotal: egp(rows.reduce((sum, row) => sum + piastres(row.left), 0)),
    before,
    after: egp(piastres(remaining) + taken),
    problem: null,
    short: need > 0 ? { available: egp(taken), missing: egp(need), excluded, limited } : null,
    manualIds: rows.filter((row) => row.source === 'manual').map((row) => row.vehicleId),
    autoIds: rows.filter((row) => row.source === 'auto').map((row) => row.vehicleId),
    offerCoverAll: false,
  };
};

/**
 * What a change of the ticked list means — the open list shows his cars in his order, then the
 * system's. A car he unticks, his own or the system's, is his «no»: never added for him again
 * until he ticks it himself. A car he ticks is his own pick, after the ones he already has.
 * («مسح الكل» and the ✕ are not this: they start the section over, the amount with it.)
 */
export const repick = ({
  ticked,
  mine,
  refused,
  next,
}: {
  /** What the list showed ticked: his picks, then the system's. */
  ticked: readonly string[];
  /** His picks, in his order. */
  mine: readonly string[];
  /** The cars he has unticked so far. */
  refused: readonly string[];
  /** What the list holds ticked now. */
  next: readonly string[];
}): { picked: string[]; refused: string[] } => {
  const was = new Set(ticked);
  const unticked = ticked.filter((id) => !next.includes(id));
  const added = next.filter((id) => !was.has(id));
  return {
    picked: [...mine.filter((id) => next.includes(id)), ...added],
    refused: [...new Set([...refused.filter((id) => !added.includes(id)), ...unticked])],
  };
};

/**
 * The body's `transfer` for a plan that takes something: the rows that give, in row order, and
 * the amount they give together — exactly what the server will draw. `undefined` otherwise.
 */
export const transferBody = (
  plan: TransferPlan,
): { fromVehicleIds: string[]; amount: number } | undefined => {
  // `!(x > 0)`, not `x <= 0`: a NaN amount is refused too, never sent as an empty transfer.
  if (plan.mode === 'none' || plan.problem !== null || !(plan.amount > 0)) return undefined;
  const giving = plan.rows.filter((row) => piastres(row.take) > 0);
  const amount = egp(giving.reduce((sum, row) => sum + piastres(row.take), 0));
  // The contract's own floor (`fromVehicleIds.min(1)`, `amount.positive()`): no car giving, or
  // nothing given, is no transfer the server could take.
  if (giving.length === 0 || !(amount > 0)) return undefined;
  return { fromVehicleIds: giving.map((row) => row.vehicleId), amount };
};
