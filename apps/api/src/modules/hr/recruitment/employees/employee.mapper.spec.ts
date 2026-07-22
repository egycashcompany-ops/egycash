import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toEmployeeDto } from './employee.mapper';
import { type EmployeeDoc, type EmploymentDetails } from './employee.model';

const employment = (over: Partial<EmploymentDetails> = {}): EmploymentDetails => ({
  jobTitleId: new Types.ObjectId(),
  departmentId: new Types.ObjectId(),
  sectionId: null,
  branchId: new Types.ObjectId(),
  jobPositionId: null,
  managerId: new Types.ObjectId(),
  employmentType: 'fullTime',
  salary: { amount: 15000, currency: 'EGP' },
  allowances: [{ name: 'transport', amount: 1000, currency: 'EGP' }],
  benefits: ['medical insurance'],
  probationMonths: 3,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
});

const baseDoc = (over: Partial<EmployeeDoc> = {}): EmployeeDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeNumber: '000125',
    code: '001000125',
    status: 'active',
    userId: null,
    applicantId: new Types.ObjectId(),
    applicantCode: 'APP-2026-000001',
    jobRequisitionId: new Types.ObjectId(),
    jobOfferId: new Types.ObjectId(),
    offerCode: 'JO-2026-000001',
    acceptedOfferRevision: 2,
    employment: employment(),
    branchId: new Types.ObjectId(),
    departmentId: new Types.ObjectId(),
    sectionId: null,
    hiredAt: new Date('2026-09-20T00:00:00.000Z'),
    __v: 0,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...over,
  }) as EmployeeDoc;

describe('toEmployeeDto', () => {
  it('maps the permanent Global Employee Number, derived code, status, and hiring date', () => {
    const dto = toEmployeeDto(baseDoc());
    expect(dto.employeeNumber).toBe('000125');
    expect(dto.code).toBe('001000125'); // <CurrentBranchCode><GlobalEmployeeNumber>
    expect(dto.status).toBe('active');
    expect(dto.userId).toBeNull();
    expect(dto.offerCode).toBe('JO-2026-000001');
    expect(dto.acceptedOfferRevision).toBe(2);
    expect(dto.hiredAt).toBe('2026-09-20T00:00:00.000Z');
  });

  it('preserves the applicant / requisition / offer references', () => {
    const applicantId = new Types.ObjectId();
    const requisitionId = new Types.ObjectId();
    const offerId = new Types.ObjectId();
    const dto = toEmployeeDto(
      baseDoc({ applicantId, jobRequisitionId: requisitionId, jobOfferId: offerId }),
    );
    expect(dto.applicantId).toBe(String(applicantId));
    expect(dto.jobRequisitionId).toBe(String(requisitionId));
    expect(dto.jobOfferId).toBe(String(offerId));
  });

  it('maps a null Job Request (direct-intake hire) to null', () => {
    const dto = toEmployeeDto(baseDoc({ jobRequisitionId: null }));
    expect(dto.jobRequisitionId).toBeNull();
  });

  it('surfaces the copied employment terms', () => {
    const dto = toEmployeeDto(baseDoc());
    expect(dto.employment.employmentType).toBe('fullTime');
    expect(dto.employment.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.employment.allowances).toEqual([{ name: 'transport', amount: 1000, currency: 'EGP' }]);
    expect(dto.employment.benefits).toEqual(['medical insurance']);
    expect(dto.employment.probationMonths).toBe(3);
    expect(dto.employment.startDate).toBe('2026-10-01T00:00:00.000Z');
  });
});
