// A purchase request's pure rules (P2 plan §4.2, §4.4, §8.4): who may raise one, what a draft's
// edit may say of its lines, whose draft it is, and what its record offers each reader. No
// database and no clock: the service reads the facts — the caller's employee as the directory
// answers, the department copy, the items, the caller's grants — and these decide.
import {
  APPROVAL_PENDING,
  ErrorCodes,
  type AdministrationAvailableActionDto,
  type AdministrationPersonStatus,
  type AdministrationPurchaseRequestActionReason,
  type AdministrationPurchaseRequestStatus,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { availableActions, type ActJudgement } from '../../shared/lifecycle';
import {
  APPROVAL_OVERRIDE,
  PURCHASE_REQUEST_ACTS,
  PURCHASE_REQUEST_ACT_KEYS,
} from './purchase-request-lifecycle';

/**
 * 422 `ADMINISTRATION_INVALID_TRANSITION`: the act is not defined from the request's status — a
 * draft's edit of a request that left draft. Ranked above a stale version (design §5.15): a retry
 * with a fresh version cannot help.
 */
export const invalidTransition = (status: AdministrationPurchaseRequestStatus): AppError => {
  const message = `a purchase request in ${status} cannot be changed this way`;
  return new AppError(ErrorCodes.ADMINISTRATION_INVALID_TRANSITION, 422, message, {
    details: [{ field: 'status', code: status, message }],
  });
};

const blocked = (field: string, code: string, message: string): AppError =>
  new AppError(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED, 422, message, {
    details: [{ field, code, message }],
  });

/** What the create reads of the caller: their employee, and that employee's department copy. */
export interface RequesterFacts {
  /** The directory's answer for the caller's login, or null when it names nobody. */
  employee: { status: AdministrationPersonStatus; branchId: string | null } | null;
  /**
   * The employee's department copy as the organization holds it, or null when the employee has
   * none or names one no longer on file — either way, no department to file a request on.
   */
  department: { branchId: string } | null;
}

/**
 * Why the caller may not raise a request (OD-16 A; P2 plan §4.2), or null. In order: a login that
 * names no employee; an employee with no branch or no department; an employee who has left — a
 * backstop, since HR's exit suspends the login; and an employee whose branch is not the one their
 * department copy lies in, where HR's record disagrees with itself and either filing would be a
 * guess.
 */
export const requesterRefusal = (facts: RequesterFacts): AppError | null => {
  const { employee, department } = facts;
  if (employee === null) {
    return blocked('requester', 'noEmployee', 'the login names no employee to raise a request');
  }
  if (employee.branchId === null || department === null) {
    return blocked('requester', 'unplaced', 'the employee has no branch or no department');
  }
  if (employee.status === 'exited') {
    const message = 'a purchase request is raised by a current employee';
    return new AppError(ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED, 422, message, {
      details: [{ field: 'requester', code: 'exited', message }],
    });
  }
  if (department.branchId !== employee.branchId) {
    return blocked(
      'requester',
      'placementMismatch',
      'the employee’s branch is not the branch of their department',
    );
  }
  return null;
};

/** Whether the caller is the request's requester — a draft is theirs alone (P2 plan §1.2 item 22). */
export const isRequester = (request: { requesterUserId: unknown }, userId: string): boolean =>
  String(request.requesterUserId) === userId;

/**
 * 422 for the edited lines whose `lineId` the request does not have, one detail each by its index
 * in the body, or null. A line is kept by its id and by nothing else, so an id from another
 * request, or from a line already removed, names nothing to keep.
 */
export const unknownLinesRefusal = (indexes: readonly number[]): AppError | null => {
  if (indexes.length === 0) return null;
  const message = 'an edited line names a line this purchase request does not have';
  return new AppError(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED, 422, message, {
    details: indexes.map((i) => ({
      field: `lines.${String(i)}.lineId`,
      code: 'unknownLine',
      message,
    })),
  });
};

/**
 * 422 for the lines that name a retired item anew, one detail each by its index in the body, or
 * null. A new line, or a kept line whose item changed, is a new reference (OD-70 A); a kept line
 * naming the same item keeps it, retired or not.
 */
export const inactiveItemsRefusal = (indexes: readonly number[]): AppError | null => {
  if (indexes.length === 0) return null;
  const message = 'a retired item cannot be named on a new line';
  return new AppError(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, 422, message, {
    details: indexes.map((i) => ({
      field: `lines.${String(i)}.itemId`,
      code: 'inactive',
      message,
    })),
  });
};

// ── The separation-of-duties pairs, as the record's acts read them (OD-21 B) ─

/** What the pairs read of a request: the three roles of pair A1, and the current round. */
export interface PairFacts {
  requesterUserId: unknown;
  createdBy: unknown;
  submittedBy: unknown;
  approvalSteps: readonly { deciderUserId: unknown }[];
}

/**
 * Pair A1's set (design §6.6): the request's requester, creator and submitter, each once — whom
 * no rung of its chain counts as an approver. On a purchase request the three are one person,
 * since only the requester creates, edits and submits it (P2 plan §1.2 item 22).
 */
export const pairA1Of = (
  request: Pick<PairFacts, 'requesterUserId' | 'createdBy' | 'submittedBy'>,
): string[] => [
  ...new Set(
    [request.requesterUserId, request.createdBy, request.submittedBy].flatMap((id) =>
      id === null || id === undefined ? [] : [String(id)],
    ),
  ),
];

/** Pair A1 (design §6.6): the request's requester, creator or submitter never decides or returns it. */
export const inPairA1 = (request: PairFacts, userId: string): boolean =>
  pairA1Of(request).includes(userId);

/** Pair B1 (design §6.6): one person decides one rung per round — the current round only. */
export const inPairB1 = (request: PairFacts, userId: string): boolean =>
  request.approvalSteps.some(
    (entry) => entry.deciderUserId !== null && String(entry.deciderUserId) === userId,
  );

// ── What the record offers (P2 plan §4.4) ───────────────────────────────────

/** Everything the record's acts are judged on, for one reader. */
export interface ActionFacts extends PairFacts {
  status: AdministrationPurchaseRequestStatus;
  userId: string;
  /** Whether the reader holds the key at all. */
  holds: (key: string) => boolean;
  /** Whether the reader's key covers the request's Unit (`keyCoversUnit`). */
  covers: (key: string) => boolean;
  /**
   * Whether the key's own scope, as the top bar narrows it today (ADR-028), still reads the
   * request — what the act's route loads it through before anything else is said of it.
   */
  loads: (key: string) => boolean;
  /**
   * The reader's place on the current chain, from the engine's trail — null when the host reads
   * none (a request with no pin, and every request before P2.4), so nobody may decide it.
   */
  trail: { viewerMayDecide: boolean; viewerMayOverride: boolean } | null;
}

const enabled = (permission: string): ActJudgement => ({ permission, enabled: true, reason: null });

const disabled = (
  permission: string,
  reason: AdministrationPurchaseRequestActionReason,
): ActJudgement => ({ permission, enabled: false, reason });

/**
 * The acts this reader's record offers (P2 plan §4.4), from the whole table: each act whose row
 * starts at the request's status and whose key the reader holds, enabled or with the reason it is
 * not. The reasons are asked in the order the act's own route refuses them, so a button's words
 * say what pressing it would answer: reach before ownership, the pairs before the rung.
 */
export const purchaseRequestActions = (facts: ActionFacts): AdministrationAvailableActionDto[] => {
  const requester = isRequester(facts, facts.userId);
  const ownDraft = (key: string): ActJudgement => {
    if (!facts.holds(key)) return null;
    // A Unit the key covers but its narrowed scope no longer reads is a 404 to the route: out of
    // reach all the same. The cancel loads under `.view` (P2 plan §7.4), so `covers` alone is its.
    if (!facts.covers(key) || !facts.loads(key)) return disabled(key, 'outOfReach');
    return requester ? enabled(key) : disabled(key, 'notRequester');
  };
  const onChain = (withPairB1: boolean): ActJudgement => {
    const holdsApprove = facts.holds(PURCHASE_REQUEST_ACT_KEYS.decide);
    if (!holdsApprove && !facts.holds(APPROVAL_OVERRIDE)) return null;
    const mayDecide = facts.trail?.viewerMayDecide === true;
    const mayOverride = facts.trail?.viewerMayOverride === true;
    const permission =
      mayDecide || !facts.holds(APPROVAL_OVERRIDE)
        ? PURCHASE_REQUEST_ACT_KEYS.decide
        : APPROVAL_OVERRIDE;
    const barred = inPairA1(facts, facts.userId) || (withPairB1 && inPairB1(facts, facts.userId));
    if (barred) return disabled(permission, 'separationOfDuties');
    if (!mayDecide && !mayOverride) return disabled(permission, 'notYourStep');
    return enabled(permission);
  };
  return availableActions(PURCHASE_REQUEST_ACTS, facts.status, (key) => {
    switch (key) {
      case 'edit':
      case 'submit':
        return ownDraft(PURCHASE_REQUEST_ACT_KEYS[key]);
      case 'decide':
        return onChain(true);
      case 'return':
        // A return decides no rung, so pair B1 does not bind it (design §6.6).
        return onChain(false);
      case 'cancel': {
        const cancel = PURCHASE_REQUEST_ACT_KEYS.cancel;
        if (!facts.holds(cancel)) return null;
        return facts.covers(cancel) ? enabled(cancel) : disabled(cancel, 'outOfReach');
      }
      case 'withdraw': {
        const view = PURCHASE_REQUEST_ACT_KEYS.withdraw;
        if (!requester || !facts.holds(view)) return null;
        // Before a decision: before the current round's first entry (P2 plan §7.4).
        if (APPROVAL_PENDING[facts.status] && facts.approvalSteps.length > 0) {
          return disabled(view, 'decided');
        }
        return enabled(view);
      }
    }
  });
};
