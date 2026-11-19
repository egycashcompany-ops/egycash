// Round 29 — the branch sheet's words: the headers the owner's sheets print, the tidying a branch
// name is stored and matched by, the suffix a repeated code takes, and the apply's hashes.
import { describe, expect, it } from 'vitest';
import {
  ApplyOperationsBranchImportSchema,
  CompareOperationsBranchImportSchema,
  OPERATIONS_BRANCH_IMPORT_ROLES,
  OPERATIONS_BRANCH_IMPORT_SYNONYMS,
  foldSheetHeader,
  isOperationsBranchImportSuffixedWrite,
  operationsBranchNameKey,
  operationsBranchNameLookalikeKey,
  suffixedOperationsBranchCode,
  tidyOperationsBranchName,
  type OperationsBranchImportRole,
} from '../index.js';

const roleOf = (header: string): OperationsBranchImportRole | undefined =>
  OPERATIONS_BRANCH_IMPORT_ROLES.find((role) =>
    OPERATIONS_BRANCH_IMPORT_SYNONYMS[role].includes(foldSheetHeader(header)),
  );

describe('the branch sheet headers', () => {
  it('binds every label the owner listed to its column', () => {
    const labels: [string, OperationsBranchImportRole][] = [
      ['اسم الفرع', 'name'],
      ['الفرع', 'name'],
      ['Branches', 'name'],
      ['Branch', 'name'],
      ['رقم الفرع', 'code'],
      ['الكود', 'code'],
      ['كود الفرع', 'code'],
      ['Code', 'code'],
      ['المنطقة', 'areaAr'],
      ['المنطقة (عربي)', 'areaAr'],
      ['Area', 'areaEn'],
      ['Area (English)', 'areaEn'],
      ['المنطقة (إنجليزي)', 'areaEn'],
      ['عنوان الفرع', 'address'],
      ['العنوان', 'address'],
      ['Address', 'address'],
    ];
    for (const [label, role] of labels) expect(roleOf(label), label).toBe(role);
  });

  it('reads no other column', () => {
    for (const label of ['م', 'التكلفة', 'Cost', 'البنك', 'ملاحظات']) {
      expect(roleOf(label), label).toBeUndefined();
    }
  });

  it('names each folded header once, under one role', () => {
    const all = OPERATIONS_BRANCH_IMPORT_ROLES.flatMap((role) => [
      ...OPERATIONS_BRANCH_IMPORT_SYNONYMS[role],
    ]);
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) expect(foldSheetHeader(key)).toBe(key);
  });
});

describe('tidyOperationsBranchName', () => {
  it('trims, makes every run of spaces one, and drops the tatweel', () => {
    expect(tidyOperationsBranchName('  فـــرع   المعادي\t')).toBe('فرع المعادي');
    expect(tidyOperationsBranchName('ــــــ')).toBe('');
  });

  it('matches names without the case of their Latin letters', () => {
    expect(operationsBranchNameKey(' Maadi   Branch')).toBe(
      operationsBranchNameKey('MAADI branch'),
    );
    expect(operationsBranchNameKey('فـرع  طنطا')).toBe('فرع طنطا');
  });
});

describe('operationsBranchNameLookalikeKey (Round 29 critic)', () => {
  it('is one key for one name spelt the ways Arabic is typed', () => {
    // A mark, never a match: the planner matches on `operationsBranchNameKey` alone.
    expect(operationsBranchNameLookalikeKey('فرع الأقحوان')).toBe(
      operationsBranchNameLookalikeKey('فرع الاقحوان'),
    );
    expect(operationsBranchNameLookalikeKey('فرع السوسنة')).toBe(
      operationsBranchNameLookalikeKey('فرع السوسنه'),
    );
    expect(operationsBranchNameLookalikeKey('فرع النرجسى')).toBe(
      operationsBranchNameLookalikeKey('فرع النرجسي'),
    );
    expect(operationsBranchNameLookalikeKey('فرع ٣٤ الزيزفون')).toBe(
      operationsBranchNameLookalikeKey('فرع 34 الزيزفون'),
    );
    expect(operationsBranchNameKey('فرع النرجسى')).not.toBe(operationsBranchNameKey('فرع النرجسي'));
    expect(operationsBranchNameLookalikeKey('فرع النخلة')).not.toBe(
      operationsBranchNameLookalikeKey('فرع السنديان'),
    );
  });
});

describe('isOperationsBranchImportSuffixedWrite (Round 29 critic)', () => {
  it('is a suffixed code the import writes — never one a held branch already carries', () => {
    expect(
      isOperationsBranchImportSuffixedWrite({ codeSuffixed: true, outcome: 'new', changes: [] }),
    ).toBe(true);
    expect(
      isOperationsBranchImportSuffixedWrite({
        codeSuffixed: true,
        outcome: 'update',
        changes: ['code'],
      }),
    ).toBe(true);
    // Held «116-2» for the sheet's «116»: its area changes, its code is not written.
    expect(
      isOperationsBranchImportSuffixedWrite({
        codeSuffixed: true,
        outcome: 'update',
        changes: ['opsAreaName', 'financeAreaName'],
      }),
    ).toBe(false);
    expect(
      isOperationsBranchImportSuffixedWrite({
        codeSuffixed: true,
        outcome: 'unchanged',
        changes: [],
      }),
    ).toBe(false);
    expect(
      isOperationsBranchImportSuffixedWrite({ codeSuffixed: false, outcome: 'new', changes: [] }),
    ).toBe(false);
  });
});

describe('suffixedOperationsBranchCode', () => {
  it('writes the code, a dash and the number', () => {
    expect(suffixedOperationsBranchCode('116', 2)).toBe('116-2');
    expect(suffixedOperationsBranchCode('0', 3)).toBe('0-3');
    expect(suffixedOperationsBranchCode('084', 2)).toBe('084-2');
  });
});

describe('the import fields', () => {
  const id = '0123456789abcdef01234567';
  const hash = 'a'.repeat(64);

  it('compares with a bank', () => {
    expect(CompareOperationsBranchImportSchema.safeParse({ bankId: id }).success).toBe(true);
    expect(CompareOperationsBranchImportSchema.safeParse({}).success).toBe(false);
  });

  it('applies only with both of the comparison’s hashes', () => {
    expect(
      ApplyOperationsBranchImportSchema.safeParse({
        bankId: id,
        fileSha256: hash,
        planDigest: hash,
      }).success,
    ).toBe(true);
    expect(
      ApplyOperationsBranchImportSchema.safeParse({ bankId: id, fileSha256: hash }).success,
    ).toBe(false);
    expect(
      ApplyOperationsBranchImportSchema.safeParse({
        bankId: id,
        fileSha256: hash.toUpperCase(),
        planDigest: hash,
      }).success,
    ).toBe(false);
  });
});
