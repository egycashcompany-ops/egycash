// Reading a fuel company's balance sheet: never to disk, the columns by ROLE in any order and any
// spelling, every row kept with its Excel row number, unreadable rows set aside, the rows that are
// not cards skipped, the PIN never read, caps enforced. Fixtures are synthetic, in the companies'
// own layouts (inline strings, no shared strings) — never the owner's files.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  FUEL_SHEET_HEADER,
  buildFuelSheet,
} from '../../../../../tests/integration/helpers/fuel-sheet-workbook';
import {
  FUEL_SHEET_LIMITS,
  balanceOf,
  buildCardName,
  columnLetter,
  readFuelSheet,
  sheetNumberKindOf,
  unwrapFuelCell,
} from './read-fuel-sheet';

const caught = async (work: Promise<unknown>): Promise<AppError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the read to be refused');
};

const ROWS = [
  FUEL_SHEET_HEADER,
  ['548**********0021', 'EGYCASH-1001-A', 2031.97],
  null, // a row the XML does not even carry
  ['548**********0056', 'EGYCASH-1002-B', 8403.24],
  [null, null, null],
  ['548**********0119', 'EGYCASH-1003-C', 0],
];

let scratchTmp: string;
let originalTmp: string | undefined;

beforeAll(() => {
  // A temp directory of our own: "no file appeared" cannot be confused by anything else running.
  originalTmp = process.env.TMPDIR;
  scratchTmp = mkdtempSync(path.join(os.tmpdir(), 'fuel-sheet-reader-'));
  process.env.TMPDIR = scratchTmp;
});

afterAll(() => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  rmSync(scratchTmp, { recursive: true, force: true });
});

describe('nothing touches the disk', () => {
  it('ExcelJS read directly WOULD spill this layout (control), the reconciliation does not', async () => {
    const upload = await buildFuelSheet({ rows: ROWS });
    const direct = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(upload), {
      sharedStrings: 'cache',
      styles: 'cache',
      worksheets: 'emit',
      hyperlinks: 'ignore',
      entries: 'emit',
    });
    let spilled: string[] = [];
    for await (const sheet of direct) {
      void sheet;
      spilled = readdirSync(scratchTmp);
      break;
    }
    // No shared strings at all: the reader parks the sheet in TMPDIR waiting for them.
    expect(spilled.length).toBeGreaterThan(0);

    const read = await readFuelSheet(upload);
    expect(read.rowsRead).toBe(3);
    expect(readdirSync(scratchTmp).filter((name) => !spilled.includes(name))).toEqual([]);
  });
});

describe('the rows', () => {
  it('reads his layout: each row with its Excel row number, blank rows skipped', async () => {
    const read = await readFuelSheet(await buildFuelSheet({ rows: ROWS }));
    const plain = { plate: null, chassis: null, code: null, numberKind: 'masked' };
    expect(read.rows).toEqual([
      {
        row: 2,
        number: '548**********0021',
        name: 'EGYCASH-1001-A',
        builtName: 'EGYCASH-1001-A',
        balance: 2031.97,
        ...plain,
      },
      {
        row: 4,
        number: '548**********0056',
        name: 'EGYCASH-1002-B',
        builtName: 'EGYCASH-1002-B',
        balance: 8403.24,
        ...plain,
      },
      {
        row: 6,
        number: '548**********0119',
        name: 'EGYCASH-1003-C',
        builtName: 'EGYCASH-1003-C',
        balance: 0,
        ...plain,
      },
    ]);
    expect(read.invalid).toEqual([]);
    expect(read).toMatchObject({
      skipped: [],
      totalCheck: null,
      nameRebuilt: false,
      carColumn: false,
      example: { row: 2, builtName: 'EGYCASH-1001-A' },
    });
    expect(read.layout).toEqual([
      { role: 'number', column: 'A', header: 'Card Number', assumed: false },
      { role: 'name', column: 'B', header: 'Card Name', assumed: false },
      { role: 'balance', column: 'C', header: 'Card Balance', assumed: false },
    ]);
  });

  it('binds the headers in any order, case and spacing, ignoring other columns', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['Notes', '  card   BALANCE ', 'CARD NAME', 'card number'],
          ['x', 12.5, 'EGYCASHTCS-1', '548**********9999'],
        ],
      }),
    );
    expect(read.rows).toMatchObject([
      { row: 2, number: '548**********9999', name: 'EGYCASHTCS-1', balance: 12.5 },
    ]);
    expect(read.layout.map((c) => [c.role, c.column])).toEqual([
      ['balance', 'B'],
      ['name', 'C'],
      ['number', 'D'],
    ]);
  });

  it('finds the header below blank rows (up to row 10), and reads the FIRST tab', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        sheetBefore: {
          name: 'Front',
          rows: [null, null, FUEL_SHEET_HEADER, ['1', 'EGYCASH-9', 5]],
        },
        rows: ROWS,
      }),
    );
    expect(read.rows).toMatchObject([{ row: 4, number: '1', name: 'EGYCASH-9', balance: 5 }]);
  });

  it('a balance written as text, as a formula, or past the piastre is read as its figure', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          FUEL_SHEET_HEADER,
          ['1', 'A', '1,234.50'],
          ['2', 'B', 'EGP 2 000'],
          ['3', 'C', { formula: 'C2+1', result: 1235.5 }],
          ['4', 'D', 10.005],
          [5485640006880021, 'E', 7],
        ],
      }),
    );
    expect(read.rows.map((r) => [r.name, r.balance])).toEqual([
      ['A', 1234.5],
      ['B', 2000],
      ['C', 1235.5],
      ['D', 10.01],
      ['E', 7],
    ]);
    // A number typed into the number column keeps its digits — and says it lost its last one.
    expect(read.rows.at(-1)).toMatchObject({ number: '5485640006880021', numberKind: 'imprecise' });
  });

  // Rewritten on purpose (6c): a row with a number and no name is a card row now (matched by its
  // number), no longer set aside as `noName`.
  it('sets aside a negative or unreadable balance — never dropped; a row with only a number is a card row', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          FUEL_SHEET_HEADER,
          ['1', 'EGYCASHTCS-4811-1', -2214.66],
          ['2', 'EGYCASHTCS-2', 'n/a'],
          ['3', 'EGYCASHTCS-3', null],
          ['4', null, 50],
          ['5', 'EGYCASHTCS-5', 5],
        ],
      }),
    );
    expect(read.invalid.map((r) => [r.row, r.name, r.balance, r.reason])).toEqual([
      [2, 'EGYCASHTCS-4811-1', -2214.66, 'badBalance'],
      [3, 'EGYCASHTCS-2', null, 'badBalance'],
      [4, 'EGYCASHTCS-3', null, 'badBalance'],
    ]);
    expect(read.rows.map((r) => [r.row, r.number, r.name, r.balance])).toEqual([
      [5, '4', '', 50],
      [6, '5', 'EGYCASHTCS-5', 5],
    ]);
    expect(read.rowsRead).toBe(5);
  });
});

describe('6c — his four layouts, by role', () => {
  it('the data sheet: full numbers, «car code», and «pass» — whose PINs are never read', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['Card Number', 'Card Name', 'Card Balance', 'car code', 'pass'],
          ['5485640006880021', 'EGYCASH-3674-B257539', 2031.97, '164', 'PIN-7391'],
          ['5485640006880056', 'EGYCASH-1002-B2', 8403.24, 'suz 62', 4826],
        ],
      }),
    );
    expect(read.rows.map((r) => [r.numberKind, r.builtName, r.code])).toEqual([
      ['full', 'EGYCASH-3674-B257539', '164'],
      ['full', 'EGYCASH-1002-B2', 'suz 62'],
    ]);
    expect(read.layout).toEqual([
      { role: 'number', column: 'A', header: 'Card Number', assumed: false },
      { role: 'name', column: 'B', header: 'Card Name', assumed: false },
      { role: 'balance', column: 'C', header: 'Card Balance', assumed: false },
      { role: 'code', column: 'D', header: 'car code', assumed: false },
      { role: 'secret', column: 'E', header: 'pass', assumed: false },
    ]);
    expect(read.carColumn).toBe(true);
    // Nowhere in what the reader returns — not a row, not the layout, not a skipped line.
    const everything = JSON.stringify(read);
    expect(everything).not.toContain('PIN-7391');
    expect(everything).not.toContain('4826');
  });

  it('the statement: masked numbers, the bare «EGYCASH», «لوحه/شاسيه/كود», «قيمه الشحن» and three totals', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['Card Number', 'Card Name', 'لوحه', 'شاسيه', 'Card Balance', 'كود', 'قيمه الشحن'],
          ['548**********0021', 'EGYCASH', 3674, 'B257539', 2031.97, 164, 98765.43],
          ['548**********0056', 'EGYCASH', 1002, 46466, 8403.24, 'm g 2', 98765.43],
          [null, null, null, 'رصيد الكروت', 10435.21, null, null],
          [null, null, null, 'قيمه الشحن', 1030000, null, null],
          [null, null, null, 'الرصيد المتوقع', 700000, null, null],
        ],
      }),
    );
    expect(read.rows.map((r) => [r.name, r.builtName, r.plate, r.chassis, r.code])).toEqual([
      ['EGYCASH', 'EGYCASH-3674-B257539', '3674', 'B257539', '164'],
      ['EGYCASH', 'EGYCASH-1002-46466', '1002', '46466', 'm g 2'],
    ]);
    expect(read.nameRebuilt).toBe(true);
    expect(read.example).toEqual({ row: 2, builtName: 'EGYCASH-3674-B257539' });
    expect(read.skipped).toEqual([
      { row: 4, text: 'رصيد الكروت', figure: 10435.21 },
      { row: 5, text: 'قيمه الشحن', figure: 1030000 },
      { row: 6, text: 'الرصيد المتوقع', figure: 700000 },
    ]);
    expect(read.totalCheck).toEqual({
      row: 4,
      text: 'رصيد الكروت',
      figure: 10435.21,
      sum: 10435.21,
      agrees: true,
    });
    expect(read.rowsRead).toBe(5);
    expect(read.layout.map((c) => [c.role, c.column, c.header])).toEqual([
      ['number', 'A', 'Card Number'],
      ['name', 'B', 'Card Name'],
      ['plate', 'C', 'لوحه'],
      ['chassis', 'D', 'شاسيه'],
      ['balance', 'E', 'Card Balance'],
      ['code', 'F', 'كود'],
      ['ignored', 'G', 'قيمه الشحن'],
    ]);
    // The company's planned top-up is never read.
    expect(JSON.stringify(read)).not.toContain('98765');
  });

  it('the statement with UNTITLED plate and chassis: read by their content, and said so', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['Card Number', 'Card Name', null, null, 'Card Balance', 'code'],
          ['548**********5824', 'EGYCASHTCS', 8344, 250541, 3491.4, 150],
          ['548**********6617', 'EGYCASHTCS', 4811, 48358, -2214.66, 801],
          ['548**********1111', 'EGYCASHTCS', 1476, 46466, 10, 'تويوتا اللواء'],
        ],
      }),
    );
    expect(read.layout.filter((c) => c.assumed)).toEqual([
      { role: 'plate', column: 'C', header: null, assumed: true },
      { role: 'chassis', column: 'D', header: null, assumed: true },
    ]);
    expect(read.rows.map((r) => [r.builtName, r.code])).toEqual([
      ['EGYCASHTCS-8344-250541', '150'],
      ['EGYCASHTCS-1476-46466', 'تويوتا اللواء'],
    ]);
    // The negative balance is one row, set aside — rebuilt like the rest.
    expect(read.invalid).toEqual([
      expect.objectContaining({
        row: 3,
        builtName: 'EGYCASHTCS-4811-48358',
        balance: -2214.66,
        reason: 'badBalance',
      }),
    ]);
    expect(read.totalCheck).toBeNull();
  });

  it('the masked-only export: no name at all — a card row by its number', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['Card Number', 'Card Balance'],
          ['548**********0021', 5],
        ],
      }),
    );
    expect(read.rows).toEqual([
      expect.objectContaining({ name: '', builtName: '', numberKind: 'masked', balance: 5 }),
    ]);
    expect(read.layout.map((c) => c.role)).toEqual(['number', 'balance']);
  });

  it('Arabic headers with ة/ه, spaces and a title row above them', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          ['كشف أرصدة الكروت'],
          ['رقم  الكارت', 'اسم البطاقة', 'اللوحة', 'الشاسية', 'الرصيد', 'كود العربية'],
          ['548**********0021', 'EGYCASH', '3674', 'B257539', '2,031.97', '164'],
        ],
      }),
    );
    expect(read.rows).toEqual([
      expect.objectContaining({
        row: 3,
        builtName: 'EGYCASH-3674-B257539',
        balance: 2031.97,
        code: '164',
      }),
    ]);
    expect(read.layout.map((c) => c.role)).toEqual([
      'number',
      'name',
      'plate',
      'chassis',
      'balance',
      'code',
    ]);
  });

  it('a totals row that does not agree is still checked — the first skipped figure', async () => {
    const read = await readFuelSheet(
      await buildFuelSheet({
        rows: [
          FUEL_SHEET_HEADER,
          ['548**********0021', 'EGYCASH-1', 10],
          [null, 'ملاحظة بدون رقم'],
          [null, null, 999.99],
        ],
      }),
    );
    // A row with a name and no number is a card row (here set aside: no balance); only a row with
    // neither is skipped.
    expect(read.rows.map((r) => r.name)).toEqual(['EGYCASH-1']);
    expect(read.invalid.map((r) => [r.row, r.name, r.reason])).toEqual([
      [3, 'ملاحظة بدون رقم', 'badBalance'],
    ]);
    expect(read.skipped).toEqual([{ row: 4, text: '', figure: 999.99 }]);
    expect(read.totalCheck).toEqual({ row: 4, text: '', figure: 999.99, sum: 10, agrees: false });
  });

  it('number kinds, the rebuilt name and column letters', () => {
    expect(sheetNumberKindOf({ kind: 'text', value: '5485640006880021' })).toBe('full');
    expect(sheetNumberKindOf({ kind: 'text', value: ' 548 ****** 0021 ' })).toBe('masked');
    expect(sheetNumberKindOf({ kind: 'text', value: '548xxxxxxxxxx0021' })).toBe('masked');
    expect(sheetNumberKindOf({ kind: 'empty' })).toBe('none');
    expect(sheetNumberKindOf({ kind: 'number', value: 5485640006880021 })).toBe('imprecise');
    expect(sheetNumberKindOf({ kind: 'number', value: 548564000688 })).toBe('full');
    expect(sheetNumberKindOf({ kind: 'text', value: '***12' })).toBe('other');
    expect(buildCardName('EGYCASH', '3674', 'b257539')).toEqual({
      builtName: 'EGYCASH-3674-B257539',
      rebuilt: true,
    });
    expect(buildCardName(' egycashtcs ', 'ج ك ق 4719', null)).toEqual({
      builtName: 'EGYCASHTCS-4719',
      rebuilt: true,
    });
    expect(buildCardName('EGYCASH-1', '1', '2')).toEqual({
      builtName: 'EGYCASH-1',
      rebuilt: false,
    });
    expect(buildCardName('EGYCASH', null, null)).toEqual({ builtName: 'EGYCASH', rebuilt: false });
    expect([0, 6, 25, 26].map(columnLetter)).toEqual(['A', 'G', 'Z', 'AA']);
  });
});

describe('cells', () => {
  it('unwraps formula results, rich text and hyperlinks; a balance is a figure or nothing', () => {
    expect(unwrapFuelCell({ formula: 'A1', result: 3 })).toEqual({ kind: 'number', value: 3 });
    expect(unwrapFuelCell({ richText: [{ text: 'EGY' }, { text: 'CASH' }] })).toEqual({
      kind: 'text',
      value: 'EGYCASH',
    });
    expect(unwrapFuelCell({ text: 'x', hyperlink: 'y' })).toEqual({ kind: 'text', value: 'x' });
    expect(unwrapFuelCell(null)).toEqual({ kind: 'empty' });
    expect(balanceOf({ kind: 'text', value: '1 000.25' })).toBe(1000.25);
    expect(balanceOf({ kind: 'text', value: '12abc' })).toBeNull();
    expect(balanceOf({ kind: 'text', value: '' })).toBeNull();
    expect(balanceOf({ kind: 'number', value: -0 })).toBe(0);
    expect(Object.is(balanceOf({ kind: 'number', value: -0 }), -0)).toBe(false);
  });
});

describe('refusals', () => {
  // Rewritten on purpose (6c): «Balance» is one of the balance's own spellings now; a header the
  // roles do not know stands in for the missing column.
  it('a missing column → 422 layout, one detail per required role', async () => {
    const error = await caught(
      readFuelSheet(
        await buildFuelSheet({
          rows: [
            ['Card Number', 'Card Name', 'Amount'],
            ['1', 'A', 1],
          ],
        }),
      ),
    );
    expect(error.code).toBe(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT);
    expect(error.httpStatus).toBe(422);
    expect(error.details).toEqual([
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Balance' },
    ]);
  });

  // Rewritten on purpose (6c): the name is no longer a required column — a statement may print
  // only the number and the balance; the two required roles are what a refusal names.
  it('no header in the first ten rows, or an empty sheet → every required column missing', async () => {
    const late = await caught(
      readFuelSheet(
        await buildFuelSheet({
          rows: [...Array.from({ length: 10 }, () => null), FUEL_SHEET_HEADER],
        }),
      ),
    );
    expect(late.details?.map((d) => d.message)).toEqual(['Card Number', 'Card Balance']);
    const empty = await caught(readFuelSheet(await buildFuelSheet({ rows: [] })));
    expect(empty.code).toBe(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT);
    expect(empty.details).toHaveLength(2);
  });

  it('never echoes a cell — a title row above the header is passed over, not quoted', async () => {
    const error = await caught(
      readFuelSheet(
        await buildFuelSheet({
          rows: [
            ['كشف حساب سري 0021'],
            ['Card Number', 'Card Name'],
            ['548**********0021', 'EGYCASH-1'],
          ],
        }),
      ),
    );
    expect(error.details).toEqual([
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Balance' },
    ]);
    expect(JSON.stringify(error)).not.toContain('0021');
  });

  it('bytes that are not a workbook → 422 UNREADABLE with the generic message only', async () => {
    const error = await caught(readFuelSheet(Buffer.from('definitely not a zip file')));
    expect(error.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(error.httpStatus).toBe(422);
    expect(error.details).toEqual([
      { field: 'file', code: 'UNREADABLE', message: 'not a readable .xlsx workbook' },
    ]);
  });

  it('caps: rows iterated, data rows, bytes and time → TOO_LARGE', async () => {
    const upload = await buildFuelSheet({ rows: ROWS });
    const tooLarge = async (limits: Partial<typeof FUEL_SHEET_LIMITS>): Promise<unknown> => {
      const error = await caught(readFuelSheet(upload, { ...FUEL_SHEET_LIMITS, ...limits }));
      expect(error.code).toBe(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT);
      expect(error.details?.[0]?.code).toBe('TOO_LARGE');
      return error.details?.[0]?.message;
    };
    expect(await tooLarge({ maxRowsIterated: 2 })).toBe('rows');
    expect(await tooLarge({ maxDataRows: 2 })).toBe('rows');
    expect(await tooLarge({ sheetBytes: 64 })).toBe('xl/worksheets/sheet1.xml');
    expect(await tooLarge({ timeMs: -1 })).toBe('time');
  });

  it('more zip entries than a workbook carries → TOO_LARGE entries, before JSZip opens it', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 501; i += 1) zip.file(`e${String(i)}`, '');
    const error = await caught(readFuelSheet(await zip.generateAsync({ type: 'nodebuffer' })));
    expect(error.code).toBe(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT);
    expect(error.httpStatus).toBe(422);
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);
  });

  it('exactly the data-row cap is still read', async () => {
    const read = await readFuelSheet(await buildFuelSheet({ rows: ROWS }), {
      ...FUEL_SHEET_LIMITS,
      maxDataRows: 3,
    });
    expect(read.rowsRead).toBe(3);
  });
});
