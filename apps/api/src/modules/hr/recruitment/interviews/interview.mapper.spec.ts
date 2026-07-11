import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toInterviewDto } from './interview.mapper';
import { type InterviewDoc } from './interview.model';

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
    interviewerIds: [],
    location: null,
    notes: null,
    evaluations: [],
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
  it('leaves decision null while scheduled and maps the panel + stage snapshot', () => {
    const panel = [new Types.ObjectId(), new Types.ObjectId()];
    const dto = toInterviewDto(baseDoc({ interviewerIds: panel }));
    expect(dto.status).toBe('scheduled');
    expect(dto.outcome).toBe('pending');
    expect(dto.decision).toBeNull();
    expect(dto.stageName).toEqual({ ar: 'المقابلة الأولى', en: 'First Interview' });
    expect(dto.interviewerIds).toEqual(panel.map(String));
  });

  it('maps per-interviewer evaluations', () => {
    const interviewer = new Types.ObjectId();
    const dto = toInterviewDto(
      baseDoc({
        evaluations: [
          {
            interviewerId: interviewer,
            recommendation: 'recommend',
            rating: 4,
            notes: 'solid',
            submittedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ],
      }),
    );
    expect(dto.evaluations).toEqual([
      {
        interviewerId: String(interviewer),
        recommendation: 'recommend',
        rating: 4,
        notes: 'solid',
        submittedAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
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
