// What the leave request page shows of a request's approval, case by case (leave design §16.8,
// Web (a) to (f)): the decision follows the trail's flags only on the chain; the manager and HR
// card is drawn with no trail, and beside the trail once HR's step exists; its heading and line
// mark a request the chain handed to HR.
import { describe, expect, it } from 'vitest';
import { type ApprovalTrailDto, type LeaveRequestDto } from '@ecms/contracts';
import { mayDecideOn, showsDeskCard, showsHandedToHr } from './leave-request-view';

/** Two rungs, the first approved and the second never reached, read by somebody on neither. */
const trail = (flags: Partial<ApprovalTrailDto> = {}): ApprovalTrailDto => ({
  requestType: 'hr.leave',
  workflowId: '64b000000000000000000001',
  steps: [
    {
      permissionKey: 'leave.approve',
      level: 'unit',
      label: null,
      outcome: 'approved',
      decidedBy: { id: '64b000000000000000000002', name: 'مدير الإدارة' },
      decidedAt: '2026-11-20T08:00:00.000Z',
      comment: null,
      overriddenWith: null,
    },
    {
      permissionKey: 'leave.approve',
      level: 'branch',
      label: null,
      outcome: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      overriddenWith: null,
    },
  ],
  currentStep: null,
  viewerMayDecide: false,
  viewerStep: null,
  viewerCovers: [],
  viewerMayOverride: false,
  ...flags,
});

const HR_DECISION = {
  step: 'hr' as const,
  deciderUserId: '64b000000000000000000003',
  decision: 'approved' as const,
  comment: null,
  at: '2026-11-21T08:00:00.000Z',
};

/** A request as the API sends it; `pendingStep` follows the status, as the mapper derives it. */
const leave = (over: Partial<LeaveRequestDto>): LeaveRequestDto => {
  const status = over.status ?? 'pendingHr';
  return {
    id: '64b000000000000000000010',
    employeeId: '64b000000000000000000011',
    employeeCode: 'E-0001',
    employeeName: 'موظف',
    branchId: null,
    departmentId: null,
    sectionId: null,
    typeId: '64b000000000000000000012',
    typeCode: 'ANNUAL',
    status,
    startDate: '2026-12-02',
    endDate: '2026-12-02',
    halfDayStart: false,
    halfDayEnd: false,
    days: 1,
    reason: null,
    attachments: [],
    approvals: [],
    pendingStep: status === 'pendingManager' ? 'manager' : status === 'pendingHr' ? 'hr' : null,
    approvalTrail: null,
    actualReturnDate: null,
    statusDriveOutcome: null,
    cancelReason: null,
    createdBy: '64b000000000000000000013',
    version: 1,
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...over,
  };
};

describe('(a) a request the chain decides', () => {
  it('offers the decision only by the trail’s flags, and draws no manager and HR card', () => {
    const onChain = (flags: Partial<ApprovalTrailDto>) =>
      leave({ status: 'pendingApproval', approvalTrail: trail({ currentStep: 1, ...flags }) });
    expect(mayDecideOn(onChain({}))).toBe(false);
    expect(mayDecideOn(onChain({ viewerMayDecide: true }))).toBe(true);
    expect(mayDecideOn(onChain({ viewerMayOverride: true }))).toBe(true);
    expect(showsDeskCard(onChain({ viewerMayDecide: true }))).toBe(false);
    expect(showsHandedToHr(onChain({ viewerMayDecide: true }))).toBe(false);
  });
});

describe('(b) a request the chain handed to HR’s step', () => {
  it('offers its decision, and draws the card beside the trail with its own heading and line', () => {
    const handed = leave({ status: 'pendingHr', approvalTrail: trail() });
    expect(handed.pendingStep).toBe('hr');
    expect(handed.approvalTrail?.viewerMayDecide).toBe(false);
    expect(handed.approvalTrail?.viewerMayOverride).toBe(false);
    expect(mayDecideOn(handed)).toBe(true);
    expect(showsDeskCard(handed)).toBe(true);
    expect(showsHandedToHr(handed)).toBe(true);
  });
});

describe('(c) a handed-over request after HR decided it', () => {
  it('keeps the card and its line, and offers no decision', () => {
    const decided = leave({ status: 'approved', approvalTrail: trail(), approvals: [HR_DECISION] });
    expect(mayDecideOn(decided)).toBe(false);
    expect(showsDeskCard(decided)).toBe(true);
    expect(showsHandedToHr(decided)).toBe(true);
  });
});

describe('(d) a request moved to HR’s step with no engine entries, so with no trail', () => {
  it('offers its decision and draws the card, without the line', () => {
    const moved = leave({ status: 'pendingHr', approvalTrail: null });
    expect(mayDecideOn(moved)).toBe(true);
    expect(showsDeskCard(moved)).toBe(true);
    expect(showsHandedToHr(moved)).toBe(false);
  });
});

describe('(e) a request off the chain with a trail and no HR decision', () => {
  it('shows the chain alone and offers nothing, a handed-over request cancelled before HR decided included', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as const) {
      const done = leave({ status, approvalTrail: trail() });
      expect(mayDecideOn(done)).toBe(false);
      expect(showsDeskCard(done)).toBe(false);
      expect(showsHandedToHr(done)).toBe(false);
    }
  });
});

describe('(f) a request on the manager and HR path from submission', () => {
  it('draws the card without the line, and offers the decision', () => {
    for (const status of ['pendingManager', 'pendingHr'] as const) {
      const routed = leave({ status, approvalTrail: null });
      expect(mayDecideOn(routed)).toBe(true);
      expect(showsDeskCard(routed)).toBe(true);
      expect(showsHandedToHr(routed)).toBe(false);
    }
  });
});
