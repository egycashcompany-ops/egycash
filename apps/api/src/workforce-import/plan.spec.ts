// The planner's three jobs, tested against the exact situations the go-live workbook contains.
import { describe, expect, it } from 'vitest';
import { buildPlan, type SourceRow } from './plan';

const row = (over: Partial<SourceRow> & Pick<SourceRow, 'sheet' | 'rowNumber'>): SourceRow => ({
  code: '0100004',
  nationalId: '28106012104454',
  fullNameAr: 'جمال احمد محمد',
  fullNameEn: null,
  hiredAt: new Date('2020-01-05T00:00:00.000Z'),
  branchName: 'المهندسين',
  departmentName: 'الصراف الالى',
  sectionName: 'التشغيل',
  jobTitleName: 'اخصائى صراف الى',
  primaryPhone: '01125232225',
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

const exited = (over: Partial<SourceRow> & Pick<SourceRow, 'rowNumber'>): SourceRow =>
  row({
    sheet: 'resignation',
    exit: {
      type: 'resignation',
      effectiveDate: new Date('2021-02-28T00:00:00.000Z'),
      reason: 'استقالة',
      note: null,
    },
    ...over,
  });

describe('identity — who is this person', () => {
  it('takes the employee code apart into the branch that hired them and their number', () => {
    const { people } = buildPlan([row({ sheet: 'master', rowNumber: 2, code: '0401250' })]);
    expect(people).toHaveLength(1);
    expect(people[0]?.code).toBe('0401250'); // verbatim — never recomposed
    expect(people[0]?.branchCodeAtHire).toBe('040');
    expect(people[0]?.employeeNumber).toBe('1250');
  });

  /**
   * The case a code-keyed join gets wrong. 28 people appear on both sheets but only 21 share a
   * code — SEVEN were rehired under a new one. Keyed on the code, those seven are created twice,
   * as two people who are one person, and the second creation hits the national-id guard.
   */
  it('joins the two sheets by national ID, not by code', () => {
    const { people } = buildPlan([
      exited({ rowNumber: 40, code: '0100226', nationalId: '29902011601475' }),
      row({
        sheet: 'master',
        rowNumber: 88,
        code: '0502001',
        nationalId: '29902011601475',
        // A genuine rehire starts AFTER the exit — true of 25 of the 28 who appear on both sheets.
        hiredAt: new Date('2023-06-01T00:00:00.000Z'),
      }),
    ]);
    expect(people).toHaveLength(1);
    // Their code today is the one the company knows them by today.
    expect(people[0]?.code).toBe('0502001');
    expect(people[0]?.spells).toHaveLength(2);
    expect(people[0]?.serving).toBe(true);
  });

  /**
   * Five go-live rows carry no national ID. The registry derives birth date, gender and place of
   * birth from it and builds the one-person-forever guard on it, so a row without one cannot become
   * an employee — it is reported as a cell to fill in rather than given a fabricated identity.
   */
  it('rejects a row with no national ID, naming what is missing', () => {
    const { people, rejected } = buildPlan([
      row({ sheet: 'master', rowNumber: 5, code: '0100777', nationalId: null }),
    ]);
    expect(people).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('no national ID — the registry requires one');
  });

  /**
   * Two people who were both issued global number 1651 — a mistake the company made on paper and
   * has decided to keep. They are different people with different codes, so they are two plans, and
   * both keep the number they were issued: `employeeNumber` carries no unique index (ADR-017).
   */
  it('keeps two people who share a global number, with their own codes', () => {
    const { people } = buildPlan([
      exited({ rowNumber: 100, code: '0501651', nationalId: '30002170202136' }),
      exited({ rowNumber: 200, code: '0101651', nationalId: '29608050104556' }),
    ]);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.nationalId).sort()).toEqual(['29608050104556', '30002170202136']);
    expect(people.map((p) => p.employeeNumber)).toEqual(['1651', '1651']);
    expect(people.map((p) => p.code).sort()).toEqual(['0101651', '0501651']);
  });
});

describe('order — the sequence the registry must be walked in', () => {
  /**
   * A rehire needs the person to EXIST and be exited first. Built the other way round, creating the
   * serving row first means the exit row then collides with the national-id guard and the whole
   * person fails.
   */
  it('puts exit spells before the serving row', () => {
    const { people } = buildPlan([
      row({ sheet: 'master', rowNumber: 9, hiredAt: new Date('2023-06-01T00:00:00.000Z') }),
      exited({ rowNumber: 3 }),
    ]);
    expect(people[0]?.spells.map((s) => s.sheet)).toEqual(['resignation', 'master']);
    expect(people[0]?.current.sheet).toBe('master');
  });

  it('orders two exits oldest first', () => {
    const { people } = buildPlan([
      exited({ rowNumber: 20, hiredAt: new Date('2018-05-01T00:00:00.000Z') }),
      exited({ rowNumber: 10, hiredAt: new Date('2015-03-01T00:00:00.000Z') }),
    ]);
    expect(people[0]?.spells.map((s) => s.rowNumber)).toEqual([10, 20]);
  });

  it('marks a person who never returned as not serving', () => {
    const { people } = buildPlan([exited({ rowNumber: 7 })]);
    expect(people[0]?.serving).toBe(false);
    expect(people[0]?.current.sheet).toBe('resignation');
  });
});

describe('refusal — rows that cannot become anything true', () => {
  /**
   * Q4, and the reason it is a refusal rather than a merge: three codes appear twice with the SAME
   * hire and exit dates. That is one employment entered twice, not somebody who left and came back,
   * and importing it as two spells would invent a period of service that never happened.
   */
  it('rejects a person whose rows are two copies of one employment', () => {
    const { people, rejected } = buildPlan([
      exited({ rowNumber: 11, code: '0100417' }),
      exited({ rowNumber: 12, code: '0100417' }),
    ]);
    expect(people).toHaveLength(0);
    expect(rejected).toHaveLength(2); // the whole person is held back, not an arbitrary half
    expect(rejected[0]?.reason).toContain('conflicting duplicate rows');
    expect(rejected[0]?.reason).toContain('exit date');
  });

  it('still refuses when only the hire dates match — one period cannot start twice', () => {
    const { rejected } = buildPlan([
      exited({ rowNumber: 11, exit: { type: 'resignation', effectiveDate: new Date('2021-01-01T00:00:00.000Z'), reason: 'استقالة', note: null } }),
      exited({ rowNumber: 12, exit: { type: 'resignation', effectiveDate: new Date('2022-01-01T00:00:00.000Z'), reason: 'استقالة', note: null } }),
    ]);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).not.toContain('exit date');
  });

  it('accepts a genuine second spell — different hire dates are two employments', () => {
    const { people, rejected } = buildPlan([
      exited({ rowNumber: 11, hiredAt: new Date('2015-01-01T00:00:00.000Z') }),
      exited({ rowNumber: 12, hiredAt: new Date('2019-06-01T00:00:00.000Z') }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people[0]?.spells).toHaveLength(2);
  });

  it.each([
    ['no employee code', { code: null }],
    ['no Arabic name', { fullNameAr: null }],
    ['no national ID — the registry requires one', { nationalId: null }],
    ['no hiring date', { hiredAt: null }],
    ['no site (الموقع)', { branchName: null }],
    ['no department (الإدارة)', { departmentName: null }],
    ['no job title (الوظيفة)', { jobTitleName: null }],
  ])('rejects a row with %s', (reason, over) => {
    const { rejected } = buildPlan([row({ sheet: 'master', rowNumber: 4, ...over })]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe(reason);
  });

  /** Six go-live rows carry an exit date with no reason. That is a cell to fill in, not a
   *  vocabulary gap, and the report has to say which so somebody knows what to do about it. */
  it('tells a blank exit reason apart from an unrecognised one', () => {
    const blank = buildPlan([
      exited({
        rowNumber: 9,
        exit: { type: null, effectiveDate: new Date('2024-03-31T00:00:00.000Z'), reason: null, note: null },
      }),
    ]);
    expect(blank.rejected[0]?.reason).toBe('exit reason is blank — fill it in and re-run');
  });

  it('rejects an exit row whose reason could not be mapped, naming the reason', () => {
    const { rejected } = buildPlan([
      exited({
        rowNumber: 5,
        exit: { type: null, effectiveDate: new Date(), reason: 'سبب غريب', note: null },
      }),
    ]);
    expect(rejected[0]?.reason).toContain('سبب غريب');
  });

  /**
   * The other half of the cross-sheet rule. A person cannot be serving AND exited for the same
   * employment; three people in the go-live sheet are recorded that way, and a genuine rehire is
   * distinguished from them by starting later.
   */
  it('rejects someone recorded as serving and exited for the SAME hire date', () => {
    const { people, rejected } = buildPlan([
      exited({
        rowNumber: 50,
        code: '0100313',
        hiredAt: new Date('2022-02-01T00:00:00.000Z'),
        exit: {
          type: 'resignation',
          effectiveDate: new Date('2025-10-31T00:00:00.000Z'),
          reason: 'استقالة',
          note: null,
        },
      }),
      row({
        sheet: 'master',
        rowNumber: 60,
        code: '0100313',
        hiredAt: new Date('2022-02-01T00:00:00.000Z'),
      }),
    ]);
    expect(people).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toContain('conflicting duplicate rows');
  });

  /** Two go-live rows end before they begin. One of the two dates is wrong and nothing can say which. */
  it('rejects an exit dated before the hire', () => {
    const { rejected } = buildPlan([
      exited({
        rowNumber: 70,
        code: '0200810',
        hiredAt: new Date('2024-10-23T00:00:00.000Z'),
        exit: {
          type: 'resignation',
          effectiveDate: new Date('2024-08-27T00:00:00.000Z'),
          reason: 'استقالة',
          note: null,
        },
      }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('before the hiring date');
  });

  it('rejects a code that is not the company shape', () => {
    const { rejected } = buildPlan([row({ sheet: 'master', rowNumber: 6, code: 'ABC' })]);
    expect(rejected[0]?.reason).toContain('not <3-digit branch><4-digit number>');
  });

  /**
   * The generous direction, and the one that matters for "lose nothing": a missing address or phone
   * is NOT a reason to drop a person. Refusing them to preserve a column would lose the person.
   */
  it('imports a person whose optional columns are all empty', () => {
    const { people, rejected } = buildPlan([
      row({
        sheet: 'master',
        rowNumber: 8,
        primaryPhone: null,
        addressLine: null,
        sectionName: null,
        nationalIdExpiry: null,
      }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people).toHaveLength(1);
  });

  it('reports rejections in a stable order a human can work down', () => {
    const { rejected } = buildPlan([
      exited({ rowNumber: 30, code: null }),
      row({ sheet: 'master', rowNumber: 20, code: null }),
      row({ sheet: 'master', rowNumber: 10, code: null }),
    ]);
    expect(rejected.map((r) => [r.sheet, r.rowNumber])).toEqual([
      ['master', 10],
      ['master', 20],
      ['resignation', 30],
    ]);
  });
});
