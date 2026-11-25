// The module's one door to the platform's approval engine (design §5.2, §5.16; P2 plan §8): the
// request types it registers, the Unit each document is decided at, the subject the engine is
// handed, OD-19 A's refusals at submission and the engine's refusals in the module's words. A
// document's service owns everything else — its status, its trail's append, the pairs and every
// effect — and reaches the engine only through here, so every document reads it one way.
//
// THE AUDIT IS THE HOST'S (ADR-041 decision 7). The type registers with `{ audit: 'host' }`: the
// engine's `decide` then writes no row of its own and hands its changes back, and the document
// records its decision on itself after its own commit, so a decision the document refused leaves
// no orphan row keyed `<type>:<step>` behind (R5).
//
// THE UNIT IS THE DOCUMENT'S, READ AT EVERY CALL (design §7.6). A purchase request is filed for good
// on the department copy it was raised in and that copy's branch, so moving the requester never
// moves the request; the copy's company department is read again each time, because a copy linked
// to one after the submission gains the rungs and grants that match on it (ADR-041 decision 4
// keeps staffing current). A copy that no longer lies in the request's branch gives no Unit to
// decide at.
//
// Shared, so it imports no feature (`administration-isolation.spec.ts`): a document hands in what
// this file reads of it, and the pair A1 set its own rules name.
import {
  ErrorCodes,
  type AdministrationApprovalChainProblem,
  type AdministrationPurchaseRequestSubmitProblem,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import {
  approvalService,
  pinOf,
  readApprovalPin,
  registerApprovalRequestType,
  type ApprovalChainPin,
  type ApprovalSubject,
  type ChainStatus,
  type DecidedEntry,
  type Unit,
} from '../../../platform/approvals';
import { departmentRepository } from '../../../platform/organization';
import { AppError, BusinessRuleError } from '../../../shared/errors';

/** The purchase request's type on the engine (design §6.4): one key, a desk per level. */
export const PURCHASE_REQUEST_APPROVAL_TYPE = 'administration.purchaseRequest';

// At module load, beside the permissions (`request-type.registry.ts`; leave's precedent): every
// rung of a purchase-request chain names `.approve`, and what differs from rung to rung is the
// level it is held at — at most four desks (OD-71 A).
registerApprovalRequestType(
  {
    key: PURCHASE_REQUEST_APPROVAL_TYPE,
    moduleId: 'administration',
    name: { ar: 'طلبات الشراء', en: 'Purchase requests' },
    permissionKeys: ['administrationPurchaseRequest.approve'],
  },
  { audit: 'host' },
);

// ── The Unit ────────────────────────────────────────────────────────────────

/** Where a document is filed: its branch, and the department copy it was raised in. */
export interface FiledOn {
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
}

/**
 * 422 `ADMINISTRATION_TRANSITION_BLOCKED`, `departmentId` · `copyMoved`: the document's copy no
 * longer lies in its branch — or is no longer on file at all — so no Unit of that branch can be
 * read from it. Only an operator's data fix or the org-catalog merge rewrites a copy's branch or a
 * document's `departmentId` (design §7.7); refusing keeps such a document from being decided on
 * another branch's chain.
 */
const copyMoved = (): AppError => {
  const message = 'the department this document was raised in no longer lies in its branch';
  return new AppError(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED, 422, message, {
    details: [
      {
        field: 'departmentId',
        code: 'copyMoved' satisfies AdministrationPurchaseRequestSubmitProblem,
        message,
      },
    ],
  });
};

/**
 * The approval Unit of a filed document (design §7.6): its own branch and copy, and the company
 * department the copy is linked to now, or null while it is uncataloged — so only the chains and
 * grants that name no company department, or name the copy itself, apply to it.
 */
export const approvalUnitOf = async (filed: FiledOn): Promise<Unit> => {
  const copy = await departmentRepository.findById(String(filed.departmentId));
  if (copy === null || String(copy.branchId) !== String(filed.branchId)) throw copyMoved();
  return {
    branchId: String(filed.branchId),
    departmentId: String(filed.departmentId),
    // A copy written before the catalog existed may lack the field altogether (a lean read applies
    // no default): unlinked all the same.
    departmentCatalogId: copy.catalogId == null ? null : String(copy.catalogId),
  };
};

// ── The subject ─────────────────────────────────────────────────────────────

/**
 * One rung's fate as a document stores it (design §2.1, `ApprovalEntry`): the engine's six facts,
 * the decider's id an ObjectId, beside the snapshots the engine never reads.
 */
export interface StoredApprovalEntry {
  stepIndex: number;
  outcome: DecidedEntry['outcome'];
  deciderUserId: Types.ObjectId | null;
  decidedAt: Date;
  comment: string | null;
  overriddenWith: string | null;
}

/**
 * The stored entries as the engine reads them: its six fields and nothing else, the decider's id a
 * string (P2 plan §1.2 item 26). Passed raw, the engine would look up the deciders' names by an
 * ObjectId and find none.
 */
export const decidedEntriesOf = (entries: readonly StoredApprovalEntry[]): DecidedEntry[] =>
  entries.map((entry) => ({
    stepIndex: entry.stepIndex,
    outcome: entry.outcome,
    deciderUserId: entry.deciderUserId === null ? null : String(entry.deciderUserId),
    decidedAt: entry.decidedAt,
    comment: entry.comment,
    overriddenWith: entry.overriddenWith,
  }));

/** What a document on a chain keeps of it: its current round, and the pin it was submitted on. */
export type ApprovalHost = Parameters<typeof readApprovalPin>[0] & {
  approvalSteps: readonly StoredApprovalEntry[];
};

/**
 * The engine's subject for one document — the one helper every call that hands the engine a
 * subject goes through, so a document is never decided on rungs its own trail does not show
 * (leave's `subjectOf`). A document always pins at submission, so its pin is null only before: the
 * submission itself, whose pin is stored by its own write, puts `pinOf`'s over it (P2 plan §8.2
 * step 4).
 */
export const approvalSubjectOf = (
  requestType: string,
  unit: Unit,
  doc: ApprovalHost,
): ApprovalSubject => ({
  requestType,
  unit,
  decisions: decidedEntriesOf(doc.approvalSteps),
  pin: readApprovalPin(doc),
});

// ── OD-19 A: nobody to decide it, refused at submission ─────────────────────

/** 422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, `approval` · the reason (OD-19 A). */
const chainMissing = (code: AdministrationApprovalChainProblem): AppError => {
  const message = 'nobody can decide this document on its approval chain';
  return new AppError(ErrorCodes.ADMINISTRATION_APPROVAL_CHAIN_MISSING, 422, message, {
    details: [{ field: 'approval', code, message }],
  });
};

/**
 * Why a chain's answer before anybody decides refuses a submission (ADR-041 decisions 2 and 3), or
 * null: no chain applies, or nobody holds any of its rungs. The engine reads neither as approved,
 * and the module's policy for both is to refuse (OD-19 A).
 */
export const chainStatusRefusal = (status: ChainStatus): AppError | null =>
  status === 'noChain' || status === 'unstaffed' ? chainMissing(status) : null;

/**
 * The live rung's eligible approvers (P2 plan, Terms): its holders as the engine names them, less
 * pair A1's set and anybody who decided another rung of the current round (pair B1), in the
 * engine's order and each once.
 */
export const eligibleAmong = (
  holders: readonly string[],
  decisions: readonly DecidedEntry[],
  pairA1: readonly string[],
): string[] => {
  const barred = new Set([
    ...pairA1,
    ...decisions.flatMap((entry) => (entry.deciderUserId === null ? [] : [entry.deciderUserId])),
  ]);
  return [...new Set(holders)].filter((id) => !barred.has(id));
};

/**
 * What a submission pins and tells (P2 plan §8.2 steps 3–5): the chain that applies to the Unit
 * now, refused when there is none or nobody holds a rung of it; its pin, the chain's row and its
 * rungs as `pinOf` gives them; and the live rung's eligible approvers, refused when none is left
 * once pair A1 is taken off it — a live rung held only by the requester, the creator or the
 * submitter counts as unstaffed (design §6.4 item 5), even when a staffed rung above it could
 * decide early.
 *
 * Only the live rung can be checked: the engine names no other rung's holders, so a later rung held
 * only by the A1 set passes here and is met after the decision before it (design §5.2).
 */
export const chainForSubmission = async (
  requestType: string,
  unit: Unit,
  pairA1: readonly string[],
): Promise<{ pin: ApprovalChainPin; approvers: string[] }> => {
  const chain = await approvalService.chainFor(requestType, unit);
  const refusal = chainStatusRefusal(chain.status);
  if (refusal !== null) throw refusal;
  // After the status check `pinOf` always pins: a chain that is pending has a row and rungs.
  const pin = pinOf(chain);
  if (pin === null) throw chainMissing('noChain');
  // A new round: no entries yet, and the pin this submission is about to store.
  const holders = await approvalService.currentApprovers({
    ...approvalSubjectOf(requestType, unit, { approvalSteps: [] }),
    pin,
  });
  const approvers = eligibleAmong(holders, [], pairA1);
  if (approvers.length === 0) throw chainMissing('noEligibleApprover');
  return { pin, approvers };
};

// ── The engine's refusals, in the module's words (design §5.15) ─────────────

/**
 * An error the engine threw at a decision, as the module answers it: `approvals.alreadyDecided`
 * and `approvals.nothingToDecide` are 422 `ADMINISTRATION_APPROVAL_NOT_PENDING` with the
 * document's status, and `approvals.notYourStep` is 422 `ADMINISTRATION_APPROVAL_NOT_YOUR_STEP`
 * (ADR-041 decision 3). The engine throws each as a `BusinessRuleError` whose message is its key,
 * and has no codes of its own, so the key is what is read. Anything else passes through unchanged.
 */
export const remapEngineRefusal = (error: unknown, status: string): unknown => {
  if (!(error instanceof BusinessRuleError)) return error;
  switch (error.message) {
    case 'approvals.alreadyDecided':
    case 'approvals.nothingToDecide': {
      const message = `a document in ${status} is not awaiting a decision`;
      return new AppError(ErrorCodes.ADMINISTRATION_APPROVAL_NOT_PENDING, 422, message, {
        details: [{ field: 'status', code: status, message }],
      });
    }
    case 'approvals.notYourStep':
      return new AppError(
        ErrorCodes.ADMINISTRATION_APPROVAL_NOT_YOUR_STEP,
        422,
        'the caller stands on no rung this document waits on, and no override of theirs reaches it',
      );
    default:
      return error;
  }
};
