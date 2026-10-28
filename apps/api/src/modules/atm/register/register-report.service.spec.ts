// The Data Report's pure half (D7, DEC-27): `$group` rows → fold groups, and the branches a scope
// shows — derived from the same selector as the match, so Section 1 and Section 2 always count
// the same entries. Then DEC-40: which banks the report folds once the catalog holds more than the
// workbook's six.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  ATM_BANK_SEED,
  ATM_REPORT_SECTION1_BANKS,
  ATM_REPORT_SECTION3_BANKS,
  atmBankLabelKey,
  foldAtmRegisterReport,
  type AtmRegisterBranchCode,
  type AtmRegisterReportGroup,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { buildAtmBankCatalog } from '../catalogs/bank-catalog';
import { type AtmBankDoc } from '../catalogs/bank.model';
import { registerScopeBranches } from './register.repository';
import { reportBanks, reportBranchesShown, toReportGroups } from './register-report.service';

const ALEX = new Types.ObjectId().toHexString();
const TANTA = new Types.ObjectId().toHexString();
const CAIRO = new Types.ObjectId().toHexString(); // a real branch nobody mapped
const DEPT_TANTA = new Types.ObjectId().toHexString();

const branchIdByCode = new Map<AtmRegisterBranchCode, string>([
  ['EGYCASH-4', ALEX],
  ['EGYCASH-2', TANTA],
]);
const codeByBranchId = new Map<string, AtmRegisterBranchCode>([
  [ALEX, 'EGYCASH-4'],
  [TANTA, 'EGYCASH-2'],
]);

const group = (branchId: string, bankCode: string | null, count: number) => ({
  _id: { branchId: new Types.ObjectId(branchId), bankCode },
  count,
});

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: new Types.ObjectId().toHexString(),
  branchId: TANTA,
  departmentId: null,
  sectionId: null,
  ...over,
});

describe('toReportGroups', () => {
  // A bank is a catalog code now (DEC-35) and every write checks it, so a stored code is counted as
  // it is — dropping it would make section 1's total disagree with section 2's.
  it('maps branch ids to codes, keeps an unmapped branch as null, and keeps any stored bank code', () => {
    expect(
      toReportGroups(
        [
          group(ALEX, 'NBE', 2),
          group(CAIRO, 'BM', 1),
          group(TANTA, null, 1),
          group(TANTA, 'XYZ', 1),
        ],
        codeByBranchId,
      ),
    ).toEqual([
      { branchCode: 'EGYCASH-4', bankCode: 'NBE', count: 2 },
      { branchCode: null, bankCode: 'BM', count: 1 },
      { branchCode: 'EGYCASH-2', bankCode: null, count: 1 },
      { branchCode: 'EGYCASH-2', bankCode: 'XYZ', count: 1 },
    ]);
  });
});

const NOW = new Date('2026-10-27T09:00:00.000Z');
const bankDoc = (over: Partial<AtmBankDoc> & Pick<AtmBankDoc, 'code'>): AtmBankDoc => {
  const opsLabel = over.opsLabel ?? over.code;
  return {
    _id: new Types.ObjectId(),
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    __v: 0,
    name: { ar: over.code, en: over.code },
    opsLabel,
    formerOpsLabels: [],
    opsLabelKeys: [atmBankLabelKey(opsLabel)],
    color: '#7030A0',
    sortOrder: 100,
    isActive: true,
    isSeed: false,
    ...over,
  };
};
const seeds = ATM_BANK_SEED.map((seed) =>
  bankDoc({ ...seed, opsLabelKeys: [seed.opsLabel], isSeed: true }),
);
const groupOf = (bankCode: string, count: number): AtmRegisterReportGroup => ({
  branchCode: 'EGYCASH-4',
  bankCode,
  count,
});

describe('reportBanks (DEC-40)', () => {
  it('the six alone: the sheet orders, every seed shown even at 0', () => {
    const banks = reportBanks(buildAtmBankCatalog(seeds), []);
    expect(banks.section1Banks).toEqual([...ATM_REPORT_SECTION1_BANKS]);
    expect(banks.section3Banks).toEqual([...ATM_REPORT_SECTION3_BANKS]);
    expect(banks.banks.map((b) => [b.code, b.isSeed, b.isActive])).toEqual(
      ATM_REPORT_SECTION1_BANKS.map((code) => [code, true, true]),
    );
    const brk = banks.banks.find((b) => b.code === 'BRK');
    expect(brk).toEqual({
      code: 'BRK',
      name: { ar: 'بنك البركة', en: 'Al Baraka Bank' },
      color: '#F4B183',
      isActive: true,
      isSeed: true,
    });
  });

  it('appends an active catalog bank after BRK (s1) and after NXT (s3), in catalog order', () => {
    const catalog = buildAtmBankCatalog([
      ...seeds,
      bankDoc({ code: 'QNB', sortOrder: 80, color: '#00B0F0' }),
      bankDoc({ code: 'AAIB', sortOrder: 70 }),
    ]);
    const banks = reportBanks(catalog, [groupOf('NBE', 3)]);
    expect(banks.section1Banks).toEqual([...ATM_REPORT_SECTION1_BANKS, 'AAIB', 'QNB']);
    expect(banks.section3Banks).toEqual([...ATM_REPORT_SECTION3_BANKS, 'AAIB', 'QNB']);
    expect(banks.banks.find((b) => b.code === 'QNB')).toMatchObject({
      color: '#00B0F0',
      isActive: true,
      isSeed: false,
    });
    // …and the fold carries a cell for it, so its bar and its section-3 column read 0, not missing.
    const counts = foldAtmRegisterReport([groupOf('QNB', 2)], ['EGYCASH-4'], banks.section1Banks);
    expect(counts.section1.QNB).toBe(2);
    expect(counts.section3['EGYCASH-4']?.AAIB).toBe(0);
    expect(counts.section1.total).toBe(2);
  });

  it('hides an ARCHIVED extra with nothing in operation, and shows one that is still counted', () => {
    const catalog = buildAtmBankCatalog([
      ...seeds,
      bankDoc({ code: 'QNB', isActive: false }),
      bankDoc({ code: 'ADIB', isActive: false }),
    ]);
    const banks = reportBanks(catalog, [groupOf('ADIB', 1), groupOf('QNB', 0)]);
    expect(banks.section1Banks).toEqual([...ATM_REPORT_SECTION1_BANKS, 'ADIB']);
    expect(banks.banks.find((b) => b.code === 'ADIB')?.isActive).toBe(false);
  });

  it('an archived SEED with 0 is still shown — the sheet always has its six', () => {
    const catalog = buildAtmBankCatalog(
      seeds.map((bank) => (bank.code === 'NXT' ? { ...bank, isActive: false } : bank)),
    );
    const banks = reportBanks(catalog, []);
    expect(banks.section1Banks).toContain('NXT');
    expect(banks.banks.find((b) => b.code === 'NXT')?.isActive).toBe(false);
  });

  it('a counted code the catalog does not know is folded last, named by its code, in grey', () => {
    const banks = reportBanks(buildAtmBankCatalog(seeds), [groupOf('ZZZ', 1)]);
    expect(banks.section1Banks.at(-1)).toBe('ZZZ');
    expect(banks.banks.at(-1)).toEqual({
      code: 'ZZZ',
      name: { ar: 'ZZZ', en: 'ZZZ' },
      color: '#A6A6A6',
      isActive: false,
      isSeed: false,
    });
  });
});

describe('reportBranchesShown (DEC-27)', () => {
  it('organization: every mapped branch, in sheet code order', () => {
    expect(
      reportBranchesShown(
        registerScopeBranches(selector({ scope: 'organization' })),
        branchIdByCode,
      ),
    ).toEqual(['EGYCASH-2', 'EGYCASH-4']);
  });

  it('branch: the home branch only', () => {
    expect(
      reportBranchesShown(registerScopeBranches(selector({ scope: 'branch' })), branchIdByCode),
    ).toEqual(['EGYCASH-2']);
  });

  it('a multi-branch reach: each reached, mapped branch', () => {
    expect(
      reportBranchesShown(
        registerScopeBranches(selector({ scope: 'branch', branchIds: [ALEX, TANTA, CAIRO] })),
        branchIdByCode,
      ),
    ).toEqual(['EGYCASH-2', 'EGYCASH-4']);
  });

  it('a department reach WITHOUT the home branch: the home is not shown', () => {
    const s = selector({
      scope: 'department',
      departmentIds: [DEPT_TANTA],
      departmentBranchIds: [ALEX],
    });
    expect(reportBranchesShown(registerScopeBranches(s), branchIdByCode)).toEqual(['EGYCASH-4']);
  });

  it('own: every mapped branch, and Section 1 total = Section 2 total + the unmapped count', () => {
    const shown = reportBranchesShown(
      registerScopeBranches(selector({ scope: 'own' })),
      branchIdByCode,
    );
    expect(shown).toEqual(['EGYCASH-2', 'EGYCASH-4']);
    const counts = foldAtmRegisterReport(
      toReportGroups(
        [group(ALEX, 'NBE', 3), group(TANTA, 'BM', 2), group(CAIRO, 'CIB', 1)],
        codeByBranchId,
      ),
      shown,
    );
    expect(counts.section1.total).toBe(6);
    expect(counts.section2.total).toBe(5);
    expect(counts.activeWithUnmappedBranch).toBe(1);
    expect(counts.section1.total).toBe(counts.section2.total + counts.activeWithUnmappedBranch);
  });
});
