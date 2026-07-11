import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toInterviewDto } from './interview.mapper';
import { type InterviewDoc, type InterviewPanelist } from './interview.model';

const panelist = (over: Partial<InterviewPanelist> = {}): InterviewPanelist => ({
  interviewerId: new Types.ObjectId(),
  state: 'pending',
  recommendation: null,
  rating: null,
  notes: null,
  submittedAt: null,
  ...over,
});

const baseDoc = (over: Partial<InterviewDoc>): InterviewDoc =>
  ({
    _id: new Types.ObjectId(),
    applicantId: new Types.ObjectId(),
    applicantCode: 'APP-2026-000001',
    branchId: null,
    stageId: new Types.ObjectId(),
    stageOrder: 1,
    stageName: { ar: 'المقابلة الأولى', en: 'First Interview' },
    status: 'scheduled',
    outcome: 'pending',
    scheduledAt: new Date('2026-08-01T09:00:00.000Z'),
    panel: [],
    location: null,
    notes: null,
    rescheduleCount: 0,
    decisionNotes: null,
    decidedBy: null,
    decidedAt: null,
    cancelledReason: null,
    cancelledBy: null,
    cancelledAt: null,
    __v: 0,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...over,
  }) as InterviewDoc;

describe('toInterviewDto', () => {
  it('leaves decision null while scheduled and maps the panel with per-member state', () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const dto = toInterviewDto(
      baseDoc({
        panel: [
          panelist({ interviewerId: a, state: 'pending' }),
          panelist({ interviewerId: b, state: 'skipped' }),
        ],
      }),
    );
    expect(dto.status).toBe('scheduled');
    expect(dto.decision).toBeNull();
    expect(dto.stageName).toEqual({ ar: 'المقابلة الأولى', en: 'First Interview' });
    expect(dto.panel).toEqual([
      { interviewerId: String(a), state: 'pending', recommendation: null, rating: null, notes: null, submittedAt: null },
      { interviewerId: String(b), state: 'skipped', recommendation: null, rating: null, notes: null, submittedAt: null },
    ]);
  });

  it('maps a submitted panel member evaluation', () => {
    const interviewer = new Types.ObjectId();
    const dto = toInterviewDto(
      baseDoc({
        panel: [
          panelist({
            interviewerId: interviewer,
            state: 'submitted',
            recommendation: 'recommend',
            rating: 4,
            notes: 'solid',
            submittedAt: new Date('2026-08-01T10:00:00.000Z'),
          }),
        ],
      }),
    );
    expect(dto.panel[0]).toEqual({
      interviewerId: String(interviewer),
      state: 'submitted',
      recommendation: 'recommend',
      rating: 4,
      notes: 'solid',
      submittedAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('derives a decision block from a completed interview', () => {
    const decider = new Types.ObjectId();
    const dto = toInterviewDto(
      baseDoc({
        status: 'completed',
        outcome: 'passed',
        decisionNotes: 'advance to next round',
        decidedBy: decider,
        decidedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
    );
    expect(dto.decision).toEqual({
      outcome: 'passed',
      notes: 'advance to next round',
      decidedBy: String(decider),
      decidedAt: '2026-08-02T00:00:00.000Z',
    });
  });
});
