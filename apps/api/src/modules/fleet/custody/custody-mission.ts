// «المأمورية» on his fuel memo — what each fuel receipt's car was out doing that day. Suggested
// only: the clerk sees it prefilled in the editor and may type anything; what ends up in the cell
// is saved on the memo's line, never on the receipt.
//
// The first answer wins, from the most specific to the most general:
//   1. the car's row on that day's roster («تعيين السيارات») — its mission type;
//   2. the car's fixed crew («الطاقم الثابت») — its mission type;
//   3. the car's own «التشغيل» on the registry.
// Each is a catalog item; the suggestion is its Arabic name, as his paper writes it.
import { type Types } from 'mongoose';
import { FleetCustodyMemoModel } from './custody-memo.model';
import { fleetDutyAssignmentRepository } from '../roster/duty-assignment.repository';
import { fleetFixedCrewRepository } from '../fixed-roster/fixed-crew.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { dayKey, utcDay } from './custody-memo-rules';

export interface MissionSources {
  /** `<vehicleId>|<YYYY-MM-DD>` → the roster row's mission type id (`null`: a row without one). */
  duty: ReadonlyMap<string, string | null>;
  /** vehicleId → its fixed crew's mission type id. */
  fixed: ReadonlyMap<string, string | null>;
  /** vehicleId → its registry «التشغيل» id. */
  operation: ReadonlyMap<string, string | null>;
  /** catalog id → its Arabic name. */
  names: ReadonlyMap<string, string>;
}

/** The suggestion for one (car, day) — the first source that NAMES something; `null` otherwise. */
export const pickMission = (
  vehicleId: string,
  day: string,
  sources: MissionSources,
): string | null => {
  const named = (id: string | null | undefined): string | null => {
    if (id == null) return null;
    const name = sources.names.get(id)?.trim() ?? '';
    return name === '' ? null : name;
  };
  return (
    named(sources.duty.get(`${vehicleId}|${day}`)) ??
    named(sources.fixed.get(vehicleId)) ??
    named(sources.operation.get(vehicleId)) ??
    null
  );
};

interface MissionRow {
  _id: Types.ObjectId;
  vehicleId: Types.ObjectId;
  date: Date;
  kind: string;
}

/** receipt id → its suggested «المأمورية»; fuel receipts only (the rest are absent). */
export const suggestMissions = async (
  rows: readonly MissionRow[],
): Promise<Map<string, string | null>> => {
  const fuel = rows.filter((row) => row.kind === 'fuel');
  if (fuel.length === 0) return new Map();
  const vehicleIds = [...new Set(fuel.map((row) => String(row.vehicleId)))];
  const days = [...new Map(fuel.map((row) => [dayKey(row.date), utcDay(row.date)])).values()];
  const [duty, crews, operation] = await Promise.all([
    fleetDutyAssignmentRepository.missionTypesFor(vehicleIds, days),
    fleetFixedCrewRepository.findAll(),
    fleetVehicleRepository.operationIdsByIds(vehicleIds),
  ]);
  const wanted = new Set(vehicleIds);
  const fixed = new Map<string, string | null>(
    crews
      .filter((crew) => wanted.has(String(crew.vehicleId)))
      .map((crew) => [
        String(crew.vehicleId),
        crew.missionTypeId == null ? null : String(crew.missionTypeId),
      ]),
  );
  const catalogIds = [
    ...new Set(
      [...duty.values(), ...fixed.values(), ...operation.values()].filter(
        (id): id is string => id != null,
      ),
    ),
  ];
  const names = new Map(
    [...(await fleetCatalogItemRepository.namesByIds(catalogIds))].map(([id, name]) => [
      id,
      name.ar,
    ]),
  );
  const sources: MissionSources = { duty, fixed, operation, names };
  return new Map(
    fuel.map((row) => [
      String(row._id),
      pickMission(String(row.vehicleId), dayKey(row.date), sources),
    ]),
  );
};

/**
 * The «المأمورية» list the editor offers: the active mission types and «التشغيل» names, and every
 * mission already typed on a live fuel memo — his own spellings come back. Distinct, no empties,
 * in Arabic order.
 */
export const missionOptions = async (): Promise<string[]> => {
  const [missionTypes, operations, typed] = await Promise.all([
    fleetCatalogItemRepository.listKind('missionType'),
    fleetCatalogItemRepository.listKind('operation'),
    FleetCustodyMemoModel.distinct('lines.mission', { isDeleted: false, kind: 'fuel' }).exec(),
  ]);
  const names = [
    ...[...missionTypes, ...operations].filter((item) => item.isActive).map((item) => item.name.ar),
    ...(typed as unknown[]).filter((value): value is string => typeof value === 'string'),
  ]
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ar'));
};
