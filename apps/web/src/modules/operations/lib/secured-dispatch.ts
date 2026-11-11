// «صرف الخزينة» — the vault's dispatch board — its client-side decisions as pure functions: which
// delivery day the URL asks for, which rows are late or due today, what may be done to a row, and
// how a release of several rows splits into one call per vehicle.
//
// The owner: «صرف الخزنية … اعملها بقى بشكل الجديد للشاشات اللى احنا عملناها», and on what it lists,
// «كله يبقى موجود فى تاريخ يتفلتر» — every محصنة in the vault, whatever its delivery day, with the day
// as a filter. WHICH rows are on it, and in what order (delivery day ascending, so the late ones
// lead), is the SERVER's (`GET /operations/secured/dispatch-board`); this file only reads them.
import { isYmd, type OperationsSecuredDispatchRowDto } from '@ecms/contracts';

/**
 * The delivery day the URL asks for (`?date=`), or null for EVERY day. Null as well for anything
 * that is not a real calendar day: the endpoint refuses an empty or malformed `date=` (a 400), and
 * "every shipment in the vault" is the screen's own default rather than an error.
 */
export const readDispatchDate = (raw: string | null): string | null =>
  raw !== null && isYmd(raw) ? raw : null;

/** The delivery day of a row, 'YYYY-MM-DD' — null when it has none. */
export const deliveryDayOf = (
  row: Pick<OperationsSecuredDispatchRowDto, 'deliveryDate'>,
): string | null => (row.deliveryDate === null ? null : row.deliveryDate.slice(0, 10));

/**
 * How a row stands against its delivery day:
 *
 *   · `overdue` — its day has passed and it is still in the vault: late leaving it. The SERVER says
 *                 so (`overdue`, judged on the Cairo calendar), and a day before `today` says the
 *                 same — the two agree, and either alone is enough;
 *   · `today`   — it is due out today;
 *   · null      — a later day, or no delivery day at all.
 *
 * `today` is the SERVER's (`OperationsSecuredDispatchBoardDto.today`), not the browser's clock: the
 * same day the server judged `overdue` by and sorted on, so a desk whose clock is off can never
 * mark a row late that the server put among the day's work.
 */
export type DispatchDue = 'overdue' | 'today';

export const dispatchDue = (
  row: Pick<OperationsSecuredDispatchRowDto, 'deliveryDate' | 'overdue'>,
  today: string,
): DispatchDue | null => {
  const day = deliveryDayOf(row);
  if (day === null) return null;
  if (row.overdue || day < today) return 'overdue';
  return day === today ? 'today' : null;
};

/** How many of the rows are late, and how many are due today — the toolbar's two counts. */
export const dispatchDueCounts = (
  rows: readonly Pick<OperationsSecuredDispatchRowDto, 'deliveryDate' | 'overdue'>[],
  today: string,
): Record<DispatchDue, number> => {
  const counts: Record<DispatchDue, number> = { overdue: 0, today: 0 };
  for (const row of rows) {
    const due = dispatchDue(row, today);
    if (due !== null) counts[due] += 1;
  }
  return counts;
};

/**
 * May the delivery crew be assigned (or changed) on this row? Where the server takes it
 * (`POST /operations/secured/:id/assign-delivery`): a shipment IN the vault, with a delivery day —
 * its crew is planned on that day, and one with none is refused
 * (`OPERATIONS_INVALID_SHIPMENT_TRANSITION`).
 */
export const offersDeliveryAssign = (
  row: Pick<OperationsSecuredDispatchRowDto, 'status' | 'deliveryDate'>,
): boolean => row.status === 'inVault' && row.deliveryDate !== null;

/**
 * The `version` an assignment sends: its DELIVERY LEG's, never the shipment's — the leg is what an
 * assignment writes. 0 while the row has no delivery leg yet (a first assignment creates it).
 */
export const deliveryAssignVersion = (
  row: Pick<OperationsSecuredDispatchRowDto, 'deliveryLegVersion'>,
): number => row.deliveryLegVersion ?? 0;

/**
 * The (crew row, captain) the row is assigned to now, as the crew choices key it
 * (`dispatchCrewOptions`: `crewAssignmentId:captainEmployeeId`) — so the assign dialog opens on
 * the crew already there. Empty while it has none.
 */
export const heldCrewKey = (row: Pick<OperationsSecuredDispatchRowDto, 'crew'>): string =>
  row.crew === null ? '' : `${row.crew.crewAssignmentId}:${row.crew.captainEmployeeId}`;

/**
 * May this row go out — be ticked for a release, or released on its own? Where the server takes
 * it (`POST /operations/secured/dispatch`): a shipment IN the vault whose delivery crew is
 * assigned. Without a crew it is refused (`OPERATIONS_DELIVERY_LEG_REQUIRED`): it is assigned
 * first.
 */
export const offersDispatch = (
  row: Pick<OperationsSecuredDispatchRowDto, 'status' | 'crew'>,
): boolean => row.status === 'inVault' && row.crew !== null;

/**
 * The rows a release acts on: those TICKED among the rows SHOWN that may still go out. A tick on a
 * row a filter now hides, or on one that has left the vault since it was ticked, is never sent.
 */
export const tickedForDispatch = <
  T extends Pick<OperationsSecuredDispatchRowDto, 'id' | 'status' | 'crew'>,
>(
  shown: readonly T[],
  selected: ReadonlySet<string>,
): T[] => shown.filter((row) => selected.has(row.id) && offersDispatch(row));

/** One vehicle's load in a release: ONE call, addressed to its crew row. */
export interface DispatchLoad<T> {
  crewAssignmentId: string;
  vehicleCode: string | null;
  /** The captains its legs were assigned to — one, or both of a two-captain vehicle. */
  captainNames: string[];
  rows: T[];
}

/**
 * A release split into one load per crew ROW, in the order the rows came. The endpoint takes ONE
 * crew row and the shipments it carries — every one of them assigned to that row, else 409 — so
 * rows of different vehicles go out in separate calls (legacy `/deliver_mohsana` released one
 * vehicle at a time too). Keyed by the crew ROW and not the captain: the whole vehicle leaves the
 * vault, whichever of its two captains each leg was assigned to. A row with no crew is left out
 * (`offersDispatch`).
 */
export const dispatchLoads = <T extends Pick<OperationsSecuredDispatchRowDto, 'crew'>>(
  rows: readonly T[],
): DispatchLoad<T>[] => {
  const loads = new Map<string, DispatchLoad<T>>();
  for (const row of rows) {
    if (row.crew === null) continue;
    const key = row.crew.crewAssignmentId;
    const load = loads.get(key) ?? {
      crewAssignmentId: key,
      vehicleCode: row.crew.vehicleCode,
      captainNames: [],
      rows: [],
    };
    const captain = row.crew.captainName;
    if (captain !== null && !load.captainNames.includes(captain)) load.captainNames.push(captain);
    load.rows.push(row);
    loads.set(key, load);
  }
  return [...loads.values()];
};
