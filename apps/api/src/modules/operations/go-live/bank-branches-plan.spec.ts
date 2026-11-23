// What the deploy writes of one bank's file (Round 29b critic): the import's plan, less the rows
// that may be a branch the bank holds — a name spelt another way, or the sheet's own code for a
// branch already on a branch of another name — and the edits it makes, kept with what was held.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  planBranchImport,
  type HeldArea,
  type HeldBranch,
} from '../bank-branches/import/plan-branch-import';
import {
  OPERATIONS_BRANCH_LOAD_BANKS,
  parseBankBranchesFile,
  sheetRowsOf,
  type BankBranchesFile,
} from './bank-branches-banks';
import { planBankLoad } from './bank-branches-plan';
import { resolveBankBranchesFile } from './bank-branches';

type Row = BankBranchesFile['rows'][number];
const row = (
  n: number,
  name: string,
  code: string | null,
  areaAr: string | null = null,
  areaEn: string | null = null,
): Row => ({ row: n, name, code, areaAr, areaEn, address: null });

const fileOf = (rows: Row[], leftOut: BankBranchesFile['leftOut'] = []): BankBranchesFile => ({
  source: 'synthetic',
  bank: 'banque-misr',
  rowsRead: rows.length + leftOut.length,
  leftOut,
  rows,
});

const held = (id: string, name: string, code: string, area: string | null = null): HeldBranch => ({
  id,
  name,
  code,
  opsAreaName: area,
  financeAreaName: area,
  location: null,
  isActive: true,
});

const creates = (load: ReturnType<typeof planBankLoad>) =>
  load.plan.branchCreates.map(({ name, code }) => [name, code]);

describe('planBankLoad', () => {
  it('an empty bank: the import’s plan, row for row — nothing held back', () => {
    const file = fileOf([
      row(2, 'فرع النزهة', '116', 'شرق', 'East'),
      row(3, 'فرع الربوة', '116'),
      row(4, 'فرع النزهة', '200'),
    ]);
    const load = planBankLoad(file, [], []);
    expect(load.plan).toEqual(planBranchImport(sheetRowsOf(file), [], []));
    expect(load.heldBack).toEqual([]);
    expect(load.problemRows).toEqual([{ row: 4, problem: 'duplicateName' }]);
    expect(load.changed).toEqual([]);
  });

  it('a name spelt another way is held back, with the branch it may be — the rest still loads', () => {
    const branches = [held('h1', 'فرع النزهه', '900')];
    const file = fileOf([
      row(2, 'فرع النزهة', '116', 'منطقة الربوة', 'Rabwa'),
      row(3, 'فرع السلام', '300'),
    ]);
    // The import itself would write it — a new branch beside «فرع النزهه».
    const imported = planBranchImport(sheetRowsOf(file), branches, []);
    expect(imported.branchCreates.map(({ name }) => name)).toContain('فرع النزهة');

    const load = planBankLoad(file, branches, []);
    expect(load.heldBack).toEqual([
      {
        row: 2,
        name: 'فرع النزهة',
        code: '116',
        why: 'similarName',
        branch: { id: 'h1', name: 'فرع النزهه', code: '900' },
      },
    ]);
    expect(creates(load)).toEqual([['فرع السلام', '300']]);
    // Its area, named by no written row, is not created.
    expect(load.plan.areaCreates).toEqual([]);
    expect(load.plan.rows.some((r) => r.similarTo !== null)).toBe(false);
  });

  it('the sheet’s own code for a branch, on a held branch of another name: held back', () => {
    const branches = [held('h1', 'فرع المروة', '320'), held('h2', 'فرع قائم', '700')];
    const file = fileOf([
      row(2, 'فرع الصفا', '320'),
      // A held branch named by the sheet, leaving its code: that code is no one's but the sheet's.
      row(3, 'فرع قائم', '701'),
      row(4, 'فرع جديد', '700'),
    ]);
    const load = planBankLoad(file, branches, []);
    expect(load.heldBack).toEqual([
      {
        row: 2,
        name: 'فرع الصفا',
        code: '320',
        why: 'codeHeld',
        branch: { id: 'h1', name: 'فرع المروة', code: '320' },
      },
    ]);
    expect(creates(load)).toEqual([['فرع جديد', '700']]);
    expect(load.plan.branchUpdates).toMatchObject([{ branchId: 'h2', set: { code: '701' } }]);
  });

  it('a code the sheet gives several rows names no one branch: «-2», «-3» as on an empty bank', () => {
    const branches = [held('h1', 'فرع ثابت', '0')];
    const file = fileOf([row(2, 'فرع أ', '0'), row(3, 'فرع ب', '0')]);
    const load = planBankLoad(file, branches, []);
    expect(load.heldBack).toEqual([]);
    expect(creates(load)).toEqual([
      ['فرع أ', '0-2'],
      ['فرع ب', '0-3'],
    ]);
    // A row left out (a date for a name) counts: its code is the sheet's twice.
    const withDate = planBankLoad(
      fileOf(
        [row(2, 'فرع أ', '0')],
        [{ row: 3, problem: 'nameIsDate', nameAsRead: '2020-05-15 00:00:00', code: '0', why: 'x' }],
      ),
      branches,
      [],
    );
    expect(withDate.heldBack).toEqual([]);
    expect(creates(withDate)).toEqual([['فرع أ', '0-2']]);
  });

  it('a held-back row frees its code for the next row of it, and a name it gives twice stays unwritten', () => {
    const branches = [held('h1', 'فرع النزهه', '900')];
    const file = fileOf([
      row(2, 'فرع النزهة', '116'),
      row(3, 'فرع الحرية', '116'),
      // The sheet's second «فرع النزهة»: a problem in the import — still one with its first held back.
      row(4, 'فرع النزهة', '117'),
    ]);
    const load = planBankLoad(file, branches, []);
    expect(load.heldBack.map(({ row: r, why }) => [r, why])).toEqual([[2, 'similarName']]);
    expect(load.problemRows).toEqual([{ row: 4, problem: 'duplicateName' }]);
    expect(creates(load)).toEqual([['فرع الحرية', '116']]);
  });

  it('keeps every edit of a held branch with what it held — and counts the areas it replaces', () => {
    const branches = [
      held('h1', 'فرع السلام', '400', 'مدينة نصر'),
      held('h2', 'فرع قائم', '500'),
      held('h3', 'فرع الشروق', '600', 'الشروق'),
    ];
    const areas: HeldArea[] = [{ id: 'a1', name: 'الشروق', nameEn: 'Shorouk' }];
    const file = fileOf([
      row(2, 'فرع السلام', '400', 'منطقة الجبل', 'Mountain'),
      row(3, 'فرع قائم', '500', 'منطقة الجبل', 'Mountain'),
      row(4, 'فرع الشروق', '601', 'الشروق', 'Shorouk'),
    ]);
    const load = planBankLoad(file, branches, areas);
    expect(load.changed).toEqual([
      {
        row: 2,
        branchId: 'h1',
        name: 'فرع السلام',
        changes: ['opsAreaName', 'financeAreaName'],
        before: {
          code: '400',
          opsAreaName: 'مدينة نصر',
          financeAreaName: 'مدينة نصر',
          address: null,
        },
        after: {
          code: '400',
          opsAreaName: 'منطقة الجبل',
          financeAreaName: 'منطقة الجبل',
          address: null,
        },
      },
      {
        row: 3,
        branchId: 'h2',
        name: 'فرع قائم',
        changes: ['opsAreaName', 'financeAreaName'],
        before: { code: '500', opsAreaName: null, financeAreaName: null, address: null },
        after: {
          code: '500',
          opsAreaName: 'منطقة الجبل',
          financeAreaName: 'منطقة الجبل',
          address: null,
        },
      },
      {
        row: 4,
        branchId: 'h3',
        name: 'فرع الشروق',
        changes: ['code'],
        before: { code: '600', opsAreaName: 'الشروق', financeAreaName: 'الشروق', address: null },
        after: { code: '601', opsAreaName: 'الشروق', financeAreaName: 'الشروق', address: null },
      },
    ]);
    // «فرع السلام» had an area; «فرع قائم» had none (filled); «فرع الشروق» kept its own.
    expect(load.areasReplaced).toBe(1);
  });

  it('notes a row whose area is a held one found by its English name', () => {
    const areas: HeldArea[] = [{ id: 'a1', name: 'حي مدينة نصر', nameEn: 'Nasr City' }];
    const load = planBankLoad(fileOf([row(2, 'فرع أ', '1', 'مدينة نصر', 'Nasr City')]), [], areas);
    expect(load.areaNotes).toEqual([
      { row: 2, note: 'byEnglish', sheetArea: 'مدينة نصر', written: 'حي مدينة نصر' },
    ]);
  });

  it('the four committed files, one after another on an empty catalog: nothing held back', () => {
    const areas: HeldArea[] = [];
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      const file = parseBankBranchesFile(
        JSON.parse(readFileSync(resolveBankBranchesFile(b.file) as string, 'utf8')),
      );
      const load = planBankLoad(file, [], areas);
      expect(load.heldBack, b.key).toEqual([]);
      expect(load.plan).toEqual(planBranchImport(sheetRowsOf(file), [], areas));
      load.plan.areaCreates.forEach((area, i) => {
        areas.push({ id: `${b.key}-${String(i)}`, name: area.name, nameEn: area.nameEn });
      });
    }
    expect(areas).toHaveLength(65);
  });
});
