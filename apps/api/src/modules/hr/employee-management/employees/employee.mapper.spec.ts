import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toEmployeeDto, toRehireCheckResultDto } from './employee.mapper';
import {
  type EmployeeDoc,
  type EmployeePersonalData,
  type EmploymentDetails,
} from './employee.model';

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

const personal = (over: Partial<EmployeePersonalData> = {}): EmployeePersonalData => ({
  fullNameAr: 'أحمد محمد',
  fullNameEn: 'Ahmed Mohamed',
  searchName: 'احمد محمد',
  nationalId: '29001011234567',
  birthDate: new Date('1990-01-01T00:00:00.000Z'),
  gender: 'male',
  nationality: 'Egyptian',
  placeOfBirth: 'Cairo',
  photoFileId: null,
  maritalStatus: 'married',
  religion: null,
  nationalIdExpiry: null,
  dependentsCount: 2,
  contact: { primaryPhone: '+201000000001', secondaryPhone: null, email: null, preferredContactChannel: null },
  officialAddress: null,
  currentAddress: null,
  military: null,
  education: null,
  experience: [],
  drivingLicenses: [],
  certifications: [],
  references: [],
  ...over,
});

const baseDoc = (over: Partial<EmployeeDoc> = {}): EmployeeDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeNumber: '000125',
    code: '001000125',
    status: 'probation',
    origin: 'recruitment',
    personal: personal(),
    probation: {
      endDate: new Date('2026-12-20T00:00:00.000Z'),
      confirmedAt: null,
      confirmedBy: null,
      extendedTo: null,
      failed: false,
    },
    exit: null,
    employmentPeriods: [{ hiredAt: new Date('2026-09-20T00:00:00.000Z'), exitedAt: null, exitType: null }],
    actionSeq: 1,
    statusHistory: [],
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

const visible = { compensationVisible: true };

describe('toEmployeeDto', () => {
  it('maps the permanent Global Employee Number, derived code, status, and hiring date', () => {
    const dto = toEmployeeDto(baseDoc(), visible);
    expect(dto.employeeNumber).toBe('000125');
    expect(dto.code).toBe('001000125'); // <CurrentBranchCode><GlobalEmployeeNumber>
    expect(dto.status).toBe('probation');
    expect(dto.origin).toBe('recruitment');
    expect(dto.userId).toBeNull();
    expect(dto.offerCode).toBe('JO-2026-000001');
    expect(dto.acceptedOfferRevision).toBe(2);
    expect(dto.hiredAt).toBe('2026-09-20T00:00:00.000Z');
    expect(dto.probation).toEqual({
      endDate: '2026-12-20T00:00:00.000Z',
      confirmedAt: null,
      confirmedBy: null,
      extendedTo: null,
      failed: false,
    });
    expect(dto.employmentPeriods).toEqual([
      { hiredAt: '2026-09-20T00:00:00.000Z', exitedAt: null, exitType: null },
    ]);
  });

  it('ALWAYS masks the national id (Security Architecture §3)', () => {
    const dto = toEmployeeDto(baseDoc(), visible);
    expect(dto.personal.nationalIdMasked).not.toBe('29001011234567');
    expect(dto.personal.nationalIdMasked).toContain('*');
  });

  it('redacts salary and allowances without employee.viewCompensation', () => {
    const dto = toEmployeeDto(baseDoc(), { compensationVisible: false });
    expect(dto.compensationVisible).toBe(false);
    expect(dto.employment.salary).toBeNull();
    expect(dto.employment.allowances).toEqual([]);
    // Non-compensation employment facts stay visible.
    expect(dto.employment.employmentType).toBe('fullTime');
    expect(dto.employment.benefits).toEqual(['medical insurance']);
  });

  it('surfaces the copied employment terms for compensation viewers', () => {
    const dto = toEmployeeDto(baseDoc(), visible);
    expect(dto.compensationVisible).toBe(true);
    expect(dto.employment.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.employment.allowances).toEqual([{ name: 'transport', amount: 1000, currency: 'EGP' }]);
    expect(dto.employment.probationMonths).toBe(3);
    expect(dto.employment.startDate).toBe('2026-10-01T00:00:00.000Z');
  });

  it('maps null recruitment references for a direct registration', () => {
    const dto = toEmployeeDto(
      baseDoc({
        origin: 'direct',
        applicantId: null,
        applicantCode: null,
        jobRequisitionId: null,
        jobOfferId: null,
        offerCode: null,
        acceptedOfferRevision: null,
      }),
      visible,
    );
    expect(dto.origin).toBe('direct');
    expect(dto.applicantId).toBeNull();
    expect(dto.jobOfferId).toBeNull();
    expect(dto.acceptedOfferRevision).toBeNull();
  });

  it('maps a typed exit', () => {
    const dto = toEmployeeDto(
      baseDoc({
        status: 'exited',
        exit: {
          type: 'resignation',
          reason: 'moving abroad',
          effectiveDate: new Date('2027-01-31T00:00:00.000Z'),
          eligibleForRehire: true,
          by: null,
        },
      }),
      visible,
    );
    expect(dto.status).toBe('exited');
    expect(dto.exit).toEqual({
      type: 'resignation',
      reason: 'moving abroad',
      effectiveDate: '2027-01-31T00:00:00.000Z',
      eligibleForRehire: true,
      by: null,
    });
  });
});

describe('toRehireCheckResultDto', () => {
  it('surfaces the identity + exit needed by the Rehire prompt', () => {
    const doc = baseDoc({
      status: 'exited',
      exit: {
        type: 'termination',
        reason: null,
        effectiveDate: new Date('2027-01-31T00:00:00.000Z'),
        eligibleForRehire: false,
        by: null,
      },
    });
    const dto = toRehireCheckResultDto(doc);
    expect(dto.employeeNumber).toBe('000125');
    expect(dto.fullNameAr).toBe('أحمد محمد');
    expect(dto.status).toBe('exited');
    expect(dto.exit?.eligibleForRehire).toBe(false);
  });
});
