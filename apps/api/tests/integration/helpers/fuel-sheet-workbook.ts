// A fuel company's balance sheet, built in-test in the companies' own layout: one sheet `Sheet1`,
// every text cell written INLINE (`t="inlineStr"`) and NO `xl/sharedStrings.xml` at all — the
// layout that makes ExcelJS's streaming reader spill the sheet to disk when it is handed the file
// as it came. Synthetic values only.
import JSZip from 'jszip';

/** A cell: text (inline), a number, a formula with its cached result, or nothing. */
export type FuelSheetCell = string | number | { formula: string; result: number } | null;

export interface FuelSheetFixture {
  /** Row 1 first; `null` leaves the row out of the XML entirely (a blank row). */
  rows: (FuelSheetCell[] | null)[];
  sheetName?: string;
  /** A second, earlier tab — the reconciliation reads the FIRST tab. */
  sheetBefore?: { name: string; rows: (FuelSheetCell[] | null)[] };
}

/** The three columns, in the companies' order. */
export const FUEL_SHEET_HEADER: FuelSheetCell[] = ['Card Number', 'Card Name', 'Card Balance'];

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const letter = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const cellXml = (cell: FuelSheetCell, ref: string): string => {
  if (cell === null) return '';
  if (typeof cell === 'string') {
    return `<c t="inlineStr" r="${ref}"><is><t>${escapeXml(cell)}</t></is></c>`;
  }
  if (typeof cell === 'number') return `<c r="${ref}"><v>${String(cell)}</v></c>`;
  return `<c r="${ref}"><f>${escapeXml(cell.formula)}</f><v>${String(cell.result)}</v></c>`;
};

const sheetXml = (rows: (FuelSheetCell[] | null)[]): string => {
  const body = rows
    .map((cells, i) => {
      if (cells === null) return '';
      const r = i + 1;
      return `<row r="${String(r)}">${cells.map((cell, c) => cellXml(cell, `${letter(c)}${String(r)}`)).join('')}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
};

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '</styleSheet>';

/** The workbook as bytes, entries in the companies' order (no shared strings anywhere). */
export const buildFuelSheet = async ({
  rows,
  sheetName = 'Sheet1',
  sheetBefore,
}: FuelSheetFixture): Promise<Buffer> => {
  const sheets = [...(sheetBefore === undefined ? [] : [sheetBefore]), { name: sheetName, rows }];
  const zip = new JSZip();
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${String(sheets.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  );
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((sheet, i) => {
    zip.file(`xl/worksheets/sheet${String(i + 1)}.xml`, sheetXml(sheet.rows));
  });
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
