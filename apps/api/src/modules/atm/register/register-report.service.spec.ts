// The Data Report's pure half (D7, DEC-27): `$group` rows → fold groups, and the branches a scope
// shows — derived from the same selector as the match, so Section 1 and Section 2 always count
// the same entries.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { foldAtmRegisterReport, type AtmRegisterBranchCode } from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { registerScopeBranches } from './register.repository';
import { reportBranchesShown, toReportGroups } from './register-report.service';

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
  it('maps branch ids to codes, keeps an unmapped branch as null, and an unknown bank as null', () => {
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
      { branchCode: 'EGYCASH-2', bankCode: null, count: 1 },
    ]);
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
