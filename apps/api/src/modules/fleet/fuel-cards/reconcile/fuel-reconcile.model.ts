// «مطابقة أرصدة الكروت» — one reading of a company's balance sheet against the cards.
//
// A session is written when a sheet is read, and NOTHING else is written then: no card, no
// movement. It keeps what a later ✓ / ✗ needs to be decided from the server's own record and
// never from the request body — each differing card's sheet balance and the balance the card held
// when the sheet was read (`readAt`). Only those differing matches are kept as `lines`: they are
// the only rows a decision may name. Everything else the screen showed (equal, sheet-only,
// system-only, repeated and conflicting rows) is counted, not stored.
//
// Soft only: `isDeleted` is never set and there is no delete route — a session is the record of
// what a decision was made against. A line's decision is written once (`decision: null` → set).
//
// Batch 3 adds, each OPTIONAL and without a default (a session read before it simply lacks them,
// and reads as none): the sheet's car code on a line, the charges a line may cancel («شحن لا يظهر
// في الشيت», stored at the read so a decision never trusts the body about them), «تاريخ الشيت»,
// the cards the sheet showed equal (a judgement the next sheet's candidates start after), and
// «ربط الكروت بالسيارات» — the links the sheet proposes and the sheet-only cards «إضافة» may
// create. No PIN is ever stored here: the sheet's «pass» column is never read.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_LINK_KINDS,
  FLEET_FUEL_LINK_RESOLVERS,
  FLEET_FUEL_RECONCILE_DECISIONS,
  FLEET_FUEL_SHEET_NUMBER_KINDS,
  type FleetFuelCardCompany,
  type FleetFuelLinkKind,
  type FleetFuelLinkResolver,
  type FleetFuelReconcileDecision,
  type FleetFuelSheetNumberKind,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

/** A live charge the sheet does not show, as it stood at the read — a candidate to cancel. */
export interface FleetFuelReconcileCharge {
  movementId: Types.ObjectId;
  amount: number;
  at: Date;
}

/** One differing card: the sheet's figure, the card's figure at `readAt`, and its decision. */
export interface FleetFuelReconcileLine {
  cardId: Types.ObjectId;
  /** The card's name as matched — the sheet's, or rebuilt from the prefix, plate and chassis. */
  name: string;
  /** The Excel row the figure came from. */
  sheetRow: number;
  /** The number as the sheet prints it (masked). */
  sheetNumber: string;
  sheetBalance: number;
  /** The card's balance when the sheet was read. */
  systemBalance: number;
  numberMatches: boolean;
  /** The sheet's car code, as printed; absent on a session read before it. */
  sheetCode?: string | null;
  /** The charges the sheet does not show (difference < 0), newest first; absent before 6a. */
  charges?: FleetFuelReconcileCharge[];
  /**
   * A card of the 0849 pair read before «تصحيح أرقام الكروت» (6d) ran: matched by a name that sits on
   * the other car's record, so its ✓ is refused for good; absent on a session read before 6d.
   */
  inRepair?: boolean;
  decision: FleetFuelReconcileDecision | null;
  decidedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  /** The `sheetAdjust` / `sheetReject` line the decision wrote (or the `charge`, on a request approved). */
  movementId: Types.ObjectId | null;
}

/** «ربط الكروت بالسيارات» — one matched card whose place the sheet says otherwise. */
export interface FleetFuelReconcileLink {
  cardId: Types.ObjectId;
  sheetRow: number;
  sheetCode: string | null;
  kind: FleetFuelLinkKind;
  /** Where the card was at the read — a decision is refused once it is elsewhere. */
  fromVehicleId: Types.ObjectId | null;
  fromLabel: string | null;
  /** Where the sheet puts it; both `null` for an unknown code. */
  toVehicleId: Types.ObjectId | null;
  toLabel: string | null;
  resolvedBy: FleetFuelLinkResolver | null;
  /** The other card of a swap or a chain. */
  pairWith: Types.ObjectId | null;
  /** Held back until the card-number repair. */
  inRepair: boolean;
  decision: FleetFuelReconcileDecision | null;
  decidedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  /** The `sheetLink` line a ✓ wrote. */
  movementId: Types.ObjectId | null;
}

/** «كروت في الشيت وليست في النظام» — a sheet-only row «إضافة» may make a card of. No PIN. */
export interface FleetFuelReconcileNewCard {
  sheetRow: number;
  name: string;
  /** As the sheet prints it. */
  number: string;
  numberKind: FleetFuelSheetNumberKind;
  numberIsFull: boolean;
  balance: number;
  sheetCode: string | null;
  toVehicleId: Types.ObjectId | null;
  toLabel: string | null;
  /** The card «إضافة» created; `null` until then. */
  cardId: Types.ObjectId | null;
  decidedAt: Date | null;
  decidedBy: Types.ObjectId | null;
}

export interface FleetFuelReconcileCounts {
  equal: number;
  sheetOnly: number;
  systemOnly: number;
  duplicates: number;
  conflicts: number;
  numbersDiffer: number;
  /** Rows that are not cards (titles, totals). */
  skipped: number;
  /** Matched cards whose car the sheet's code names otherwise. */
  placesDiffer: number;
}

export interface FleetFuelReconciliationDoc extends BaseDocFields {
  /** The company the sheet was read for (chosen on the screen). */
  company: FleetFuelCardCompany;
  fileName: string;
  fileSha256: string;
  /** Set BEFORE the cards are read — a card that moved after it is refused on ✓. */
  readAt: Date;
  /** The sheet's data rows. */
  rowsRead: number;
  /** The company whose name prefix every row carries; `null` when they disagree. */
  sheetCompany: FleetFuelCardCompany | null;
  /** «تاريخ الشيت» as given at upload (UTC midnight); absent on a session read before it. */
  sheetDate?: Date | null;
  lines: FleetFuelReconcileLine[];
  /**
   * The cards the sheet showed EQUAL to the system at `readAt` — a judgement on them as much as a
   * decided line is: their charges up to the read are on the company's books, and no later sheet
   * offers one as «شحن لا يظهر في الشيت». Absent on a session read before it (read as none).
   */
  equalCardIds?: Types.ObjectId[];
  /** Absent on a session read before 6b. */
  links?: FleetFuelReconcileLink[];
  newCards?: FleetFuelReconcileNewCard[];
  counts: FleetFuelReconcileCounts;
}

const chargeSchema = new Schema<FleetFuelReconcileCharge>(
  {
    movementId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const lineSchema = new Schema<FleetFuelReconcileLine>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    sheetRow: { type: Number, required: true },
    sheetNumber: { type: String, default: '' },
    sheetBalance: { type: Number, required: true },
    systemBalance: { type: Number, required: true },
    numberMatches: { type: Boolean, required: true },
    sheetCode: { type: String, default: null },
    // NO default: absent on a session read before 6a — read as no candidates.
    charges: { type: [chargeSchema], default: undefined },
    inRepair: { type: Boolean, default: false },
    decision: { type: String, enum: [...FLEET_FUEL_RECONCILE_DECISIONS, null], default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    movementId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const linkSchema = new Schema<FleetFuelReconcileLink>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    sheetRow: { type: Number, required: true },
    sheetCode: { type: String, default: null },
    kind: { type: String, enum: FLEET_FUEL_LINK_KINDS, required: true },
    fromVehicleId: { type: Schema.Types.ObjectId, default: null },
    fromLabel: { type: String, default: null },
    toVehicleId: { type: Schema.Types.ObjectId, default: null },
    toLabel: { type: String, default: null },
    resolvedBy: { type: String, enum: [...FLEET_FUEL_LINK_RESOLVERS, null], default: null },
    pairWith: { type: Schema.Types.ObjectId, default: null },
    inRepair: { type: Boolean, default: false },
    decision: { type: String, enum: [...FLEET_FUEL_RECONCILE_DECISIONS, null], default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    movementId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const newCardSchema = new Schema<FleetFuelReconcileNewCard>(
  {
    sheetRow: { type: Number, required: true },
    name: { type: String, default: '' },
    number: { type: String, default: '' },
    numberKind: { type: String, enum: FLEET_FUEL_SHEET_NUMBER_KINDS, required: true },
    numberIsFull: { type: Boolean, required: true },
    balance: { type: Number, required: true },
    sheetCode: { type: String, default: null },
    toVehicleId: { type: Schema.Types.ObjectId, default: null },
    toLabel: { type: String, default: null },
    cardId: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const countsSchema = new Schema<FleetFuelReconcileCounts>(
  {
    equal: { type: Number, required: true, default: 0 },
    sheetOnly: { type: Number, required: true, default: 0 },
    systemOnly: { type: Number, required: true, default: 0 },
    duplicates: { type: Number, required: true, default: 0 },
    conflicts: { type: Number, required: true, default: 0 },
    numbersDiffer: { type: Number, required: true, default: 0 },
    skipped: { type: Number, default: 0 },
    placesDiffer: { type: Number, default: 0 },
  },
  { _id: false },
);

const reconciliationSchema = new Schema<FleetFuelReconciliationDoc>(
  {
    company: { type: String, enum: FLEET_FUEL_CARD_COMPANIES, required: true },
    fileName: { type: String, default: '' },
    fileSha256: { type: String, required: true },
    readAt: { type: Date, required: true },
    rowsRead: { type: Number, required: true, min: 0 },
    sheetCompany: { type: String, enum: [...FLEET_FUEL_CARD_COMPANIES, null], default: null },
    // NO default: absent on a session read before «تاريخ الشيت» — read as none.
    sheetDate: { type: Date, required: false },
    lines: { type: [lineSchema], default: [] },
    // NO default: absent on a session read before it — read as none.
    equalCardIds: { type: [Schema.Types.ObjectId], default: undefined },
    links: { type: [linkSchema], default: undefined },
    newCards: { type: [newCardSchema], default: undefined },
    counts: { type: countsSchema, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The latest readings of a company first — the only order the sessions are ever looked at in.
reconciliationSchema.index({ company: 1, readAt: -1 }, { name: 'ix_fuel_reconcile_company_read' });

export const FleetFuelReconciliationModel = model<FleetFuelReconciliationDoc>(
  'FleetFuelReconciliation',
  reconciliationSchema,
  'fleet_fuel_card_reconciliations',
);
