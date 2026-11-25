// Purchase requests (design §2.5; P2 plan §6.1): a department's need for items — «طلب شراء». The
// first document of the module: drafted by its department's focal point (OD-16 A), numbered when
// it first leaves draft (OD-58 A), decided on the platform engine at its Unit (OD-17 A), and never
// deleted — it ends in a terminal status and keeps its number.
//
// FILED ON THE REQUESTER'S DEPARTMENT COPY, FOR GOOD. `branchId` and `departmentId` are the copy
// the requester worked in at the create, and the branch that copy lies in (design §7.5); nothing
// writes them again, so moving the requester does not move the request.
//
// SNAPSHOTS, NOT LOOKUPS (design §2.1). The requester's name and facts, the branch and each line's
// item are copied onto the request and rewritten from live data on every draft save; the first
// submission freezes them, so what the approvers decided is what the record shows for ever. The
// localized copies are declared as plain nested objects, never subschemas: HR's census of name
// copies tests every path against /name$/, and a nested `itemName` lists only its leaves,
// `itemName.ar` and `itemName.en`, which need no classification (P2 plan §6.4).
//
// THE APPROVAL FIELDS are the engine's pin, spread from the platform barrel so a pinned rung is
// held to exactly what a chain row's is (ADR-041 decision 4), and the module's own trail: the
// current round's entries and the rounds a return archived (design §2.1, §5.2).
import { Schema, model, type Types } from 'mongoose';
import {
  ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES,
  ADMINISTRATION_PURCHASE_REQUEST_STATUSES,
  type AdministrationPurchaseRequestOrderStatus,
  type AdministrationPurchaseRequestStatus,
  type ApprovalOutcome,
  type ApprovalStep,
  type LocalizedString,
} from '@ecms/contracts';
import { approvalPinFields } from '../../../../platform/approvals';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

/**
 * One line (P2 plan §6.1): the item it names, the item's snapshot, the item's base unit — never
 * the client's (OD-07) — and the counters. Its `_id` is the `lineId` an edit keeps it by and,
 * from P4, what an order's claim cites.
 */
export interface AdministrationPurchaseRequestLineSub {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  itemCode: string;
  itemName: LocalizedString;
  unitName: LocalizedString | null;
  unitId: Types.ObjectId;
  qty: number;
  /** 0 through P2: only P4's purchase orders claim a line. */
  orderedQty: number;
  /** What approvers lowered the line by (OD-17 (ii)). */
  cancelledQty: number;
  notes: string | null;
}

/** What is printed beside the requester's name (design §2.1, `PersonSnap`). */
export interface AdministrationPurchaseRequestPersonSnap {
  employeeCode: string | null;
  jobTitle: LocalizedString | null;
  /** Reference-only: the copy the name below was read for. It grants nothing. */
  departmentId: Types.ObjectId | null;
  departmentName: LocalizedString | null;
}

/** The filing branch as the record prints it (design §2.1, `BranchSnap`). */
export interface AdministrationPurchaseRequestBranchSnap {
  code: string;
  name: LocalizedString;
}

/**
 * One request file on the typed list (list B, design §11.4), linked only while the request is a
 * draft (P2.6).
 */
export interface AdministrationPurchaseRequestAttachmentSub {
  attachmentId: Types.ObjectId;
  fileId: Types.ObjectId;
  categoryKey: string;
  label: string;
  fileName: string;
  mime: string;
  size: number;
  addedByUserId: Types.ObjectId;
  addedAt: Date;
}

/**
 * One rung's fate in a round (design §2.1, `ApprovalEntry`): the engine's entry, its decider's id
 * stored as an ObjectId, plus the two snapshots the engine does not keep — the rung's caption from
 * the pin and the decider's name — so an archived round, which the engine no longer reads, still
 * names both.
 */
export interface AdministrationApprovalEntrySub {
  stepIndex: number;
  outcome: Exclude<ApprovalOutcome, 'pending'>;
  deciderUserId: Types.ObjectId | null;
  decidedAt: Date;
  comment: string | null;
  overriddenWith: string | null;
  stepLabel: LocalizedString | null;
  deciderName: string | null;
}

/** A round a return archived (design §5.2, Rounds); `round` is its position plus one. */
export interface AdministrationApprovalRoundSub {
  round: number;
  endedBy: 'returned';
  at: Date;
  steps: AdministrationApprovalEntrySub[];
}

export interface AdministrationPurchaseRequestDoc extends BaseDocFields {
  /** «PR-2026-000001», taken by the first submission; kept by a return and on every end. */
  number: string | null;
  status: AdministrationPurchaseRequestStatus;
  orderStatus: AdministrationPurchaseRequestOrderStatus;
  /** The branch the requester's department copy lies in: the scope anchor. */
  branchId: Types.ObjectId;
  /** The requester's department copy: the scope's department axis and the approval Unit's. */
  departmentId: Types.ObjectId;
  /** Always the caller of the create (design §7.3): the repository's owner field. */
  requesterUserId: Types.ObjectId;
  requesterEmployeeId: Types.ObjectId;
  /** The directory's `fullNameAr` (D-22), beside its id so HR's permanent delete can reach it. */
  requesterName: string;
  requester: AdministrationPurchaseRequestPersonSnap;
  branch: AdministrationPurchaseRequestBranchSnap;
  /** A Cairo date at UTC midnight. */
  neededBy: Date | null;
  justification: string | null;
  notes: string | null;
  /** The Cairo date of the first submission, at UTC midnight: the number's year (OD-57 A). */
  businessDate: Date | null;
  lines: AdministrationPurchaseRequestLineSub[];
  attachments: AdministrationPurchaseRequestAttachmentSub[];
  /** `administration.purchaseRequest`, stamped by each submission. */
  approvalRequestType: string | null;
  /** The engine's pin (ADR-041 decision 4): written by each submission, cleared by a return. */
  approvalWorkflowId: Types.ObjectId | null;
  approvalChainShape: ApprovalStep[];
  /** The current round's entries. */
  approvalSteps: AdministrationApprovalEntrySub[];
  approvalRounds: AdministrationApprovalRoundSub[];
  submittedBy: Types.ObjectId | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: Types.ObjectId | null;
  /** The rejection's reason is its entry's `comment`. */
  rejectedAt: Date | null;
  rejectedByUserId: Types.ObjectId | null;
  /** The latest return; earlier ones are in the audit trail. */
  returnedAt: Date | null;
  returnedByUserId: Types.ObjectId | null;
  returnReason: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: Types.ObjectId | null;
  /** Null only on a cancelled draft that never took a number. */
  cancelReason: string | null;
}

/** A localized copy that is always there. */
const localized = () => ({
  ar: { type: String, required: true },
  en: { type: String, required: true },
});

/** A localized copy that may be null: a unit no longer on file, a person with no job title. */
const optionalLocalized = () => ({ ar: { type: String }, en: { type: String } });

const lineSchema = new Schema<AdministrationPurchaseRequestLineSub>({
  itemId: { type: Schema.Types.ObjectId, required: true },
  itemCode: { type: String, required: true },
  itemName: localized(),
  unitName: optionalLocalized(),
  unitId: { type: Schema.Types.ObjectId, required: true },
  qty: { type: Number, required: true, min: 1 },
  orderedQty: { type: Number, required: true, min: 0, default: 0 },
  cancelledQty: { type: Number, required: true, min: 0, default: 0 },
  notes: { type: String, default: null },
});

const attachmentSchema = new Schema<AdministrationPurchaseRequestAttachmentSub>(
  {
    attachmentId: { type: Schema.Types.ObjectId, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    categoryKey: { type: String, required: true },
    label: { type: String, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    addedByUserId: { type: Schema.Types.ObjectId, required: true },
    addedAt: { type: Date, required: true },
  },
  { _id: false },
);

const approvalEntrySchema = new Schema<AdministrationApprovalEntrySub>(
  {
    stepIndex: { type: Number, required: true },
    outcome: { type: String, required: true },
    deciderUserId: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, required: true },
    comment: { type: String, default: null },
    overriddenWith: { type: String, default: null },
    stepLabel: optionalLocalized(),
    deciderName: { type: String, default: null },
  },
  { _id: false },
);

const approvalRoundSchema = new Schema<AdministrationApprovalRoundSub>(
  {
    round: { type: Number, required: true, min: 1 },
    endedBy: { type: String, required: true, enum: ['returned'] },
    at: { type: Date, required: true },
    steps: { type: [approvalEntrySchema], required: true, default: [] },
  },
  { _id: false },
);

const purchaseRequestSchema = new Schema<AdministrationPurchaseRequestDoc>(
  {
    number: { type: String, default: null },
    status: {
      type: String,
      enum: ADMINISTRATION_PURCHASE_REQUEST_STATUSES,
      required: true,
      default: 'draft',
    },
    orderStatus: {
      type: String,
      enum: ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES,
      required: true,
      default: 'notOrdered',
    },
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    requesterUserId: { type: Schema.Types.ObjectId, required: true },
    requesterEmployeeId: { type: Schema.Types.ObjectId, required: true },
    requesterName: { type: String, required: true },
    requester: {
      employeeCode: { type: String, default: null },
      jobTitle: optionalLocalized(),
      departmentId: { type: Schema.Types.ObjectId, default: null },
      departmentName: optionalLocalized(),
    },
    branch: {
      code: { type: String, required: true },
      name: localized(),
    },
    neededBy: { type: Date, default: null },
    justification: { type: String, default: null },
    notes: { type: String, default: null },
    businessDate: { type: Date, default: null },
    lines: { type: [lineSchema], required: true, default: [] },
    attachments: { type: [attachmentSchema], required: true, default: [] },
    approvalRequestType: { type: String, default: null },
    // Declared by the engine, so a pinned rung is validated as a chain row's own rung is.
    ...approvalPinFields,
    approvalSteps: { type: [approvalEntrySchema], required: true, default: [] },
    approvalRounds: { type: [approvalRoundSchema], required: true, default: [] },
    submittedBy: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedByUserId: { type: Schema.Types.ObjectId, default: null },
    rejectedAt: { type: Date, default: null },
    rejectedByUserId: { type: Schema.Types.ObjectId, default: null },
    returnedAt: { type: Date, default: null },
    returnedByUserId: { type: Schema.Types.ObjectId, default: null },
    returnReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledByUserId: { type: Schema.Types.ObjectId, default: null },
    cancelReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A number is taken once a request leaves draft, and never reused (design §2.1, Indexes): unique
// across every row that holds one, deleted or not, and partial on its type so the drafts' nulls
// never collide. The `$type` is also what the series' floor read matches (`highestNumberPipeline`),
// so the planner can use this index for the anchored prefix.
purchaseRequestSchema.index(
  { number: 1 },
  { unique: true, name: 'ux_number', partialFilterExpression: { number: { $type: 'string' } } },
);
// The register's reads, the scope anchor first: a branch's requests by status, newest first.
purchaseRequestSchema.index(
  { branchId: 1, status: 1, createdAt: -1 },
  { name: 'ix_branch_status_created' },
);
// A department reader's register: the copy's requests by status.
purchaseRequestSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_department_status' });
// "Mine": the requester's own requests, newest first — and `own`'s reading.
purchaseRequestSchema.index(
  { requesterUserId: 1, createdAt: -1 },
  { name: 'ix_requester_created' },
);
// Status first, for P2's daily sweep over `pendingApproval`, then the order status, for P3's
// awaiting-sourcing queue (approved and not fully ordered).
purchaseRequestSchema.index({ status: 1, orderStatus: 1 }, { name: 'ix_sourcing' });

export const AdministrationPurchaseRequestModel = model<AdministrationPurchaseRequestDoc>(
  'AdministrationPurchaseRequest',
  purchaseRequestSchema,
  'administration_purchase_requests',
);
