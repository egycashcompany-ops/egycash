// The rule this feature lives or dies on: a blank cell must never erase what somebody typed in.
//
// An HR roster export carries the columns the roster has. The registry also holds addresses,
// phones and qualifications that HR filled in by hand afterwards. If a blank cell overwrote, every
// upload would quietly undo that work — and the report would say "no changes" while doing it.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  desiredFrom,
  diffPerson,
  readPath,
  sameValue,
  setFrom,
  type ExistingEmployee,
  type ResolvedPlacement,
} from './sync';
import { type SourceRow } from './plan';

const BRANCH = '507f1f77bcf86cd799439011';
const DEPARTMENT = '507f1f77bcf86cd799439012';
const SECTION = '507f1f77bcf86cd799439013';
const JOB = '507f1f77bcf86cd799439014';

const placement: ResolvedPlacement = {
  branchId: BRANCH,
  departmentId: DEPARTMENT,
  sectionId: SECTION,
  jobTitleId: JOB,
};

/** A row with nothing filled in but the fields the planner already refuses a row without. */
const blankRow = (over: Partial<SourceRow> = {}): SourceRow => ({
  sheet: 'master',
  rowNumber: 2,
  code: '0100004',
  nationalId: null,
  fullNameAr: 'جمال احمد محمد',
  fullNameEn: null,
  hiredAt: new Date('2020-01-05T00:00:00.000Z'),
  branchName: 'المهندسين',
  departmentName: 'الصراف الالى',
  sectionName: 'التشغيل',
  jobTitleName: 'اخصائى صراف الى',
  primaryPhone: null,
  emergencyPhone: null,
  addressLine: null,
  governorate: null,
  maritalStatus: null,
  religion: null,
  nationalIdExpiry: null,
  drivingLicenseExpiry: null,
  military: { status: null, certificateRef: null, completedAt: null },
  education: {
    level: null,
    qualification: null,
    specialization: null,
    institution: null,
    graduationYear: null,
  },
  additionalQualification: { qualification: null, institution: null, year: null },
  hasPriorExperience: false,
  incentive: null,
  insurance: {
    insuranceNumber: null,
    occupation: null,
    occupationCode: null,
    grossWage: null,
    contributionWage: null,
    basicWage: null,
    employerShare: null,
    employeeShare: null,
    status: null,
  },
  officer: {
    reserveOfficer: false,
    rank: null,
    weaponLicenseType: null,
    weaponLicenseExpiry: null,
    professionPractice: false,
    retirementDate: null,
  },
  exit: null,
  ...over,
});

/** An employee already in the registry, placed exactly where the row places them. */
const stored = (over: Partial<ExistingEmployee> = {}): ExistingEmployee => ({
  personal: {
    fullNameAr: 'جمال احمد محمد',
    fullNameEn: null,
    searchName: 'جمال احمد محمد',
    nationalId: null,
    contact: { primaryPhone: '01125232225', secondaryPhone: null },
    maritalStatus: null,
    religion: null,
    nationalIdExpiry: null,
    currentAddress: null,
    military: null,
    education: null,
    drivingLicenses: [],
  },
  insurance: null,
  officer: { reserveOfficer: false, professionPractice: false, rank: null, retirementDate: null, weaponLicense: null },
  employment: {
    branchId: new Types.ObjectId(BRANCH),
    departmentId: new Types.ObjectId(DEPARTMENT),
    sectionId: new Types.ObjectId(SECTION),
    jobTitleId: new Types.ObjectId(JOB),
  },
  branchId: new Types.ObjectId(BRANCH),
  departmentId: new Types.ObjectId(DEPARTMENT),
  sectionId: new Types.ObjectId(SECTION),
  ...over,
});

describe('a blank cell changes nothing', () => {
  /** THE ONE THAT MATTERS. Everything else in this file is in service of it. */
  it('leaves an address, a phone and a qualification the system holds and the file does not', () => {
    const existing = stored();
    existing.personal.currentAddress = { line1: 'شارع ٩', city: 'القاهرة', governorate: 'القاهرة' };
    existing.personal.education = { level: 'bachelor', institution: 'جامعة القاهرة', specialization: null, graduationYear: 2004, grade: null };
    existing.personal.contact = { primaryPhone: '01125232225', secondaryPhone: '01000000000' };

    const { changes } = diffPerson(existing, blankRow(), placement);
    expect(changes.map((c) => c.path)).toEqual([]);
  });

  it('does not even offer a path for a field the file left blank', () => {
    const desired = desiredFrom(blankRow(), placement);
    expect(desired['personal.religion']).toBeUndefined();
    expect(desired['personal.currentAddress']).toBeUndefined();
    expect(desired['personal.military']).toBeUndefined();
    expect(desired['insurance.insuranceNumber']).toBeUndefined();
  });

  /** A half-filled address is worse than either address, so it takes both cells or neither. */
  it('needs both the address line and the governorate before it writes an address', () => {
    expect(desiredFrom(blankRow({ addressLine: 'شارع ٩' }), placement)['personal.currentAddress']).toBeUndefined();
    expect(desiredFrom(blankRow({ governorate: 'القاهرة' }), placement)['personal.currentAddress']).toBeUndefined();
    expect(
      desiredFrom(blankRow({ addressLine: 'شارع ٩', governorate: 'القاهرة' }), placement)[
        'personal.currentAddress'
      ],
    ).toEqual({ line1: 'شارع ٩', city: 'القاهرة', governorate: 'القاهرة' });
  });
});

describe('a filled cell that differs is a change', () => {
  it('updates a phone number', () => {
    const { changes } = diffPerson(stored(), blankRow({ primaryPhone: '01000000001' }), placement);
    expect(changes.map((c) => c.path)).toEqual(['personal.contact.primaryPhone']);
    expect(changes[0]?.from).toBe('01125232225');
    expect(changes[0]?.to).toBe('01000000001');
  });

  it('moves the search name with the name, so a renamed employee stays findable', () => {
    const { changes } = diffPerson(stored(), blankRow({ fullNameAr: 'جمال أحمد محمد على' }), placement);
    expect(changes.map((c) => c.path).sort()).toEqual(['personal.fullNameAr', 'personal.searchName']);
    expect(changes.find((c) => c.path === 'personal.searchName')?.value).toBe('جمال احمد محمد علي');
  });

  /**
   * A block that does not exist yet is written WHOLE, and that is not a stylistic choice: a dotted
   * `$set` into `null` is a MongoDB error — `insurance.grossWage` cannot be created "in element
   * {insurance: null}" — so the per-field form would fail the write for every employee who never
   * had an insurance file. It is also the more honest preview: the record gains an insurance file,
   * which is one fact rather than nine.
   */
  it('writes a whole insurance block when the registry has none, not nine dotted fields', () => {
    const row = blankRow();
    row.insurance.insuranceNumber = '17987259';
    row.insurance.grossWage = 12600;
    const { changes } = diffPerson(stored(), row, placement);
    expect(changes.map((c) => c.path)).toEqual(['insurance']);
    // Complete, so what lands is a block the schema recognises rather than a fragment. What the
    // file did not carry is recorded as absent.
    expect(changes[0]?.value).toEqual({
      insuranceNumber: '17987259',
      occupation: null,
      occupationCode: null,
      grossWage: 12600,
      contributionWage: null,
      basicWage: null,
      employerShare: null,
      employeeShare: null,
      status: null,
    });
  });

  it('goes back to per-field changes once the block exists', () => {
    const existing = stored();
    existing.insurance = { insuranceNumber: '17987259', grossWage: 12000 };
    const row = blankRow();
    row.insurance.grossWage = 12600;
    const { changes } = diffPerson(existing, row, placement);
    expect(changes.map((c) => c.path)).toEqual(['insurance.grossWage']);
  });

  /**
   * The case that produced this rule. The company's first employee was inserted by hand with
   * `insurance: null` and `officer: null`; the file carries only zeros and falses for him, which
   * say nothing. A block of nothing but defaults is not a filing, so none is created.
   */
  it('does not invent an empty block from a file that says nothing about it', () => {
    const existing = stored();
    existing.insurance = null;
    existing.officer = null;
    const { changes } = diffPerson(existing, blankRow(), placement);
    expect(changes.map((c) => c.path)).toEqual([]);
  });
});

describe('placement moves, because the file is the roster', () => {
  const MOVED = '507f1f77bcf86cd799439099';

  it('rewrites the department in the employment block AND the top-level mirror', () => {
    const { changes } = diffPerson(stored(), blankRow(), { ...placement, departmentId: MOVED });
    expect(changes.map((c) => c.path).sort()).toEqual(['departmentId', 'employment.departmentId']);
  });

  it('reads an unchanged placement as unchanged, though the document holds ObjectIds', () => {
    const { changes } = diffPerson(stored(), blankRow(), placement);
    expect(changes).toEqual([]);
  });

  it('clears a section when the file places the person in a department without one', () => {
    const { changes } = diffPerson(stored(), blankRow(), { ...placement, sectionId: null });
    expect(changes.map((c) => c.path).sort()).toEqual(['employment.sectionId', 'sectionId']);
    expect(changes[0]?.value).toBeNull();
  });
});

describe('the National ID, which is an identity and not a field', () => {
  it('fills one in when the record has none — that is a gap closing', () => {
    const { changes, refused } = diffPerson(stored(), blankRow({ nationalId: '28106012104454' }), placement);
    expect(refused).toEqual([]);
    expect(changes.map((c) => c.path)).toContain('personal.nationalId');
  });

  /** Re-identifying a human being is not something a spreadsheet cell gets to do silently. */
  it('refuses to overwrite one that disagrees, and says so', () => {
    const existing = stored();
    existing.personal.nationalId = '28106012104454';
    const { changes, refused } = diffPerson(existing, blankRow({ nationalId: '29902011601475' }), placement);
    expect(changes.map((c) => c.path)).not.toContain('personal.nationalId');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toContain('already holds a different National ID');
  });

  it('says nothing at all when it matches', () => {
    const existing = stored();
    existing.personal.nationalId = '28106012104454';
    const { changes, refused } = diffPerson(existing, blankRow({ nationalId: '28106012104454' }), placement);
    expect(refused).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe('what counts as the same value', () => {
  it('reads a stored Date and the file’s Date as one fact', () => {
    expect(sameValue(new Date('2020-01-05'), new Date('2020-01-05'))).toBe(true);
    expect(sameValue(new Date('2020-01-05'), new Date('2021-01-05'))).toBe(false);
  });

  it('reads a stored ObjectId and the file’s string id as one fact', () => {
    expect(sameValue(new Types.ObjectId(BRANCH), BRANCH)).toBe(true);
    expect(sameValue(new Types.ObjectId(BRANCH), DEPARTMENT)).toBe(false);
  });

  it('treats a missing block and an explicit null the same way', () => {
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
  });

  /** Key order out of Mongo is not the key order in the builder; comparing text would churn. */
  it('does not call an object changed for holding its keys in another order', () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('ignores a null the document stores and the file omits inside one object', () => {
    expect(sameValue({ status: 'exempted', certificateRef: null }, { status: 'exempted' })).toBe(true);
  });
});

describe('reading a path off a record whose optional blocks are null', () => {
  it('returns undefined rather than throwing when insurance was never filed', () => {
    expect(readPath(stored(), 'insurance.grossWage')).toBeUndefined();
  });

  it('finds a nested value that is there', () => {
    expect(readPath(stored(), 'personal.contact.primaryPhone')).toBe('01125232225');
  });
});

describe('the update that gets written', () => {
  it('carries the real value, not the text the report shows', () => {
    const row = blankRow({ nationalIdExpiry: new Date('2027-12-20T00:00:00.000Z') });
    const { changes } = diffPerson(stored(), row, placement);
    const set = setFrom(changes);
    expect(set['personal.nationalIdExpiry']).toBeInstanceOf(Date);
  });

  it('is empty when nothing changed, so an unchanged person is not written at all', () => {
    expect(setFrom(diffPerson(stored(), blankRow(), placement).changes)).toEqual({});
  });
});
