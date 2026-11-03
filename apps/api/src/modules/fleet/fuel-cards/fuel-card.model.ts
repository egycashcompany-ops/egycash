// A fuel card (الفيز) — one company's card on one car, and the balance it holds.
//
// The balance is STORED here and every change to it is a movement in `fleet_fuel_card_movements`:
// a charge the clerk approved, a transfer from or to another card, a fuel receipt, a company
// sheet's figure taken (✓) — and a sheet's figure refused (✗), or a card moved car by a sheet
// decision (`sheetLink`), lines that move nothing; and «تصحيح أرقام الكروت» (6d, `dataFix`). The two
// are written in one transaction, so the balance and its log cannot disagree.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_MOVEMENT_KINDS,
  FLEET_FUEL_MOVEMENT_REPAIR_KINDS,
  FLEET_FUEL_NUMBER_REPAIR_UNITS,
  type FleetFuelCardCompany,
  type FleetFuelMovementKind,
  type FleetFuelMovementRepairKind,
  type FleetFuelNumberRepairUnit,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/**
 * The photo's small blurred thumbnail (6d) — its own Files entity (`fuelCardThumb`), readable with
 * the cards' view grant, while the photo itself shows the PIN sticker and needs the reveal grant.
 * ABSENT on the go-live photos: theirs ship beside the asset (`fuel-card-thumbs.ts`).
 */
export interface FleetFuelCardImageThumb {
  fileId: Types.ObjectId;
  mime: string;
  size: number;
}

/** The photo of the card — Files owns the bytes, the card owns the link. */
export interface FleetFuelCardImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
  thumb?: FleetFuelCardImageThumb | null;
}

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
  image?: FleetFuelCardImage | null;
}

const imageThumbSchema = new Schema<FleetFuelCardImageThumb>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false },
);

const imageSchema = new Schema<FleetFuelCardImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
    // NO default: absent on every photo written before 6d, and on the go-live photos.
    thumb: { type: imageThumbSchema, required: false },
  },
  { _id: false },
);

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
    image: { type: imageSchema, default: null },
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

/**
 * The company sheet behind a `sheetAdjust` (✓) or `sheetReject` (✗) line — «مطابقة أرصدة الكروت»:
 * the session it was decided in, the file, and the two balances it stood between.
 */
export interface FleetFuelMovementReconciliation {
  reconciliationId: Types.ObjectId;
  fileName: string;
  sheetBalance: number;
  /** The card's balance when the decision was made. */
  systemBalance: number;
  /** The Excel row the sheet's figure came from. */
  sheetRow: number | null;
  /** The charges this ✓ cancelled («وأُلغي شحن …»); ABSENT on a line that cancelled none. */
  cancelled?: { movementId: Types.ObjectId; amount: number }[];
}

/**
 * «أُلغي بشيت الشركة» — a `charge` the company's sheet does not show, cancelled by a ✓ on it. The
 * line stays in the card's log; it no longer colours the row, counts in «شحن اليوم», or may be
 * changed or removed.
 */
export interface FleetFuelMovementCancelledBySheet {
  reconciliationId: Types.ObjectId;
  /** The `sheetAdjust` line that cancelled it. */
  movementId: Types.ObjectId;
  fileName: string;
  at: Date;
  by: Types.ObjectId | null;
}

/** A place a card can be: on a car, or on none under a label. */
export interface FleetFuelMovementPlace {
  vehicleId: Types.ObjectId | null;
  vehicleCode: string | null;
  label: string | null;
}

/** A `sheetLink` line's move — «نُقل من … إلى … — شيت الشركة». */
export interface FleetFuelMovementLink {
  from: FleetFuelMovementPlace;
  to: FleetFuelMovementPlace;
  sheetCode: string | null;
  reconciliationId: Types.ObjectId;
  fileName: string;
}

/**
 * A `dataFix` line's correction — «تصحيح أرقام الكروت» (6d). Full numbers (the card holds them in
 * the clear too); never a PIN — `pinMoved` only says whether one came with the number.
 */
export interface FleetFuelMovementRepair {
  /** The repair («6d:2026-10-04») — what makes the unit read «done». */
  key: string;
  unit: FleetFuelNumberRepairUnit;
  kind: FleetFuelMovementRepairKind;
  numberBefore: string | null;
  numberAfter: string | null;
  pinMoved: boolean | null;
  photoMoved: boolean | null;
  expiryBefore: Date | null;
  expiryAfter: Date | null;
  nameBefore: string | null;
  nameAfter: string | null;
  openingBefore: number | null;
  openingAfter: number | null;
}

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
  /** Only on the two sheet kinds; ABSENT on every other line (and on every line before them). */
  reconciliation?: FleetFuelMovementReconciliation | null;
  /** Only on a `charge` a sheet cancelled; ABSENT on every other line. */
  cancelledBySheet?: FleetFuelMovementCancelledBySheet | null;
  /** Only on a `sheetLink` line; ABSENT on every other line. */
  link?: FleetFuelMovementLink | null;
  /** Only on a `dataFix` line; ABSENT on every other line. */
  repair?: FleetFuelMovementRepair | null;
}

const movementReconciliationSchema = new Schema<FleetFuelMovementReconciliation>(
  {
    reconciliationId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, default: '' },
    sheetBalance: { type: Number, required: true },
    systemBalance: { type: Number, required: true },
    sheetRow: { type: Number, default: null },
    // NO default: absent on a line that cancelled nothing.
    cancelled: {
      type: [
        new Schema(
          {
            movementId: { type: Schema.Types.ObjectId, required: true },
            amount: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
  },
  { _id: false },
);

const movementCancelledSchema = new Schema<FleetFuelMovementCancelledBySheet>(
  {
    reconciliationId: { type: Schema.Types.ObjectId, required: true },
    movementId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, default: '' },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const movementPlaceSchema = new Schema<FleetFuelMovementPlace>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    label: { type: String, default: null },
  },
  { _id: false },
);

const movementLinkSchema = new Schema<FleetFuelMovementLink>(
  {
    from: { type: movementPlaceSchema, required: true },
    to: { type: movementPlaceSchema, required: true },
    sheetCode: { type: String, default: null },
    reconciliationId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, default: '' },
  },
  { _id: false },
);

const movementRepairSchema = new Schema<FleetFuelMovementRepair>(
  {
    key: { type: String, required: true },
    unit: { type: String, enum: FLEET_FUEL_NUMBER_REPAIR_UNITS, required: true },
    kind: { type: String, enum: FLEET_FUEL_MOVEMENT_REPAIR_KINDS, required: true },
    numberBefore: { type: String, default: null },
    numberAfter: { type: String, default: null },
    pinMoved: { type: Boolean, default: null },
    photoMoved: { type: Boolean, default: null },
    expiryBefore: { type: Date, default: null },
    expiryAfter: { type: Date, default: null },
    nameBefore: { type: String, default: null },
    nameAfter: { type: String, default: null },
    openingBefore: { type: Number, default: null },
    openingAfter: { type: Number, default: null },
  },
  { _id: false },
);

const movementSchema = new Schema<FleetFuelCardMovementDoc>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: FLEET_FUEL_MOVEMENT_KINDS, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    counterpartCardId: { type: Schema.Types.ObjectId, default: null },
    receiptId: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, required: true },
    // NO default: a line written without it — every line before the sheet kinds, and every other
    // kind since — stays without the field; read as `null`. Nothing is backfilled.
    reconciliation: { type: movementReconciliationSchema, required: false },
    // NO default either: only a charge a sheet cancelled carries it (`{ cancelledBySheet: null }`
    // matches every other line, absent included), only a `sheetLink` line a link.
    cancelledBySheet: { type: movementCancelledSchema, required: false },
    link: { type: movementLinkSchema, required: false },
    // NO default either: only a `dataFix` line carries it.
    repair: { type: movementRepairSchema, required: false },
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
