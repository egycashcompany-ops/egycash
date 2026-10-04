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
   * Five go-live rows carry no national ID — four leavers and the company's own first employee,
   * hired before it kept the paperwork. They used to be refused, which kept five real people out of
   * their own company's registry to preserve a column. The registry itself never required it: the
   * employee service stores `nationalId: null` and skips the duplicate-person guard for it.
   *
   * What is NOT done here is as important: no placeholder is invented. The service DERIVES birth
   * date, gender and place of birth from this number, so a made-up one would manufacture three more
   * facts about a real person and file them as true. Absent is recorded as absent.
   */
  it('imports a person the company holds no national ID for, recording it as absent', () => {
    const { people, rejected } = buildPlan([
      row({ sheet: 'master', rowNumber: 5, code: '0100000', nationalId: null }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people).toHaveLength(1);
    expect(people[0]?.nationalId).toBeNull();
    expect(people[0]?.code).toBe('0100000');
  });

  /** With no national ID to join on, the employee code is the identity — it is unique, so two rows
   *  carrying one are the same person's two spells, not two people. */
  it('joins the sheets by code when neither row has a national ID', () => {
    const { people } = buildPlan([
      exited({ rowNumber: 40, code: '0100000', nationalId: null }),
      row({
        sheet: 'master',
        rowNumber: 88,
        code: '0100000',
        nationalId: null,
        hiredAt: new Date('2023-06-01T00:00:00.000Z'),
      }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]?.spells).toHaveLength(2);
    expect(people[0]?.serving).toBe(true);
  });

  /** The two key spaces are prefixed apart, so a person with no ID is never merged into one who has
   *  one — even if the digits were ever to line up. */
  it('keeps a person with no national ID separate from one who has one', () => {
    const { people } = buildPlan([
      row({ sheet: 'master', rowNumber: 5, code: '0100000', nationalId: null }),
      row({ sheet: 'master', rowNumber: 6, code: '0100001', nationalId: '28106012104454' }),
    ]);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.nationalId)).toEqual([null, '28106012104454']);
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
    ['no hiring date', { hiredAt: null }],
    ['no site (الموقع)', { branchName: null }],
    ['no department (الإدارة)', { departmentName: null }],
    ['no job title (الوظيفة)', { jobTitleName: null }],
  ])('rejects a row with %s', (reason, over) => {
    const { rejected } = buildPlan([row({ sheet: 'master', rowNumber: 4, ...over })]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason.en).toBe(reason);
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
    expect(blank.rejected[0]?.reason.en).toBe('exit reason is blank — fill it in and re-run');
  });

  it('rejects an exit row whose reason could not be mapped, naming the reason', () => {
    const { rejected } = buildPlan([
      exited({
        rowNumber: 5,
        exit: { type: null, effectiveDate: new Date(), reason: 'سبب غريب', note: null },
      }),
    ]);
    expect(rejected[0]?.reason.en).toContain('سبب غريب');
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
    expect(rejected[0]?.reason.en).toContain('before the hiring date');
  });

  it('rejects a code that is not the company shape', () => {
    const { rejected } = buildPlan([row({ sheet: 'master', rowNumber: 6, code: 'ABC' })]);
    expect(rejected[0]?.reason.en).toContain('not <3-digit branch><4-digit number>');
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

describe('repeated rows — one copy is kept and the person goes in', () => {
  const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
  const leaving = (
    type: 'resignation' | 'termination',
    on: string,
    reason: string,
  ): SourceRow['exit'] => ({ type, effectiveDate: day(on), reason, note: null });

  /**
   * «لو فى بيانات متكرره خد واحد منهم وضيفه .. لكن متمنعش البيانات كلها إنها تتحط». The upload
   * that prompted this had 36 leavers pasted twice, and the planner refused all 72 rows — 66 of them
   * copies that agreed on every cell. One employment entered twice is still ONE employment: one
   * spell, never an invented second period of service.
   */
  it('takes one of two identical copies and lets the person in', () => {
    const { people, rejected, disagreeing } = buildPlan([
      exited({ rowNumber: 3, code: '0102544' }),
      exited({ rowNumber: 39, code: '0102544' }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people).toHaveLength(1);
    expect(people[0]?.spells).toHaveLength(1);
    // Nothing to check: there was no choice to make between them.
    expect(disagreeing).toHaveLength(0);
  });

  /**
   * Copies that DISAGREE. The person still goes in — the owner was explicit that a repeat must not
   * keep the data out — and the LAST copy is the one kept: in a list pasted twice the lower copy is
   * the later paste. The real case: row 15 says «انقطاع», row 51 says «استقالة».
   */
  it('keeps the last of two copies that disagree, and names both rows', () => {
    const { people, rejected, disagreeing } = buildPlan([
      exited({ rowNumber: 15, code: '0101845', exit: leaving('termination', '2026-09-01', 'انقطاع') }),
      exited({ rowNumber: 51, code: '0101845', exit: leaving('resignation', '2026-09-01', 'استقالة') }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people[0]?.spells.map((s) => s.rowNumber)).toEqual([51]);
    expect(people[0]?.current.exit?.type).toBe('resignation');
    expect(disagreeing).toEqual([
      {
        code: '0101845',
        name: 'جمال احمد محمد',
        kept: { sheet: 'resignation', rowNumber: 51 },
        dropped: [{ sheet: 'resignation', rowNumber: 15 }],
      },
    ]);
  });

  it('picks by row number, not by the order the rows arrive in', () => {
    const { people } = buildPlan([
      exited({ rowNumber: 51, code: '0101845', exit: leaving('resignation', '2026-09-01', 'استقالة') }),
      exited({ rowNumber: 15, code: '0101845', exit: leaving('termination', '2026-09-01', 'انقطاع') }),
    ]);
    expect(people[0]?.spells.map((s) => s.rowNumber)).toEqual([51]);
  });

  /** A blank cell against a filled one is still a disagreement — the screen says which was used. */
  it('lists copies that differ only in a cell one of them left blank', () => {
    const blank = exited({ rowNumber: 2, code: '0102689' });
    const filled = exited({
      rowNumber: 38,
      code: '0102689',
      insurance: { ...blank.insurance, status: 'notInsured' },
    });
    const { people, disagreeing } = buildPlan([blank, filled]);
    expect(people[0]?.current.insurance.status).toBe('notInsured');
    expect(disagreeing.map((d) => d.kept.rowNumber)).toEqual([38]);
  });

  /**
   * «لو فى أسماء فى الشيتين .. دا معناه إن الراجل جه وأتعين وبعدين مشي .. فأنت هتعتمد الأتنين..
   * توظفه وبعدين تمشية». Same person, same hire date, on BOTH sheets: one employment that ended.
   * The Resignation copy is kept because the ending is written on it — even when the Master row
   * sits lower in its sheet — and the person is NOT serving. This used to be a refusal of both rows.
   */
  it('reads someone on both sheets with one hire date as hired and then left', () => {
    const hired = day('2026-09-07');
    const { people, rejected, disagreeing } = buildPlan([
      row({ sheet: 'master', rowNumber: 90, code: '0102724', hiredAt: hired }),
      exited({
        rowNumber: 5,
        code: '0102724',
        hiredAt: hired,
        exit: leaving('termination', '2026-09-24', 'انقطاع'),
      }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(people).toHaveLength(1);
    expect(people[0]?.serving).toBe(false);
    expect(people[0]?.spells.map((s) => [s.sheet, s.rowNumber])).toEqual([['resignation', 5]]);
    expect(people[0]?.current.exit?.effectiveDate).toEqual(day('2026-09-24'));
    // The ending IS the difference between the two copies, so there is nothing to flag.
    expect(disagreeing).toHaveLength(0);
  });

  it('flags a both-sheets pair that differs somewhere other than the ending', () => {
    const hired = day('2026-09-08');
    const { people, disagreeing } = buildPlan([
      row({ sheet: 'master', rowNumber: 16, code: '0702733', hiredAt: hired, primaryPhone: '01000000001' }),
      exited({
        rowNumber: 89,
        code: '0702733',
        hiredAt: hired,
        primaryPhone: '01000000002',
        exit: leaving('resignation', '2026-09-30', 'استقالة'),
      }),
    ]);
    expect(people[0]?.serving).toBe(false);
    expect(disagreeing).toEqual([
      {
        code: '0702733',
        name: 'جمال احمد محمد',
        kept: { sheet: 'resignation', rowNumber: 89 },
        dropped: [{ sheet: 'master', rowNumber: 16 }],
      },
    ]);
  });

  /** The rule is about one employment. A later hire date is a rehire and stays two spells. */
  it('still keeps a genuine rehire across the sheets as two spells, serving', () => {
    const { people, disagreeing } = buildPlan([
      exited({ rowNumber: 7, hiredAt: day('2019-01-01'), exit: leaving('resignation', '2021-06-30', 'استقالة') }),
      row({ sheet: 'master', rowNumber: 30, hiredAt: day('2024-03-01') }),
    ]);
    expect(people[0]?.spells.map((s) => s.sheet)).toEqual(['resignation', 'master']);
    expect(people[0]?.serving).toBe(true);
    expect(disagreeing).toHaveLength(0);
  });
});
