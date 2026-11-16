// What a stage page is allowed to offer — the rule, without a page.
//
// The bug this pins: a page decided from the status of its OWN record, so a candidate at the
// security check was still offered «بدء المقابلة» and «تعديل القرار» on their screening and
// «نقل لمرحلة عرض العمل» on their first interview. The rule now comes from the server's answer,
// and these are the cases that answer has to get right.
import { describe, expect, it } from 'vitest';
import { type StageRecordStateDto, type WorkflowActionDto, type WorkflowStateDto } from '@ecms/contracts';
import { stageAuthorityOf } from './useStageAuthority';

const state = (
  records: StageRecordStateDto[],
  actions: WorkflowActionDto[] = [],
  applicantStatus = 'new',
): WorkflowStateDto => ({
  applicantId: 'app-1',
  applicantCode: 'APP-0001',
  applicantStatus,
  stage: null,
  status: null,
  attempt: 1,
  placement: { jobTitleId: null, departmentId: null, branchId: null, sectionId: null },
  placementLabel: { position: null, branch: null, department: null },
  stageRecords: records,
  availableActions: actions,
});

const record = (
  over: Partial<StageRecordStateDto> & Pick<StageRecordStateDto, 'recordId'>,
): StageRecordStateDto => ({
  key: 'screening',
  status: 'waiting',
  attempt: 1,
  passed: false,
  correctable: true,
  ...over,
});

describe('stageAuthorityOf — fail closed', () => {
  it('offers nothing until the server has answered', () => {
    const authority = stageAuthorityOf(undefined);
    expect(authority.ready).toBe(false);
    // Hiding a button on a page that has not heard back is the whole point: showing it would be
    // showing it on exactly the evidence that misled the old pages.
    expect(authority.isPassed('scr-1')).toBe(true);
    expect(authority.isLive('scr-1')).toBe(false);
    expect(authority.may('moveToOffer')).toBe(false);
    expect(authority.closed).toBe(false);
  });

  it('treats a record the state does not list as past — a superseded attempt is read-only (I1)', () => {
    const authority = stageAuthorityOf(state([record({ recordId: 'scr-1' })]));
    expect(authority.isPassed('an-old-attempt')).toBe(true);
    expect(authority.isLive('an-old-attempt')).toBe(false);
  });
});

describe('stageAuthorityOf — a stage the candidate has moved past', () => {
  const atSecurityCheck = state([
    record({ recordId: 'scr-1', key: 'screening', status: 'accepted', passed: true }),
    record({ recordId: 'iv-1', key: 'interview:a', status: 'completed', passed: true }),
    record({ recordId: 'ev-sec', key: 'evaluation:sec', status: 'waiting', passed: false }),
    record({ recordId: 'ev-med', key: 'evaluation:med', status: 'waiting', passed: false }),
  ]);

  it('closes the screening and the finished interview', () => {
    const authority = stageAuthorityOf(atSecurityCheck);
    expect(authority.isPassed('scr-1')).toBe(true);
    expect(authority.isPassed('iv-1')).toBe(true);
  });

  it('leaves BOTH checks live — phases are parallel', () => {
    const authority = stageAuthorityOf(atSecurityCheck);
    expect(authority.isPassed('ev-sec')).toBe(false);
    expect(authority.isPassed('ev-med')).toBe(false);
    expect(authority.isLive('ev-sec')).toBe(true);
    expect(authority.isLive('ev-med')).toBe(true);
  });

  it('does not call a decided record live, even while it is the furthest one', () => {
    const authority = stageAuthorityOf(
      state([record({ recordId: 'ev-sec', key: 'evaluation:sec', status: 'approved', passed: false })]),
    );
    expect(authority.isPassed('ev-sec')).toBe(false);
    expect(authority.isLive('ev-sec')).toBe(false);
  });
});

describe('stageAuthorityOf — correcting a decision (D7)', () => {
  it('offers a correction on a PAST stage while nothing has been built on it', () => {
    // The screening is past — the round it opened exists — and that round is still untouched, so
    // «تعديل القرار» is right even though every forward action on the screening is gone. This is
    // the case a single `passed` flag could not express.
    const authority = stageAuthorityOf(
      state([
        record({ recordId: 'scr-1', key: 'screening', status: 'accepted', passed: true, correctable: true }),
        record({ recordId: 'iv-1', key: 'interview:a', status: 'waiting', passed: false }),
      ]),
    );
    expect(authority.isPassed('scr-1')).toBe(true);
    expect(authority.isCorrectable('scr-1')).toBe(true);
  });

  it('withdraws the correction once somebody has acted on what the decision opened', () => {
    const authority = stageAuthorityOf(
      state([
        record({ recordId: 'scr-1', key: 'screening', status: 'accepted', passed: true, correctable: false }),
        record({ recordId: 'iv-1', key: 'interview:a', status: 'inProgress', passed: false }),
      ]),
    );
    expect(authority.isCorrectable('scr-1')).toBe(false);
  });

  it('offers nothing before the server has answered', () => {
    expect(stageAuthorityOf(undefined).isCorrectable('scr-1')).toBe(false);
  });
});

describe('stageAuthorityOf — moving to the Job Offer stage', () => {
  // The offer runs ALONGSIDE the checks — HR starts it when they decide to, and clearing the last
  // check moves the candidate by itself. So availability is the server's answer about the
  // CANDIDATE, and whether the button is drawn is the page's answer about the STAGE it sits on.
  const canMove: WorkflowActionDto[] = [
    { key: 'moveToOffer', permission: 'applicant.moveToOffer', enabled: true, reason: null },
  ];

  it('is available while a check is still open — that is the designed path, not a skip', () => {
    const authority = stageAuthorityOf(
      state([record({ recordId: 'ev-med', key: 'evaluation:med' })], canMove),
    );
    expect(authority.may('moveToOffer')).toBe(true);
  });

  it('is unavailable once it has happened, and says so rather than saying it is blocked', () => {
    const authority = stageAuthorityOf(
      state(
        [record({ recordId: 'ev-med', key: 'evaluation:med' })],
        [
          {
            key: 'moveToOffer',
            permission: 'applicant.moveToOffer',
            enabled: false,
            reason: 'already in the Job Offer stage',
          },
        ],
      ),
    );
    expect(authority.may('moveToOffer')).toBe(false);
  });

  it('is not drawn on a stage the candidate has left — the page asks isPassed, not may()', () => {
    const authority = stageAuthorityOf(
      state(
        [
          record({ recordId: 'iv-1', key: 'interview:a', status: 'completed', passed: true }),
          record({ recordId: 'ev-med', key: 'evaluation:med' }),
        ],
        canMove,
      ),
    );
    // The candidate may be moved…
    expect(authority.may('moveToOffer')).toBe(true);
    // …but the finished first interview is not the place to offer it from.
    expect(authority.isPassed('iv-1')).toBe(true);
    expect(authority.isPassed('ev-med')).toBe(false);
  });
});

describe('stageAuthorityOf — the candidate has left the pipeline', () => {
  it('reports closed for a withdrawn candidate', () => {
    expect(stageAuthorityOf(state([], [], 'withdrawn')).closed).toBe(true);
    expect(stageAuthorityOf(state([], [], 'hired')).closed).toBe(true);
    expect(stageAuthorityOf(state([], [], 'new')).closed).toBe(false);
  });
});
