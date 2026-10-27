// The shared `.xlsx` writer (docs/12-planning/atm-settlements-phase1.md DS-20, §8.5, §10.4).
//
// Promoted from Fleet: a Fleet book must be the SAME FILE after the move, byte for byte, so the
// SHA-256 of a sample book — every part, and the whole zip — was taken from
// `modules/fleet/lib/fleet-xlsx.ts` before it became a re-export and is pinned here. Then the grid
// sheet the REP. TAPE export needs, and the XML-invalid characters the old escaping let through.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as fleet from '../../modules/fleet/lib/fleet-xlsx';
import {
  buildXlsx,
  buildXlsxBook,
  columnLetter,
  excelDaySerial,
  type XlsxGridSheet,
  type XlsxSheet,
} from './xlsx-writer';

/** The parts of a STORED zip (the writer never deflates), by name. */
const parts = async (blob: Blob): Promise<Map<string, string>> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const out = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return out;
};

const sha = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const FLEET_SHEET: XlsxSheet = {
  name: 'مخالفات: السائقين/2026',
  serialHeader: 'م',
  header: ['اسم السائق', 'المبلغ', 'ملاحظة'],
  rows: [
    ['أحمد & شركاه', 507.5, 'نص <خاص> "مقتبس"'],
    ['', 12, 'ثانٍ'],
  ],
  totals: ['الإجمالي', 519.5, ''],
  moneyColumns: [1],
  trailer: [
    ['القائم بالأعمال', '', 'مدير إدارة الحركة'],
    ['التوقيع /', '', 'التوقيع /'],
  ],
};
const SUMMARY_SHEET: XlsxSheet = {
  name: 'ملخص',
  serialHeader: 'م',
  header: ['أ'],
  rows: [[1], ['ب']],
};

/** Taken from the Fleet writer before the move (the two-sheet book above). */
const BEFORE = {
  book: '28de2ae0b8e921ba9f0343d1f4493a8006cb099060628c2de29b5c6876005187',
  oneSheetBook: 'b91e723eb789523d8445f6d47f5f3d639ee356da564438d0376ab4c0b923d2cf',
  parts: {
    '[Content_Types].xml': '6da75d1af62ca7e29ac4d531247ee1f2d075cdd69f20010a9fd85e6ece51e2e7',
    '_rels/.rels': '9f96bb683e71c45171c7ae310bf6c37fb5a834bb9738497ac7084c42ac9c2d9a',
    'xl/workbook.xml': '2cac9d57e022193cf30bd7483b7b91487902ca047bb47af65f4ca118f92ecf50',
    'xl/_rels/workbook.xml.rels':
      '2a97d1a56a4698cb1e2290e1a7a60392e23e65adae18ab2d99e2e682486ecf3a',
    'xl/styles.xml': 'eafce465c3a63526f9c607e974e3202e589a47465255b7d4c077cc4d71a8557a',
    'xl/worksheets/sheet1.xml': 'aba71e7e9b30da9380e141db971f8cd6b054e007fd9f78333f533598db6a04b3',
    'xl/worksheets/sheet2.xml': '9e2f0b94beb24b41269c081b0c393a8a80e7ecc4d9d4aa41bb54ebf20ca5fa09',
  },
} as const;

const blobSha = async (blob: Blob): Promise<string> =>
  sha(new Uint8Array(await blob.arrayBuffer()));

describe('a Fleet book is the same file after the move', () => {
  it('every part — the sheets and styles.xml included — is byte-identical', async () => {
    const book = await parts(buildXlsxBook([FLEET_SHEET, SUMMARY_SHEET]));
    expect([...book.keys()].sort()).toEqual(Object.keys(BEFORE.parts).sort());
    for (const [name, hash] of Object.entries(BEFORE.parts)) {
      expect(sha(book.get(name) ?? ''), name).toBe(hash);
    }
  });

  it('the whole zip is byte-identical, through the shared writer and through Fleet', async () => {
    expect(await blobSha(buildXlsxBook([FLEET_SHEET, SUMMARY_SHEET]))).toBe(BEFORE.book);
    expect(await blobSha(fleet.buildXlsxBook([FLEET_SHEET, SUMMARY_SHEET]))).toBe(BEFORE.book);
    expect(await blobSha(buildXlsx(SUMMARY_SHEET))).toBe(BEFORE.oneSheetBook);
    expect(await blobSha(fleet.buildXlsx(SUMMARY_SHEET))).toBe(BEFORE.oneSheetBook);
  });

  it('Fleet re-exports the same functions, not copies', () => {
    expect(fleet.buildXlsxBook).toBe(buildXlsxBook);
    expect(fleet.buildXlsx).toBe(buildXlsx);
  });
});

describe('a grid sheet', () => {
  const grid: XlsxGridSheet = {
    kind: 'grid',
    name: 'REP. TAPE',
    rightToLeft: false,
    font: 'tahoma10',
    columns: [
      { index: 3, width: 40 },
      { index: 2, width: 15 },
    ],
    merges: ['B6:C6', 'D4:E4'],
    cells: [
      { row: 7, col: 3, value: 'location', style: 'head' },
      { row: 7, col: 2, value: 'Reference', style: 'head' },
      { row: 4, col: 4, value: excelDaySerial('2026-10-27'), style: 'dateLong' },
      { row: 8, col: 12, value: 800000, style: 'totalInt' },
      { row: 8, col: 15, value: excelDaySerial('2026-10-27'), style: 'dateShort' },
      { row: 8, col: 2, value: 'BRKN9001' },
    ],
  };

  it('writes each cell at its address, rows and cells in order, with its style', async () => {
    const book = await parts(buildXlsxBook([grid]));
    const sheet = book.get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain(
      '<row r="4"><c r="D4" s="16"><v>46322</v></c></row><row r="7"><c r="B7" s="8" t="inlineStr"><is><t xml:space="preserve">Reference</t></is></c><c r="C7" s="8" t="inlineStr"><is><t xml:space="preserve">location</t></is></c></row>',
    );
    expect(sheet).toContain('<c r="B8" s="6" t="inlineStr">');
    expect(sheet).toContain('<c r="L8" s="14"><v>800000</v></c>');
    expect(sheet).toContain('<c r="O8" s="15"><v>46322</v></c>');
    expect(sheet.indexOf('r="B8"')).toBeLessThan(sheet.indexOf('r="L8"'));
    expect(sheet).toContain(
      '<cols><col min="2" max="2" width="15" customWidth="1"/><col min="3" max="3" width="40" customWidth="1"/></cols>',
    );
    expect(sheet).toContain(
      '<mergeCells count="2"><mergeCell ref="B6:C6"/><mergeCell ref="D4:E4"/></mergeCells>',
    );
    // Left to right: the attribute is absent, not "0".
    expect(sheet).toContain('<sheetView workbookViewId="0"/>');
    expect(sheet).not.toContain('rightToLeft');
  });

  it('extends the stylesheet after the table formats, which keep ids 0–5', async () => {
    const styles = (await parts(buildXlsxBook([grid]))).get('xl/styles.xml') ?? '';
    const table = (await parts(buildXlsx(SUMMARY_SHEET))).get('xl/styles.xml') ?? '';
    const xfs = (xml: string): string[] =>
      [...(/<cellXfs[^>]*>(.*)<\/cellXfs>/u.exec(xml)?.[1] ?? '').matchAll(/<xf .*?<\/xf>/gu)].map(
        (m) => m[0],
      );
    expect(xfs(styles).slice(0, 6)).toEqual(xfs(table));
    expect(xfs(styles)).toHaveLength(6 + 26);
    expect(styles).toContain(
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="[$-409]d/mmm/yy;@"/></numFmts>',
    );
    // dateShort is Excel's built-in 14; int and totalInt built-in 3.
    expect(xfs(styles)[15]).toContain('numFmtId="14"');
    expect(xfs(styles)[16]).toContain('numFmtId="164"');
    expect(xfs(styles)[14]).toContain('numFmtId="3"');
    expect(styles).toContain('<fgColor rgb="FFC6EFCE"/>');
    expect(styles).toContain('<fgColor rgb="FFFFCC00"/>');
    expect(styles).toContain('<fgColor rgb="FF000000"/>');
    expect(styles).toContain(
      '<font><sz val="10"/><color rgb="FFFF0000"/><name val="Tahoma"/></font>',
    );
    expect(styles).toContain('<font><b/><sz val="13"/><name val="Calibri"/></font>');
  });

  it('a table sheet beside a grid sheet keeps its own style ids', async () => {
    const book = await parts(buildXlsxBook([grid, SUMMARY_SHEET]));
    const table = (await parts(buildXlsx(SUMMARY_SHEET))).get('xl/worksheets/sheet1.xml');
    expect(book.get('xl/worksheets/sheet2.xml')).toBe(table);
  });

  it('a right-to-left grid says so on its view', async () => {
    const sheet =
      (await parts(buildXlsxBook([{ ...grid, rightToLeft: true }]))).get(
        'xl/worksheets/sheet1.xml',
      ) ?? '';
    expect(sheet).toContain('<sheetView rightToLeft="1" workbookViewId="0"/>');
  });

  it('refuses a cell outside the sheet', () => {
    expect(() => buildXlsxBook([{ ...grid, cells: [{ row: 0, col: 1, value: 'x' }] }])).toThrow(
      RangeError,
    );
  });
});

describe('text the XML cannot hold', () => {
  it('drops the XML-invalid characters and keeps the rest', async () => {
    const sheet: XlsxSheet = {
      name: 'ورقة',
      serialHeader: 'م',
      header: ['نص'],
      rows: [['A\u0000B\u0007C\u000BD￾E\uD800F\tG\nH😀I']],
    };
    const xml = (await parts(buildXlsx(sheet))).get('xl/worksheets/sheet1.xml') ?? '';
    expect(xml).toContain('<t xml:space="preserve">ABCDEF\tG\nH😀I</t>');
  });
});

describe('the grid helpers', () => {
  it('names columns from 1', () => {
    expect([1, 2, 26, 27, 52, 53].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AZ', 'BA']);
    expect(() => columnLetter(0)).toThrow(RangeError);
  });

  it('gives a day its Excel serial', () => {
    expect(excelDaySerial('1900-03-01')).toBe(61);
    expect(excelDaySerial('2026-10-27')).toBe(46322);
    expect(() => excelDaySerial('27/10/2026')).toThrow(RangeError);
  });
});
