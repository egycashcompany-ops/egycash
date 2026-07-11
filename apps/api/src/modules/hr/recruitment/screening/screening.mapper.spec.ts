import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toScreeningDto } from './screening.mapper';
import { type ScreeningDoc } from './screening.model';

const baseDoc = (over: Partial<ScreeningDoc>): ScreeningDoc =>
  ({
    _id: new Types.ObjectId(),
    applicantId: new Types.ObjectId(),
    applicantCode: 'APP-2026-000001',
    branchId: null,
    status: 'pending',
    notes: [],
    decisionReason: null,
    decidedBy: null,
    decidedAt: null,
    __v: 0,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  }) as ScreeningDoc;

describe('toScreeningDto', () => {
  it('leaves decision null while pending and maps notes with authors', () => {
    const author = new Types.ObjectId();
    const dto = toScreeningDto(
      baseDoc({
        status: 'pending',
        notes: [{ text: 'needs more info', by: author, at: new Date('2026-07-02T00:00:00.000Z') }],
      }),
    );
    expect(dto.status).toBe('pending');
    expect(dto.decision).toBeNull();
    expect(dto.notes).toEqual([
      { text: 'needs more info', by: String(author), at: '2026-07-02T00:00:00.000Z' },
    ]);
  });

  it('derives an accepted decision block from a decided screening', () => {
    const decider = new Types.ObjectId();
    const dto = toScreeningDto(
      baseDoc({
        status: 'accepted',
        decisionReason: 'strong profile',
        decidedBy: decider,
        decidedAt: new Date('2026-07-03T00:00:00.000Z'),
      }),
    );
    expect(dto.decision).toEqual({
      outcome: 'accepted',
      reason: 'strong profile',
      decidedBy: String(decider),
      decidedAt: '2026-07-03T00:00:00.000Z',
    });
  });

  it('surfaces the rejection reason in the decision block', () => {
    const dto = toScreeningDto(
      baseDoc({
        status: 'rejected',
        decisionReason: 'does not meet the minimum experience',
        decidedBy: new Types.ObjectId(),
        decidedAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
    );
    expect(dto.decision?.outcome).toBe('rejected');
    expect(dto.decision?.reason).toBe('does not meet the minimum experience');
  });
});
