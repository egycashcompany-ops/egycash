// Reading a fuel company's balance sheet: never to disk, the three columns by header in any
// order, every row kept with its Excel row number, unreadable rows set aside, caps enforced.
// Fixtures are synthetic, in the companies' own layout (inline strings, no shared strings).
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  FUEL_SHEET_HEADER,
  buildFuelSheet,
} from '../../../../../tests/integration/helpers/fuel-sheet-workbook';
import { FUEL_SHEET_LIMITS, balanceOf, readFuelSheet, unwrapFuelCell } from './read-fuel-sheet';

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
    expect(read.rows).toEqual([
      { row: 2, number: '548**********0021', name: 'EGYCASH-1001-A', balance: 2031.97 },
      { row: 4, number: '548**********0056', name: 'EGYCASH-1002-B', balance: 8403.24 },
      { row: 6, number: '548**********0119', name: 'EGYCASH-1003-C', balance: 0 },
    ]);
    expect(read.invalid).toEqual([]);
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
    expect(read.rows).toEqual([
      { row: 2, number: '548**********9999', name: 'EGYCASHTCS-1', balance: 12.5 },
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
    expect(read.rows).toEqual([{ row: 4, number: '1', name: 'EGYCASH-9', balance: 5 }]);
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
    // A number typed into the number column keeps its digits.
    expect(read.rows.at(-1)?.number).toBe('5485640006880021');
  });

  it('sets aside a negative or unreadable balance and a row with no name — never dropped', async () => {
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
    expect(read.invalid).toEqual([
      { row: 2, number: '1', name: 'EGYCASHTCS-4811-1', balance: -2214.66, reason: 'badBalance' },
      { row: 3, number: '2', name: 'EGYCASHTCS-2', balance: null, reason: 'badBalance' },
      { row: 4, number: '3', name: 'EGYCASHTCS-3', balance: null, reason: 'badBalance' },
      { row: 5, number: '4', name: '', balance: 50, reason: 'noName' },
    ]);
    expect(read.rows).toHaveLength(1);
    expect(read.rowsRead).toBe(5);
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
  it('a missing column → 422 layout, one detail per column', async () => {
    const error = await caught(
      readFuelSheet(
        await buildFuelSheet({
          rows: [
            ['Card Number', 'Card Name', 'Balance'],
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

  it('no header in the first ten rows, or an empty sheet → every column missing', async () => {
    const late = await caught(
      readFuelSheet(
        await buildFuelSheet({
          rows: [...Array.from({ length: 10 }, () => null), FUEL_SHEET_HEADER],
        }),
      ),
    );
    expect(late.details?.map((d) => d.message)).toEqual([
      'Card Number',
      'Card Name',
      'Card Balance',
    ]);
    const empty = await caught(readFuelSheet(await buildFuelSheet({ rows: [] })));
    expect(empty.code).toBe(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT);
    expect(empty.details).toHaveLength(3);
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

  it('exactly the data-row cap is still read', async () => {
    const read = await readFuelSheet(await buildFuelSheet({ rows: ROWS }), {
      ...FUEL_SHEET_LIMITS,
      maxDataRows: 3,
    });
    expect(read.rowsRead).toBe(3);
  });
});
