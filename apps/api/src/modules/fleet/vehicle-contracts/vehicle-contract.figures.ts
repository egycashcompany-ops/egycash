// What a supply contract's numbers are — computed, never stored (vehicle-contract.model.ts).
//
// Pure functions over the stored document, so the rules the screen shows («المستلم», «المتبقي»,
// «إنذار التوريد») and the rules the writes enforce («أكثر من المتبقي», a count below what arrived)
// are one set of functions with one spec. The list's sort and filter spell the same figures as
// aggregation expressions (vehicle-contract.repository.ts); the integration spec holds the two
// together.
//
// MONEY is summed in whole piastres and only then turned back into pounds, so a contract of 33 cars
// at 4,700,000.10 is exact. DAYS are UTC calendar days, as custody's: «اليوم» is the server's UTC
// day (`utcTodayYmd`), and the screens show the DTO's `days` without recomputing it.
import {
  type ApiErrorDetail,
  type FleetSupplyAlarmDto,
  fleetDaysBetween,
  fleetSupplyAlarmLevel,
} from '@ecms/contracts';
import {
  type FleetVehicleContractDeliveryDoc,
  type FleetVehicleContractDoc,
  type FleetVehicleContractLineDoc,
} from './vehicle-contract.model';

const DAY_MS = 86_400_000;

/** The UTC midnight of `value`'s UTC day — how every contract day is stored. */
export const utcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

/** The day after — a «to» filter counts its whole day. */
export const dayAfter = (day: Date): Date => new Date(utcDay(day).getTime() + DAY_MS);

/** `YYYY-MM-DD` — the only way a contract day leaves the API. */
export const dayKey = (value: Date): string => value.toISOString().slice(0, 10);

/** «اليوم» as the server counts it: `now`'s UTC day. */
export const utcTodayYmd = (now: Date): string => dayKey(now);

/** EGP → whole piastres. */
export const toPiastres = (egp: number): number => Math.round(egp * 100);

/** Whole piastres → EGP, never a negative zero. */
export const fromPiastres = (piastres: number): number => {
  const egp = piastres / 100;
  return egp === 0 ? 0 : egp;
};

const idKey = (id: { toString(): string } | string): string => String(id).toLowerCase();

/** The live deliveries, in their order: by day, then by when they were recorded. */
export const liveDeliveries = (
  doc: Pick<FleetVehicleContractDoc, 'deliveries'>,
): FleetVehicleContractDeliveryDoc[] =>
  (doc.deliveries ?? [])
    .filter((delivery) => delivery.isDeleted !== true)
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        idKey(a._id).localeCompare(idKey(b._id)),
    );

/** Cars in one delivery. */
export const deliveryTotal = (delivery: Pick<FleetVehicleContractDeliveryDoc, 'counts'>): number =>
  delivery.counts.reduce((sum, entry) => sum + entry.count, 0);

export interface LineFigures {
  received: number;
  remaining: number;
}

export interface ContractFigures {
  /** Per line id (lower-case hex). */
  perLine: Map<string, LineFigures>;
  /** Cars contracted, received and still owed, over the whole contract. */
  contracted: number;
  received: number;
  remaining: number;
  /** Σ line totals in piastres — a line without a price counts 0. */
  totalPiastres: number;
}

/** Cars received on each line by the live deliveries — optionally leaving one delivery out. */
const receivedByLine = (
  doc: Pick<FleetVehicleContractDoc, 'deliveries'>,
  exceptDeliveryId?: string,
): Map<string, number> => {
  const except = exceptDeliveryId === undefined ? null : idKey(exceptDeliveryId);
  const received = new Map<string, number>();
  for (const delivery of liveDeliveries(doc)) {
    if (except !== null && idKey(delivery._id) === except) continue;
    for (const entry of delivery.counts) {
      const key = idKey(entry.lineId);
      received.set(key, (received.get(key) ?? 0) + entry.count);
    }
  }
  return received;
};

export const figuresOf = (
  doc: Pick<FleetVehicleContractDoc, 'lines' | 'deliveries'>,
): ContractFigures => {
  const received = receivedByLine(doc);
  const perLine = new Map<string, LineFigures>();
  let contracted = 0;
  let receivedAll = 0;
  let totalPiastres = 0;
  for (const line of doc.lines) {
    const got = received.get(idKey(line._id)) ?? 0;
    perLine.set(idKey(line._id), { received: got, remaining: Math.max(0, line.count - got) });
    contracted += line.count;
    receivedAll += got;
    totalPiastres += line.unitPrice == null ? 0 : toPiastres(line.unitPrice) * line.count;
  }
  return {
    perLine,
    contracted,
    received: receivedAll,
    remaining: Math.max(0, contracted - receivedAll),
    totalPiastres,
  };
};

/** One line a delivery would take past what is still owed on it. */
export interface DeliveryOver {
  /** The index in the request's `counts`. */
  index: number;
  lineId: string;
  count: number;
  /** What is still owed on the line, the edited delivery's own cars given back. */
  left: number;
}

/**
 * The lines where `counts` asks for more cars than are still owed. On an edit the delivery's own
 * old counts are given back first, so re-saving a delivery unchanged is never «over».
 */
export const deliveryOver = (
  doc: Pick<FleetVehicleContractDoc, 'lines' | 'deliveries'>,
  counts: readonly { lineId: string; count: number }[],
  exceptDeliveryId?: string,
): DeliveryOver[] => {
  const received = receivedByLine(doc, exceptDeliveryId);
  const lines = new Map(doc.lines.map((line) => [idKey(line._id), line]));
  const over: DeliveryOver[] = [];
  counts.forEach((entry, index) => {
    const line = lines.get(idKey(entry.lineId));
    if (line === undefined) return; // an unknown line is `unknownDeliveryLines`' refusal
    const left = Math.max(0, line.count - (received.get(idKey(entry.lineId)) ?? 0));
    if (entry.count > left)
      over.push({ index, lineId: idKey(entry.lineId), count: entry.count, left });
  });
  return over;
};

/** The request's lines this contract does not hold. */
export const unknownDeliveryLines = (
  doc: Pick<FleetVehicleContractDoc, 'lines'>,
  counts: readonly { lineId: string }[],
): ApiErrorDetail[] => {
  const lines = new Set(doc.lines.map((line) => idKey(line._id)));
  return counts.flatMap((entry, index) =>
    lines.has(idKey(entry.lineId))
      ? []
      : [
          {
            field: `counts.${index}.lineId`,
            code: 'UNKNOWN_LINE',
            message: 'this contract has no such line',
          },
        ],
  );
};

/**
 * What an edit of the lines may not do, each as a 422 detail: name a line this contract does not
 * hold, lower a line below the cars already received on it, or drop a line cars arrived on.
 */
export const lineEditRefusal = (
  before: Pick<FleetVehicleContractDoc, 'lines' | 'deliveries'>,
  nextLines: readonly { id: string | null; count: number }[],
): ApiErrorDetail[] => {
  const { perLine } = figuresOf(before);
  const known = new Map<string, FleetVehicleContractLineDoc>(
    before.lines.map((line) => [idKey(line._id), line]),
  );
  const details: ApiErrorDetail[] = [];
  const kept = new Set<string>();
  nextLines.forEach((line, index) => {
    if (line.id === null) return;
    const key = idKey(line.id);
    if (!known.has(key)) {
      details.push({
        field: `lines.${index}.id`,
        code: 'UNKNOWN_LINE',
        message: 'this contract has no such line',
      });
      return;
    }
    kept.add(key);
    const received = perLine.get(key)?.received ?? 0;
    if (line.count < received) {
      details.push({
        field: `lines.${index}.count`,
        code: 'BELOW_RECEIVED',
        message: `${received} cars were already received on this line`,
      });
    }
  });
  for (const line of before.lines) {
    const key = idKey(line._id);
    if (kept.has(key)) continue;
    const received = perLine.get(key)?.received ?? 0;
    if (received > 0) {
      details.push({
        field: 'lines',
        code: 'LINE_RECEIVED',
        message: `line ${key} cannot be removed: ${received} cars were received on it`,
      });
    }
  }
  return details;
};

/** «إنذار التوريد» on `todayYmd` (the server's UTC day), or `null`. */
export const alarmOf = (
  doc: Pick<FleetVehicleContractDoc, 'lines' | 'deliveries' | 'deadline'>,
  todayYmd: string,
  figures: ContractFigures = figuresOf(doc),
): FleetSupplyAlarmDto | null => {
  const days = doc.deadline == null ? null : fleetDaysBetween(todayYmd, dayKey(doc.deadline));
  const level = fleetSupplyAlarmLevel(days, figures.remaining);
  if (level === null || days === null) return null;
  return {
    level,
    days,
    left: figures.remaining,
    lines: doc.lines.flatMap((line) => {
      const left = figures.perLine.get(idKey(line._id))?.remaining ?? 0;
      return left > 0 ? [{ lineId: idKey(line._id), left }] : [];
    }),
  };
};
