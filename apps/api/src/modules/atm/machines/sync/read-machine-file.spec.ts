// Reading a machines file: the header row binds the four columns wherever they stand, in English
// or Arabic; the sheet named «ATM» is read, else the first; cells read as the text a person sees.
// A real workbook is built in memory and read back through the register import's reader.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { bindMachineHeader, machineSheetOf, readMachineFile } from './read-machine-file';

const workbook = async (
  sheets: { name: string; rows: (string | number | null)[][] }[],
): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const r of sheet.rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('bindMachineHeader', () => {
  it('binds the old system’s header, and the same in Arabic, in any order', () => {
    expect(bindMachineHeader(['Bank', 'ID', 'ATM Name', 'Area'])).toEqual({
      bank: 0,
      code: 1,
      name: 2,
      area: 3,
    });
    expect(bindMachineHeader(['', 'المنطقة', 'اسم الماكينة', 'البنك', 'الكود'])).toEqual({
      area: 1,
      name: 2,
      bank: 3,
      code: 4,
    });
  });

  it('is no header unless all four are named', () => {
    expect(bindMachineHeader(['Bank', 'ID', 'ATM Name'])).toBeNull();
    expect(bindMachineHeader(['NBE', '4670516', 'X', 'Bolaa'])).toBeNull();
  });
});

describe('machineSheetOf', () => {
  it('reads «ATM» when there is one, else the first sheet', () => {
    expect(machineSheetOf(['Notes', 'atm'])).toEqual(['atm']);
    expect(machineSheetOf(['Sheet1', 'Sheet2'])).toEqual(['Sheet1']);
    expect(machineSheetOf([])).toEqual([]);
  });
});

describe('readMachineFile', () => {
  it('reads every row under the header, codes as Excel shows them', async () => {
    const buffer = await workbook([
      { name: 'Summary', rows: [['nothing here']] },
      {
        name: 'ATM',
        rows: [
          ['قائمة الماكينات'],
          ['Bank', 'ID', 'ATM Name', 'Area'],
          ['NBE', 4670516, 'اتصالات المتاجر', 'Bolaa'],
          ['MISR', '0027750027', ' فودافون ', 'Talbya'],
          [null, null, null, null],
          ['CIB', 'ATM0302', 'Mall', 'ZAYED'],
        ],
      },
    ]);
    const rows = await readMachineFile(buffer);
    expect(rows).toEqual([
      { row: 3, bank: 'NBE', code: '4670516', name: 'اتصالات المتاجر', area: 'Bolaa' },
      { row: 4, bank: 'MISR', code: '0027750027', name: 'فودافون', area: 'Talbya' },
      { row: 6, bank: 'CIB', code: 'ATM0302', name: 'Mall', area: 'ZAYED' },
    ]);
  });

  it('answers ATM_MACHINE_SYNC_LAYOUT when no row names the four columns', async () => {
    const buffer = await workbook([{ name: 'Sheet1', rows: [['Bank', 'Code'], ['NBE', '1']] }]);
    await expect(readMachineFile(buffer)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError && error.code === ErrorCodes.ATM_MACHINE_SYNC_LAYOUT,
    );
  });

  it('refuses a file that is not a workbook', async () => {
    await expect(readMachineFile(Buffer.from('not a zip'))).rejects.toBeInstanceOf(AppError);
  });
});
