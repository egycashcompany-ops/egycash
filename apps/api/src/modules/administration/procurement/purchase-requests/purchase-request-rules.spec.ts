// A purchase request's pure rules (P2 plan §4.2, §4.4, §12.1; P2.2's share): who may raise one and
// each refusal's detail, a draft being its requester's alone, an edit's unknown and retired lines,
// the two separation-of-duties pairs as the record reads them, and the acts the record offers each
// reader at each status — every `enabled` and every `reason`. P2.3: pair A1's set, which the
// submission takes off the live rung's holders.
import { ErrorCodes, type AdministrationPurchaseRequestStatus } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { type AppError } from '../../../../shared/errors';
import {
  inPairA1,
  inPairB1,
  pairA1Of,
  inactiveItemsRefusal,
  invalidTransition,
  isRequester,
  purchaseRequestActions,
  requesterRefusal,
  unknownLinesRefusal,
  type ActionFacts,
} from './purchase-request-rules';

const BRANCH = '64a0000000000000000000b1';
const OTHER_BRANCH = '64a0000000000000000000b2';
const REQUESTER = '64a0000000000000000000a1';
const COLLEAGUE = '64a0000000000000000000a2';
const APPROVER = '64a0000000000000000000a3';

const answer = (refusal: AppError | null) =>
  refusal === null
    ? null
    : {
        code: refusal.code,
        status: refusal.httpStatus,
        details: refusal.details?.map((detail) => `${detail.field ?? ''}:${detail.code}`),
      };

describe('who may raise a request (OD-16 A; P2 plan §4.2)', () => {
  const employee = (
    over: Partial<{ status: 'active' | 'exited'; branchId: string | null }> = {},
  ) => ({
    status: 'active' as const,
    branchId: BRANCH,
    ...over,
  });

  it('an employee placed in their department copy’s branch raises one', () => {
    expect(requesterRefusal({ employee: employee(), department: { branchId: BRANCH } })).toBeNull();
  });

  it('a login that names no employee: 422, requester · noEmployee', () => {
    expect(answer(requesterRefusal({ employee: null, department: null }))).toEqual({
      code: ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED,
      status: 422,
      details: ['requester:noEmployee'],
    });
  });

  it('an employee with no branch, or no department: 422, requester · unplaced', () => {
    for (const facts of [
      { employee: employee({ branchId: null }), department: { branchId: BRANCH } },
      { employee: employee(), department: null },
    ]) {
      expect(answer(requesterRefusal(facts))?.details).toEqual(['requester:unplaced']);
    }
  });

  it('an employee who has left: 422 ADMINISTRATION_EMPLOYEE_EXITED, requester · exited', () => {
    expect(
      answer(
        requesterRefusal({
          employee: employee({ status: 'exited' }),
          department: { branchId: BRANCH },
        }),
      ),
    ).toEqual({
      code: ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED,
      status: 422,
      details: ['requester:exited'],
    });
  });

  it('an employee whose branch is not their copy’s: 422, requester · placementMismatch', () => {
    expect(
      answer(requesterRefusal({ employee: employee(), department: { branchId: OTHER_BRANCH } }))
        ?.details,
    ).toEqual(['requester:placementMismatch']);
  });
});

describe('a draft is its requester’s (P2 plan §1.2 item 22)', () => {
  it('compares the login ids, whatever their type', () => {
    expect(isRequester({ requesterUserId: REQUESTER }, REQUESTER)).toBe(true);
    expect(isRequester({ requesterUserId: { toString: () => REQUESTER } }, REQUESTER)).toBe(true);
    expect(isRequester({ requesterUserId: REQUESTER }, COLLEAGUE)).toBe(false);
  });
});

describe('a draft edit’s lines and status', () => {
  it('names each unknown line id by its index: 422, lines.<i>.lineId · unknownLine', () => {
    expect(unknownLinesRefusal([])).toBeNull();
    expect(answer(unknownLinesRefusal([1, 3]))).toEqual({
      code: ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED,
      status: 422,
      details: ['lines.1.lineId:unknownLine', 'lines.3.lineId:unknownLine'],
    });
  });

  it('names each retired item named anew: 422 REFERENCE_INACTIVE, lines.<i>.itemId · inactive', () => {
    expect(inactiveItemsRefusal([])).toBeNull();
    expect(answer(inactiveItemsRefusal([0]))).toEqual({
      code: ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE,
      status: 422,
      details: ['lines.0.itemId:inactive'],
    });
  });

  it('a status that does not allow the act: 422 INVALID_TRANSITION, status · the status', () => {
    expect(answer(invalidTransition('pendingApproval'))).toEqual({
      code: ErrorCodes.ADMINISTRATION_INVALID_TRANSITION,
      status: 422,
      details: ['status:pendingApproval'],
    });
  });
});

describe('the pairs, as the record reads them (OD-21 B)', () => {
  const request = {
    requesterUserId: REQUESTER,
    createdBy: REQUESTER,
    submittedBy: null,
    approvalSteps: [{ deciderUserId: APPROVER }, { deciderUserId: null }],
  };

  it('A1 names the requester, the creator and the submitter', () => {
    expect(inPairA1(request, REQUESTER)).toBe(true);
    expect(inPairA1({ ...request, submittedBy: COLLEAGUE }, COLLEAGUE)).toBe(true);
    expect(inPairA1({ ...request, createdBy: COLLEAGUE }, COLLEAGUE)).toBe(true);
    expect(inPairA1(request, APPROVER)).toBe(false);
  });

  it('A1’s set is the three ids, each once, as strings — and none for a role nobody has yet', () => {
    // A draft not yet submitted has no submitter; on a purchase request the three are one person.
    expect(pairA1Of(request)).toEqual([REQUESTER]);
    // The submission names its caller as the submitter before it asks who may decide (P2 plan §8.2).
    expect(pairA1Of({ ...request, submittedBy: REQUESTER })).toEqual([REQUESTER]);
    // Should the three ever differ, each is barred.
    expect(
      pairA1Of({ requesterUserId: REQUESTER, createdBy: COLLEAGUE, submittedBy: APPROVER }),
    ).toEqual([REQUESTER, COLLEAGUE, APPROVER]);
    expect(
      pairA1Of({
        requesterUserId: { toString: () => REQUESTER },
        createdBy: undefined,
        submittedBy: null,
      }),
    ).toEqual([REQUESTER]);
  });

  it('B1 names whoever decided a rung of the current round, and nobody for an empty one', () => {
    expect(inPairB1(request, APPROVER)).toBe(true);
    expect(inPairB1(request, COLLEAGUE)).toBe(false);
    expect(inPairB1({ ...request, approvalSteps: [] }, APPROVER)).toBe(false);
  });
});

describe('the acts a record offers (P2 plan §4.4)', () => {
  const VIEW = 'administrationPurchaseRequest.view';
  const CREATE = 'administrationPurchaseRequest.create';
  const EDIT = 'administrationPurchaseRequest.edit';
  const APPROVE = 'administrationPurchaseRequest.approve';
  const CANCEL = 'administrationPurchaseRequest.cancel';
  const OVERRIDE = 'approval.override';

  const facts = (
    over: Partial<ActionFacts> & {
      keys?: string[];
      uncovered?: string[];
      unloaded?: string[];
    } = {},
  ) => {
    const { keys = [VIEW, CREATE, EDIT], uncovered = [], unloaded = [], ...rest } = over;
    return {
      status: 'draft' as AdministrationPurchaseRequestStatus,
      userId: REQUESTER,
      requesterUserId: REQUESTER,
      createdBy: REQUESTER,
      submittedBy: null,
      approvalSteps: [],
      holds: (key: string) => keys.includes(key),
      covers: (key: string) => keys.includes(key) && !uncovered.includes(key),
      loads: (key: string) => !unloaded.includes(key),
      trail: null,
      ...rest,
    } satisfies ActionFacts;
  };
  const acts = (f: ActionFacts) =>
    purchaseRequestActions(f).map(
      (act) => `${act.key}:${act.permission}:${act.enabled ? 'on' : (act.reason ?? '?')}`,
    );

  it('a draft: its requester edits, submits and withdraws it', () => {
    expect(acts(facts())).toEqual([
      `edit:${EDIT}:on`,
      `submit:${CREATE}:on`,
      `withdraw:${VIEW}:on`,
    ]);
  });

  it('a draft: a colleague holding the same keys is shown both acts disabled, notRequester, and no withdrawal', () => {
    expect(acts(facts({ userId: COLLEAGUE }))).toEqual([
      `edit:${EDIT}:notRequester`,
      `submit:${CREATE}:notRequester`,
    ]);
  });

  it('a draft: a key that does not cover the Unit says outOfReach, before ownership', () => {
    expect(acts(facts({ uncovered: [EDIT], userId: COLLEAGUE }))).toEqual([
      `edit:${EDIT}:outOfReach`,
      `submit:${CREATE}:notRequester`,
    ]);
  });

  it('a draft: a covering key whose scope the top bar narrows away from the request says outOfReach — its route would 404', () => {
    expect(acts(facts({ unloaded: [EDIT, CREATE] }))).toEqual([
      `edit:${EDIT}:outOfReach`,
      `submit:${CREATE}:outOfReach`,
      `withdraw:${VIEW}:on`,
    ]);
    // The cancel is loaded under `.view` and judged by its key's cover alone (P2 plan §7.4).
    expect(acts(facts({ keys: [VIEW, CANCEL], unloaded: [CANCEL], userId: COLLEAGUE }))).toEqual([
      `cancel:${CANCEL}:on`,
    ]);
  });

  it('a draft: nothing is listed under a key the reader does not hold', () => {
    expect(acts(facts({ keys: [VIEW], userId: COLLEAGUE }))).toEqual([]);
    expect(acts(facts({ keys: [] }))).toEqual([]);
  });

  it('a draft: a cancel holder is offered the cancel where the key covers the Unit (P2.5)', () => {
    expect(acts(facts({ keys: [VIEW, CANCEL], userId: COLLEAGUE }))).toEqual([
      `cancel:${CANCEL}:on`,
    ]);
    expect(acts(facts({ keys: [VIEW, CANCEL], uncovered: [CANCEL], userId: COLLEAGUE }))).toEqual([
      `cancel:${CANCEL}:outOfReach`,
    ]);
  });

  describe('pendingApproval', () => {
    const pending = (over: Partial<ActionFacts> & { keys?: string[] } = {}) =>
      facts({ status: 'pendingApproval', submittedBy: REQUESTER, ...over });

    it('the requester withdraws before the round’s first entry, and not after: decided', () => {
      expect(acts(pending())).toEqual([`withdraw:${VIEW}:on`]);
      expect(acts(pending({ approvalSteps: [{ deciderUserId: APPROVER }] }))).toEqual([
        `withdraw:${VIEW}:decided`,
      ]);
    });

    it('an approver on the live rung decides and returns', () => {
      expect(
        acts(
          pending({
            userId: APPROVER,
            keys: [VIEW, APPROVE],
            trail: { viewerMayDecide: true, viewerMayOverride: false },
          }),
        ),
      ).toEqual([`decide:${APPROVE}:on`, `return:${APPROVE}:on`]);
    });

    it('an approve holder on no rung of the chain: notYourStep; with no trail at all, the same', () => {
      for (const trail of [{ viewerMayDecide: false, viewerMayOverride: false }, null]) {
        expect(acts(pending({ userId: APPROVER, keys: [APPROVE], trail }))).toEqual([
          `decide:${APPROVE}:notYourStep`,
          `return:${APPROVE}:notYourStep`,
        ]);
      }
    });

    it('an override within reach decides under the override key', () => {
      expect(
        acts(
          pending({
            userId: APPROVER,
            keys: [OVERRIDE],
            trail: { viewerMayDecide: false, viewerMayOverride: true },
          }),
        ),
      ).toEqual([`decide:${OVERRIDE}:on`, `return:${OVERRIDE}:on`]);
    });

    it('pair A1 keeps the requester off both, even on a rung: separationOfDuties', () => {
      expect(
        acts(
          pending({
            keys: [APPROVE],
            trail: { viewerMayDecide: true, viewerMayOverride: false },
          }),
        ),
      ).toEqual([`decide:${APPROVE}:separationOfDuties`, `return:${APPROVE}:separationOfDuties`]);
    });

    it('pair B1 keeps a rung’s decider off the next decision, and not off a return', () => {
      expect(
        acts(
          pending({
            userId: APPROVER,
            keys: [APPROVE],
            approvalSteps: [{ deciderUserId: APPROVER }],
            trail: { viewerMayDecide: true, viewerMayOverride: false },
          }),
        ),
      ).toEqual([`decide:${APPROVE}:separationOfDuties`, `return:${APPROVE}:on`]);
    });
  });

  it('approved: only a cancel holder’s cancel; no edit, no withdrawal', () => {
    expect(acts(facts({ status: 'approved', keys: [VIEW, EDIT, CANCEL] }))).toEqual([
      `cancel:${CANCEL}:on`,
    ]);
  });

  it.each(['rejected', 'cancelled', 'closed'] as const)(
    '%s: nothing, whatever the reader holds',
    (status) => {
      expect(
        acts(
          facts({
            status,
            keys: [VIEW, CREATE, EDIT, APPROVE, CANCEL, OVERRIDE],
            trail: { viewerMayDecide: true, viewerMayOverride: true },
          }),
        ),
      ).toEqual([]);
    },
  );
});
