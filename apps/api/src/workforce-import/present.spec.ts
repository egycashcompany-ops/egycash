// How a change is SHOWN — the pass that replaced «summarise the object by its first field».
//
// The three rows this file exists for were on one real preview: `الإدارة 6a9d5b17… → 6a9c84e1…`,
// `insurance — → 0`, and `المؤهل bachelor → bachelor`. Each is a case below, with the row it now
// produces instead.
import { describe, expect, it } from 'vitest';
import { loadOrgNames, presentChange, presentValue, type OrgNames } from './present';

const names: OrgNames = {
  branch: new Map([['b1', { ar: 'المهندسين', en: 'Mohandessin' }]]),
  department: new Map([
    ['d-old', { ar: 'التشغيل', en: 'Operations' }],
    ['d-new', { ar: 'المالية', en: 'Finance' }],
  ]),
  section: new Map(),
  jobTitle: new Map([['j1', { ar: 'صراف', en: 'Teller' }]]),
};

const change = (path: string, value: unknown) => ({ path, from: '', to: '', value });

describe('a placement id is shown as the entity’s name', () => {
  it('renders a department move by name on both sides', () => {
    const rows = presentChange(change('employment.departmentId', 'd-new'), 'd-old', names);
    expect(rows).toEqual([
      {
        path: 'employment.departmentId',
        from: { kind: 'named', name: { ar: 'التشغيل', en: 'Operations' }, isNew: false },
        to: { kind: 'named', name: { ar: 'المالية', en: 'Finance' }, isNew: false },
      },
    ]);
  });

  /**
   * THE TOKEN THAT LEAKED. `dry-run:jobTitle:اخصائي صراف الي تحميل` was shown to a manager as the
   * value a field would take. It means «this does not exist and the run will create it» — so it is
   * shown as the name it would have, flagged new.
   */
  it('shows a dry-run placeholder as «new: name», never as the token', () => {
    const [row] = presentChange(
      change('employment.jobTitleId', 'dry-run:jobTitle:اخصائي صراف الي تحميل'),
      'j1',
      names,
    );
    expect(row?.to).toEqual({
      kind: 'named',
      name: { ar: 'اخصائي صراف الي تحميل', en: 'اخصائي صراف الي تحميل' },
      isNew: true,
    });
  });

  it('takes the last segment of a section placeholder — the name, not the parent id', () => {
    expect(
      presentValue('employment.sectionId', 'dry-run:section:6a9c67e1|التشغيل خارجي الشروق', names),
    ).toEqual({ kind: 'named', name: { ar: 'التشغيل خارجي الشروق', en: 'التشغيل خارجي الشروق' }, isNew: true });
  });

  /** Hiding an unknown id would make a real reference indistinguishable from a blank. */
  it('still shows an id the registry does not know, as the id', () => {
    expect(presentValue('employment.branchId', 'ghost', names)).toEqual({ kind: 'text', text: 'ghost' });
  });
});

describe('a block is shown field by field, and only the fields that changed', () => {
  /**
   * `bachelor → bachelor`. The diff was right that something changed — the institution — and the
   * old preview collapsed both sides to the level, which had not. One row now, naming what moved.
   */
  it('names the institution when only the institution changed', () => {
    const before = { level: 'bachelor', institution: 'جامعة القاهرة', specialization: null, graduationYear: 2004 };
    const after = { level: 'bachelor', institution: 'جامعة عين شمس', specialization: null, graduationYear: 2004 };
    const rows = presentChange(change('personal.education', after), before, names);
    expect(rows.map((r) => r.path)).toEqual(['personal.education.institution']);
    expect(rows[0]?.from).toEqual({ kind: 'text', text: 'جامعة القاهرة' });
    expect(rows[0]?.to).toEqual({ kind: 'text', text: 'جامعة عين شمس' });
  });

  it('tags the level as a vocabulary token when it is what changed', () => {
    const before = { level: 'diploma', institution: 'x', specialization: null, graduationYear: 2004 };
    const after = { level: 'bachelor', institution: 'x', specialization: null, graduationYear: 2004 };
    const [row] = presentChange(change('personal.education', after), before, names);
    expect(row?.path).toBe('personal.education.level');
    expect(row?.from).toEqual({ kind: 'enum', family: 'educationLevel', value: 'diploma' });
    expect(row?.to).toEqual({ kind: 'enum', family: 'educationLevel', value: 'bachelor' });
  });

  /**
   * `insurance — → 0`. A whole insurance file being created was shown as its first non-null
   * field. It is written whole (a `$set` into `null` fails) and SHOWN as the fields it fills.
   */
  it('expands a newly created insurance block into the fields it fills, from «absent»', () => {
    const block = {
      insuranceNumber: null, occupation: 'اخصائي', occupationCode: '110510', grossWage: 7000,
      contributionWage: 5385, basicWage: 2540, employerShare: 1009.6875, employeeShare: 592.35, status: null,
    };
    const rows = presentChange(change('insurance', block), null, names);
    expect(rows.map((r) => r.path)).toEqual([
      'insurance.occupation', 'insurance.occupationCode', 'insurance.grossWage',
      'insurance.contributionWage', 'insurance.basicWage', 'insurance.employerShare', 'insurance.employeeShare',
    ]);
    expect(rows.every((r) => r.from.kind === 'absent')).toBe(true);
    expect(rows[2]?.to).toEqual({ kind: 'text', text: '7000' });
  });

  it('tags the insurance status as a token, so the screen labels it', () => {
    const [row] = presentChange(change('insurance.status', 'notInsured'), null, names);
    expect(row?.to).toEqual({ kind: 'enum', family: 'insuranceStatus', value: 'notInsured' });
  });

  it('expands a weapon licence nested inside the officer block', () => {
    const rows = presentChange(
      change('officer', { reserveOfficer: false, rank: null, weaponLicense: { type: 'personal', expiry: null }, professionPractice: false, retirementDate: null }),
      { reserveOfficer: false, rank: null, weaponLicense: { type: 'company', expiry: null }, professionPractice: false, retirementDate: null },
      names,
    );
    expect(rows.map((r) => r.path)).toEqual(['officer.weaponLicense.type']);
    expect(rows[0]?.to).toEqual({ kind: 'enum', family: 'weaponLicenseType', value: 'personal' });
  });
});

describe('what is deliberately NOT expanded', () => {
  /** The DTO's own contract: a preview never carries a whole address. */
  it('reduces an address to its governorate', () => {
    expect(
      presentValue('personal.currentAddress', { line1: '12 ش النيل', city: 'الجيزة', governorate: 'الجيزة' }, names),
    ).toEqual({ kind: 'text', text: 'الجيزة' });
  });

  it('shows a driving licence as its expiry, since the sheet never records a class', () => {
    expect(presentValue('personal.drivingLicenses', [{ class: '—', expiry: new Date('2027-01-31T00:00:00.000Z') }], names))
      .toEqual({ kind: 'text', text: '2027-01-31' });
  });
});

describe('plain values', () => {
  it('shows nothing as «absent»', () => {
    expect(presentValue('personal.contact.primaryPhone', null, names)).toEqual({ kind: 'absent' });
    expect(presentValue('personal.drivingLicenses', [], names)).toEqual({ kind: 'absent' });
  });
  it('shows a date as its day', () => {
    expect(presentValue('personal.nationalIdExpiry', new Date('2030-05-01T00:00:00.000Z'), names))
      .toEqual({ kind: 'text', text: '2030-05-01' });
  });
  it('shows a refused status change through the employee-status labels', () => {
    expect(presentValue('status', 'exited', names)).toEqual({ kind: 'enum', family: 'employeeStatus', value: 'exited' });
  });
  it('exposes the loader, which reads the four registries once', () => {
    expect(typeof loadOrgNames).toBe('function');
  });
});
