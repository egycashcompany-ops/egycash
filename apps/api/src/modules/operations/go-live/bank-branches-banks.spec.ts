// Which bank each of the owner's four branch files loads into (Round 29b), and the committed files
// themselves. The load against a real mongo — once, all or nothing, the bank created or skipped —
// is `tests/integration/operations-go-live-bank-branches.spec.ts`, on synthetic files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planBranchImport, type HeldArea } from '../bank-branches/import/plan-branch-import';
import {
  OPERATIONS_BRANCH_LOAD_BANKS,
  OPERATIONS_BRANCH_LOAD_BANK_KEYS,
  foldBankName,
  looksLike,
  nextBankCode,
  parseBankBranchesFile,
  resolveLoadBank,
  sheetRowsOf,
  type LiveBank,
  type OperationsBranchLoadBank,
  type OperationsBranchLoadBankKey,
} from './bank-branches-banks';
import { resolveBankBranchesFile } from './bank-branches';

const target = (key: OperationsBranchLoadBankKey): OperationsBranchLoadBank =>
  OPERATIONS_BRANCH_LOAD_BANKS.find((bank) => bank.key === key) as OperationsBranchLoadBank;

let ids = 0;
const bank = (
  opsName: string,
  name: { ar: string; en: string } = { ar: opsName, en: opsName },
  isActive = true,
): LiveBank => {
  ids += 1;
  return { id: `b${String(ids)}`, opsName, name, isActive };
};

describe('the four banks', () => {
  it('are the owner’s four, each with its own file, its names among its aliases', () => {
    expect(OPERATIONS_BRANCH_LOAD_BANKS.map((b) => b.key)).toEqual([
      ...OPERATIONS_BRANCH_LOAD_BANK_KEYS,
    ]);
    expect(new Set(OPERATIONS_BRANCH_LOAD_BANKS.map((b) => b.file)).size).toBe(4);
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      const aliases = b.aliases.map(foldBankName);
      expect(aliases).toContain(foldBankName(b.create.opsName));
      expect(aliases).toContain(foldBankName(b.create.name.ar));
      expect(aliases).toContain(foldBankName(b.create.name.en));
    }
  });

  it('no alias of one bank is another’s', () => {
    const seen = new Map<string, string>();
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      for (const alias of b.aliases.map(foldBankName)) {
        expect(seen.get(alias) ?? b.key).toBe(b.key);
        seen.set(alias, b.key);
      }
    }
  });

  it('each one’s marks find its own names, and none of the other three’s', () => {
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      expect(looksLike(b, bank(b.create.opsName, b.create.name)), b.key).toBe(true);
      for (const other of OPERATIONS_BRANCH_LOAD_BANKS) {
        if (other.key === b.key) continue;
        for (const alias of other.aliases) {
          expect(looksLike(b, bank(alias)), `${b.key} ← ${alias}`).toBe(false);
        }
      }
    }
  });
});

describe('foldBankName', () => {
  it('folds as the crew board folds an area: hamza, alef maqsura, ta marbuta, «ال», case, spaces', () => {
    expect(foldBankName('البنك الأهلى  المصرى')).toBe(foldBankName('البنك الأهلي المصري'));
    expect(foldBankName('بنك القاهره')).toBe(foldBankName('بنك القاهرة'));
    expect(foldBankName('  BANQUE   misr ')).toBe(foldBankName('Banque Misr'));
    expect(foldBankName('cib')).toBe(foldBankName('CIB'));
    expect(foldBankName('بنك مصر إيران')).not.toBe(foldBankName('بنك مصر'));
  });
});

describe('resolveLoadBank', () => {
  it('finds the one bank that answers to the file’s names — by any of its three names', () => {
    const misr = bank('بنك مصر');
    expect(resolveLoadBank(target('banque-misr'), [bank('بنك آخر'), misr])).toEqual({
      kind: 'found',
      bank: misr,
    });
    // Its English name only, in other letters' case.
    const byEnglish = bank('بنك م', { ar: 'بنك م', en: 'banque du caire' });
    expect(resolveLoadBank(target('banque-du-caire'), [byEnglish])).toEqual({
      kind: 'found',
      bank: byEnglish,
    });
    // Its Arabic name spelt another way (its operations name says nothing of the bank).
    const nbe = bank('بنك ٥', { ar: 'البنك الاهلى المصرى', en: 'x' });
    expect(resolveLoadBank(target('nbe'), [nbe])).toEqual({ kind: 'found', bank: nbe });
    // The short names the owner uses.
    const cib = bank('CIB');
    expect(resolveLoadBank(target('cib'), [cib])).toEqual({ kind: 'found', bank: cib });
    const ahly = bank('الأهلي');
    expect(resolveLoadBank(target('nbe'), [ahly])).toEqual({ kind: 'found', bank: ahly });
  });

  it('the legacy operations names (`bank_name_ops`: contad_app.js /vault1) — every name of the bank in that form', () => {
    // «مصر» «الأهلي» «القاهرة» «التجاري الدولي», held as opsName, Arabic AND English: each is its
    // file's bank, never another's — so the step creates no «بنك مصر» beside «مصر».
    const legacy = {
      'banque-misr': bank('مصر', { ar: 'مصر', en: 'Misr' }),
      nbe: bank('الأهلي', { ar: 'الاهلى', en: 'Ahly' }),
      'banque-du-caire': bank('القاهرة', { ar: 'القاهره', en: 'Cairo' }),
      cib: bank('التجاري الدولي', { ar: 'التجارى الدولى', en: 'CIB Egypt' }),
    } as const;
    const all = Object.values(legacy);
    for (const [key, held] of Object.entries(legacy)) {
      expect(resolveLoadBank(target(key as OperationsBranchLoadBankKey), all)).toEqual({
        kind: 'found',
        bank: held,
      });
    }
    // The central bank of the same legacy list is none of the four.
    const cbe = bank('البنك المركزي');
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      expect(resolveLoadBank(b, [cbe])).toEqual({ kind: 'missing' });
    }
  });

  it('a stopped bank is still THE bank — found, so it is never created twice', () => {
    const stopped = bank('بنك القاهرة', undefined, false);
    expect(resolveLoadBank(target('banque-du-caire'), [stopped])).toEqual({
      kind: 'found',
      bank: stopped,
    });
  });

  it('the names the codebase already gives them: ATM’s MISR / BM, BDC, «الأهلي المصري»', () => {
    // Every name of the bank in that form — so the step creates no «بنك مصر» beside «MISR».
    const held = {
      'banque-misr': [bank('MISR', { ar: 'MISR', en: 'MISR' }), bank('BM')],
      'banque-du-caire': [bank('BDC')],
      nbe: [bank('الأهلي المصري', { ar: 'الاهلى المصرى', en: 'x' })],
    } as const;
    for (const [key, banks] of Object.entries(held)) {
      for (const one of banks) {
        expect(resolveLoadBank(target(key as OperationsBranchLoadBankKey), [one])).toEqual({
          kind: 'found',
          bank: one,
        });
      }
    }
    // By its operations name, whatever its display name says.
    const misr = bank('MISR', { ar: 'بنك مصر ش.م.م', en: 'MISR BANK' });
    expect(resolveLoadBank(target('banque-misr'), [misr])).toEqual({ kind: 'found', bank: misr });
  });

  it('none answers: created only when no live bank even LOOKS like it', () => {
    expect(resolveLoadBank(target('banque-misr'), [])).toEqual({ kind: 'missing' });
    // Words matched whole: «مصرف», «المصري», «الدولي» alone are not the bank's words.
    const unrelated = [
      bank('البنك المركزي المصري'),
      bank('المصرف المتحد'),
      bank('البنك المصري الخليجي'),
      bank('بنك فيصل'),
      bank('المصرف العربي الدولي'),
      bank('Arab International Bank'),
    ];
    for (const b of OPERATIONS_BRANCH_LOAD_BANKS) {
      expect(resolveLoadBank(b, unrelated), b.key).toEqual({ kind: 'missing' });
    }
    // A name that only holds the bank's word is not the bank — nor a reason to create one beside.
    const near: [OperationsBranchLoadBankKey, LiveBank[]][] = [
      ['banque-misr', [bank('بنك مصر إيران'), bank('Misr Bank Europe')]],
      ['banque-misr', [bank('بنك م', { ar: 'بنك م', en: 'MISR BANK' })]],
      ['nbe', [bank('البنك الأهلي الكويتي')]],
      ['nbe', [bank('NBE FOREX')]],
      [
        'banque-du-caire',
        [bank('بنك القاهرة عمان', { ar: 'بنك القاهرة عمان', en: 'Cairo Amman Bank' })],
      ],
      ['cib', [bank('البنك التجاري الدولي (CIB)')]],
      ['cib', [bank('CIB Egypt')]],
    ];
    for (const [key, banks] of near) {
      expect(resolveLoadBank(target(key), [...banks, ...unrelated]), key).toEqual({
        kind: 'ambiguous',
        banks,
        reason: 'lookalikeBanks',
      });
    }
  });

  it('found by its Arabic or English name only: never beside a look-alike, nor as a variant', () => {
    // «NBE FOREX» named «البنك الأهلي المصري»: its operations name is a bank of its own.
    const forex = bank('NBE FOREX', { ar: 'البنك الأهلي المصري', en: 'NBE FOREX' });
    expect(resolveLoadBank(target('nbe'), [forex])).toEqual({
      kind: 'ambiguous',
      banks: [forex],
      reason: 'lookalikeBanks',
    });
    // A neutral operations name, but another bank looks like the file's: a person says which.
    const byName = bank('بنك ٥', { ar: 'البنك الأهلي المصري', en: 'x' });
    const kuwait = bank('البنك الأهلي الكويتي');
    expect(resolveLoadBank(target('nbe'), [byName, kuwait])).toEqual({
      kind: 'ambiguous',
      banks: [byName, kuwait],
      reason: 'lookalikeBanks',
    });
    expect(resolveLoadBank(target('nbe'), [byName])).toEqual({ kind: 'found', bank: byName });
    // Found by its OPERATIONS name: a look-alike beside it changes nothing.
    const misr = bank('مصر');
    const midb = bank('بنك مصر إيران');
    expect(resolveLoadBank(target('banque-misr'), [midb, misr])).toEqual({
      kind: 'found',
      bank: misr,
    });
    const ahly = bank('الأهلي');
    expect(resolveLoadBank(target('nbe'), [kuwait, ahly])).toEqual({ kind: 'found', bank: ahly });
    // «NBE FOREX» answering by its Arabic name beside «الأهلي»: two banks answer — never a guess.
    expect(resolveLoadBank(target('nbe'), [forex, ahly])).toEqual({
      kind: 'ambiguous',
      banks: [forex, ahly],
      reason: 'severalBanks',
    });
  });

  it('two banks answering to the names: never a guess', () => {
    const a = bank('بنك القاهرة');
    const b = bank('BDC', { ar: 'بنك القاهره', en: 'BdC' });
    expect(resolveLoadBank(target('banque-du-caire'), [a, b])).toEqual({
      kind: 'ambiguous',
      banks: [a, b],
      reason: 'severalBanks',
    });
  });

  it('one bank that another file’s names find too: never a guess either', () => {
    const both = bank('بنك مصر', { ar: 'بنك مصر', en: 'Banque du Caire' });
    for (const key of ['banque-misr', 'banque-du-caire'] as const) {
      expect(resolveLoadBank(target(key), [both])).toEqual({
        kind: 'ambiguous',
        banks: [both],
        reason: 'anotherFilesBank',
      });
    }
  });
});

describe('nextBankCode', () => {
  it('one past every code given — deleted banks’ included — and 1 for the first', () => {
    expect(nextBankCode([])).toBe(1);
    expect(nextBankCode([3, 17, 9])).toBe(18);
    expect(nextBankCode([0])).toBe(1);
  });
});

describe('the file', () => {
  const synthetic = {
    source: 'synthetic',
    bank: 'cib',
    rowsRead: 2,
    leftOut: [
      { row: 3, problem: 'nameIsDate', nameAsRead: '2001-02-03 00:00:00', code: '9', why: 'x' },
    ],
    rows: [{ row: 2, name: 'فرع ١', code: '084', areaAr: 'منطقة', areaEn: 'Area', address: null }],
  };

  it('is read as the planner takes a sheet’s rows — none of them a date', () => {
    expect(sheetRowsOf(parseBankBranchesFile(synthetic))).toEqual([
      {
        row: 2,
        name: 'فرع ١',
        nameIsDate: false,
        code: '084',
        areaAr: 'منطقة',
        areaEn: 'Area',
        address: null,
      },
    ]);
  });

  it('refuses a file that is not one', () => {
    expect(() => parseBankBranchesFile({ ...synthetic, rowsRead: 3 })).toThrow();
    expect(() => parseBankBranchesFile({ ...synthetic, bank: 'other' })).toThrow();
    expect(() =>
      parseBankBranchesFile({ ...synthetic, rows: [{ ...synthetic.rows[0], name: '' }] }),
    ).toThrow();
    expect(() =>
      parseBankBranchesFile({ ...synthetic, rows: [{ ...synthetic.rows[0], extra: 1 }] }),
    ).toThrow();
  });
});

// The committed files — counts only, never a row of them.
describe('the four committed files', () => {
  const read = (b: OperationsBranchLoadBank) => {
    const path = resolveBankBranchesFile(b.file);
    expect(path, b.file).not.toBeNull();
    return parseBankBranchesFile(JSON.parse(readFileSync(path as string, 'utf8')));
  };

  it('are in the source tree where the step looks, each its own bank’s, with the sheets’ row counts', () => {
    const counts = OPERATIONS_BRANCH_LOAD_BANKS.map((b) => {
      const file = read(b);
      expect(file.bank).toBe(b.key);
      return [b.key, file.rowsRead, file.rows.length, file.leftOut.map((row) => row.row)];
    });
    expect(counts).toEqual([
      ['banque-misr', 672, 670, [409, 456]],
      ['cib', 201, 201, []],
      ['nbe', 629, 629, []],
      ['banque-du-caire', 230, 230, []],
    ]);
    expect(resolveBankBranchesFile('nothing.json')).toBeNull();
    expect(
      resolveBankBranchesFile(
        OPERATIONS_BRANCH_LOAD_BANKS[0]?.file as string,
        join('/', 'nowhere'),
      ),
    ).toBeNull();
  });

  it('planned one after another on an empty «البنوك» and «المناطق» — the deploy’s fresh database', () => {
    const areas: HeldArea[] = [];
    const counts = OPERATIONS_BRANCH_LOAD_BANKS.map((b) => {
      const plan = planBranchImport(sheetRowsOf(read(b)), [], areas);
      // What the bank's transaction creates, the next bank finds held.
      plan.areaCreates.forEach((area, i) => {
        areas.push({ id: `${b.key}-${String(i)}`, name: area.name, nameEn: area.nameEn });
      });
      const { rows, new: created, update, unchanged, problem, suffixed, areasNew } = plan.counts;
      return { bank: b.key, rows, created, update, unchanged, problem, suffixed, areasNew };
    });
    expect(counts).toEqual([
      {
        bank: 'banque-misr',
        rows: 670,
        created: 670,
        update: 0,
        unchanged: 0,
        problem: 0,
        suffixed: 73,
        areasNew: 31,
      },
      {
        bank: 'cib',
        rows: 201,
        created: 201,
        update: 0,
        unchanged: 0,
        problem: 0,
        suffixed: 0,
        areasNew: 34,
      },
      {
        bank: 'nbe',
        rows: 629,
        created: 629,
        update: 0,
        unchanged: 0,
        problem: 0,
        suffixed: 1,
        areasNew: 0,
      },
      {
        bank: 'banque-du-caire',
        rows: 230,
        created: 230,
        update: 0,
        unchanged: 0,
        problem: 0,
        suffixed: 8,
        areasNew: 0,
      },
    ]);
  });
});
