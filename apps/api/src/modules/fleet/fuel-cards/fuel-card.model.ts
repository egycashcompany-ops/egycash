// A fuel card (الفيز) — one company's card on one car, and the balance it holds.
//
// The balance is STORED here and every change to it is a movement in `fleet_fuel_card_movements`:
// a charge the clerk approved, a transfer from or to another card, a fuel receipt. The two are
// written in one transaction, so the balance and its log cannot disagree.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_MOVEMENT_KINDS,
  type FleetFuelCardCompany,
  type FleetFuelMovementKind,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetFuelCardDoc extends BaseDocFields {
  /** `null` — a card on no car («سفر 1», «اسبير»), named by `label`. */
  vehicleId: Types.ObjectId | null;
  label?: string | null;
  company: FleetFuelCardCompany;
  name: string;
  number: string;
  /** `null` until it is known. */
  expiresAt: Date | null;
  password: string | null;
  balance: number;
  requestedAmount: number | null;
  requestedAt: Date | null;
  lastChargedAt: Date | null;
}

const fuelCardSchema = new Schema<FleetFuelCardDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    label: { type: String, default: null, trim: true },
    company: { type: String, enum: FLEET_FUEL_CARD_COMPANIES, required: true },
    name: { type: String, required: true, trim: true },
    number: { type: String, required: true, trim: true },
    expiresAt: { type: Date, default: null },
    password: { type: String, default: null },
    balance: { type: Number, required: true, default: 0 },
    requestedAmount: { type: Number, default: null, min: 0 },
    requestedAt: { type: Date, default: null },
    lastChargedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A card number is one card. Partial so a deleted card frees its number.
fuelCardSchema.index(
  { number: 1 },
  { unique: true, name: 'ux_fuel_card_number', partialFilterExpression: { isDeleted: false } },
);
// ONE card per company per car — «العربيه عليها رقم كارتين واحد شيل اوت و وواحد وطنيه».
fuelCardSchema.index(
  { vehicleId: 1, company: 1 },
  {
    unique: true,
    name: 'ux_fuel_card_vehicle_company',
    // One card per company per CAR — the cards on no car (six travel cards of one company) are
    // outside it.
    partialFilterExpression: { isDeleted: false, vehicleId: { $type: 'objectId' } },
  },
);
fuelCardSchema.index({ expiresAt: 1 }, { name: 'ix_fuel_card_expires' });

export const FleetFuelCardModel = model<FleetFuelCardDoc>(
  'FleetFuelCard',
  fuelCardSchema,
  'fleet_fuel_cards',
);

export interface FleetFuelCardMovementDoc extends BaseDocFields {
  cardId: Types.ObjectId;
  kind: FleetFuelMovementKind;
  /** Signed — what the balance moved by. */
  amount: number;
  balanceAfter: number;
  counterpartCardId: Types.ObjectId | null;
  /** The receipt that took this, when `kind` is `receipt`. */
  receiptId: Types.ObjectId | null;
  at: Date;
}

const movementSchema = new Schema<FleetFuelCardMovementDoc>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: FLEET_FUEL_MOVEMENT_KINDS, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    counterpartCardId: { type: Schema.Types.ObjectId, default: null },
    receiptId: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);
movementSchema.index({ cardId: 1, at: -1 }, { name: 'ix_fuel_movement_card_at' });
movementSchema.index({ kind: 1, at: -1 }, { name: 'ix_fuel_movement_kind_at' });

export const FleetFuelCardMovementModel = model<FleetFuelCardMovementDoc>(
  'FleetFuelCardMovement',
  movementSchema,
  'fleet_fuel_card_movements',
);
