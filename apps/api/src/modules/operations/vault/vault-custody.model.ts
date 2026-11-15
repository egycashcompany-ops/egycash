// Custody of a secured shipment while it is with the treasury — the legacy vault fields lifted
// off `transactions` into their own row (the approved SPLIT, design §15).
//
// DROPPED from the legacy schema (never written with a value in ANY code path — verified):
// `vault_no`, `Rack_no`, `vault_receipt_num`. Carrying dead columns forward would document a
// capability the business never had. Vault LOCATION can return as a real field the day the
// business asks for it; inventing it now would be inventing a rule.
//
// WHO RECEIVED IT. Legacy wrote `treasurer_receive` as `""` on every save and only ever recorded ONE
// treasurer (contad_app.js:1211/1266), so its two-man rule was decorative; OP-4 normalized it (Q2):
// two treasurers, both required, different. Round 18 the owner dropped the names altogether — «انا
// مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله اختيارى» — so a receipt now records
// ONE person, the signed-in user who pressed «إستلام» (`receivedById`, from the token, like
// `releasedById` and `cancelledById`). The two treasurer fields stay on the schema, optional, so
// every receipt taken before reads back exactly as it was signed; no new row writes them.
// Q3 too: `treasurer_delivery*` were declared and never written; `releasedBy/releasedAt` are written
// for real on dispatch.
//
// Round 18 also made every field of the receipt optional — the receipt number included — and added
// the legacy form's «2×» / «3×» (`bagSealsPerBag`) and «عدد الورق من كل فئة» (`denominations`).
// Rows written before have none of the three new fields; absent reads as null / empty
// (vault-custody.service.ts `toCustodyView`), never as a guess. No migration: nothing about an old
// row changes, and no index reads the new fields.
import { Schema, model, type Types } from 'mongoose';
import {
  OPERATIONS_CUSTODY_STATES,
  OPERATIONS_VAULT_BAG_SEALS_PER_BAG,
  OPERATIONS_VAULT_DENOMINATIONS,
  type OperationsCustodyState,
  type OperationsVaultBagSealsPerBag,
  type OperationsVaultDenomination,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** The notes of one denomination counted at the receipt — stored only when above zero. */
export interface OperationsVaultDenominationCount {
  value: OperationsVaultDenomination;
  count: number;
}

export interface OperationsVaultCustodyDoc extends BaseDocFields {
  shipmentId: Types.ObjectId;
  state: OperationsCustodyState;
  /** Null when the vault typed none (Round 18); always a string on rows written before. */
  receiptNumber: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** Round 18 — absent on rows written before. */
  bagSealsPerBag?: OperationsVaultBagSealsPerBag | null;
  bagSeals: string[];
  boxSeals: string[];
  /** Round 18 — absent on rows written before. */
  denominations?: OperationsVaultDenominationCount[];
  /** Round 18 — the receiving user (the token's); absent on rows written before. */
  receivedById?: Types.ObjectId | null;
  /** The two treasurers of a row written BEFORE Round 18; absent on every newer row. */
  receivedByPrimaryId?: Types.ObjectId | null;
  receivedBySecondaryId?: Types.ObjectId | null;
  receivedAt: Date;
  releasedById: Types.ObjectId | null;
  releasedAt: Date | null;
  /**
   * Round 10 — a CANCELLED receipt («صلاحية خاصة تقدر تلغى استلام الخزينة»). The row is voided, never
   * erased: it keeps everything the treasury stamped, gains when/who/why here, and is soft-deleted
   * in the same write, so every live read (which all ask `isDeleted: false`) stops seeing it and
   * `ux_shipment` frees the shipment for a fresh receipt. Optional: rows written before Round 10
   * have none of the three, and absent reads as "not cancelled".
   */
  cancelledAt?: Date | null;
  cancelledById?: Types.ObjectId | null;
  cancelReason?: string | null;
}

const custodySchema = new Schema<OperationsVaultCustodyDoc>(
  {
    shipmentId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, required: true, enum: OPERATIONS_CUSTODY_STATES, default: 'held' },
    receiptNumber: { type: String, default: null },
    bagCount: { type: Number, required: true, default: 0 },
    cartonCount: { type: Number, required: true, default: 0 },
    boxCount: { type: Number, required: true, default: 0 },
    // No `default`: a row written before Round 18 must keep reading as "not asked", not as 2.
    bagSealsPerBag: { type: Number, enum: OPERATIONS_VAULT_BAG_SEALS_PER_BAG },
    bagSeals: { type: [String], required: true, default: [] },
    boxSeals: { type: [String], required: true, default: [] },
    denominations: {
      type: [
        new Schema(
          {
            value: { type: Number, required: true, enum: OPERATIONS_VAULT_DENOMINATIONS },
            count: { type: Number, required: true, min: 1 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    receivedById: { type: Schema.Types.ObjectId },
    // Written by no code path since Round 18 — only read, on the rows that already hold them.
    receivedByPrimaryId: { type: Schema.Types.ObjectId },
    receivedBySecondaryId: { type: Schema.Types.ObjectId },
    receivedAt: { type: Date, required: true },
    releasedById: { type: Schema.Types.ObjectId, default: null },
    releasedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledById: { type: Schema.Types.ObjectId, default: null },
    cancelReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One custody record per shipment — the DB half of "a shipment cannot be received twice".
custodySchema.index(
  { shipmentId: 1 },
  { unique: true, name: 'ux_shipment', partialFilterExpression: { isDeleted: false } },
);
custodySchema.index({ state: 1 }, { name: 'ix_state' });
// Round 8: the vault's receive queue lists what was received TODAY — a window on `receivedAt`. The
// vault roll-up's period (a month by default) is the same kind of window, so it rides this index
// too rather than scanning the collection.
custodySchema.index({ receivedAt: -1 }, { name: 'ix_received_at' });
// Round 10: a shipment's WHOLE custody history, a cancelled receipt included, oldest first — the
// action log reads it. `ux_shipment` cannot serve it: it is partial on `isDeleted: false`, and a
// cancelled receipt is exactly the row it leaves out.
custodySchema.index({ shipmentId: 1, receivedAt: 1 }, { name: 'ix_shipment_received' });

export const OperationsVaultCustodyModel = model<OperationsVaultCustodyDoc>(
  'OperationsVaultCustody',
  custodySchema,
  'operations_vault_custody',
);
