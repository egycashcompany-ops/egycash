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
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_RECONCILE_DECISIONS,
  type FleetFuelCardCompany,
  type FleetFuelReconcileDecision,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

/** One differing card: the sheet's figure, the card's figure at `readAt`, and its decision. */
export interface FleetFuelReconcileLine {
  cardId: Types.ObjectId;
  /** The card's name as matched (the sheet's «Card Name»). */
  name: string;
  /** The Excel row the figure came from. */
  sheetRow: number;
  /** The number as the sheet prints it (masked). */
  sheetNumber: string;
  sheetBalance: number;
  /** The card's balance when the sheet was read. */
  systemBalance: number;
  numberMatches: boolean;
  decision: FleetFuelReconcileDecision | null;
  decidedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  /** The `sheetAdjust` / `sheetReject` line the decision wrote. */
  movementId: Types.ObjectId | null;
}

export interface FleetFuelReconcileCounts {
  equal: number;
  sheetOnly: number;
  systemOnly: number;
  duplicates: number;
  conflicts: number;
  numbersDiffer: number;
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
  lines: FleetFuelReconcileLine[];
  counts: FleetFuelReconcileCounts;
}

const lineSchema = new Schema<FleetFuelReconcileLine>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    sheetRow: { type: Number, required: true },
    sheetNumber: { type: String, default: '' },
    sheetBalance: { type: Number, required: true },
    systemBalance: { type: Number, required: true },
    numberMatches: { type: Boolean, required: true },
    decision: { type: String, enum: [...FLEET_FUEL_RECONCILE_DECISIONS, null], default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    movementId: { type: Schema.Types.ObjectId, default: null },
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
    lines: { type: [lineSchema], default: [] },
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
