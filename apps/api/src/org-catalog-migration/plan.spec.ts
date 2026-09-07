// The decisions the org-catalog migration makes before it touches anything (P-ORG-2).
//
// Every case here is a decision that would otherwise only be visible by running the migration
// against a real database and reading the result — which is the wrong time to find out that seven
// departments became six catalog entries, or that a merge quietly moved somebody between branches.
//
// The Arabic names are this deployment's real ones, including the spelling pair the importer's fold
// is supposed to join and the two departments the owner decided were one unit. Fixtures invented to
// agree with the code would prove nothing about either.
import { describe, expect, it } from 'vitest';
import { planOrgCatalog, type UnitRow } from './plan';

let seq = 0;
const row = (over: Omit<Partial<UnitRow>, 'name'> & { name: string }): UnitRow => {
  seq += 1;
  const { name, ...rest } = over;
  return {
    id: `id${String(seq)}`,
    code: `DEP-${String(seq).padStart(4, '0')}`,
    branchId: 'b1',
    createdAt: `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    ...rest,
    name: { ar: name, en: name },
  };
};

describe('one catalog entry per name, across every branch', () => {
  it('folds the same department in seven branches into one entry with seven members', () => {
    const rows = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map((branchId) =>
      row({ name: 'العمليات', branchId }),
    );
    const plan = planOrgCatalog(rows, []);
    expect(plan.problems).toEqual([]);
    expect(plan.departments).toHaveLength(1);
    expect(plan.departments[0]?.memberIds).toHaveLength(7);
  });

  /** Spelling variation is the importer's own problem to have solved; the fold is its fold. */
  it('folds spellings the importer treats as one word', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'الرقابة والمستهلكات', branchId: 'b1' }),
        row({ name: 'الرقابة و المستهلكات', branchId: 'b2' }),
      ],
      [],
    );
    expect(plan.departments).toHaveLength(1);
  });

  /**
   * The entry takes the OLDEST live member's code and spelling. Nothing is minted, so a reader can
   * always find which row an entry came from — and the answer never depends on read order.
   */
  it('takes the oldest member’s code and spelling, whatever order the rows arrive in', () => {
    const old = row({
      name: 'الخزينة',
      code: 'CAI-3',
      branchId: 'b1',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    const recent = row({
      name: 'الخزينه',
      code: 'DEP-0099',
      branchId: 'b2',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    for (const rows of [
      [old, recent],
      [recent, old],
    ]) {
      const plan = planOrgCatalog(rows, []);
      expect(plan.departments[0]?.code).toBe('CAI-3');
      expect(plan.departments[0]?.name.ar).toBe('الخزينة');
    }
  });

  /** Two genuinely different departments stay two, however alike they look to a reader. */
  it('keeps different names apart', () => {
    const plan = planOrgCatalog(
      [row({ name: 'العمليات', branchId: 'b1' }), row({ name: 'المشتريات', branchId: 'b1' })],
      [],
    );
    expect(plan.departments).toHaveLength(2);
  });
});

describe('THE GATE — two of the same name inside one branch', () => {
  /**
   * The whole redesign rests on `{branchId, catalogId}` being unique, and nothing today forbids one
   * branch from holding the same department twice. The migration refuses rather than choosing.
   */
  it('refuses, naming the branch and both codes', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'العليا', code: 'DEP-0041', branchId: 'b1' }),
        row({ name: 'العليا', code: 'CAI-0', branchId: 'b1' }),
      ],
      [],
    );
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toContain('DEP-0041');
    expect(plan.problems[0]).toContain('CAI-0');
    expect(plan.problems[0]).toContain('b1');
  });

  it('is satisfied once a human says which one survives', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'العليا', code: 'DEP-0041', branchId: 'b1' }),
        row({ name: 'العليا', code: 'CAI-0', branchId: 'b1' }),
      ],
      [],
      [{ loserCode: 'DEP-0041', winnerCode: 'CAI-0' }],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.departments).toHaveLength(1);
    expect(plan.departments[0]?.code).toBe('CAI-0');
  });

  /** The same name in DIFFERENT branches is the ordinary case, not a collision. */
  it('is not tripped by the same name in two branches', () => {
    const plan = planOrgCatalog(
      [row({ name: 'العليا', branchId: 'b1' }), row({ name: 'العليا', branchId: 'b2' })],
      [],
    );
    expect(plan.problems).toEqual([]);
  });
});

describe('merges are refused unless they make sense', () => {
  /** A cross-branch merge moves people between sites. That is a transfer, with a date and an approver. */
  it('refuses a merge across branches', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'العمليات', code: 'A1', branchId: 'b1' }),
        row({ name: 'العمليات', code: 'B1', branchId: 'b2' }),
      ],
      [],
      [{ loserCode: 'A1', winnerCode: 'B1' }],
    );
    expect(plan.problems.join(' ')).toContain('different branches');
    expect(plan.merges).toEqual([]);
  });

  it('refuses a merge naming a department that is not there', () => {
    const plan = planOrgCatalog(
      [row({ name: 'العمليات', code: 'A1' })],
      [],
      [{ loserCode: 'A1', winnerCode: 'GHOST' }],
    );
    expect(plan.problems.join(' ')).toContain('GHOST');
  });

  it('refuses a chain, where the survivor of one merge is the casualty of another', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'أ', code: 'A1' }),
        row({ name: 'ب', code: 'B1' }),
        row({ name: 'ج', code: 'C1' }),
      ],
      [],
      [
        { loserCode: 'A1', winnerCode: 'B1' },
        { loserCode: 'B1', winnerCode: 'C1' },
      ],
    );
    expect(plan.problems.join(' ')).toContain('chained');
  });

  /**
   * A merge spelled differently on purpose. These two fold APART, so nothing flags them — the only
   * thing that puts them together is somebody saying so.
   */
  it('merges two names that do NOT fold together, when told to', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'عمليات نقل الأموال', code: 'OPS-1', branchId: 'b1' }),
        row({ name: 'العمليات', code: 'DEP-0052', branchId: 'b1' }),
      ],
      [],
      [{ loserCode: 'OPS-1', winnerCode: 'DEP-0052' }],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.departments).toHaveLength(1);
    expect(plan.departments[0]?.code).toBe('DEP-0052');
  });

  it('brings the loser’s sections with it', () => {
    const loser = row({ name: 'العمليات', code: 'A1', branchId: 'b1' });
    const winner = row({ name: 'التشغيل', code: 'B1', branchId: 'b1' });
    const section = row({ name: 'العد والفرز', code: 'SEC-1', departmentId: loser.id });
    const plan = planOrgCatalog(
      [loser, winner],
      [section],
      [{ loserCode: 'A1', winnerCode: 'B1' }],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.merges[0]?.movedSectionIds).toEqual([section.id]);
    // …and lands under the SURVIVOR's catalog entry, not the retired department's.
    expect(plan.sections[0]?.parentKey).toBe('التشغيل');
  });

  /** Moving a section onto a department that already has one by that name is the same bug, deeper. */
  it('refuses when a moved section would collide under the survivor', () => {
    const loser = row({ name: 'العمليات', code: 'A1', branchId: 'b1' });
    const winner = row({ name: 'التشغيل', code: 'B1', branchId: 'b1' });
    const plan = planOrgCatalog(
      [loser, winner],
      [
        row({ name: 'العد والفرز', code: 'SEC-1', departmentId: loser.id }),
        row({ name: 'العد و الفرز', code: 'SEC-2', departmentId: winner.id }),
      ],
      [{ loserCode: 'A1', winnerCode: 'B1' }],
    );
    expect(plan.problems.join(' ')).toContain('SEC-1');
  });
});

describe('sections hang off the company-wide department, not off a branch’s copy', () => {
  it('folds one section name under one department into a single entry', () => {
    const departments = ['b1', 'b2', 'b3'].map((branchId) => row({ name: 'العمليات', branchId }));
    const sections = departments.map((d) =>
      row({ name: 'العد والفرز', departmentId: d.id, branchId: d.branchId }),
    );
    const plan = planOrgCatalog(departments, sections);
    expect(plan.problems).toEqual([]);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.memberIds).toHaveLength(3);
    expect(plan.sections[0]?.parentKey).toBe('العمليات');
  });

  /** The same section NAME under two different departments is two sections, and must stay two. */
  it('keeps one name under two departments apart', () => {
    const fleet = row({ name: 'الحركة', branchId: 'b1' });
    const facilities = row({ name: 'الشئون الادارية', branchId: 'b1' });
    const plan = planOrgCatalog(
      [fleet, facilities],
      [
        row({ name: 'الصيانة', departmentId: fleet.id }),
        row({ name: 'الصيانة', departmentId: facilities.id }),
      ],
    );
    expect(plan.sections).toHaveLength(2);
  });

  it('refuses a section whose department is not live, rather than dropping it', () => {
    const plan = planOrgCatalog(
      [row({ name: 'العمليات', branchId: 'b1' })],
      [row({ name: 'العد والفرز', code: 'SEC-9', departmentId: 'gone' })],
    );
    expect(plan.problems.join(' ')).toContain('SEC-9');
    expect(plan.sections).toHaveLength(0);
  });

  it('refuses two same-named sections inside one department', () => {
    const department = row({ name: 'العمليات', branchId: 'b1' });
    const plan = planOrgCatalog(
      [department],
      [
        row({ name: 'الصيانة', code: 'SEC-1', departmentId: department.id }),
        row({ name: 'الصيانه', code: 'SEC-2', departmentId: department.id }),
      ],
    );
    expect(plan.problems.join(' ')).toContain('SEC-1');
  });
});

describe('running it twice changes nothing the second time', () => {
  it('skips rows a previous run linked, and counts them', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'العمليات', branchId: 'b1', catalogId: 'cat1' }),
        row({ name: 'العمليات', branchId: 'b2', catalogId: 'cat1' }),
      ],
      [],
    );
    expect(plan.departments).toEqual([]);
    expect(plan.alreadyLinked.departments).toBe(2);
    expect(plan.problems).toEqual([]);
  });

  /** A half-finished run: some rows linked, some not. The unlinked ones join the existing entry. */
  it('plans only the rows that are still unlinked', () => {
    const plan = planOrgCatalog(
      [
        row({ name: 'العمليات', branchId: 'b1', catalogId: 'cat1' }),
        row({ name: 'العمليات', code: 'DEP-0500', branchId: 'b2' }),
      ],
      [],
    );
    expect(plan.departments).toHaveLength(1);
    expect(plan.departments[0]?.memberCodes).toEqual(['DEP-0500']);
    expect(plan.alreadyLinked.departments).toBe(1);
  });

  /** A section under an ALREADY-linked department still resolves its parent on the second run. */
  it('places a new section under a department an earlier run catalogued', () => {
    const linked = row({ name: 'العمليات', branchId: 'b1', catalogId: 'cat1' });
    const plan = planOrgCatalog([linked], [row({ name: 'العد والفرز', departmentId: linked.id })]);
    expect(plan.problems).toEqual([]);
    expect(plan.sections[0]?.parentKey).toBe('العمليات');
  });
});

describe('nothing at all is a valid answer', () => {
  it('plans nothing for an empty organization', () => {
    const plan = planOrgCatalog([], []);
    expect(plan).toMatchObject({
      departments: [],
      sections: [],
      merges: [],
      problems: [],
    });
  });
});
