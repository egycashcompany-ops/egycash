// `it_consumable_movements` — the consumables store's ledger, append-only FOR QUANTITIES (ADR-024's
// shape): every unit in («توريد», «مرتجع») and out («صرف», «هالك») — and between two branches' stores
// («تحويل إلى فرع»: a `transferredOut` row in one, a `transferredIn` row in the other, sharing one
// `transferId`) — one row per movement. A mistake in what moved is corrected by an opposing
// movement — which is what keeps every on-hand figure explainable six months later.
//
// ONE fact of a row may be corrected in place: the device an `issued` unit sits in (`assetId`) —
// «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم» (2026-11-17). It is a description of
// where the unit went, not a quantity: it moves no counter, and an opposing movement could not say
// it. Every other field is still never edited, and the repository's one write for it
// (`setInstalledOn`) reaches that field of an issued row and nothing else; the row's `__v` moves
// with it, the audit trail keeps the device it named before, and so does the row itself
// (`installedOnBefore`), for the one rule that must still see it: an asset a unit was once recorded
// in is not «registered in error» (FR-5) — the signed copy on file and the trail still name it.
//
// On a COUNTED issue — a toner of a type that `requiresCounterReading` («حبارات», 2026-11-19: «عايز
// يبقى فى Counter لعدد لورق المطبوع للطابعة اللى بيركب عليها الحبارة») — that one fact is the device
// AND the printer's counter reading taken on it (`counterReading`, `counterReset`): the reading
// moves with the device, is checked again on the printer it lands on, and leaves with it
// («بدون جهاز»). «One memo, one printer, one reading»: the counted rows of one memo on one printer
// are one display read once, so they carry ONE reading and reset, and a write of it on one of them
// — a correction there, or a move onto a printer where rows of its memo sit — writes it on all of
// them (the repository's `setMemoCounterOnPrinter`, beside `setInstalledOn`, in one transaction);
// a move off a printer leaves the others there as they are. Both keys are present only on a
// counted issue (`counterReset` only when true), so an old row and an uncounted one read alike. The
// pages a cartridge printed are never stored: they are the next reading of the same item on that
// printer less this one, computed when read (`consumable-counter.ts`), so no row ever holds a
// figure another row's correction would have to rewrite.
//
// `qty` is always POSITIVE and the kind says which way it moved: a ledger read by people, where
// «−3» beside «صرف» would say the same thing twice and invite the sign to disagree with the word.
// What each kind does to the item's counters is `consumable-stock.ts`.
//
// It answers «وأتبدل لمين» — an issue names the employee it went to and, «لو حاجة بتتركب فى حاجة
// تانية», the register's asset it was installed on. That makes it a record that names a person, and
// the workforce reset KEEPS it: it is the stock ledger, and deleting it would leave every on-hand
// figure without the movements that explain it.
//
// Or — since 2026-11-19 — an issue goes to a DEPARTMENT kept at a PLACE, signed for by its
// responsible person («صرف لإدارة»: «الأصول أو المستهلكات الخاصة بالإدارة»). Then `employeeId` is
// NULL — it means who the items went to, and they went to the department — and the row carries
// `departmentId`, `locationId` and `responsibleEmployeeId`, the memo's signer. The three keys are
// present ONLY on such an issue (the counter keys' rule): every other row, and every row before,
// has none, and reads «no department».
import { Schema, model, type Types } from 'mongoose';
import { IT_CONSUMABLE_MOVEMENT_KINDS, type ItConsumableMovementKind } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItConsumableMovementDoc extends BaseDocFields {
  consumableId: Types.ObjectId;
  kind: ItConsumableMovementKind;
  /** Positive; the kind carries the direction. */
  qty: number;
  /** When it happened — what the ledger orders by, as typed (it defaults to the moment of entry). */
  at: Date;
  /** The item's store — fixed for the item's life, so the ledger is scoped with no join. */
  branchId: Types.ObjectId;
  byUserId: Types.ObjectId | null;
  /**
   * `issued`: who it went to; `returned`: who brought it back, when known. Null otherwise — an
   * issue to a department included: the department is who it went to, and its signer is
   * `responsibleEmployeeId`, never this.
   */
  employeeId: Types.ObjectId | null;
  /** `issued` to a department: the platform department it went to. Absent on every other row. */
  departmentId?: Types.ObjectId;
  /** …the place («المواقع») it is kept at, in the store's branch… */
  locationId?: Types.ObjectId;
  /** …and who signed the memo for the department («المستلم عن الإدارة»). */
  responsibleEmployeeId?: Types.ObjectId;
  /** `issued`: the asset it was installed on, when it was. Null otherwise. */
  assetId: Types.ObjectId | null;
  /**
   * `issued`, after a «تعديل الجهاز»: every device the row named before — added to, never taken
   * from, and read by nothing but FR-5's delete guard. Absent on a row never corrected.
   */
  installedOnBefore?: Types.ObjectId[];
  /**
   * `issued`, of a type that takes the printer's counter: the counter of the printer (`assetId`) as
   * the toner went in — as typed, or as «تعديل الجهاز» last corrected it (on this row, or on another
   * row of its memo on that printer: one memo, one printer, one reading). Absent on every other row.
   */
  counterReading?: number;
  /** «تم تصفير عداد الطابعة» — that reading started the printer's counter again. Absent = false. */
  counterReset?: boolean;
  /** `issued`: `new` | `replacement`; `scrapped`: why, as written. Null otherwise. */
  reason: string | null;
  /** `issued`: the memo signed for it — by the employee, or by the department's signer. */
  memoId: Types.ObjectId | null;
  notes: string | null;
  /**
   * A transfer between two stores — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني»: the id its two
   * movements share (one transfer of several items shares one id across all of them). Null
   * otherwise.
   */
  transferId: Types.ObjectId | null;
  /** `transferredOut`: the branch it went to; `transferredIn`: the branch it came from. */
  counterpartBranchId: Types.ObjectId | null;
  /** A transfer: the other store's item of the same name — the other half of the pair. */
  counterpartConsumableId: Types.ObjectId | null;
}

const movementSchema = new Schema<ItConsumableMovementDoc>(
  {
    consumableId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: IT_CONSUMABLE_MOVEMENT_KINDS, required: true },
    qty: { type: Number, required: true, min: 1 },
    at: { type: Date, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId, default: null },
    employeeId: { type: Schema.Types.ObjectId, default: null },
    // No default: only an issue to a department carries them (the header).
    departmentId: { type: Schema.Types.ObjectId },
    locationId: { type: Schema.Types.ObjectId },
    responsibleEmployeeId: { type: Schema.Types.ObjectId },
    assetId: { type: Schema.Types.ObjectId, default: null },
    // No empty array on every row: only a corrected issue carries it.
    installedOnBefore: { type: [Schema.Types.ObjectId], default: undefined },
    // No default: only a counted issue carries them (the header).
    counterReading: { type: Number, min: 0 },
    counterReset: { type: Boolean },
    reason: { type: String, default: null },
    memoId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    transferId: { type: Schema.Types.ObjectId, default: null },
    counterpartBranchId: { type: Schema.Types.ObjectId, default: null },
    counterpartConsumableId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One item's movements, newest first — the item's own movements list.
movementSchema.index({ consumableId: 1, at: -1 }, { name: 'ix_consumable_at' });
// The ledger across items, scoped to the stores a reader sees, newest first.
movementSchema.index({ branchId: 1, at: -1 }, { name: 'ix_branch_at' });
// «وأتبدل لمين» — what a person was issued: the IT history page of an employee.
movementSchema.index({ employeeId: 1, at: -1 }, { name: 'ix_employee_at' });
// What went to a department, what went to a place («إيه اللي في غرفة السيرفرات»), and what a person
// signed for on a department's behalf — the ledger's filters and the person page. Partial, so the
// rows that name no department (every row before 2026-11-19) cost them nothing; a query uses one
// when it names its field's id AND its type (`consumable.service.ts` ledgerFilter).
movementSchema.index(
  { departmentId: 1, at: -1 },
  { name: 'ix_department_at', partialFilterExpression: { departmentId: { $type: 'objectId' } } },
);
movementSchema.index(
  { locationId: 1, at: -1 },
  { name: 'ix_location_at', partialFilterExpression: { locationId: { $type: 'objectId' } } },
);
movementSchema.index(
  { responsibleEmployeeId: 1, at: -1 },
  {
    name: 'ix_responsible_at',
    partialFilterExpression: { responsibleEmployeeId: { $type: 'objectId' } },
  },
);
// «المستهلكات المركّبة عليه» — what was installed on an asset: its detail page. A printer's counter
// timeline (its counted issues, in order) reads it too: a bounded scan of one asset's rows.
movementSchema.index({ assetId: 1, at: -1 }, { name: 'ix_asset_at' });
// FR-5's guard: an asset a corrected issue named before. Sparse — few rows are ever corrected.
movementSchema.index({ installedOnBefore: 1 }, { name: 'ix_installed_on_before', sparse: true });
// The movements one memo lists.
movementSchema.index({ memoId: 1 }, { name: 'ix_memo' });
// The movements one transfer wrote — both halves of every line, in both stores.
movementSchema.index({ transferId: 1 }, { name: 'ix_transfer' });

export const ItConsumableMovementModel = model<ItConsumableMovementDoc>(
  'ItConsumableMovement',
  movementSchema,
  'it_consumable_movements',
);
