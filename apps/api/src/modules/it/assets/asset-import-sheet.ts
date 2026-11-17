// Reading the asset register's bulk upload («رفع جماعي») — the only file of the upload that knows
// what a workbook is. «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع» (2026-11-16):
// the sheet is the branches' custody sheet, word for word (`IT_ASSET_IMPORT_COLUMNS`), so the
// file a branch already keeps is the file it uploads — one branch per file, chosen on the screen
// (the file has no branch column; its sheet's name «عهدة فرع X» only suggests one).
//
// What leaves this file is the sheet's lines as text, each with its row number — nothing decided:
// what a line comes to is `asset-import-plan.ts`. Refusals name a column, a header or a limit.
//
// THE WORKBOOK IS NEVER INFLATED WHOLE. `workbook.xlsx.load` builds every sheet of the file in
// memory before any cap here applies — a 765 KB sheet of 30 000 rows took 175 MB of heap, and a
// crafted zip far more. So the upload is read as the fuel-card reconciliation reads its sheets
// (`fleet/fuel-cards/reconcile/read-fuel-sheet.ts`), through `shared/xlsx/one-sheet-zip.ts`: the
// entry count checked before JSZip opens anything (SEC-13); five parts inflated, each under its cap
// (`ASSET_IMPORT_SHEET_LIMITS`) — the workbook, its relationships, the styles, the shared strings
// and ONE sheet, the first visible one, found from the workbook part; re-zipped in memory for
// ExcelJS's STREAMING reader (the sheet's inline rich text joined first — `joinInlineRuns`: the
// streaming reader reads a cell of runs as its last run), handed to it in 64 KB slices cut on
// character boundaries (`readSlices` — why below), which parses it as the slices arrive and stops
// one line past the cap. Nothing touches the disk.
//
// THE TEXT READ IS THE TEXT TYPED — what `xlsx.load` reads, or, where `xlsx.load` itself is wrong,
// what Excel shows. The streaming reader keeps a cell's text as the XML spells it, so Excel's
// `_xHHHH_` escapes are decoded here (`decodeXstring`): a carriage return Excel stored as
// `_x000D_` reached the register («كيبورد_x000D_ ماوس»), and a serial «ABC123_x000D_» matched no
// device and registered a duplicate.
//
// ExcelJS is loaded with `await import` at the point of use, never at module scope, where it
// would sit in the API's boot path (workforce-import/read-workbook.ts learned that with a
// production outage); JSZip likewise, inside the reducer.
import { Readable } from 'node:stream';
import { ErrorCodes, IT_ASSET_IMPORT_COLUMNS, IT_ASSET_IMPORT_MAX_ROWS } from '@ecms/contracts';
import { AppError, BusinessRuleError } from '../../../shared/errors';
import {
  reduceToOneSheet,
  type OneSheetZipErrors,
  type OneSheetZipLimits,
} from '../../../shared/xlsx/one-sheet-zip';

/** One line of the sheet, as typed — every cell trimmed, its whitespace collapsed, empty → null. */
export interface AssetImportLine {
  /** The sheet's own row number — its first is the header. */
  row: number;
  /** «النوع» — the sheet's word for the device, the key its category is chosen by. */
  kind: string | null;
  name: string | null;
  serial: string | null;
  manufacturer: string | null;
  model: string | null;
  /** «الملصق المطبوع (Tag)» — a Dell's service tag, which the register keeps as its serial. */
  tag: string | null;
  specs: {
    processor: string | null;
    memory: string | null;
    systemType: string | null;
    storage: string | null;
    displayAdapter: string | null;
  };
  /** «المشتملات» — columns L and M, the ones typed. */
  accessories: string[];
}

export interface AssetImportSheet {
  /** The worksheet's name — «عهدة فرع طنطا» on the branches' own sheets. */
  sheetName: string;
  lines: AssetImportLine[];
}

/** The columns read: A..L as the header names them, and M — the second accessories column. */
const WIDTH = IT_ASSET_IMPORT_COLUMNS.length + 1;

const letter = (index: number): string => String.fromCharCode('A'.charCodeAt(0) + index);

/**
 * Excel's escapes in a cell's text (ECMA-376's ST_Xstring): `_xHHHH_` is the UTF-16 code unit
 * HHHH — Excel writes a carriage return as `_x000D_`, and a typed «_x0041_» as `_x005F_x0041_`,
 * its `_` escaped as `_x005F_`. Decoded left to right, none overlapping, exactly as ExcelJS's
 * `xlsx.load` decodes its shared strings (`text-xform.js`), so `_x005F_x0041_` reads «_x0041_»
 * and no further; the hex digits in either case (`xlsx.load` takes capitals only). The streaming
 * reader decodes none of them, shared or inline.
 */
export const decodeXstring = (text: string): string =>
  text.includes('_x')
    ? text.replace(/_x([0-9A-Fa-f]{4})_/gu, (_escape, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
    : text;

/**
 * A cell's value as the streaming reader hands it, with its text decoded as Excel reads it
 * (`decodeXstring`): a string, each run of rich text on its own (an escape never spans two runs),
 * a formula's text result. Everything else — numbers, dates, booleans, errors — is as it came.
 * A rich text the reader caches for every cell of one shared string is copied, never changed, so
 * nothing is decoded twice. Only the stream needs this: `xlsx.load` decodes its shared strings
 * itself.
 */
export const streamedCellValue = (value: unknown): unknown => {
  if (typeof value === 'string') return decodeXstring(value);
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  const cell = value as { richText?: unknown; result?: unknown };
  if (Array.isArray(cell.richText)) {
    return {
      ...cell,
      richText: (cell.richText as { text?: unknown }[]).map((part) =>
        typeof part.text === 'string' ? { ...part, text: decodeXstring(part.text) } : part,
      ),
    };
  }
  if (typeof cell.result === 'string') return { ...cell, result: decodeXstring(cell.result) };
  return value;
};

/** A cell's text as a person reads it, trimmed and with its whitespace collapsed; empty → null. */
const clean = (text: string): string | null => {
  const value = text.replace(/\s+/gu, ' ').trim();
  return value === '' ? null : value;
};

/**
 * A number as Excel's General format shows a whole one — never in exponent form: a long serial
 * typed as a number must read as its digits, not «1.2e+15». `String` already writes every integer
 * below 1e21 in full; past that only `BigInt` does.
 */
export const numberText = (n: number): string =>
  Number.isInteger(n) && Math.abs(n) >= 1e21 ? BigInt(n).toString() : String(n);

/**
 * What a cell shows: a number as its digits, a date as its day, rich text joined, a formula's or a
 * hyperlink's by its result or text — trimmed, collapsed, empty → null. An error value (#N/A) is
 * nothing a person typed: null.
 */
export const cellText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number') return Number.isFinite(value) ? clean(numberText(value)) : null;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const cell = value as {
      richText?: { text?: unknown }[];
      result?: unknown;
      formula?: unknown;
      sharedFormula?: unknown;
      text?: unknown;
      error?: unknown;
    };
    if (Array.isArray(cell.richText)) {
      return clean(
        cell.richText.map((part) => (typeof part.text === 'string' ? part.text : '')).join(''),
      );
    }
    if ('formula' in cell || 'sharedFormula' in cell || 'result' in cell) {
      return cellText(cell.result);
    }
    if ('text' in cell) return cellText(cell.text);
  }
  return null;
};

/** A header as compared: trimmed, whitespace collapsed, the Latin parts without case. */
const foldHeader = (text: string | null): string =>
  (text ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');

/**
 * Row 1 must be the custody sheets' header, column A onward — or the 422 names the first header
 * missing or out of place, so whoever reads it knows which column to fix.
 */
const assertHeader = (header: readonly unknown[]): void => {
  const found = header
    .slice(0, IT_ASSET_IMPORT_COLUMNS.length)
    .map((cell) => foldHeader(cellText(cell)));
  IT_ASSET_IMPORT_COLUMNS.forEach((expected, index) => {
    const want = foldHeader(expected);
    if (found[index] === want) return;
    const elsewhere = found.indexOf(want);
    throw new BusinessRuleError(
      elsewhere === -1
        ? `the header «${expected}» is missing — column ${letter(index)} of row 1 must be it`
        : `the header «${expected}» is in column ${letter(elsewhere)} — it must be in column ${letter(index)}`,
    );
  });
};

/** A row of the sheet: its own number (row 1 is the header) and its cells, column A first. */
export interface AssetImportSheetRow {
  row: number;
  cells: readonly unknown[];
}

/**
 * The sheet's lines from its rows, in the sheet's order: row 1 the header, blank rows skipped,
 * more than `IT_ASSET_IMPORT_MAX_ROWS` lines refused — a file is one branch's register page, not
 * the whole register.
 */
export const parseAssetImportRows = (
  sheetName: string,
  rows: readonly AssetImportSheetRow[],
): AssetImportSheet => {
  assertHeader(rows.find((entry) => entry.row === 1)?.cells ?? []);
  const lines: AssetImportLine[] = [];
  for (const { row, cells: values } of rows) {
    if (row <= 1) continue;
    const cells = Array.from({ length: WIDTH }, (_, column) => cellText(values[column]));
    if (cells.every((cell) => cell === null)) continue;
    if (lines.length === IT_ASSET_IMPORT_MAX_ROWS) {
      throw new BusinessRuleError(
        `the sheet has more than ${String(IT_ASSET_IMPORT_MAX_ROWS)} lines — upload one branch's sheet at a time`,
      );
    }
    const at = (column: number): string | null => cells[column] ?? null;
    lines.push({
      row,
      kind: at(0),
      name: at(1),
      serial: at(2),
      manufacturer: at(3),
      model: at(4),
      tag: at(5),
      specs: {
        processor: at(6),
        memory: at(7),
        systemType: at(8),
        storage: at(9),
        displayAdapter: at(10),
      },
      accessories: [at(11), at(12)].filter((item): item is string => item !== null),
    });
  }
  return { sheetName, lines };
};

/** The same, from a grid of cells — `grid[0]` is row 1, the header. */
export const parseAssetImportSheet = (
  sheetName: string,
  grid: readonly (readonly unknown[])[],
): AssetImportSheet =>
  parseAssetImportRows(
    sheetName,
    grid.map((cells, index) => ({ row: index + 1, cells })),
  );

/** Whether the upload's name says it is a workbook of the kind read here. */
export const isXlsxName = (fileName: string): boolean => /\.xlsx$/iu.test(fileName.trim());

// ── Reading the upload ───────────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

export interface AssetImportSheetLimits extends OneSheetZipLimits {
  /** Wall-clock for the whole read, inflation included. */
  timeMs: number;
  /**
   * Not a cap: the slices the reduced zip is handed to the streaming reader in, so it parses
   * one slice's rows at a time (`readSlices`) — each up to three bytes longer, so that no cut
   * splits a character, and longer by the U+FEFF it ends with, so that none starts with one.
   */
  chunkBytes: number;
}

/**
 * Each part's cap, inflated. A file is ONE branch's page: at most 500 lines of 13 short cells. At
 * every column's own limit (2 180 characters a line, Arabic two bytes each) 501 lines are about
 * 2.5 MB of sheet written inline, and as shared strings that much again; a real page — a kind, a
 * name, a serial, a few specifications — is a few hundred KB. The sheet's 6 MB and the shared
 * strings' 4 MB hold the worst of it with room for the formatting Excel writes around a page
 * (styled empty cells and rows past the data), and stop a zip bomb at a few MB: nothing else is
 * inflated, and the streaming reader parses one slice's rows at a time (`readSlices`). The fuel
 * sheets' caps are larger because nothing caps their rows.
 */
export const ASSET_IMPORT_SHEET_LIMITS: AssetImportSheetLimits = {
  workbookBytes: 1 * MB,
  relsBytes: 1 * MB,
  stylesBytes: 4 * MB,
  sharedStringsBytes: 4 * MB,
  sheetBytes: 6 * MB,
  timeMs: 20_000,
  chunkBytes: 64 * 1024,
};

/** A UTF-8 character's continuation bytes, at most: a lead byte and three more. */
export const UTF8_MAX_CONTINUATION = 3;

/** U+FEFF in UTF-8 — the byte-order mark a decoder drops from the start of what it decodes. */
export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * The reduced zip as the streaming reader must be handed it: in slices (views of the buffer, never
 * copies), each cut on a character boundary. HANDED WHOLE, it is one chunk; unzipper passes the
 * sheet entry on as one chunk too, and ExcelJS's `parse-sax` turns a chunk into event objects ALL
 * AT ONCE before the first row reaches the loop — the whole sheet, however soon the read means to
 * stop. Measured (2026-11-16, the process's maxRSS growth over the read): a 600 KB file of 20 000
 * short lines — a 5.8 MB sheet, under its 6 MB cap — took +283 MB handed whole, more than the
 * `xlsx.load` this reader replaced, so «stop one line past 500» bounded nothing. In 64 KB slices
 * unzipper passes the entry on in pieces of at most two slices (88 KB the largest of that sheet)
 * and the same file takes +50 to +93 MB: the parse +13 MB of it (+183 MB whole), the rest the
 * sheet inflated and re-zipped under its cap; a 500-line page takes +17 to +20 MB either way. The
 * read stops past the 501st line having parsed only that far: the streams' queues hold some 25
 * slices more of that file (3.3 MB of its 7.4 MB pulled, the shared strings read first among
 * them), as bytes, never parsed. So slicing bounds it and the caps stay as they are.
 *
 * NO CUT SPLITS A CHARACTER. unzipper passes each entry on in pieces that end where the slices
 * end (it joins what has arrived and cuts only at the entry's own ends), STORE keeps the XML's
 * bytes as they are, and `parse-sax` decodes every piece ON ITS OWN
 * (`exceljs/lib/utils/browser-buffer-decode.js`: `textDecoder.decode(chunk)`, no `{stream:
 * true}`) — so a cut inside a two-byte Arabic letter became two U+FFFD, written to the register:
 * 8 of 17 realistic 100–500-line pages at 64 KB (2026-11-16, «ما��س ديل …»). So each cut moves
 * forward past the UTF-8 continuation bytes after it (`10xxxxxx`): exact inside the XML, and
 * harmless inside the zip's binary headers, which unzipper gathers whole before it reads them. At
 * most three — a character is at most four bytes — so a slice stays within `size + 3` even where
 * a crafted part is not UTF-8 at all (its text is garbled whatever the cut).
 *
 * NO SLICE STARTS WITH U+FEFF. Each piece decoded on its own is decoded as a text of its own, and
 * a decoder drops a byte-order mark from the start of one (`TextDecoder`'s `ignoreBOM: false`) —
 * so a cut just before a U+FEFF inside a cell lost it: «معالج», U+FEFF, «إنتل» read «معالجإنتل»,
 * where `xlsx.load` reads a space between the words (U+FEFF is whitespace to `clean`). So a cut
 * also moves past an EF BB BF after it, and past the ones right after that: the BOM ends a slice,
 * never starts one. Past `size + 3` a slice holds nothing but U+FEFF — one text to the parser,
 * never a tag, a cell or a row — so what a slice is parsed into stays bounded as before; a real
 * sheet has one or two in a row, if any.
 */
export function* readSlices(buffer: Buffer, size: number): Generator<Buffer> {
  const continues = (at: number): boolean =>
    at < buffer.length && ((buffer[at] ?? 0) & 0xc0) === 0x80;
  const bomAt = (at: number): boolean =>
    buffer[at] === UTF8_BOM[0] && buffer[at + 1] === UTF8_BOM[1] && buffer[at + 2] === UTF8_BOM[2];
  for (let at = 0; at < buffer.length;) {
    let end = Math.min(at + size, buffer.length);
    for (let moved = 0; moved < UTF8_MAX_CONTINUATION && continues(end); moved += 1) end += 1;
    while (bomAt(end)) end += UTF8_BOM.length;
    yield buffer.subarray(at, end);
    at = end;
  }
}

/**
 * The library's own message is never echoed: what a refusal names is a part or a limit. A cap of
 * this reader's — a part inflated past it, more entries than a workbook carries, the deadline — is
 * `SHEET_TOO_LARGE`, never multer's `TOO_LARGE`: the screen words that one «larger than 5 MB»,
 * which a 1 MB file whose sheet unpacks past one branch's page is not.
 */
const ZIP_ERRORS: OneSheetZipErrors = {
  unreadable: () => new BusinessRuleError('the file is not an .xlsx workbook'),
  tooLarge: (what) =>
    new AppError(
      ErrorCodes.VALIDATION_FAILED,
      422,
      `the workbook is larger than one branch's sheet — upload the custody sheet on its own (at most ${String(IT_ASSET_IMPORT_MAX_ROWS)} lines)`,
      { details: [{ field: 'file', code: 'SHEET_TOO_LARGE', message: what }] },
    ),
  missingSheet: () => new BusinessRuleError('the workbook has no visible worksheet'),
};

/** A row as ExcelJS's streaming reader hands it: its number, its values from index 1 (column A). */
export interface StreamedSheetRow {
  number: number;
  values: unknown;
}

/**
 * The sheet's lines, read as the rows stream in — each row only as wide as the columns read
 * (A..M), its text decoded as Excel reads it (`streamedCellValue`), blank ones dropped, and NO
 * FURTHER than one line past the cap: that line is the one the parse refuses the sheet on, so
 * nothing after it is ever pulled from the reader (a sheet of 30 000 lines stops at its 501st).
 */
export const readAssetImportRows = async (
  sheetName: string,
  rows: AsyncIterable<StreamedSheetRow>,
  deadline = Number.POSITIVE_INFINITY,
  merges: readonly string[] = [],
): Promise<AssetImportSheet> => {
  const read: AssetImportSheetRow[] = [];
  let typed = 0;
  for await (const streamed of rows) {
    if (Date.now() > deadline) throw ZIP_ERRORS.tooLarge('time');
    // `values` is built afresh on every read of it: once per row.
    const values: readonly unknown[] = Array.isArray(streamed.values) ? streamed.values : [];
    const cells = Array.from({ length: WIDTH }, (_, column) =>
      streamedCellValue(values[column + 1]),
    );
    if (streamed.number === 1) {
      read.push({ row: 1, cells });
      continue;
    }
    if (cells.every((cell) => cellText(cell) === null)) continue;
    read.push({ row: streamed.number, cells });
    typed += 1;
    if (typed > IT_ASSET_IMPORT_MAX_ROWS) break;
  }
  return parseAssetImportRows(sheetName, fillMergedDown(read, merges));
};

/** «AB12» → column 27 (A = 0), row 12; null for anything else. */
const cellRef = (ref: string): { column: number; row: number } | null => {
  const match = /^([A-Z]{1,3})([0-9]{1,7})$/u.exec(ref);
  if (match === null) return null;
  const [, letters = '', digits = ''] = match;
  let column = 0;
  for (const char of letters) column = column * 26 + (char.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(digits) };
};

/**
 * A merged cell's value, given to the rows under it in its column — «النوع» merged down a block of
 * screens is every one of those lines' kind, as Excel shows it (and `xlsx.load` reads it); the
 * streaming reader gives it to the block's first row only. Only DOWN, never across: a value merged
 * over the two accessories columns is one accessory, not two. A range starting on the header row
 * is the header's own (its «المشتملات» spans L and M), and a cell that holds a value of its own
 * keeps it. Rows that were never read (blank, or past the cap) gain nothing.
 */
export const fillMergedDown = (
  rows: readonly AssetImportSheetRow[],
  merges: readonly string[],
): AssetImportSheetRow[] => {
  if (merges.length === 0) return [...rows];
  const byRow = new Map(rows.map((entry) => [entry.row, [...entry.cells]]));
  for (const range of merges) {
    const [from, to] = range.split(':').map(cellRef);
    if (from === null || from === undefined || to === null || to === undefined) continue;
    const column = Math.min(from.column, to.column);
    const [top, bottom] = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
    if (top <= 1 || column >= WIDTH || bottom === top) continue;
    const value = byRow.get(top)?.[column];
    if (cellText(value) === null) continue;
    for (const [row, cells] of byRow) {
      if (row <= top || row > bottom) continue;
      if (cellText(cells[column]) === null) cells[column] = value;
    }
  }
  return rows.map((entry) => ({ row: entry.row, cells: byRow.get(entry.row) ?? entry.cells }));
};

/**
 * Read the upload: its first VISIBLE worksheet (a hidden one is nobody's register page), row 1 the
 * header, every row after it a line — under `limits` (a parameter so the spec can shrink them;
 * production passes none). A file that is no workbook is refused as such; one past a cap, 422
 * `SHEET_TOO_LARGE` naming the part (or 'entries', or 'time').
 */
export const readAssetImportWorkbook = async (
  buffer: Buffer,
  limits: AssetImportSheetLimits = ASSET_IMPORT_SHEET_LIMITS,
): Promise<AssetImportSheet> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceToOneSheet(buffer, 'firstVisible', limits, deadline, ZIP_ERRORS, {
    joinInlineRuns: true,
    readMerges: true,
  });
  const { default: ExcelJS } = await import('exceljs');
  // In slices, never `Readable.from(reduced.buffer)` — one chunk, parsed whole (`readSlices`).
  const source = Readable.from(readSlices(reduced.buffer, limits.chunkBytes));
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });
  // The reduced zip holds exactly one worksheet: the one picked.
  const rows = async function* (): AsyncGenerator<StreamedSheetRow> {
    for await (const worksheet of reader) {
      for await (const row of worksheet) yield row as unknown as StreamedSheetRow;
      return;
    }
  };
  try {
    return await readAssetImportRows(reduced.sheetName, rows(), deadline, reduced.merges);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw ZIP_ERRORS.unreadable();
  } finally {
    // A read stopped past the 501st line leaves the rest of the slices unread: stop feeding them.
    source.destroy();
  }
};
