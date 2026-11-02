// «تصحيح أرقام الكروت» (6d) — the reads. Every card is found as «the live Wataniya card on car X»
// (`ux_fuel_card_vehicle_company` makes it one) — never by name, never by last four — and turned into
// the planner's PIN-free shape at once. The raw documents (their PIN included, as stored) leave this
// file only for execute's in-memory donor map, inside its transaction.
import { type Types, type ClientSession } from 'mongoose';
import { FleetVehicleModel } from '../../vehicles/vehicle.model';
import { fleetVehicleRepository } from '../../vehicles/vehicle.repository';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
  type FleetFuelCardMovementDoc,
} from '../fuel-card.model';
import {
  FUEL_NUMBER_REPAIR_COMPANY,
  FUEL_NUMBER_REPAIR_KEY,
  REPAIR_CARS,
  REPAIR_PAIR,
  REPAIR_RECORDS,
} from './number-repair-definition';
import { type RepairLine, type RepairLiveCard, type RepairWorld } from './number-repair-plan';

/** Every number the definition names — to tell a card moved off its car from one that is gone. */
const REPAIR_NUMBERS: readonly string[] = [
  ...REPAIR_RECORDS.map((record) => record.before.number),
  ...REPAIR_PAIR.map((record) => record.number),
];

export interface RepairRead {
  world: RepairWorld;
  /** The raw card documents by id — for the donors (execute) and the photos' thumbnails (dry run). */
  docs: ReadonlyMap<string, FleetFuelCardDoc>;
  /** The repair's `dataFix` lines. */
  lineDocs: FleetFuelCardMovementDoc[];
}

const dayOf = (date: Date | null | undefined): string | null =>
  date == null ? null : date.toISOString().slice(0, 10);

/** A card as the planner sees it — whether a PIN is stored, never the PIN. */
export const liveCardOf = (doc: FleetFuelCardDoc, vehicleCode: string | null): RepairLiveCard => ({
  id: String(doc._id),
  company: doc.company,
  vehicleCode,
  label: doc.label ?? null,
  name: doc.name,
  number: doc.number,
  expiresAt: dayOf(doc.expiresAt),
  hasPin: doc.password != null && doc.password !== '',
  image: doc.image == null ? null : { fileName: doc.image.fileName, size: doc.image.size },
  balance: doc.balance,
  version: doc.__v,
});

/**
 * The world of the repair — the cars `cars` (all of the definition's by default), the live Wataniya
 * cards on them or holding one of its numbers, and its `dataFix` lines — read inside `session` when
 * given.
 */
export const readRepairWorld = async (
  session: ClientSession | null = null,
  cars: readonly string[] = REPAIR_CARS,
): Promise<RepairRead> => {
  const vehicles = await FleetVehicleModel.find({ code: { $in: [...cars] }, isDeleted: false })
    .select({ code: 1 })
    .session(session)
    .lean<{ _id: Types.ObjectId; code: string }[]>()
    .exec();
  const codeOf = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle.code]));
  const [cards, lineDocs] = await Promise.all([
    FleetFuelCardModel.find({
      company: FUEL_NUMBER_REPAIR_COMPANY,
      isDeleted: false,
      $or: [
        { vehicleId: { $in: vehicles.map((vehicle) => vehicle._id) } },
        { number: { $in: [...REPAIR_NUMBERS] } },
      ],
    })
      .session(session)
      .lean<FleetFuelCardDoc[]>()
      .exec(),
    FleetFuelCardMovementModel.find({
      kind: 'dataFix',
      'repair.key': FUEL_NUMBER_REPAIR_KEY,
      isDeleted: false,
    })
      .sort({ at: 1, _id: 1 })
      .session(session)
      .lean<FleetFuelCardMovementDoc[]>()
      .exec(),
  ]);
  // The cars a moved card sits on now, by code — for «on another car».
  const elsewhere = cards.flatMap((card) =>
    card.vehicleId != null && !codeOf.has(String(card.vehicleId)) ? [String(card.vehicleId)] : [],
  );
  const otherCodes = await fleetVehicleRepository.codesByIds([...new Set(elsewhere)]);
  const vehicleCodeOf = (card: FleetFuelCardDoc): string | null =>
    card.vehicleId == null
      ? null
      : (codeOf.get(String(card.vehicleId)) ?? otherCodes.get(String(card.vehicleId)) ?? null);

  const byCar = new Map<string, RepairLiveCard>();
  const byNumber = new Map<string, RepairLiveCard>();
  for (const doc of cards) {
    const live = liveCardOf(doc, vehicleCodeOf(doc));
    const onRepairCar = doc.vehicleId != null && codeOf.has(String(doc.vehicleId));
    if (onRepairCar && live.vehicleCode !== null) byCar.set(live.vehicleCode, live);
    if (REPAIR_NUMBERS.includes(doc.number)) byNumber.set(doc.number, live);
  }
  const lines: RepairLine[] = lineDocs.flatMap((doc) =>
    doc.repair == null
      ? []
      : [
          {
            movementId: String(doc._id),
            cardId: String(doc.cardId),
            unit: doc.repair.unit,
            at: doc.at,
            by: doc.createdBy == null ? null : String(doc.createdBy),
          },
        ],
  );
  return {
    world: { byCar, byNumber, lines },
    docs: new Map(cards.map((card) => [String(card._id), card])),
    lineDocs,
  };
};
