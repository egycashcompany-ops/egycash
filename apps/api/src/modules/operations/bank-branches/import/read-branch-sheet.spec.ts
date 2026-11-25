// Reading a bank's branch sheet (Round 29): the columns by their labels in any order, the header
// below a title, merged areas, codes as the cell shows them, tidied names, placeholder areas, dates
// where names belong, blank and serial-only rows, the first VISIBLE tab, and the caps. Synthetic
// workbooks built here — never the owner's files.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  BRANCH_SHEET_HEADER,
  buildBranchSheet,
} from '../../../../../tests/integration/helpers/branch-sheet-workbook';
import {
  BRANCH_SHEET_LIMITS,
  codeTextOf,
  columnLetter,
  readBranchSheet,
} from './read-branch-sheet';

const caught = async (work: Promise<unknown>): Promise<AppError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the read to be refused');
};

describe('readBranchSheet — the owner’s layout', () => {
  it('reads every row with its row number, tidied', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          BRANCH_SHEET_HEADER,
          ['  فـــرع   النخلة ', '084', 'منطقة الأفق', 'Horizon', 'شارع  الأمل ١'],
          ['Palm Garden', '116', 'منطقة الواحة', 'Oasis', null],
        ],
      }),
    );
    expect(read.sheetName).toBe('الفروع');
    expect(read.headerRow).toBe(1);
    expect(read.layout).toEqual([
      { role: 'name', column: 'A', header: 'اسم الفرع' },
      { role: 'code', column: 'B', header: 'رقم الفرع' },
      { role: 'areaAr', column: 'C', header: 'المنطقة' },
      { role: 'areaEn', column: 'D', header: 'Area' },
      { role: 'address', column: 'E', header: 'عنوان الفرع' },
    ]);
    expect(read.rows).toEqual([
      {
        row: 2,
        name: 'فرع النخلة',
        nameIsDate: false,
        code: '084',
        areaAr: 'منطقة الأفق',
        areaEn: 'Horizon',
        address: 'شارع الأمل ١',
      },
      {
        row: 3,
        name: 'Palm Garden',
        nameIsDate: false,
        code: '116',
        areaAr: 'منطقة الواحة',
        areaEn: 'Oasis',
        address: null,
      },
    ]);
  });

  it('binds the columns by their other labels, in any order, and reads no other column', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          ['فروع البنك التجريبي'], // a title above the header
          ['م', 'الكود', 'العنوان', 'الفرع', 'التكلفة', 'المنطقة (إنجليزي)', 'المنطقة (عربي)'],
          [1, '7', 'شارع السلام', 'فرع السنديان', 1500, 'Cedar', 'منطقة السنديان'],
        ],
      }),
    );
    expect(read.headerRow).toBe(2);
    expect(read.layout.map(({ role, column }) => `${role}:${column}`)).toEqual([
      'name:D',
      'code:B',
      'areaAr:G',
      'areaEn:F',
      'address:C',
    ]);
    expect(read.rows).toEqual([
      {
        row: 3,
        name: 'فرع السنديان',
        nameIsDate: false,
        code: '7',
        areaAr: 'منطقة السنديان',
        areaEn: 'Cedar',
        address: 'شارع السلام',
      },
    ]);
  });

  it('takes «Branches» / «Code» / «Address» too', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          ['Branches', 'Code', 'Area (English)', 'Address'],
          ['North Gate', '12', 'Northfield', '1 First Street'],
        ],
      }),
    );
    expect(read.rows[0]).toMatchObject({
      name: 'North Gate',
      code: '12',
      areaAr: null,
      areaEn: 'Northfield',
      address: '1 First Street',
    });
  });
});

describe('readBranchSheet — cells', () => {
  it('gives a merged area to every row it covers', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          BRANCH_SHEET_HEADER,
          ['فرع أ', '1', 'منطقة الأفق', 'Horizon'],
          ['فرع ب', '2'],
          ['فرع ج', '3'],
          ['فرع د', '4', 'منطقة الواحة', 'Oasis'],
        ],
        merges: ['C2:C4', 'D2:D4'],
      }),
    );
    expect(read.rows.map((row) => [row.name, row.areaAr, row.areaEn])).toEqual([
      ['فرع أ', 'منطقة الأفق', 'Horizon'],
      ['فرع ب', 'منطقة الأفق', 'Horizon'],
      ['فرع ج', 'منطقة الأفق', 'Horizon'],
      ['فرع د', 'منطقة الواحة', 'Oasis'],
    ]);
  });

  it('reads a code as the cell shows it — leading zeros kept, never «84.0»', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          ['اسم الفرع', 'رقم الفرع', 'كود الفرع'],
          ['فرع أ', '084'],
          ['فرع ب', 84],
          ['فرع ج', 116],
        ],
      }),
    );
    expect(read.rows.map((row) => row.code)).toEqual(['084', '84', '116']);
    const padded = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          ['اسم الفرع', 'رقم الفرع'],
          ['فرع أ', 84],
          ['فرع ب', 7],
        ],
        formats: { 2: '000' },
      }),
    );
    expect(padded.rows.map((row) => row.code)).toEqual(['084', '007']);
    expect(codeTextOf(84, '@')).toBe('84');
    expect(codeTextOf(84.5, '000')).toBe('84.5');
    expect(codeTextOf('  116 ', undefined)).toBe('116');
  });

  it('reads an area with no letter as no area', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [BRANCH_SHEET_HEADER, ['فرع أ', '1', 'ــــــ', '-'], ['فرع ب', '2', '  ', null]],
      }),
    );
    expect(read.rows.map((row) => [row.areaAr, row.areaEn])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('flags a name cell that holds a date', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          BRANCH_SHEET_HEADER,
          [new Date(Date.UTC(2003, 3, 5)), '1'],
          ['2001-02-03 00:00:00', '2'],
          ['فرع ٣ فبراير', '3'],
        ],
      }),
    );
    expect(read.rows.map((row) => row.nameIsDate)).toEqual([true, true, false]);
  });

  it('skips blank rows and rows of a serial alone, keeping the row numbers', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        rows: [
          ['م', ...BRANCH_SHEET_HEADER],
          [1, 'فرع أ', '1'],
          null,
          [2],
          [3, null, null, 'ـــ'],
          [4, null, '9'],
          [5, 'فرع ب', '2'],
        ],
      }),
    );
    expect(read.rows.map((row) => [row.row, row.name, row.code])).toEqual([
      [2, 'فرع أ', '1'],
      [6, null, '9'],
      [7, 'فرع ب', '2'],
    ]);
  });

  it('reads the first VISIBLE tab', async () => {
    const read = await readBranchSheet(
      await buildBranchSheet({
        hiddenBefore: [
          ['Branch', 'Code'],
          ['Hidden One', '1'],
        ],
        rows: [BRANCH_SHEET_HEADER, ['فرع ظاهر', '5']],
      }),
    );
    expect(read.rows.map((row) => row.name)).toEqual(['فرع ظاهر']);
  });
});

describe('readBranchSheet — refusals', () => {
  it('refuses a sheet whose first rows name no branch column', async () => {
    const error = await caught(
      readBranchSheet(
        await buildBranchSheet({
          rows: [
            ['البنك', 'الكود'],
            ['بنك', '1'],
          ],
        }),
      ),
    );
    expect(error.code).toBe(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT);
    expect(error.httpStatus).toBe(422);
    expect(error.details?.[0]).toMatchObject({ code: 'MISSING_HEADER', message: 'اسم الفرع' });
  });

  it('refuses more branch rows than the cap', async () => {
    const buffer = await buildBranchSheet({
      rows: [BRANCH_SHEET_HEADER, ['أ', '1'], ['ب', '2'], ['ج', '3'], ['د', '4']],
    });
    const error = await caught(readBranchSheet(buffer, { ...BRANCH_SHEET_LIMITS, maxDataRows: 3 }));
    expect(error.code).toBe(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT);
    expect(error.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'rows' });
  });

  it('refuses a sheet past its inflated cap', async () => {
    const buffer = await buildBranchSheet({ rows: [BRANCH_SHEET_HEADER, ['أ', '1']] });
    const error = await caught(readBranchSheet(buffer, { ...BRANCH_SHEET_LIMITS, sheetBytes: 64 }));
    expect(error.code).toBe(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT);
    expect(error.details?.[0]?.code).toBe('TOO_LARGE');
  });

  it('refuses a file that is no workbook, naming no content', async () => {
    const error = await caught(readBranchSheet(Buffer.from('اسم الفرع,رقم الفرع\nفرع,1')));
    expect(error.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(error.message).toBe('not a readable .xlsx workbook');
  });
});

describe('columnLetter', () => {
  it('names columns past Z', () => {
    expect([0, 25, 26, 27].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB']);
  });
});
