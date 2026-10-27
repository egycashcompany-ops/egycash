// The reader never writes to disk, inflates only what it must, and stops where the sheet says
// (spec §6.2, §10.2). Workbooks are synthetic, built in-test.
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
  atmRow,
  buildRegisterWorkbook,
  cell,
  excelDate,
} from '../../../../../tests/integration/helpers/atm-register-workbook';
import {
  REGISTER_WORKBOOK_LIMITS,
  readRegisterWorkbook,
  reduceRegisterWorkbook,
} from './read-register-workbook';

const FAKE_SECRET = 'FAKE-SECRET-SHEET-VALUE';

const rows = [
  atmRow({
    branchCode: 'EGYCASH-4',
    area: 'Smouha',
    bankCode: 'NBE',
    machineCode: 99990001,
    name: 'Synthetic one',
    startDate: excelDate('2025-01-05'),
    'keys.supervisorCode': 'FAKE-KEY-1',
  }),
  null, // a blank row is padding, not a row
  atmRow({
    branchCode: 'EGYCASH-2',
    bankCode: 'BM',
    machineCode: '9999002',
    name: 'Synthetic two',
  }),
];

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
  // A temp directory of our own, so "no file appeared" cannot be confused by anything else
  // running on the machine. `os.tmpdir()` (and the `tmp` package ExcelJS uses) read TMPDIR live.
  originalTmp = process.env.TMPDIR;
  scratchTmp = mkdtempSync(path.join(os.tmpdir(), 'atm-register-reader-'));
  process.env.TMPDIR = scratchTmp;
});

afterAll(() => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  rmSync(scratchTmp, { recursive: true, force: true });
});

describe('the reduced zip', () => {
  it('holds exactly rels, workbook, styles, shared strings and the ATMs sheet — in that order', async () => {
    const upload = await buildRegisterWorkbook({
      rows,
      sheetBefore: { name: 'Sheet1', cells: { A1: FAKE_SECRET } },
    });
    const original = await JSZip.loadAsync(upload);
    // The fixture really has the dangerous layout: both worksheets before the shared strings.
    const order = Object.keys(original.files);
    expect(order.indexOf('xl/worksheets/sheet2.xml')).toBeLessThan(
      order.indexOf('xl/sharedStrings.xml'),
    );

    const reduced = await reduceRegisterWorkbook(upload);
    const zip = await JSZip.loadAsync(reduced.buffer);
    expect(Object.keys(zip.files)).toEqual([
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(reduced.date1904).toBe(false);
  });

  it('adds an empty shared-strings table when the workbook has none', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('ATMs').getCell('A1').value = 1;
    const upload = Buffer.from(await workbook.xlsx.writeBuffer());
    const stripped = await JSZip.loadAsync(upload);
    stripped.remove('xl/sharedStrings.xml');
    const bytes = await stripped.generateAsync({ type: 'nodebuffer' });
    const zip = await JSZip.loadAsync((await reduceRegisterWorkbook(bytes)).buffer);
    expect(Object.keys(zip.files)).toContain('xl/sharedStrings.xml');
  });

  it('reads the 1904 date system flag', async () => {
    const upload = await buildRegisterWorkbook({ rows: [], date1904: true });
    expect((await reduceRegisterWorkbook(upload)).date1904).toBe(true);
  });
});

describe('nothing touches the disk', () => {
  it('ExcelJS read directly WOULD spill this fixture (control), the import does not', async () => {
    const upload = await buildRegisterWorkbook({
      rows,
      sheetBefore: { name: 'Sheet1', cells: { A1: FAKE_SECRET, B2: 123456 } },
    });

    // Control: handed the upload as-is, the streaming reader writes the sheets to TMPDIR.
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
    // ExcelJS still holds those files open; they are left for afterAll, and the import is judged
    // by what it ADDS.
    expect(spilled.length).toBeGreaterThan(0);

    const read = await readRegisterWorkbook(upload);
    expect(read.rows.map((r) => r.rowNumber)).toEqual([3, 5]);
    expect(readdirSync(scratchTmp).filter((name) => !spilled.includes(name))).toEqual([]);
  });
});

describe('where reading stops', () => {
  it('stops at END and never reads the rows after it', async () => {
    const upload = await buildRegisterWorkbook({
      rows,
      trailing: [atmRow({ branchCode: 'EGYCASH-1', machineCode: 99990009, name: 'After END' })],
    });
    const read = await readRegisterWorkbook(upload);
    expect(read.sentinelRow).toBe(6);
    expect(read.lastDataRow).toBe(5);
    expect(read.rows).toHaveLength(2);
  });

  it('without a sentinel it reads to the last row', async () => {
    const read = await readRegisterWorkbook(await buildRegisterWorkbook({ rows, sentinel: false }));
    expect(read.sentinelRow).toBeNull();
    expect(read.rows).toHaveLength(2);
  });

  it('captures the header fills of row 1', async () => {
    const upload = await buildRegisterWorkbook({
      rows: [],
      headerFills: { M: 'FFFF0000', AP: 'FFFF0000' },
    });
    expect((await readRegisterWorkbook(upload)).headerFills).toEqual([
      { column: 'M', fill: 'FFFF0000' },
      { column: 'AP', fill: 'FFFF0000' },
    ]);
  });

  it('keeps every A..AW cell of a row, empty ones included', async () => {
    const upload = await buildRegisterWorkbook({
      rows: [atmRow({ name: 'Only a name' }, { AW: cell('hub', { fill: 'FFFFFF00' }) })],
    });
    const [row] = (await readRegisterWorkbook(upload)).rows;
    expect(row?.cells).toHaveLength(49);
    expect(row?.cells[48]).toMatchObject({
      value: { kind: 'string', value: 'hub' },
      fill: 'FFFFFF00',
    });
  });
});

describe('refusals', () => {
  it('a renamed header → 422 layout naming the column', async () => {
    const error = await caught(
      readRegisterWorkbook(await buildRegisterWorkbook({ rows, headers: { E: 'Machine' } })),
    );
    expect(error.code).toBe(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT);
    expect(error.httpStatus).toBe(422);
    expect(error.details).toEqual([{ field: 'E', code: 'MISSING_HEADER', message: 'Name' }]);
  });

  it('no ATMs sheet → 422 layout', async () => {
    const error = await caught(
      readRegisterWorkbook(await buildRegisterWorkbook({ rows, sheetName: 'Register' })),
    );
    expect(error.code).toBe(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT);
    expect(error.details?.[0]?.code).toBe('MISSING_SHEET');
  });

  it('bytes that are not a workbook → 422 with the generic message only', async () => {
    const error = await caught(readRegisterWorkbook(Buffer.from('definitely not a zip file')));
    expect(error.httpStatus).toBe(422);
    expect(error.message).toBe('not a readable .xlsx workbook');
  });

  it('an entry inflating past its cap → TOO_LARGE naming the entry', async () => {
    const upload = await buildRegisterWorkbook({ rows });
    const error = await caught(
      readRegisterWorkbook(upload, { ...REGISTER_WORKBOOK_LIMITS, sheetBytes: 512 }),
    );
    expect(error.code).toBe(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT);
    expect(error.details).toEqual([
      { field: 'file', code: 'TOO_LARGE', message: 'xl/worksheets/sheet1.xml' },
    ]);
  });

  it('too many rows → TOO_LARGE', async () => {
    const upload = await buildRegisterWorkbook({ rows });
    const iterated = await caught(
      readRegisterWorkbook(upload, { ...REGISTER_WORKBOOK_LIMITS, maxRowsIterated: 2 }),
    );
    expect(iterated.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'rows' });
    const data = await caught(
      readRegisterWorkbook(upload, { ...REGISTER_WORKBOOK_LIMITS, maxDataRows: 1 }),
    );
    expect(data.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'rows' });
  });

  // SEC-2: a workbook part that never closes its tags. A backtracking `<sheet\b[^>]*>` over it took
  // 45 s for 400 KB (quadratic, and no deadline can stop a running regex); a linear scan answers
  // in milliseconds whatever the size up to the 2 MB cap.
  it('a workbook.xml of unclosed tags is answered at once, not scanned quadratically', async () => {
    const zip = new JSZip();
    const padding = '<sheet'.repeat(Math.floor(REGISTER_WORKBOOK_LIMITS.workbookBytes / 6) - 64);
    zip.file('xl/workbook.xml', `<workbook><workbookPr${padding}`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships>${'<Relationship'.repeat(100_000)}`);
    const upload = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(upload.length).toBeLessThan(64 * 1024);
    const started = Date.now();
    const error = await caught(reduceRegisterWorkbook(upload));
    expect(error.details?.[0]?.code).toBe('MISSING_SHEET');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('attributes and tags are still read in both quote styles, any prefix, tags split by `<`', async () => {
    const { attributes, startTags } = await import('./read-register-workbook');
    expect([...attributes(`<x:sheet name='ATMs' sheetId = "1" r:id="rId9"/>`)]).toEqual([
      ['name', 'ATMs'],
      ['sheetId', '1'],
      ['r:id', 'rId9'],
    ]);
    expect(attributes('<sheet name="A &amp; B" broken= novalue x="1">').get('x')).toBe('1');
    expect(startTags('<a><sheets><x:sheet a="1"/><sheet<sheet b="2">', 'sheet')).toEqual([
      '<x:sheet a="1"/>',
      '<sheet b="2">',
    ]);
  });

  // SEC-13 (settlements §5.1): JSZip builds every entry before any cap applies, so the count is
  // read from the end-of-central-directory record first.
  it('a zip of 501 entries → TOO_LARGE entries, before JSZip opens it', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 501; i += 1) zip.file(`e${String(i)}.txt`, '');
    const upload = await zip.generateAsync({ type: 'nodebuffer' });
    const error = await caught(reduceRegisterWorkbook(upload));
    expect(error.code).toBe(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT);
    expect(error.details).toEqual([{ field: 'file', code: 'TOO_LARGE', message: 'entries' }]);
  });

  it('the time limit → TOO_LARGE', async () => {
    const upload = await buildRegisterWorkbook({ rows });
    const error = await caught(
      readRegisterWorkbook(upload, { ...REGISTER_WORKBOOK_LIMITS, timeMs: -1 }),
    );
    expect(error.details?.[0]).toMatchObject({ code: 'TOO_LARGE', message: 'time' });
  });
});
