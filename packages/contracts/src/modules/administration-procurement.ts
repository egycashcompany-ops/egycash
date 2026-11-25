// Administrative Affairs — procurement (docs/12-planning/administration-module-design.md §2.3.6,
// §11.2–§11.5, §19.4): the supplier register, P1b.1, and the purchase request from P2.2
// (docs/12-planning/administration-module-phase-2.md §5). Quotations and orders join here later.
//
// The register is the module's own (OD-01 C, ADR-040): IT's vendors and Fleet's workshops stay
// where they are, and a later platform seam may read this one. The fields are OD-11 A's — identity,
// contacts, the tax and commercial registration numbers, a VAT status, payment terms, the papers —
// and nothing else: no bank, IBAN or account data, and no national id. A supplier is active or
// retired (OD-12 A, the IT vendor precedent), never deleted, and keeps its name and code retired.
//
// As in the catalog, no schema takes `code` (generated, «SUP-00001», OD-05 A) or `nameKey` (the
// service folds `name.ar`, §2.1), and every write schema is strict, so a stray key is refused
// rather than dropped.
import { z } from 'zod';
import {
  PaginationQuerySchema,
  booleanQuery,
  isYmd,
  listQuery,
  objectId,
} from '../common/index.js';
import { type LocalizedString } from '../common/localized.js';
import { type ApprovalOutcome } from '../platform/approvals.js';
import { type ScanStatus } from '../platform/files.js';
import {
  ADMINISTRATION_MAX_DOCUMENT_LINES,
  type AdministrationAvailableActionDto,
} from './administration.js';
import { AdministrationNameSchema } from './administration-catalog.js';

// ── Field shapes ────────────────────────────────────────────────────────────

/** The IT vendor card's bounds (§2.3.6: "the IT vendor card"), so one phone fits either form. */
const phone = z.string().trim().max(30);
const email = z.string().trim().email().max(200);
const address = z.string().trim().max(500);
/**
 * A registration number as the paper prints it, trimmed. Bounded as the Organization's own
 * `taxNumber` and `commercialRegistry` are (50), whose names these are (§2.3.6). No format is
 * imposed: the design gives none, and a supplier's papers are what the number is checked against.
 */
const registryNumber = z.string().trim().min(1).max(50);
/** Free text until OD-29 structures payment terms (OD-11 A). */
const paymentTerms = z.string().trim().max(500);
const notes = z.string().trim().max(2000);

/** A supplier lists at most 20 contact people (§2.3.6): reality bounds the list, IT's rule. */
export const ADMINISTRATION_SUPPLIER_MAX_CONTACTS = 20;

/**
 * The most item categories one supplier names. Not a business rule — the design states none — but
 * the bound every stored array keeps, here a list page's 100, so a row stays small.
 */
export const ADMINISTRATION_SUPPLIER_MAX_CATEGORIES = 100;

/**
 * A supplier's VAT status (OD-11 A): a closed list whose values arrive with OD-29 (VAT, §12.8).
 * Until then the list is empty and the field holds null only, so the record's shape is final and
 * the values join without a migration — none is invented here.
 */
export const ADMINISTRATION_SUPPLIER_VAT_STATUSES = [] as const;
export type AdministrationSupplierVatStatus = (typeof ADMINISTRATION_SUPPLIER_VAT_STATUSES)[number];

/**
 * What a supplier names (`ADMINISTRATION_REFERENCE_INACTIVE`'s detail `field`): the item
 * categories it supplies, which RFQ invitations will be filtered by (P3).
 */
export const ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS = ['categoryIds'] as const;
export type AdministrationSupplierReferenceField =
  (typeof ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS)[number];

export const AdministrationSupplierContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    phone: phone.optional(),
    email: email.optional(),
  })
  .strict();
export type AdministrationSupplierContact = z.infer<typeof AdministrationSupplierContactSchema>;

const contacts = z
  .array(AdministrationSupplierContactSchema)
  .max(ADMINISTRATION_SUPPLIER_MAX_CONTACTS);
const categoryIds = z.array(objectId()).max(ADMINISTRATION_SUPPLIER_MAX_CATEGORIES);

// ── Papers — `administration-supplier-documents` (§11.2, OD-11 A) ───────────

/** The file category a supplier's papers are filed in, one key per purpose (§11.2). */
export const ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY = 'administration-supplier-documents';

/**
 * PDF and images only (OD-76 (i)): "a phone photo of the signed paper, or the office scanner's
 * PDF", each previewable in the browser. Office formats would be download-only, a macro risk.
 */
export const ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** The category's limit, the one a user meets: the upload's own cap sits 5 MB above it (§11.2). */
export const ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB = 10;

/**
 * The text fields sent beside the file (multipart, so each arrives as a string): what the paper
 * is — «السجل التجاري», «البطاقة الضريبية» — bounded as a file's display name is, and the
 * version of the supplier the person was looking at, because a paper's link is an edit of it.
 */
export const AddAdministrationSupplierAttachmentSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    version: z.coerce.number().int().min(0),
  })
  .strict();
export type AddAdministrationSupplierAttachment = z.infer<
  typeof AddAdministrationSupplierAttachmentSchema
>;

/** `?version=` on a paper's removal — a DELETE carries no body. */
export const AdministrationSupplierAttachmentVersionQuerySchema = z
  .object({ version: z.coerce.number().int().min(0) })
  .strict();
export type AdministrationSupplierAttachmentVersionQuery = z.infer<
  typeof AdministrationSupplierAttachmentVersionQuerySchema
>;

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface AdministrationSupplierContactDto {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

/** An item category the supplier names, by its name at read time (a retired one names itself). */
export interface AdministrationSupplierCategoryDto {
  id: string;
  name: LocalizedString | null;
}

/** A register row (§19.4): the record and its category names. Papers are the detail's. */
export interface AdministrationSupplierDto {
  id: string;
  /** «SUP-00001», generated at creation (OD-05 A): permanent, never reused. */
  code: string;
  name: LocalizedString;
  phone: string | null;
  email: string | null;
  address: string | null;
  contacts: AdministrationSupplierContactDto[];
  /** The item categories it supplies, in the order they were given. */
  categories: AdministrationSupplierCategoryDto[];
  taxNumber: string | null;
  commercialRegistry: string | null;
  /** Null until OD-29 gives the values (`ADMINISTRATION_SUPPLIER_VAT_STATUSES`). */
  vatStatus: AdministrationSupplierVatStatus | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One paper on the supplier's list (list B, §11.4), its file's scan state read at read time. */
export interface AdministrationSupplierAttachmentDto {
  /** What the paper's own read and removal name: `/suppliers/:id/attachments/:attachmentId`. */
  attachmentId: string;
  categoryKey: string;
  label: string;
  fileName: string;
  mime: string;
  size: number;
  addedByUserId: string;
  addedAt: string;
  /**
   * The file's scan state, never stored (§11.5): `pending` can be neither previewed nor
   * downloaded yet, `blocked` never. Null when the file is gone or archived — «الملف غير متاح».
   */
  scanStatus: ScanStatus | null;
}

/** Another supplier, as a warning names it. */
export interface AdministrationSupplierMatchDto {
  id: string;
  code: string;
  name: LocalizedString;
  isActive: boolean;
}

/** The record as its page reads it (§13.6 B): the register row, its papers, and its warnings. */
export interface AdministrationSupplierDetailDto extends AdministrationSupplierDto {
  attachments: AdministrationSupplierAttachmentDto[];
  /**
   * Other suppliers that hold this tax number, retired ones included — a WARNING, never a block
   * (OD-11 (i)): a supplier's branches may be separate records. At most
   * `ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES`, newest first; empty without a tax number.
   */
  taxNumberMatches: AdministrationSupplierMatchDto[];
}

/** How many other holders of a tax number the warning names — enough to recognize, not a report. */
export const ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES = 5;

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * No `code` (the server takes it inside the create's transaction), no `attachments` (a paper is
 * linked through its own endpoint, with its file), no `isActive` (a supplier starts active), and
 * no bank data of any kind (OD-11 A). `vatStatus` takes null alone until OD-29.
 */
export const CreateAdministrationSupplierSchema = z
  .object({
    name: AdministrationNameSchema,
    phone: phone.optional(),
    email: email.optional(),
    address: address.optional(),
    contacts: contacts.default([]),
    categoryIds: categoryIds.default([]),
    taxNumber: registryNumber.optional(),
    commercialRegistry: registryNumber.optional(),
    vatStatus: z.null().optional(),
    paymentTerms: paymentTerms.optional(),
    notes: notes.optional(),
  })
  .strict();
export type CreateAdministrationSupplier = z.infer<typeof CreateAdministrationSupplierSchema>;

/**
 * `null` clears a field; `contacts` and `categoryIds` replace their whole list; `isActive: false`
 * retires the supplier (OD-12 A, §5.3), which nothing refuses.
 */
export const UpdateAdministrationSupplierSchema = z
  .object({
    name: AdministrationNameSchema.optional(),
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    address: address.nullable().optional(),
    contacts: contacts.optional(),
    categoryIds: categoryIds.optional(),
    taxNumber: registryNumber.nullable().optional(),
    commercialRegistry: registryNumber.nullable().optional(),
    vatStatus: z.null().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    notes: notes.nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationSupplier = z.infer<typeof UpdateAdministrationSupplierSchema>;

/**
 * `search` reads the code and both names, the Arabic folded too (§19.4). `categoryId` reads a
 * category with its subcategories, as the item register does: the filter is picked from the top
 * level down.
 */
export const ListAdministrationSuppliersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  categoryId: objectId().optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationSuppliersQuery = z.infer<
  typeof ListAdministrationSuppliersQuerySchema
>;

// ── Purchase requests — «طلبات الشراء» (P2; design §2.5, §5.4, §5.14) ───────
//
// A department's focal point raises a request for items (OD-16 A); it is numbered when it first
// leaves draft (OD-58 A), approved on the platform engine at the requester's Unit (OD-17 A), and
// returned, rejected, cancelled or, from P4, closed. Every line names an item (OD-14 C: a service
// or an uncataloged good is a non-stock item), so a line has no free text. No schema takes the
// requester: it is always the caller (design §7.3), and the branch and department are the
// requester's department copy, never a body field (design §7.5).

/** The six statuses of design §5.4, in its order; `closed` is reached only from P4. */
export const ADMINISTRATION_PURCHASE_REQUEST_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'rejected',
  'cancelled',
  'closed',
] as const;
export type AdministrationPurchaseRequestStatus =
  (typeof ADMINISTRATION_PURCHASE_REQUEST_STATUSES)[number];

/**
 * The physical status beside the document's (design §5.12): derived from the lines' counters and
 * `notOrdered` through P2, since only P4's purchase orders claim a line.
 */
export const ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES = [
  'notOrdered',
  'partiallyOrdered',
  'fullyOrdered',
] as const;
export type AdministrationPurchaseRequestOrderStatus =
  (typeof ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES)[number];

/**
 * A guard set (design §5.14): every status classified, so a status added later fails compilation
 * until each set says where it stands — the payroll freeze-gap lesson. No guard tests one status.
 */
export type AdministrationPurchaseRequestGuardSet = Readonly<
  Record<AdministrationPurchaseRequestStatus, boolean>
>;

/** What an RFQ or a PO line may cite (P3, P4): an approved need, nothing ordered or not. */
export const PR_SOURCEABLE: AdministrationPurchaseRequestGuardSet = {
  draft: false,
  pendingApproval: false,
  approved: true,
  rejected: false,
  cancelled: false,
  closed: false,
};

/** What waits on a decision: the decide and return acts, the awaiting list, the sweep. */
export const APPROVAL_PENDING: AdministrationPurchaseRequestGuardSet = {
  draft: false,
  pendingApproval: true,
  approved: false,
  rejected: false,
  cancelled: false,
  closed: false,
};

/** Whose content may still change: the draft alone, which its repository's every write requires. */
export const CONTENT_EDITABLE: AdministrationPurchaseRequestGuardSet = {
  draft: true,
  pendingApproval: false,
  approved: false,
  rejected: false,
  cancelled: false,
  closed: false,
};

/** What a cancel may end (design §5.4 rows 6–8): every status before an order closes it. */
export const PR_CANCELLABLE: AdministrationPurchaseRequestGuardSet = {
  draft: true,
  pendingApproval: true,
  approved: true,
  rejected: false,
  cancelled: false,
  closed: false,
};

/**
 * The acts a request's record may offer (`availableActions`' `key`, phase-2 §4.4), in the order a
 * screen shows them: a draft's edit and submission, a decision and a return on the chain, a cancel,
 * and the requester's own withdrawal.
 */
export const ADMINISTRATION_PURCHASE_REQUEST_ACTIONS = [
  'edit',
  'submit',
  'decide',
  'return',
  'cancel',
  'withdraw',
] as const;
export type AdministrationPurchaseRequestAction =
  (typeof ADMINISTRATION_PURCHASE_REQUEST_ACTIONS)[number];

/**
 * Why a listed act is not enabled (`availableActions`' `reason`): the caller is not the requester;
 * stands on no rung and holds no override within reach; is kept off by a separation-of-duties pair
 * (OD-21 B); would withdraw after the round's first decision; or holds a key that does not cover
 * the request's Unit.
 */
export const ADMINISTRATION_PURCHASE_REQUEST_ACTION_REASONS = [
  'notRequester',
  'notYourStep',
  'separationOfDuties',
  'decided',
  'outOfReach',
] as const;
export type AdministrationPurchaseRequestActionReason =
  (typeof ADMINISTRATION_PURCHASE_REQUEST_ACTION_REASONS)[number];

/**
 * Why a request may not be created or edited as sent (`ADMINISTRATION_TRANSITION_BLOCKED`'s detail
 * `code` on a create or a draft edit): the caller's login names no employee; the employee has no
 * branch or no department; the employee's branch is not the one their department copy lies in; or
 * an edited line names a `lineId` the request does not have.
 */
export const ADMINISTRATION_PURCHASE_REQUEST_DRAFT_PROBLEMS = [
  'noEmployee',
  'unplaced',
  'placementMismatch',
  'unknownLine',
] as const;
export type AdministrationPurchaseRequestDraftProblem =
  (typeof ADMINISTRATION_PURCHASE_REQUEST_DRAFT_PROBLEMS)[number];

/** A line's quantity, in the item's base unit (design §2.1, Quantities). */
const requestQty = z.number().int().min(1).max(1_000_000);
/** The catalog's `notes` bound (`administration-catalog.ts`), for the request's two texts. */
const requestText = z.string().trim().max(2000);
const lineNotes = z.string().trim().max(500);
/**
 * A Cairo calendar date, 'YYYY-MM-DD'. A past one is allowed: a returned draft may carry one, and
 * the design sets no rule against it.
 */
const ymd = z.string().refine(isYmd, { message: 'must be a real YYYY-MM-DD date' });

export const AdministrationPurchaseRequestLineSchema = z
  .object({ itemId: objectId(), qty: requestQty, notes: lineNotes.optional() })
  .strict();
export type AdministrationPurchaseRequestLine = z.infer<
  typeof AdministrationPurchaseRequestLineSchema
>;

/**
 * No requester, branch or department (the caller's own copy), no number or status (the server's),
 * no unit on a line (the item's, OD-07) and no counter. A draft may hold no line yet: the
 * submission requires one (design §5.4 row 2).
 */
export const CreateAdministrationPurchaseRequestSchema = z
  .object({
    neededBy: ymd.optional(),
    justification: requestText.optional(),
    notes: requestText.optional(),
    lines: z.array(AdministrationPurchaseRequestLineSchema).max(ADMINISTRATION_MAX_DOCUMENT_LINES),
  })
  .strict();
export type CreateAdministrationPurchaseRequest = z.infer<
  typeof CreateAdministrationPurchaseRequestSchema
>;

/** A line as an edit sends it: with the `lineId` of a line it keeps, without one for a new line. */
export const AdministrationPurchaseRequestLineEditSchema =
  AdministrationPurchaseRequestLineSchema.extend({
    lineId: objectId().optional(),
  }).strict();
export type AdministrationPurchaseRequestLineEdit = z.infer<
  typeof AdministrationPurchaseRequestLineEditSchema
>;

/**
 * A draft's edit: `null` clears a field, and `lines` replaces the whole list — a line sent with
 * its `lineId` keeps its id, one sent without is new, and a line left out is gone. A `lineId`
 * sent twice would make two lines of one, so it is refused here, before any rule.
 */
export const UpdateAdministrationPurchaseRequestSchema = z
  .object({
    neededBy: ymd.nullable().optional(),
    justification: requestText.nullable().optional(),
    notes: requestText.nullable().optional(),
    lines: z
      .array(AdministrationPurchaseRequestLineEditSchema)
      .max(ADMINISTRATION_MAX_DOCUMENT_LINES)
      .superRefine((lines, ctx) => {
        const seen = new Set<string>();
        lines.forEach((line, index) => {
          if (line.lineId === undefined) return;
          const id = line.lineId.toLowerCase();
          if (seen.has(id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'lineId'],
              message: 'a line is sent once',
            });
          }
          seen.add(id);
        });
      })
      .optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationPurchaseRequest = z.infer<
  typeof UpdateAdministrationPurchaseRequestSchema
>;

/** The columns the register sorts on (phase-2 §4.1). */
export const ADMINISTRATION_PURCHASE_REQUEST_SORTS = [
  'number',
  'createdAt',
  'submittedAt',
  'neededBy',
] as const;

/**
 * The register's query (phase-2 §4.1): `search` is the start of a number as typed, matched from
 * its first character without regard to case; `status` and `departmentIds` are comma lists;
 * `departmentIds` only narrows — a copy outside the reader's reach adds no row — and takes up to
 * 200 because a company department picked in the filter sends every copy it has; `from` and `to`
 * are Cairo days, both inclusive, bounding `createdAt`.
 */
export const ListAdministrationPurchaseRequestsQuerySchema = PaginationQuerySchema.extend({
  sortBy: z.enum(ADMINISTRATION_PURCHASE_REQUEST_SORTS).default('createdAt'),
  search: z.string().trim().max(100).optional(),
  status: listQuery(z.enum(ADMINISTRATION_PURCHASE_REQUEST_STATUSES)),
  departmentIds: listQuery(objectId(), 200),
  requesterUserId: objectId().optional(),
  from: ymd.optional(),
  to: ymd.optional(),
}).strict();
export type ListAdministrationPurchaseRequestsQuery = z.infer<
  typeof ListAdministrationPurchaseRequestsQuerySchema
>;

/** A register row (phase-2 §6.5): the request's own snapshots, so a page reads no other row. */
export interface AdministrationPurchaseRequestDto {
  id: string;
  /** «PR-2026-000001» once it first left draft; null on a draft that never did (OD-58 A). */
  number: string | null;
  status: AdministrationPurchaseRequestStatus;
  orderStatus: AdministrationPurchaseRequestOrderStatus;
  branchId: string;
  /** The filing branch as the request's snapshot names it (design §2.1, Snapshots). */
  branchName: LocalizedString;
  /** The requester's department copy (design §7.5). */
  departmentId: string;
  departmentName: LocalizedString | null;
  requesterUserId: string;
  /** The requester's Arabic name as the directory gave it (D-22). */
  requesterName: string;
  /** 'YYYY-MM-DD', or null. */
  neededBy: string | null;
  lineCount: number;
  submittedAt: string | null;
  createdAt: string;
  version: number;
}

/** One line: its item as the snapshot names it, and its counters. */
export interface AdministrationPurchaseRequestLineDto {
  /** What an edit sends to keep this line. */
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: LocalizedString;
  /** The item's base unit, never the client's (OD-07). */
  unitId: string;
  unitName: LocalizedString | null;
  qty: number;
  /** 0 through P2: only P4's purchase orders claim a line. */
  orderedQty: number;
  /** What approvers lowered the line by (OD-17 (ii)). */
  cancelledQty: number;
  notes: string | null;
}

/** The facts printed with the requester's name (design §2.1, `PersonSnap`). */
export interface AdministrationPurchaseRequestRequesterDto {
  employeeCode: string | null;
  jobTitle: LocalizedString | null;
  departmentId: string | null;
  departmentName: LocalizedString | null;
}

/** One stored entry of a round (design §2.1, `ApprovalEntry`), with its two snapshots. */
export interface AdministrationApprovalEntryDto {
  stepIndex: number;
  outcome: Exclude<ApprovalOutcome, 'pending'>;
  deciderUserId: string | null;
  /** The decider's display name at the decision, null on an entry nobody decided. */
  deciderName: string | null;
  decidedAt: string;
  comment: string | null;
  overriddenWith: string | null;
  /** The rung's caption from the pin, null when it has none. */
  stepLabel: LocalizedString | null;
}

/** A round a return archived (design §5.2, Rounds). */
export interface AdministrationPurchaseRequestRoundDto {
  /** 1 for the first round a return archived, one more for each later one. */
  round: number;
  endedBy: 'returned';
  at: string;
  steps: AdministrationApprovalEntryDto[];
}

/**
 * The record (phase-2 §6.5): the row, the request's texts and snapshots, its lines, its files with
 * their scan states (P2.6), the rounds a return archived, the stamps and reasons of each act, and
 * what this reader may do now. The current round's trail joins with the decisions that read it
 * (P2.4).
 */
export interface AdministrationPurchaseRequestDetailDto extends AdministrationPurchaseRequestDto {
  justification: string | null;
  notes: string | null;
  /** The Cairo date of the first submission, 'YYYY-MM-DD': the number's year (OD-57 A). */
  businessDate: string | null;
  requester: AdministrationPurchaseRequestRequesterDto;
  lines: AdministrationPurchaseRequestLineDto[];
  /** Linked only while the request is a draft, by its requester (phase-2 §4.3). */
  attachments: AdministrationPurchaseRequestAttachmentDto[];
  approvalRounds: AdministrationPurchaseRequestRoundDto[];
  submittedBy: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  returnedAt: string | null;
  returnedByUserId: string | null;
  returnReason: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancelReason: string | null;
  availableActions: AdministrationAvailableActionDto[];
}

// ── A request's files — `administration-request-attachments` (phase-2 §4.3; P2.6) ──
//
// The supplier papers' shape (P1b.1): one file per upload, under the field `file`, linked by a
// version-held write and removed by its link alone. A purchase request's list changes only while
// it is a draft, and only by its requester (OD-76 after submission (i); phase-2 §1.2 item 22).

/**
 * The text fields sent beside the file (multipart, so each arrives as a string): what the file is
 * — «مواصفات الطابعة», «صورة العطل» — bounded as a file's display name is, and the version of the
 * request the requester was looking at, because a file's link is an edit of the draft.
 */
export const AddAdministrationPurchaseRequestAttachmentSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    version: z.coerce.number().int().min(0),
  })
  .strict();
export type AddAdministrationPurchaseRequestAttachment = z.infer<
  typeof AddAdministrationPurchaseRequestAttachmentSchema
>;

/** `?version=` on a file's removal — a DELETE carries no body. */
export const AdministrationPurchaseRequestAttachmentVersionQuerySchema = z
  .object({ version: z.coerce.number().int().min(0) })
  .strict();
export type AdministrationPurchaseRequestAttachmentVersionQuery = z.infer<
  typeof AdministrationPurchaseRequestAttachmentVersionQuerySchema
>;

/** One file on the request's list (list B, design §11.4), its scan state read at read time. */
export interface AdministrationPurchaseRequestAttachmentDto {
  /** What the file’s read and removal name: `/purchase-requests/:id/attachments/:attachmentId`. */
  attachmentId: string;
  categoryKey: string;
  label: string;
  fileName: string;
  mime: string;
  size: number;
  addedByUserId: string;
  addedAt: string;
  /**
   * The file's scan state, never stored (design §11.5): `pending` can be neither previewed nor
   * downloaded yet, `blocked` never. Null when the file is gone or archived, or when this reader
   * may not open the request's files.
   */
  scanStatus: ScanStatus | null;
}
