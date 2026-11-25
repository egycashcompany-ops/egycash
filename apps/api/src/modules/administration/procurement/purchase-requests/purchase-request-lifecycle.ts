// The purchase request's state machine (design §5.4; P2 plan §7) — PURE: no database, no clock,
// no request. The whole table ships at once (P2.2), its nine edges and their keys, so every slice
// after it reads one table, and the record's `availableActions` is computed from all of it: from
// P2.2 to P2.4 a record can list an act whose route a later slice mounts, which no screen reads
// before P2.W1. Beside the table, its guards: `submitProblem`, `cancelProblem`, `closeCondition`
// and `orderStatusOf`.
//
//   — → draft ──submit──▶ pendingApproval ──decide──▶ approved ──(P4, system)──▶ closed
//        ▲  │                  │  │                      │
//        │  └──cancel─▶ cancelled ◀──cancel───────────────┘
//        └────return───────────┘  └──decide──▶ rejected
//
// THE DECISION'S KEYS. Rows 3 to 5 run under `.approve`, and `approval.override` stands in for it
// within its own reach (ADR-041 decision 6; P2 plan §1.2 item 19), so the row names one key and its
// platform substitute. THE CANCEL'S. Rows 6 and 7 are also the requester's own withdrawal, before
// a decision (OD-28.4 (i)): the route reads under `.view` and the service judges the ownership.
import {
  ErrorCodes,
  type AdministrationPurchaseRequestOrderStatus,
  type AdministrationPurchaseRequestStatus,
  type AdministrationPurchaseRequestSubmitProblem,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { type ActDef, type TransitionDef, type TransitionTable } from '../../shared/lifecycle';

/** The table's actions: the dispatch keys, the audit mapping (design §10.2). */
export type PurchaseRequestAction = 'create' | 'submit' | 'decide' | 'return' | 'cancel' | 'close';

type Row = TransitionDef<AdministrationPurchaseRequestStatus, PurchaseRequestAction>;

const VIEW = 'administrationPurchaseRequest.view';
const CREATE = 'administrationPurchaseRequest.create';
const EDIT = 'administrationPurchaseRequest.edit';
const APPROVE = 'administrationPurchaseRequest.approve';
const CANCEL = 'administrationPurchaseRequest.cancel';
/** The platform's override key (ADR-041 decision 6), the approve key's substitute. */
export const APPROVAL_OVERRIDE = 'approval.override';

/** Design §5.4's nine rows, in its order. */
export const PURCHASE_REQUEST_TRANSITIONS: TransitionTable<
  AdministrationPurchaseRequestStatus,
  PurchaseRequestAction
> = [
  // 1. Raised by a department's focal point (OD-16 A).
  { action: 'create', from: null, to: 'draft', permission: CREATE },
  // 2. Numbered and pinned (OD-58 A; ADR-041 decision 4); stamped again by each round.
  {
    action: 'submit',
    from: 'draft',
    to: 'pendingApproval',
    permission: CREATE,
    stamps: 'submitted',
  },
  // 3, 4. The settling rung; which row the engine's answer picks is `decisionTransition`'s.
  {
    action: 'decide',
    from: 'pendingApproval',
    to: 'approved',
    permission: APPROVE,
    substitute: APPROVAL_OVERRIDE,
    stamps: 'approved',
    settledByApproval: true,
  },
  {
    action: 'decide',
    from: 'pendingApproval',
    to: 'rejected',
    permission: APPROVE,
    substitute: APPROVAL_OVERRIDE,
    stamps: 'rejected',
    requiresReason: true,
    settledByApproval: true,
  },
  // 5. A return for amendment (OD-72 B): the number kept, the round archived.
  {
    action: 'return',
    from: 'pendingApproval',
    to: 'draft',
    permission: APPROVE,
    substitute: APPROVAL_OVERRIDE,
    stamps: 'returned',
    requiresReason: true,
  },
  // 6–8. A cancel while nothing is ordered (OD-28 A); a draft's needs a reason only once it carries
  // a number (`reasonRequired`).
  {
    action: 'cancel',
    from: 'draft',
    to: 'cancelled',
    permission: CANCEL,
    stamps: 'cancelled',
    ownWithdrawal: true,
  },
  {
    action: 'cancel',
    from: 'pendingApproval',
    to: 'cancelled',
    permission: CANCEL,
    stamps: 'cancelled',
    requiresReason: true,
    ownWithdrawal: true,
  },
  {
    action: 'cancel',
    from: 'approved',
    to: 'cancelled',
    permission: CANCEL,
    stamps: 'cancelled',
    requiresReason: true,
  },
  // 9. Inside the PO act or the remainder cancel that completes `closeCondition` — from P4.
  { action: 'close', from: 'approved', to: 'closed', permission: null, system: true },
];

/** The statuses the actions' rows start from, in table order, each once. */
const startsOf = (
  test: (row: Row) => boolean,
  inState: readonly AdministrationPurchaseRequestStatus[] = [],
): AdministrationPurchaseRequestStatus[] => [
  ...new Set([
    ...PURCHASE_REQUEST_TRANSITIONS.filter(test).flatMap((row) =>
      row.from === null ? [] : [row.from],
    ),
    ...inState,
  ]),
];

/**
 * The acts a record may offer (P2 plan §4.4), each with the statuses it starts from: the table's
 * rows, and the two in-state acts — a draft's edit, and an intermediate rung's decision, which
 * writes the request and keeps its status (design §5.4, In-state).
 */
export const PURCHASE_REQUEST_ACTS: readonly ActDef<
  AdministrationPurchaseRequestStatus,
  'edit' | 'submit' | 'decide' | 'return' | 'cancel' | 'withdraw'
>[] = [
  { key: 'edit', from: ['draft'] },
  { key: 'submit', from: startsOf((row) => row.action === 'submit') },
  { key: 'decide', from: startsOf((row) => row.action === 'decide', ['pendingApproval']) },
  { key: 'return', from: startsOf((row) => row.action === 'return') },
  { key: 'cancel', from: startsOf((row) => row.action === 'cancel') },
  { key: 'withdraw', from: startsOf((row) => row.ownWithdrawal === true) },
];

/** The key each act of the record runs under — the key `availableActions` names. */
export const PURCHASE_REQUEST_ACT_KEYS = {
  edit: EDIT,
  submit: CREATE,
  decide: APPROVE,
  return: APPROVE,
  cancel: CANCEL,
  withdraw: VIEW,
} as const;

/** What the engine answers a decision with (ADR-041 decision 2), as the host reads it. */
export type DecisionOutcome = 'pending' | 'unstaffed' | 'approved' | 'rejected';

/**
 * The row a decision takes — the one pure function that picks between rows 3 and 4 — or null for
 * an intermediate rung's decision, which keeps `pendingApproval` (in-state).
 */
export const decisionTransition = (outcome: DecisionOutcome): Row | null => {
  if (outcome !== 'approved' && outcome !== 'rejected') return null;
  return (
    PURCHASE_REQUEST_TRANSITIONS.find((row) => row.action === 'decide' && row.to === outcome) ??
    null
  );
};

/**
 * Whether the act on this row needs a reason (design §5.1.2 item 5): every row that always does,
 * and a draft's cancel once the draft carries a number — a returned request, whose number the
 * register still lists. An unnumbered draft's cancel ended nothing anybody saw.
 */
export const reasonRequired = (row: Row, request: { number: string | null }): boolean =>
  row.requiresReason === true ||
  (row.action === 'cancel' && row.from === 'draft' && request.number !== null);

/** What `submitProblem` reads of one line: its quantity, and its item as the catalog answers. */
export interface SubmitLineFacts {
  qty: number;
  item: { isActive: boolean } | null;
}

/**
 * Why this draft may not be submitted (design §5.4 row 2): no line; a quantity that is not above
 * 0; an item that no longer exists or is retired, judged as a new reference. The 422 names every
 * failed rule, or null when none fails.
 */
export const submitProblem = (lines: readonly SubmitLineFacts[]): AppError | null => {
  // Typed by the contract's vocabulary, so a code the web cannot read does not compile.
  const details: { field: string; code: AdministrationPurchaseRequestSubmitProblem }[] = [];
  if (lines.length === 0) details.push({ field: 'lines', code: 'noLines' });
  lines.forEach((line, i) => {
    if (!(line.qty > 0)) details.push({ field: `lines.${String(i)}.qty`, code: 'notPositive' });
    if (line.item === null)
      details.push({ field: `lines.${String(i)}.itemId`, code: 'itemMissing' });
    else if (!line.item.isActive) {
      details.push({ field: `lines.${String(i)}.itemId`, code: 'itemInactive' });
    }
  });
  if (details.length === 0) return null;
  const message = 'this purchase request cannot be submitted as it stands';
  return new AppError(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED, 422, message, {
    details: details.map((detail) => ({ ...detail, message })),
  });
};

/** A line's counters, as the guards below read them. */
export interface LineCounters {
  qty: number;
  orderedQty: number;
  cancelledQty: number;
}

/**
 * Why an approved request may not be cancelled (design §5.4 row 8; OD-28 A): something on it is
 * ordered, so only its remainder may go (P4). The binding guard is the cancel's own filter, every
 * `orderedQty` 0; this names the lines for the answer. Null in P2, where nothing is ordered.
 */
export const cancelProblem = (lines: readonly LineCounters[]): AppError | null => {
  const ordered = lines.flatMap((line, i) =>
    line.orderedQty > 0 ? [{ field: `lines.${String(i)}.orderedQty`, code: 'ordered' }] : [],
  );
  if (ordered.length === 0) return null;
  const message = 'a purchase request with something ordered is closed by its remainder only';
  return new AppError(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED, 422, message, {
    details: ordered.map((detail) => ({ ...detail, message })),
  });
};

/** A line's open quantity: what is still asked for once the approvers' cuts are taken off. */
export const openQty = (line: LineCounters): number => line.qty - line.cancelledQty;

/**
 * Whether an approved request closes (design §5.4 row 9): every line ordered or cancelled in
 * full, and no citing purchase order still holding an open claim on it (§4.2.2). P4's acts ask it.
 */
export const closeCondition = (facts: {
  lines: readonly LineCounters[];
  hasOpenClaim: boolean;
}): boolean => !facts.hasOpenClaim && facts.lines.every((line) => line.orderedQty >= openQty(line));

/**
 * The physical status (design §5.12), against qty − cancelled: nothing ordered, every line ordered
 * up to its open quantity, or between. A request with no line, or whose lines are all cut to
 * nothing and unordered, reads `notOrdered`.
 */
export const orderStatusOf = (
  lines: readonly LineCounters[],
): AdministrationPurchaseRequestOrderStatus => {
  const ordered = lines.reduce((sum, line) => sum + line.orderedQty, 0);
  if (ordered === 0) return 'notOrdered';
  return lines.every((line) => line.orderedQty >= openQty(line))
    ? 'fullyOrdered'
    : 'partiallyOrdered';
};
