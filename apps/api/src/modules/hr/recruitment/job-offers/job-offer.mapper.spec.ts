import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toJobOfferDto } from './job-offer.mapper';
import { type JobOfferDoc, type OfferTerms } from './job-offer.model';

const terms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  jobTitleId: new Types.ObjectId(),
  departmentId: new Types.ObjectId(),
  branchId: new Types.ObjectId(),
  managerId: new Types.ObjectId(),
  employmentType: 'fullTime',
  salary: { amount: 15000, currency: 'EGP' },
  allowances: [{ name: 'transport', amount: 1000, currency: 'EGP' }],
  benefits: ['medical insurance'],
  probationMonths: 3,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  validUntil: new Date('2026-09-15T00:00:00.000Z'),
  notes: null,
  ...over,
});

const baseDoc = (over: Partial<JobOfferDoc>): JobOfferDoc =>
  ({
    _id: new Types.ObjectId(),
    code: 'JO-2026-000001',
    applicantId: new Types.ObjectId(),
    applicantCode: 'APP-2026-000001',
    branchId: new Types.ObjectId(),
    status: 'draft',
    active: true,
    terms: terms(),
    revisionNumber: 1,
    revisions: [],
    acceptedSnapshot: null,
    sentAt: null,
    sentBy: null,
    respondedAt: null,
    responseNote: null,
    rejectionReason: null,
    withdrawnReason: null,
    withdrawnBy: null,
    withdrawnAt: null,
    expiredAt: null,
    __v: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  }) as JobOfferDoc;

describe('toJobOfferDto', () => {
  it('maps the package terms, salary, allowances, and benefits', () => {
    const dto = toJobOfferDto(baseDoc({}));
    expect(dto.code).toBe('JO-2026-000001');
    expect(dto.status).toBe('draft');
    expect(dto.active).toBe(true);
    expect(dto.acceptedSnapshot).toBeNull();
    expect(dto.terms.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.terms.allowances).toEqual([{ name: 'transport', amount: 1000, currency: 'EGP' }]);
    expect(dto.terms.benefits).toEqual(['medical insurance']);
    expect(dto.terms.employmentType).toBe('fullTime');
    expect(dto.terms.startDate).toBe('2026-10-01T00:00:00.000Z');
    expect(dto.terms.validUntil).toBe('2026-09-15T00:00:00.000Z');
    expect(dto.revisions).toEqual([]);
  });

  it('surfaces revision history oldest-first with the superseded terms', () => {
    const reviser = new Types.ObjectId();
    const dto = toJobOfferDto(
      baseDoc({
        revisionNumber: 2,
        revisions: [
          {
            revisionNumber: 1,
            terms: terms({ salary: { amount: 12000, currency: 'EGP' } }),
            revisedBy: reviser,
            revisedAt: new Date('2026-09-02T00:00:00.000Z'),
          },
        ],
      }),
    );
    expect(dto.revisionNumber).toBe(2);
    expect(dto.revisions).toHaveLength(1);
    expect(dto.revisions[0]?.revisionNumber).toBe(1);
    expect(dto.revisions[0]?.terms.salary?.amount).toBe(12000);
    expect(dto.revisions[0]?.revisedBy).toBe(String(reviser));
  });

  it('exposes the response/terminal fields once set', () => {
    const dto = toJobOfferDto(
      baseDoc({
        status: 'accepted',
        active: false,
        sentAt: new Date('2026-09-03T00:00:00.000Z'),
        respondedAt: new Date('2026-09-04T00:00:00.000Z'),
        responseNote: 'delighted to join',
      }),
    );
    expect(dto.status).toBe('accepted');
    expect(dto.active).toBe(false);
    expect(dto.sentAt).toBe('2026-09-03T00:00:00.000Z');
    expect(dto.respondedAt).toBe('2026-09-04T00:00:00.000Z');
    expect(dto.responseNote).toBe('delighted to join');
  });

  it('surfaces the frozen accepted snapshot (the exact accepted revision)', () => {
    const dto = toJobOfferDto(
      baseDoc({
        status: 'accepted',
        active: false,
        acceptedSnapshot: {
          revisionNumber: 2,
          terms: terms({ salary: { amount: 18000, currency: 'EGP' } }),
          acceptedAt: new Date('2026-09-04T00:00:00.000Z'),
        },
      }),
    );
    expect(dto.acceptedSnapshot?.revisionNumber).toBe(2);
    expect(dto.acceptedSnapshot?.terms.salary?.amount).toBe(18000);
    expect(dto.acceptedSnapshot?.acceptedAt).toBe('2026-09-04T00:00:00.000Z');
  });
});
