// A bank's branch sheet, built in-test with ExcelJS (Round 29) — the header the owner's sheets
// print («اسم الفرع | رقم الفرع | المنطقة | Area | عنوان الفرع») or any other, merged cells, number
// formats, a hidden tab before it. Synthetic names only — never the owner's files or branches.
import ExcelJS from 'exceljs';

export type BranchSheetCell = string | number | Date | null;

export const BRANCH_SHEET_HEADER: BranchSheetCell[] = [
  'اسم الفرع',
  'رقم الفرع',
  'المنطقة',
  'Area',
  'عنوان الفرع',
];

export interface BranchSheetFixture {
  /** Row 1 first; `null` is a blank row. */
  rows: (BranchSheetCell[] | null)[];
  sheetName?: string;
  /** Merged ranges («C2:C4»). */
  merges?: string[];
  /** A number format per 1-based column («000» on the code column). */
  formats?: Record<number, string>;
  /** A hidden tab before the sheet — the import reads the first VISIBLE one. */
  hiddenBefore?: (BranchSheetCell[] | null)[];
}

export const buildBranchSheet = async (fixture: BranchSheetFixture): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  if (fixture.hiddenBefore !== undefined) {
    const hidden = wb.addWorksheet('مخفي', { state: 'hidden' });
    for (const row of fixture.hiddenBefore) hidden.addRow(row ?? []);
  }
  const ws = wb.addWorksheet(fixture.sheetName ?? 'الفروع');
  fixture.rows.forEach((row, index) => {
    const excelRow = ws.getRow(index + 1);
    (row ?? []).forEach((value, column) => {
      if (value === null) return;
      const cell = excelRow.getCell(column + 1);
      cell.value = value;
      const format = fixture.formats?.[column + 1];
      if (format !== undefined && index > 0) cell.numFmt = format;
    });
    excelRow.commit();
  });
  for (const range of fixture.merges ?? []) ws.mergeCells(range);
  return Buffer.from(await wb.xlsx.writeBuffer());
};
