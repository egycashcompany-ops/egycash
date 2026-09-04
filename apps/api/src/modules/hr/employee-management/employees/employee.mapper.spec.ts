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
  managerId: new Types.ObjectId(),
  employmentType: 'fullTime',
  salary: { amount: 15000, currency: 'EGP' },
  salarySource: 'manual',
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
    insurance: null,
    officer: null,
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

const visible = { compensationVisible: true, insuranceVisible: true, officerVisible: true };

describe('toEmployeeDto', () => {
  it('maps the permanent Global Employee Number, derived code, status, and hiring date', () => {
    const dto = toEmployeeDto(baseDoc(), visible);
    expect(dto.employeeNumber).toBe('000125');
    expect(dto.code).toBe('001000125'); // <BranchCodeAtHire><GlobalEmployeeNumber>, stored as issued
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
    const dto = toEmployeeDto(baseDoc(), { ...visible, compensationVisible: false });
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

  /**
   * The insurance and officer blocks, and the thing that makes them worth testing separately: each
   * is `null` both when it was never filed AND when the caller may not read it, so the flag beside
   * it is the only way to tell those apart. Getting that pair wrong does not fail a build — it
   * either leaks a wage bracket or tells the UI an employee has no insurance file when they do.
   */
  const INSURANCE = {
    insuranceNumber: '17987259',
    occupation: 'اخصائي موارد بشرية',
    occupationCode: '194200',
    grossWage: 12600,
    contributionWage: 12600,
    basicWage: 2370,
    employerShare: 2362.5,
    employeeShare: 1386,
    status: 'insured' as const,
  };

  const OFFICER = {
    reserveOfficer: true,
    rank: 'عميد',
    weaponLicense: { type: 'company' as const, expiry: new Date('2026-12-13T00:00:00.000Z') },
    professionPractice: true,
    retirementDate: new Date('2022-07-01T00:00:00.000Z'),
  };

  it('surfaces the insurance file for a viewer, dates as ISO strings', () => {
    const dto = toEmployeeDto(baseDoc({ insurance: INSURANCE }), visible);
    expect(dto.insuranceVisible).toBe(true);
    expect(dto.insurance).toEqual(INSURANCE);
  });

  it('redacts the insurance file without employee.viewInsurance', () => {
    const dto = toEmployeeDto(baseDoc({ insurance: INSURANCE }), {
      ...visible,
      insuranceVisible: false,
    });
    expect(dto.insurance).toBeNull();
    expect(dto.insuranceVisible).toBe(false);
  });

  it('distinguishes "no insurance file" from "redacted" by the flag alone', () => {
    const absent = toEmployeeDto(baseDoc({ insurance: null }), visible);
    expect(absent.insurance).toBeNull();
    // The payload matches the redacted case above; only the flag separates them.
    expect(absent.insuranceVisible).toBe(true);
  });

  it('surfaces the officer profile for a viewer', () => {
    const dto = toEmployeeDto(baseDoc({ officer: OFFICER }), visible);
    expect(dto.officerVisible).toBe(true);
    expect(dto.officer).toEqual({
      reserveOfficer: true,
      rank: 'عميد',
      weaponLicense: { type: 'company', expiry: '2026-12-13T00:00:00.000Z' },
      professionPractice: true,
      retirementDate: '2022-07-01T00:00:00.000Z',
    });
  });

  it('redacts the officer profile without employee.viewOfficer', () => {
    const dto = toEmployeeDto(baseDoc({ officer: OFFICER }), { ...visible, officerVisible: false });
    expect(dto.officer).toBeNull();
    expect(dto.officerVisible).toBe(false);
  });

  it('gates the three blocks independently — one permission never opens another', () => {
    const dto = toEmployeeDto(baseDoc({ insurance: INSURANCE, officer: OFFICER }), {
      compensationVisible: false,
      insuranceVisible: true,
      officerVisible: false,
    });
    expect(dto.employment.salary).toBeNull();
    expect(dto.insurance).not.toBeNull();
    expect(dto.officer).toBeNull();
  });

  it('never lets an insurance wage reach the employment salary', () => {
    // The whole reason the two are separate: `basicWage` is a statutory bracket, not pay.
    const dto = toEmployeeDto(baseDoc({ insurance: INSURANCE }), visible);
    expect(dto.employment.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.insurance?.basicWage).toBe(2370);
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
