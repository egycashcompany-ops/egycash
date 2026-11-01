// The master reader (docs/12-planning/atm-settlements-phase1.md §5.1, §10.2): both sheets from ONE
// reduction, only the cells the profile names (never a count column), the settlements error code,
// the limits sized for a bank master, the entry count checked before JSZip opens the file, and
// nothing written to disk. Workbooks are synthetic, built in-test.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  buildMasterWorkbook,
  type MasterRow,
} from '../../../../../tests/integration/helpers/atm-master-workbook';
import type * as ReaderModule from '../../register/import/read-register-workbook';

// Count the reductions without changing what they do.
vi.mock('../../register/import/read-register-workbook', async (importOriginal) => {
  const actual = await importOriginal<typeof ReaderModule>();
  return { ...actual, reduceWorkbookToSheets: vi.fn(actual.reduceWorkbookToSheets) };
});

const reader = await import('../../register/import/read-register-workbook');
const { MASTER_WORKBOOK_LIMITS, readMasterWorkbook } = await import('./read-master-workbook');
const { ATM_MASTER_PROFILES } = await import('./master-profiles');

const BRK = ATM_MASTER_PROFILES.BRK!;
/** A count no profile column may ever carry into the result (written into the count columns). */
const COUNT_SENTINEL = 987_654;
const FAKE_SECRET = 'FAKE-SECRET-SHEET-VALUE';
const MB = 1024 * 1024;

const row = (code: string, denominations: number[], extra: Partial<MasterRow> = {}): MasterRow => ({
  code,
  location: `ماكينة اختبار ${code.slice(-1)}`,
  denominations,
  counts: [COUNT_SENTINEL, COUNT_SENTINEL, COUNT_SENTINEL, COUNT_SENTINEL],
  deposit: 'Withdrawall',
  dep: 'منطقة اختبار',
  bank: 'BRK (T1)',
  help: denominations.filter((d) => d !== 0).join('---'),
  ...extra,
});

const master = (over: Parameters<typeof buildMasterWorkbook>[0] = {}) =>
  buildMasterWorkbook({
    fullList: [row('BRKN9001', [200, 200, 100, 50]), row('BRKN9002', [0, 50, 100, 200])],
    standardRows: [
      [835_000, 3100, 1700, 900],
      [625_000, 2300, 1300, 700],
    ],
    dayLines: [
      { code: 'BRKN9001', denominations: [200, 200, 100, 50], counts: [COUNT_SENTINEL] },
      { code: 'BRKN9002', denominations: [null, 50, 100, 200], counts: [COUNT_SENTINEL] },
    ],
    ...over,
  });

/** Fails with the AppError a reader throws, or the test. */
const caught = async (work: Promise<unknown>): Promise<AppError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the read to be refused');
};

let scratchTmp: string;
let originalTmp: string | undefined;

beforeAll(() => {
  originalTmp = process.env.TMPDIR;
  scratchTmp = mkdtempSync(path.join(os.tmpdir(), 'atm-master-reader-'));
  process.env.TMPDIR = scratchTmp;
});

afterAll(() => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  rmSync(scratchTmp, { recursive: true, force: true });
});

afterEach(() => {
  vi.mocked(reader.reduceWorkbookToSheets).mockClear();
});

describe('what is read', () => {
  it('the Full list rows, REP. TAPE rows 1–2 and the day lines — codes and denominations only', async () => {
    const read = await readMasterWorkbook(await master(), BRK);
    expect(read.fullList.map((r) => r.row)).toEqual([3, 4]);
    expect(read.fullList[0]).toEqual({
      row: 3,
      code: { kind: 'string', value: 'BRKN9001' },
      location: { kind: 'string', value: 'ماكينة اختبار 1' },
      denominations: [200, 200, 100, 50].map((value) => ({ kind: 'number', value })),
      typeLabel: { kind: 'string', value: 'BRK (T1)' },
      featuresLabel: { kind: 'string', value: 'Withdrawall' },
      hubLabel: { kind: 'string', value: 'منطقة اختبار' },
      help: { kind: 'string', value: '200---200---100---50' },
    });
    expect(read.fullList[1]?.denominations[0]).toEqual({ kind: 'number', value: 0 });
    expect(read.standardRows).toEqual([
      {
        row: 1,
        total: { kind: 'number', value: 835_000 },
        counts: [
          { denomination: 200, cell: { kind: 'number', value: 3100 } },
          { denomination: 100, cell: { kind: 'number', value: 1700 } },
          { denomination: 50, cell: { kind: 'number', value: 900 } },
        ],
      },
      expect.objectContaining({ row: 2 }),
    ]);
    expect(read.dayLines).toEqual([
      {
        row: 8,
        code: { kind: 'string', value: 'BRKN9001' },
        denominations: [200, 200, 100, 50].map((value) => ({ kind: 'number', value })),
      },
      {
        row: 9,
        code: { kind: 'string', value: 'BRKN9002' },
        denominations: [
          { kind: 'empty' },
          ...[50, 100, 200].map((value) => ({ kind: 'number', value })),
        ],
      },
    ]);
    // No count column of either sheet reaches the result.
    expect(JSON.stringify(read)).not.toContain(String(COUNT_SENTINEL));
  });

  it('binds the Full list headers by text, wherever they stand, spaces collapsed', async () => {
    const read = await readMasterWorkbook(
      await master({ fullListHeaders: { 0: '  Reference ', 15: 'HELP' } }),
      BRK,
    );
    expect(read.fullList).toHaveLength(2);
  });

  it('skips blank rows and reads the Full list to its end', async () => {
    const read = await readMasterWorkbook(
      await master({ fullListCells: { A40: 'BRKN9040', D40: 200 } }),
      BRK,
    );
    expect(read.fullList.map((r) => r.row)).toEqual([3, 4, 40]);
  });

  it('missing standard rows come back blank, for the plan to call invalid', async () => {
    const read = await readMasterWorkbook(await master({ standardRows: [] }), BRK);
    expect(read.standardRows.map((r) => [r.row, r.total.kind])).toEqual([
      [1, 'empty'],
      [2, 'empty'],
    ]);
  });

  it('both sheets are read from ONE reduction', async () => {
    await readMasterWorkbook(await master(), BRK);
    expect(reader.reduceWorkbookToSheets).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reader.reduceWorkbookToSheets).mock.calls[0]?.[1]).toEqual([
      'Full list',
      'REP. TAPE',
    ]);
  });
});

describe('nothing touches the disk', () => {
  it('reads a workbook whose sheets come before the shared strings without a temp file', async () => {
    const upload = await master({ sheetBefore: { name: 'Sheet1', cells: { A1: FAKE_SECRET } } });
    const zip = await JSZip.loadAsync(upload);
    const order = Object.keys(zip.files);
    expect(order.indexOf('xl/worksheets/sheet2.xml')).toBeLessThan(
      order.indexOf('xl/sharedStrings.xml'),
    );
    const before = readdirSync(scratchTmp);
    const read = await readMasterWorkbook(upload, BRK);
    expect(read.fullList).toHaveLength(2);
    expect(readdirSync(scratchTmp).filter((name) => !before.includes(name))).toEqual([]);
    expect(JSON.stringify(read)).not.toContain(FAKE_SECRET);
  });
});

describe('refusals (ATM_LAYOUT_IMPORT_LAYOUT 422)', () => {
  it('a missing sheet is named', async () => {
    for (const omit of ['Full list', 'REP. TAPE'] as const) {
      const error = await caught(readMasterWorkbook(await master({ omit }), BRK));
      expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
      expect(error.httpStatus).toBe(422);
      expect(error.details).toEqual([{ field: 'file', code: 'MISSING_SHEET', message: omit }]);
    }
  });

  it('a renamed Full list header → the header named, never a cell', async () => {
    const error = await caught(
      readMasterWorkbook(await master({ fullListHeaders: { 5: 'Denomination 2' } }), BRK),
    );
    expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
    expect(error.details).toEqual([
      { field: 'Full list', code: 'MISSING_HEADER', message: 'Denom2' },
    ]);
  });

  it('a renamed REP. TAPE row-7 header → its position and the header named', async () => {
    const error = await caught(
      readMasterWorkbook(await master({ repTapeHeaders: { I: 'Denom 3' } }), BRK),
    );
    expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
    expect(error.details).toEqual([
      { field: 'REP. TAPE!I7', code: 'MISSING_HEADER', message: 'Denom3' },
    ]);
  });

  it('a sheet beyond 5,000 iterated rows → TOO_LARGE rows', async () => {
    expect(MASTER_WORKBOOK_LIMITS.maxRowsIterated).toBe(5_000);
    // Column N is not bound, so these rows are iterated but are not data rows.
    const cells: Record<string, string> = {};
    for (let r = 3; r <= 5_003; r += 1) cells[`N${String(r)}`] = 'x';
    const error = await caught(readMasterWorkbook(await master({ fullListCells: cells }), BRK));
    expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'rows' }]);
  });

  it('more data rows than the limit → TOO_LARGE rows', async () => {
    const error = await caught(
      readMasterWorkbook(await master(), BRK, { ...MASTER_WORKBOOK_LIMITS, maxDataRows: 2 }),
    );
    expect(error.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'rows' });
  });

  it('a sheet part beyond 16 MB → TOO_LARGE naming the part', async () => {
    expect(MASTER_WORKBOOK_LIMITS.sheetBytes).toBe(16 * MB);
    const zip = await JSZip.loadAsync(await master());
    zip.file('xl/worksheets/sheet1.xml', `<worksheet>${' '.repeat(16 * MB + 1024)}</worksheet>`);
    const upload = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const error = await caught(readMasterWorkbook(upload, BRK));
    expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
    expect(error.details).toEqual([
      { field: 'file', code: 'TOO_LARGE', message: 'xl/worksheets/sheet1.xml' },
    ]);
  });

  it('the one deadline covers the whole read', async () => {
    const error = await caught(
      readMasterWorkbook(await master(), BRK, { ...MASTER_WORKBOOK_LIMITS, timeMs: -1 }),
    );
    expect(error.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'time' });
  });

  it('bytes that are not a workbook → 422 with the generic message only', async () => {
    const error = await caught(readMasterWorkbook(Buffer.from('not a zip at all'), BRK));
    expect(error.httpStatus).toBe(422);
    expect(error.message).toBe('not a readable .xlsx workbook');
  });
});

describe('the entry count, before JSZip opens the file (SEC-13)', () => {
  const opened = () => vi.spyOn(JSZip, 'loadAsync');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a zip of 501 empty entries → TOO_LARGE entries', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 501; i += 1) zip.file(`e${String(i)}`, '');
    const upload = await zip.generateAsync({ type: 'nodebuffer' });
    const loadAsync = opened();
    const error = await caught(readMasterWorkbook(upload, BRK));
    expect(error.code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT);
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('500 entries are still read past the count', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 500; i += 1) zip.file(`e${String(i)}`, '');
    const upload = await zip.generateAsync({ type: 'nodebuffer' });
    const loadAsync = opened();
    const error = await caught(readMasterWorkbook(upload, BRK));
    // Not a workbook — but refused after JSZip opened it, not by the count (the control that the
    // spy above sees the reader's JSZip).
    expect(error.message).toBe('not a readable .xlsx workbook');
    expect(loadAsync).toHaveBeenCalledTimes(1);
  });

  it('an end record that understates its entries is caught by the directory walk', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 501; i += 1) zip.file(`e${String(i)}`, '');
    const upload = await zip.generateAsync({ type: 'nodebuffer' });
    const eocd = upload.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    upload.writeUInt16LE(1, eocd + 8);
    upload.writeUInt16LE(1, eocd + 10);
    const loadAsync = opened();
    const error = await caught(readMasterWorkbook(upload, BRK));
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('a zip carrying a ZIP64 marker or a ZIP64 end locator → TOO_LARGE entries', async () => {
    const upload = await master();
    const eocd = upload.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

    const marked = Buffer.from(upload);
    marked.writeUInt16LE(0xffff, eocd + 10);
    const loadAsync = opened();
    const error = await caught(readMasterWorkbook(marked, BRK));
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(1, 16);
    const withLocator = Buffer.concat([upload.subarray(0, eocd), locator, upload.subarray(eocd)]);
    const second = await caught(readMasterWorkbook(withLocator, BRK));
    expect(second.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);
    expect(loadAsync).not.toHaveBeenCalled();
  });
});
