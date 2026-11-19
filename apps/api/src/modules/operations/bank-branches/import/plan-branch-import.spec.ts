// What a branch sheet comes to (Round 29) — the owner's decisions, each pinned: new, update and
// unchanged rows; «ضيف رقم بعد الكود» against the sheet and against the codes the bank holds; the
// areas reused in their own spelling, filled, created once; Latin-only areas; what an empty cell
// never wipes; the problems; and a sheet planned again after its import plans nothing.
import { describe, expect, it } from 'vitest';
import { type BranchSheetRow } from './read-branch-sheet';
import {
  planBranchImport,
  type BranchImportPlan,
  type HeldArea,
  type HeldBranch,
} from './plan-branch-import';

let rowNo = 1;
const row = (
  name: string | null,
  code: string | null,
  area: { ar?: string | null; en?: string | null } = {},
  extra: Partial<BranchSheetRow> = {},
): BranchSheetRow => {
  rowNo += 1;
  return {
    row: rowNo,
    name,
    nameIsDate: false,
    code,
    areaAr: area.ar ?? null,
    areaEn: area.en ?? null,
    address: null,
    ...extra,
  };
};

let idNo = 0;
const held = (name: string, code: string, extra: Partial<HeldBranch> = {}): HeldBranch => {
  idNo += 1;
  return {
    id: `b${String(idNo)}`,
    name,
    code,
    opsAreaName: null,
    financeAreaName: null,
    location: null,
    isActive: true,
    ...extra,
  };
};

const area = (id: string, name: string, nameEn: string | null = null): HeldArea => ({
  id,
  name,
  nameEn,
});

const codes = (plan: BranchImportPlan): (string | null)[] =>
  plan.rows.map((r) => r.after?.code ?? null);

describe('planBranchImport — rows', () => {
  it('creates a new branch, updates a held one by name, and leaves a matching one alone', () => {
    const palm = held('فرع النخلة', '10', {
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الأفق',
    });
    const cedar = held('فرع السنديان', '11', {
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الأفق',
    });
    const plan = planBranchImport(
      [
        row('فرع جديد', '20', { ar: 'منطقة الأفق' }),
        row('فرع  النخلـة', '12', { ar: 'منطقة الواحة', en: 'Oasis' }),
        row('فرع السنديان', '11', { ar: 'منطقة الأفق' }),
      ],
      [palm, cedar],
      [area('a1', 'منطقة الأفق', 'Horizon')],
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual(['new', 'update', 'unchanged']);
    const [created, updated, same] = plan.rows;
    expect(created?.after).toEqual({
      code: '20',
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الأفق',
      address: null,
    });
    // The held branch's own name, its id, old → new.
    expect(updated).toMatchObject({
      name: 'فرع النخلة',
      branchId: palm.id,
      before: { code: '10', opsAreaName: 'منطقة الأفق' },
      after: { code: '12', opsAreaName: 'منطقة الواحة', financeAreaName: 'منطقة الواحة' },
      changes: ['code', 'opsAreaName', 'financeAreaName'],
    });
    expect(same).toMatchObject({ branchId: cedar.id, changes: [] });
    expect(plan.branchCreates).toEqual([
      { row: created?.row, name: 'فرع جديد', code: '20', areaName: 'منطقة الأفق', address: null },
    ]);
    expect(plan.branchUpdates).toEqual([
      {
        row: updated?.row,
        branchId: palm.id,
        viaTemp: false,
        set: { code: '12', opsAreaName: 'منطقة الواحة', financeAreaName: 'منطقة الواحة' },
      },
    ]);
    expect(plan.counts).toMatchObject({ rows: 3, new: 1, update: 1, unchanged: 1, problem: 0 });
  });

  it('matches a held name without the case of its Latin letters, its tatweel or its spaces', () => {
    const gate = held('North  Gate', '5');
    const plan = planBranchImport([row('NORTH GATE', '5')], [gate], []);
    expect(plan.rows[0]).toMatchObject({
      outcome: 'unchanged',
      branchId: gate.id,
      name: 'North  Gate',
    });
  });

  it('never wipes what a held branch has with what the sheet leaves empty', () => {
    const palm = held('فرع النخلة', '10', {
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الحسابات',
      location: { addressLine: 'شارع الأمل', coordinates: null },
    });
    const plan = planBranchImport([row('فرع النخلة', null, {}, { address: null })], [palm], []);
    expect(plan.rows[0]).toMatchObject({ outcome: 'unchanged', after: palm && { code: '10' } });
    expect(plan.rows[0]?.after).toEqual({
      code: '10',
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الحسابات',
      address: 'شارع الأمل',
    });
  });

  it('sets an address on a new branch, and on a held one only when it has none', () => {
    const bare = held('فرع أ', '1', {
      location: { addressLine: null, coordinates: { lat: 30, lng: 31 } },
    });
    const kept = held('فرع ب', '2', { location: { addressLine: 'عنوان قديم', coordinates: null } });
    const plan = planBranchImport(
      [
        row('فرع أ', '1', {}, { address: 'عنوان جديد أ' }),
        row('فرع ب', '2', {}, { address: 'عنوان جديد ب' }),
        row('فرع ج', '3', {}, { address: 'عنوان ج' }),
      ],
      [bare, kept],
      [],
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual(['update', 'unchanged', 'new']);
    expect(plan.branchUpdates[0]?.set).toEqual({
      location: { addressLine: 'عنوان جديد أ', coordinates: { lat: 30, lng: 31 } },
    });
    expect(plan.branchCreates[0]?.address).toBe('عنوان ج');
  });

  it('lists the rows it will not write, and why', () => {
    const twinA = held('فرع التوأم', '1');
    const twinB = held('فرع  التوأم', '2');
    const plan = planBranchImport(
      [
        row(null, '5', { ar: 'منطقة الأفق' }),
        row('2020-05-15', '6', {}, { nameIsDate: true }),
        row('فرع أ', '7'),
        row('فرع أ', '8'),
        row('فرع التوأم', '9'),
        row('فرع بلا كود', null),
      ],
      [twinA, twinB],
      [],
    );
    expect(plan.rows.map((r) => r.problem)).toEqual([
      'noName',
      'nameIsDate',
      null,
      'duplicateName',
      'ambiguousName',
      'noCode',
    ]);
    expect(plan.rows.filter((r) => r.outcome === 'problem')).toHaveLength(5);
    expect(plan.rows.every((r) => r.outcome !== 'problem' || r.after === null)).toBe(true);
    // A problem row's area is never created.
    expect(plan.newAreas).toEqual([]);
    expect(plan.branchCreates.map((b) => b.code)).toEqual(['7']);
  });
});

describe('planBranchImport — «ضيف رقم بعد الكود»', () => {
  it('keeps the first code and suffixes the rest', () => {
    const plan = planBranchImport(
      [row('فرع أ', '116'), row('فرع ب', '116'), row('فرع ج', '116'), row('فرع د', '117')],
      [],
      [],
    );
    expect(codes(plan)).toEqual(['116', '116-2', '116-3', '117']);
    expect(plan.rows.map((r) => r.codeSuffixed)).toEqual([false, true, true, false]);
    expect(plan.counts.suffixed).toBe(2);
  });

  it('does the same for a placeholder code', () => {
    const plan = planBranchImport(
      [row('فرع أ', '0'), row('فرع ب', '0'), row('فرع ج', '0')],
      [],
      [],
    );
    expect(codes(plan)).toEqual(['0', '0-2', '0-3']);
  });

  it('skips every code another branch of the bank holds — suffixes too', () => {
    const plan = planBranchImport(
      [row('فرع أ', '116'), row('فرع ب', '116')],
      [held('فرع قديم', '116'), held('فرع أقدم', '116-2'), held('فرع ثالث', '116-4')],
      [],
    );
    expect(codes(plan)).toEqual(['116-3', '116-5']);
  });

  it('lets a held branch keep its code over an earlier row of the sheet', () => {
    const own = held('فرع قائم', '116');
    const plan = planBranchImport([row('فرع جديد', '116'), row('فرع قائم', '116')], [own], []);
    expect(plan.rows.map((r) => [r.outcome, r.after?.code])).toEqual([
      ['new', '116-2'],
      ['unchanged', '116'],
    ]);
  });

  it('suffixes a held branch the sheet gives a code another branch holds', () => {
    const moving = held('فرع متنقل', '200');
    const plan = planBranchImport([row('فرع متنقل', '116')], [moving, held('فرع آخر', '116')], []);
    expect(plan.rows[0]).toMatchObject({
      outcome: 'update',
      before: { code: '200' },
      after: { code: '116-2' },
      codeSuffixed: true,
    });
  });

  it('keeps a held branch on its own suffix when the code before it is still taken', () => {
    const first = held('فرع أ', '116');
    const second = held('فرع ب', '116-2');
    const plan = planBranchImport([row('فرع أ', '116'), row('فرع ب', '116')], [first, second], []);
    expect(plan.rows.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(plan.rows[1]?.codeSuffixed).toBe(true);
  });

  it('frees the code a held branch leaves for another row — two writes never meet on it', () => {
    const leaving = held('فرع راحل', '116');
    const plan = planBranchImport([row('فرع جديد', '116'), row('فرع راحل', '300')], [leaving], []);
    expect(plan.rows.map((r) => [r.outcome, r.after?.code])).toEqual([
      ['new', '116'],
      ['update', '300'],
    ]);
    expect(plan.branchUpdates.map((u) => [u.set.code, u.viaTemp])).toEqual([['300', false]]);
  });

  it('swaps two held codes through a code of their own', () => {
    const a = held('فرع أ', '1');
    const b = held('فرع ب', '2');
    const plan = planBranchImport([row('فرع أ', '2'), row('فرع ب', '1')], [a, b], []);
    expect(plan.branchUpdates.map((u) => [u.branchId, u.set.code, u.viaTemp])).toEqual([
      [a.id, '2', true],
      [b.id, '1', true],
    ]);
  });

  it('never touches a branch the sheet does not name', () => {
    const outside = held('فرع خارج الشيت', '116');
    const plan = planBranchImport([row('فرع جديد', '116')], [outside], []);
    expect(codes(plan)).toEqual(['116-2']);
    expect(plan.branchUpdates).toEqual([]);
  });

  it('gives a held branch the sheet’s own code back once nobody else has it', () => {
    const suffixed = held('فرع أ', '116-3');
    const plan = planBranchImport([row('فرع أ', '116'), row('فرع جديد', '116')], [suffixed], []);
    expect(plan.rows.map((r) => [r.outcome, r.after?.code])).toEqual([
      ['update', '116'],
      ['new', '116-2'],
    ]);
  });

  it('compares codes as text — «084» is not «84»', () => {
    const plan = planBranchImport([row('فرع أ', '084'), row('فرع ب', '84')], [], []);
    expect(codes(plan)).toEqual(['084', '84']);
  });
});

describe('planBranchImport — areas', () => {
  it('reuses a held area in its own spelling, by its folded Arabic name or its English name', () => {
    const plan = planBranchImport(
      [
        row('فرع أ', '1', { ar: 'الواحه' }),
        row('فرع ب', '2', { ar: 'واحة الغرب', en: 'west oasis' }),
      ],
      [],
      [area('a1', 'الواحة', 'Oasis'), area('a2', 'منطقة الغرب', 'West Oasis')],
    );
    expect(plan.rows.map((r) => r.after?.opsAreaName)).toEqual(['الواحة', 'منطقة الغرب']);
    expect(plan.newAreas).toEqual([]);
  });

  it('fills a held area’s empty English name from the sheet, once', () => {
    const plan = planBranchImport(
      [
        row('فرع أ', '1', { ar: 'منطقة الأفق', en: 'Horizon' }),
        row('فرع ب', '2', { ar: 'منطقة الأفق', en: 'Skyline' }),
      ],
      [],
      [area('a1', 'منطقة الأفق')],
    );
    expect(plan.filledAreas).toEqual([{ id: 'a1', name: 'منطقة الأفق', nameEn: 'Horizon' }]);
    expect(plan.counts.areasFilled).toBe(1);
  });

  it('creates an area it does not hold once, Arabic in the name and English in nameEn', () => {
    const plan = planBranchImport(
      [
        row('فرع أ', '1', { ar: 'منطقة النجمة', en: 'Star' }),
        row('فرع ب', '2', { ar: 'منطقه النجمه' }),
        row('فرع ج', '3', { ar: 'نجمة', en: 'STAR' }),
      ],
      [],
      [],
    );
    expect(plan.newAreas).toEqual([
      { name: 'منطقة النجمة', nameEn: 'Star', rows: 3, latinOnly: false },
    ]);
    expect(plan.areaCreates).toEqual([{ name: 'منطقة النجمة', nameEn: 'Star' }]);
    expect(plan.rows.map((r) => [r.after?.opsAreaName, r.areaIsNew])).toEqual([
      ['منطقة النجمة', true],
      ['منطقة النجمة', true],
      ['منطقة النجمة', true],
    ]);
  });

  it('takes a Latin-only area for the English name and the Arabic one alike', () => {
    const plan = planBranchImport(
      [row('فرع أ', '1', { ar: 'Riverside' }), row('فرع ب', '2', { en: 'Hilltop' })],
      [],
      [],
    );
    expect(plan.newAreas).toEqual([
      { name: 'Riverside', nameEn: 'Riverside', rows: 1, latinOnly: true },
      { name: 'Hilltop', nameEn: 'Hilltop', rows: 1, latinOnly: true },
    ]);
    expect(plan.rows.map((r) => r.areaLatinOnly)).toEqual([true, true]);
  });

  it('creates an area for an unchanged branch that names one the catalog lacks', () => {
    const palm = held('فرع النخلة', '1', {
      opsAreaName: 'منطقة الأفق',
      financeAreaName: 'منطقة الأفق',
    });
    const plan = planBranchImport([row('فرع النخلة', '1', { ar: 'منطقة الأفق' })], [palm], []);
    expect(plan.rows[0]?.outcome).toBe('unchanged');
    expect(plan.newAreas.map((a) => a.name)).toEqual(['منطقة الأفق']);
  });
});

describe('planBranchImport — a second import', () => {
  /** The plan's writes, made on the held lists — what the transaction leaves behind. */
  const applied = (
    plan: BranchImportPlan,
    branches: HeldBranch[],
    areas: HeldArea[],
  ): { branches: HeldBranch[]; areas: HeldArea[] } => {
    const nextAreas = areas.map((a) => {
      const fill = plan.filledAreas.find((f) => f.id === a.id);
      return fill === undefined ? a : { ...a, nameEn: fill.nameEn };
    });
    plan.areaCreates.forEach((a, i) => nextAreas.push({ id: `new-area-${String(i)}`, ...a }));
    const next = branches.map((b) => {
      const update = plan.branchUpdates.find((u) => u.branchId === b.id);
      if (update === undefined) return b;
      return {
        ...b,
        ...(update.set.code === undefined ? {} : { code: update.set.code }),
        ...(update.set.opsAreaName === undefined ? {} : { opsAreaName: update.set.opsAreaName }),
        ...(update.set.financeAreaName === undefined
          ? {}
          : { financeAreaName: update.set.financeAreaName }),
        ...(update.set.location === undefined ? {} : { location: update.set.location }),
      };
    });
    plan.branchCreates.forEach((c, i) =>
      next.push({
        id: `new-branch-${String(i)}`,
        name: c.name,
        code: c.code,
        opsAreaName: c.areaName,
        financeAreaName: c.areaName,
        location: c.address === null ? null : { addressLine: c.address, coordinates: null },
        isActive: true,
      }),
    );
    return { branches: next, areas: nextAreas };
  };

  it('plans nothing new — every row «بدون تغيير»', () => {
    const sheet = [
      row('فرع أ', '116', { ar: 'منطقة الأفق', en: 'Horizon' }),
      row('فرع ب', '116', { ar: 'منطقة الأفق' }, { address: 'شارع ١' }),
      row('فرع ج', '0', { ar: 'Riverside' }),
      row('فرع د', '0'),
      row('فرع قائم', '300', { ar: 'الواحه' }),
      row(null, '9'),
    ];
    const start = {
      branches: [held('فرع قائم', '116', { opsAreaName: 'قديمة' }), held('فرع خارج الشيت', '0')],
      areas: [area('a1', 'الواحة')],
    };
    const first = planBranchImport(sheet, start.branches, start.areas);
    // «فرع قائم» leaves 116 for 300, so the first 116 of the sheet takes it.
    expect(codes(first)).toEqual(['116', '116-2', '0-2', '0-3', '300', null]);
    const after = applied(first, start.branches, start.areas);
    const second = planBranchImport(sheet, after.branches, after.areas);
    expect(second.rows.map((r) => r.outcome)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
      'problem',
    ]);
    expect(second.newAreas).toEqual([]);
    expect(second.filledAreas).toEqual([]);
    expect(second.branchCreates).toEqual([]);
    expect(second.branchUpdates).toEqual([]);
  });
});
