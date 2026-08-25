// The rulebook, proved without a database (P-HR-REQ).
//
// Every case here is one somebody could plausibly undo by "simplifying" the service: skipping a
// step because the caller holds the key, letting the requester sign their own request, treating a
// quantity rise as an ordinary edit, or letting a hire reopen a closed requisition.
import { describe, expect, it } from 'vitest';
import {
  cancelProblem,
  closeProblem,
  decisionProblem,
  deleteProblem,
  editProblem,
  fulfilmentStatus,
  isLinkable,
  linkProblem,
  nextStatusAfterDecision,
  requiresReapproval,
  statusAfterEdit,
  stepOf,
  submitProblem,
  type RequisitionShape,
} from './job-requisition-rules';

const shape = (over: Partial<RequisitionShape> = {}): RequisitionShape => ({
  jobTitleId: 'title-a',
  departmentId: 'dept-a',
  branchId: 'branch-a',
  sectionId: null,
  quantity: 3,
  ...over,
});

describe('the two-step chain', () => {
  it('names the step a requisition waits on, and none for the rest', () => {
    expect(stepOf('pendingManager')).toBe('manager');
    expect(stepOf('pendingHr')).toBe('hr');
    for (const status of ['draft', 'open', 'partiallyFilled', 'filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(stepOf(status)).toBeNull();
    }
  });

  it('approving at the manager step lands on pendingHr — never on open', () => {
    expect(nextStatusAfterDecision('pendingManager', 'approve')).toBe('pendingHr');
  });

  it('approving at the HR step opens the requisition', () => {
    expect(nextStatusAfterDecision('pendingHr', 'approve')).toBe('open');
  });

  it('rejecting at either step ends it', () => {
    expect(nextStatusAfterDecision('pendingManager', 'reject')).toBe('rejected');
    expect(nextStatusAfterDecision('pendingHr', 'reject')).toBe('rejected');
  });

  it('only a draft can be submitted', () => {
    expect(submitProblem('draft')).toBeNull();
    expect(submitProblem('open')).not.toBeNull();
    expect(submitProblem('pendingManager')).not.toBeNull();
  });
});

describe('who may decide', () => {
  const base = { isRequester: false, isDepartmentManager: false, canApprove: false };

  it('lets the department manager decide step one without holding the key', () => {
    expect(
      decisionProblem({ ...base, status: 'pendingManager', isDepartmentManager: true }),
    ).toBeNull();
  });

  it('lets an approver stand in at step one — the absent-manager escape', () => {
    expect(decisionProblem({ ...base, status: 'pendingManager', canApprove: true })).toBeNull();
  });

  it('refuses step one to somebody who is neither', () => {
    expect(decisionProblem({ ...base, status: 'pendingManager' })).toBe(
      'only the department manager or HR may decide this step',
    );
  });

  it('refuses step two to the department manager alone — the key is required there', () => {
    expect(decisionProblem({ ...base, status: 'pendingHr', isDepartmentManager: true })).toBe(
      'this step requires jobRequisition.approve',
    );
  });

  it('refuses the requester at BOTH steps, whatever they hold', () => {
    expect(
      decisionProblem({
        status: 'pendingManager',
        isRequester: true,
        isDepartmentManager: true,
        canApprove: true,
      }),
    ).toBe('you cannot decide your own requisition');
    expect(
      decisionProblem({
        status: 'pendingHr',
        isRequester: true,
        isDepartmentManager: true,
        canApprove: true,
      }),
    ).toBe('you cannot decide your own requisition');
  });

  it('refuses a decision on a requisition that is not waiting for one', () => {
    expect(decisionProblem({ ...base, status: 'open', canApprove: true })).toBe(
      'this requisition is not waiting for a decision',
    );
  });
});

describe('fulfilment', () => {
  it('walks open → partiallyFilled → filled as hires land', () => {
    expect(fulfilmentStatus('open', 0, 3)).toBe('open');
    expect(fulfilmentStatus('open', 1, 3)).toBe('partiallyFilled');
    expect(fulfilmentStatus('partiallyFilled', 2, 3)).toBe('partiallyFilled');
    expect(fulfilmentStatus('partiallyFilled', 3, 3)).toBe('filled');
  });

  it('closes on the last hire of a single-seat requisition', () => {
    expect(fulfilmentStatus('open', 1, 1)).toBe('filled');
  });

  it('counts an overshoot as filled rather than inventing a state for it', () => {
    expect(fulfilmentStatus('partiallyFilled', 4, 3)).toBe('filled');
  });

  it('never revives a requisition that is not live', () => {
    for (const status of ['draft', 'pendingManager', 'pendingHr', 'filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(fulfilmentStatus(status, 1, 3)).toBe(status);
    }
  });
});

describe('editing costs an approval when it asks for more (D-REQ-15)', () => {
  it('a quantity rise needs re-approval', () => {
    expect(requiresReapproval(shape(), shape({ quantity: 4 }))).toBe(true);
  });

  it('a quantity drop does not', () => {
    expect(requiresReapproval(shape(), shape({ quantity: 2 }))).toBe(false);
  });

  it('any placement move needs re-approval', () => {
    expect(requiresReapproval(shape(), shape({ jobTitleId: 'title-b' }))).toBe(true);
    expect(requiresReapproval(shape(), shape({ departmentId: 'dept-b' }))).toBe(true);
    expect(requiresReapproval(shape(), shape({ branchId: 'branch-b' }))).toBe(true);
    expect(requiresReapproval(shape(), shape({ sectionId: 'section-b' }))).toBe(true);
  });

  it('sends an approved requisition back to the MANAGER step, not the HR one', () => {
    expect(statusAfterEdit('open', true)).toBe('pendingManager');
    expect(statusAfterEdit('partiallyFilled', true)).toBe('pendingManager');
    expect(statusAfterEdit('pendingHr', true)).toBe('pendingManager');
  });

  it('leaves a draft and a step-one requisition where they are', () => {
    expect(statusAfterEdit('draft', true)).toBe('draft');
    expect(statusAfterEdit('pendingManager', true)).toBe('pendingManager');
  });

  it('changes nothing when the edit asked for no more than was granted', () => {
    expect(statusAfterEdit('open', false)).toBe('open');
    expect(statusAfterEdit('partiallyFilled', false)).toBe('partiallyFilled');
  });

  it('refuses a quantity below what is already filled', () => {
    expect(editProblem({ status: 'partiallyFilled', filledCount: 2, after: shape({ quantity: 1 }) })).toBe(
      'quantity cannot be lower than the 2 already filled',
    );
    expect(editProblem({ status: 'partiallyFilled', filledCount: 2, after: shape({ quantity: 2 }) })).toBeNull();
  });

  it('refuses any edit to a terminal requisition', () => {
    for (const status of ['filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(editProblem({ status, filledCount: 0, after: shape() })).toBe(
        `a ${status} requisition cannot be edited`,
      );
    }
  });
});

describe('ending a requisition', () => {
  it('closes only what is open', () => {
    expect(closeProblem('open')).toBeNull();
    expect(closeProblem('partiallyFilled')).toBeNull();
    expect(closeProblem('draft')).toBe('only an open requisition can be closed — cancel it instead');
  });

  it('refuses to end what has already ended', () => {
    for (const status of ['filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(closeProblem(status)).toBe(`this requisition is already ${status}`);
      expect(cancelProblem(status)).toBe(`this requisition is already ${status}`);
    }
  });

  it('deletes a draft and nothing else — the rest are cancelled, so the record survives', () => {
    expect(deleteProblem('draft')).toBeNull();
    for (const status of ['pendingManager', 'pendingHr', 'open', 'partiallyFilled', 'filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(deleteProblem(status)).toBe('only a draft can be deleted — cancel it instead');
    }
  });

  it('cancels anything still live, at any stage before the end', () => {
    for (const status of ['draft', 'pendingManager', 'pendingHr', 'open', 'partiallyFilled'] as const) {
      expect(cancelProblem(status)).toBeNull();
    }
  });
});

describe('what an applicant may be linked to', () => {
  it('accepts an open or partially filled requisition, and nothing else', () => {
    expect(isLinkable('open')).toBe(true);
    expect(isLinkable('partiallyFilled')).toBe(true);
    for (const status of ['draft', 'pendingManager', 'pendingHr', 'filled', 'rejected', 'cancelled', 'closed'] as const) {
      expect(isLinkable(status)).toBe(false);
      expect(linkProblem(status)).toBe(`requisition is ${status} — only an open one accepts applicants`);
    }
  });
});
