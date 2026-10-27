// «عقود توريد السيارات» — vehicle supply contracts (Fleet).
//
// A contract names the makes and how many cars of each the supplier owes, and by when
// («آخر موعد للتوريد»); deliveries («الاستلامات») record the cars that arrived. Nothing derived is
// stored: received, remaining, totals and the supply alarm are computed when read.
//
// Only what the owner requires is required: a contract's date and at least one line; a line's
// make and a count of 1 or more. Name, supplier, deadline and unit price are optional
// («ومش عاوز اى داتا اجبارى»).
//
// DAYS. Every `date` and `deadline` in a DTO is a calendar day, `YYYY-MM-DD`; only `createdAt`,
// `updatedAt` and `addedAt` are full ISO strings. Every name here starts with `FleetVehicleContract`
// or `FleetSupply`, so nothing collides with HR's `hr-contract.ts`.
import { z } from 'zod';
import { type LocalizedString } from '../common/localized.js';
import { PaginationQuerySchema, listQuery, objectId } from '../common/index.js';
import { fleetSortQuery } from './fleet.js';

/** Money in EGP. */
const egp = () => z.number().nonnegative();
/** To the piastre. */
const atMostTwoDecimals = (value: number): boolean =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
/** The same id however its hex is spelled — `objectId()` takes both cases. */
const distinctIds = (ids: readonly string[]): boolean =>
  new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

// ── Constants ───────────────────────────────────────────────────────────────

/** The platform file category the contract's pages («مرفقات العقد») are stored under. */
export const FLEET_VEHICLE_CONTRACT_FILE_CATEGORY = 'fleet-vehicle-contracts';
export const FLEET_VEHICLE_CONTRACT_FILE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
/** Per file, in MB — as every fleet category. */
export const FLEET_VEHICLE_CONTRACT_FILE_MAX_MB = 10;
/** The most cars one line may contract, and one delivery may receive on a line. */
export const FLEET_VEHICLE_CONTRACT_MAX_COUNT = 10_000;
/** The most lines a contract may hold. */
export const FLEET_VEHICLE_CONTRACT_MAX_LINES = 100;
/**
 * The dearest unit price accepted, in EGP. Bounded so a whole contract — 100 lines of 10,000 cars
 * at this price — still sums exactly in piastres (under `Number.MAX_SAFE_INTEGER`).
 */
export const FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX = 50_000_000;

/** «إنذار التوريد»: yellow from 30 days before the deadline, red from 7 (and once overdue). */
export const FLEET_SUPPLY_ALARM_YELLOW_DAYS = 30;
export const FLEET_SUPPLY_ALARM_RED_DAYS = 7;
export const FLEET_SUPPLY_ALARM_LEVELS = ['red', 'yellow'] as const;
export const FleetSupplyAlarmLevelSchema = z.enum(FLEET_SUPPLY_ALARM_LEVELS);
export type FleetSupplyAlarmLevel = z.infer<typeof FleetSupplyAlarmLevelSchema>;

// ── Inputs ──────────────────────────────────────────────────────────────────

/** One line: a make («الماركة», a `fleet_vehicle_types` id), a count, and an optional unit price. */
export const FleetVehicleContractLineInputSchema = z
  .object({
    /** The saved line an edit keeps; `null` (or absent) for a new line. */
    id: objectId().nullable().default(null),
    typeId: objectId(),
    count: z.number().int().min(1).max(FLEET_VEHICLE_CONTRACT_MAX_COUNT),
    /** Excluding VAT; `null` (or absent) when not given — it then counts as 0 in the totals. */
    unitPrice: egp()
      .max(FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX)
      .refine(atMostTwoDecimals, { message: 'At most two decimal places' })
      .nullable()
      .default(null),
  })
  .strict();
export type FleetVehicleContractLineInput = z.infer<typeof FleetVehicleContractLineInputSchema>;

const contractBody = {
  /** '' when not given — the screens then say «عقد رقم N». */
  name: z.string().trim().max(200).default(''),
  date: z.coerce.date(),
  /** «آخر موعد للتوريد»; `null` (or absent) when none — such a contract never raises the alarm. */
  deadline: z.coerce.date().nullable().default(null),
  supplier: z.string().trim().max(200).default(''),
  lines: z.array(FleetVehicleContractLineInputSchema).min(1).max(FLEET_VEHICLE_CONTRACT_MAX_LINES),
};
const distinctLineIds = (body: { lines: { id: string | null }[] }): boolean =>
  distinctIds(body.lines.flatMap((line) => (line.id === null ? [] : [line.id])));

export const CreateFleetVehicleContractSchema = z
  .object(contractBody)
  .strict()
  .refine((body) => body.lines.every((line) => line.id === null), {
    path: ['lines'],
    message: 'a new contract has no saved lines',
  });
export type CreateFleetVehicleContract = z.infer<typeof CreateFleetVehicleContractSchema>;

/** The whole contract again, with its version; a saved line left out is removed. */
export const UpdateFleetVehicleContractSchema = z
  .object({ ...contractBody, version: z.number().int().min(0) })
  .strict()
  .refine(distinctLineIds, { path: ['lines'], message: 'a line is named twice' });
export type UpdateFleetVehicleContract = z.infer<typeof UpdateFleetVehicleContractSchema>;

const DeliveryCountSchema = z
  .object({
    lineId: objectId(),
    count: z.number().int().min(0).max(FLEET_VEHICLE_CONTRACT_MAX_COUNT),
  })
  .strict();
/**
 * «تسجيل استلام» (add or edit): the day, and the cars received on each line — at least one car in
 * all, each line once. `version` is the CONTRACT's.
 */
export const SaveFleetVehicleContractDeliverySchema = z
  .object({
    date: z.coerce.date(),
    counts: z.array(DeliveryCountSchema).min(1).max(FLEET_VEHICLE_CONTRACT_MAX_LINES),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((body) => body.counts.some((entry) => entry.count > 0), {
    path: ['counts'],
    message: 'nothing received',
  })
  .refine((body) => distinctIds(body.counts.map((entry) => entry.lineId)), {
    path: ['counts'],
    message: 'a line is named twice',
  });
export type SaveFleetVehicleContractDelivery = z.infer<
  typeof SaveFleetVehicleContractDeliverySchema
>;

/** The attachments' new order — every live attachment, each once. */
export const OrderFleetVehicleContractFilesSchema = z
  .object({ fileIds: z.array(objectId()).min(1).max(200) })
  .strict()
  .refine((body) => distinctIds(body.fileIds), {
    path: ['fileIds'],
    message: 'a file is named twice',
  });
export type OrderFleetVehicleContractFiles = z.infer<typeof OrderFleetVehicleContractFilesSchema>;

const filters = {
  /** The contract's date, both days included. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Exact supplier names. `listQuery` splits on the ASCII comma, so a name holding one cannot be
   * named through this filter (the Arabic «،» is unaffected).
   */
  suppliers: listQuery(z.string().trim().min(1).max(200)),
  /** «الماركة» — contracts with a line of any of these makes. */
  typeIds: listQuery(objectId()),
  /** «إنذار التوريد» — contracts whose alarm is at any of these levels. */
  alarm: listQuery(FleetSupplyAlarmLevelSchema),
};
export const ListFleetVehicleContractsQuerySchema = PaginationQuerySchema.extend({
  ...filters,
  /** `date`, `no`, `supplier`, `deadline`, `total`, `receivedShare`, `remaining`, `alarmRank`. */
  sort: fleetSortQuery(),
}).strict();
export type ListFleetVehicleContractsQuery = z.infer<typeof ListFleetVehicleContractsQuerySchema>;
export const FleetVehicleContractSummaryQuerySchema = z.object(filters).strict();
export type FleetVehicleContractSummaryQuery = z.infer<
  typeof FleetVehicleContractSummaryQuerySchema
>;

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface FleetVehicleContractLineDto {
  id: string;
  typeId: string;
  /** The make's name — still shown when the make was deactivated or deleted; `null` if unknown. */
  typeName: LocalizedString | null;
  count: number;
  unitPrice: number | null;
  /** `count × unitPrice` to the piastre (`fleetContractLineTotal`); `null` without a price. */
  total: number | null;
  /** From the live deliveries. */
  received: number;
  remaining: number;
}

export interface FleetVehicleContractDeliveryDto {
  id: string;
  /** 1-based among the live deliveries, by date then `createdAt` — «الاستلام الأول». */
  no: number;
  date: string;
  /** The lines this delivery received on — counts above 0 only. */
  counts: { lineId: string; count: number }[];
  /** Cars in this delivery. */
  total: number;
  /** Cars received up to and including it, and still owed after it — over the whole contract. */
  receivedAfter: number;
  remainingAfter: number;
  createdAt: string;
  updatedAt: string;
}

export interface FleetVehicleContractFileDto {
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  kind: 'image' | 'pdf';
  addedAt: string;
}

/** «إنذار التوريد» — cars still owed with the deadline 30 days away or nearer. */
export interface FleetSupplyAlarmDto {
  level: FleetSupplyAlarmLevel;
  /**
   * Days from the server's today to the deadline: 0 today, < 0 overdue. The screens show it and
   * never recompute it, so the list, its `alarm` filter and the strip always agree.
   */
  days: number;
  /** Cars still owed. */
  left: number;
  /** The lines still owed, each with what is left on it. */
  lines: { lineId: string; left: number }[];
}

export interface FleetVehicleContractDto {
  id: string;
  /** The system's sequence — «عقد رقم N»; never reused. */
  no: number;
  name: string;
  date: string;
  deadline: string | null;
  supplier: string;
  lines: FleetVehicleContractLineDto[];
  /** The live deliveries, in `no` order. */
  deliveries: FleetVehicleContractDeliveryDto[];
  /** The live attachments, in their order. */
  files: FleetVehicleContractFileDto[];
  /** Cars: Σ line counts, Σ received, and what is still owed. */
  contracted: number;
  received: number;
  remaining: number;
  /** Money: Σ line totals, a line without a price counting 0. Excluding VAT. */
  total: number;
  /** `null` when nothing is owed, there is no deadline, or it is more than 30 days away. */
  alarm: FleetSupplyAlarmDto | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The list's figures over the filtered contracts. */
export interface FleetVehicleContractTotalsDto {
  count: number;
  /** Σ contract totals, EGP. */
  value: number;
  /** Cars. */
  contracted: number;
  received: number;
}

// ── Pure helpers (the API and the screens share them) ───────────────────────

/**
 * The alarm's level for a contract `days` from its deadline (`null`: no deadline) with `left` cars
 * still owed: none once nothing is owed, without a deadline, or more than 30 days away; red at 7
 * days or fewer (overdue included); yellow otherwise.
 */
export const fleetSupplyAlarmLevel = (
  days: number | null,
  left: number,
): FleetSupplyAlarmLevel | null => {
  if (left <= 0 || days === null || days > FLEET_SUPPLY_ALARM_YELLOW_DAYS) return null;
  return days <= FLEET_SUPPLY_ALARM_RED_DAYS ? 'red' : 'yellow';
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcDayOf = (ymd: string): number | null => {
  const match = YMD.exec(ymd.slice(0, 10));
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  return back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
    ? at
    : null;
};
/**
 * Calendar days from one `YYYY-MM-DD` day to another — negative when `toYmd` comes first. A full
 * ISO string counts by its first ten characters. `null` when either is not a real day.
 */
export const fleetDaysBetween = (fromYmd: string, toYmd: string): number | null => {
  const from = utcDayOf(fromYmd);
  const to = utcDayOf(toYmd);
  return from === null || to === null ? null : Math.round((to - from) / 86_400_000);
};

/** A line's total, `count × unitPrice`, computed in piastres; `null` without a price. */
export const fleetContractLineTotal = (count: number, unitPrice: number | null): number | null =>
  unitPrice === null ? null : (Math.round(unitPrice * 100) * count) / 100;
