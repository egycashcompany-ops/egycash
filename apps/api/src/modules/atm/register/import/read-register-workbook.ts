// Reading the owner's workbook — the only file of the import that knows what a zip and a sheet are
// (spec §6.2).
//
// NOTHING TOUCHES THE DISK. ExcelJS's streaming `WorkbookReader` writes every worksheet that comes
// before `xl/sharedStrings.xml` in the zip to an OS temp file and removes it only after its loop
// ends (exceljs/lib/stream/xlsx/workbook-reader.js). The owner's workbook stores five sheets ahead
// of its shared strings — one of them `Sheet1`, whose cached values repeat the safe-door
// combinations and key codes (EG-13) — and ExcelJS's own writer puts every worksheet first, so even
// a test workbook would spill. The upload is therefore NEVER handed to `WorkbookReader`:
//
//   1. the zip is opened in memory (JSZip) and only five entries are ever inflated — the workbook,
//      its relationships, the styles, the shared strings, and the ONE worksheet the workbook names
//      `ATMs` — each through a byte counter that stops the inflation past its cap (a zip bomb
//      cannot grow further than that, and no other sheet is inflated at all);
//   2. those five are re-zipped in memory, worksheet LAST, so the reader has the shared strings
//      before it meets the sheet and parses the sheet straight from the stream;
//   3. that reduced zip is streamed, row by row, and the loop stops at the `END` sentinel.
//
// Both libraries are CommonJS and are loaded with `await import` at the point of use — never at
// module scope, where they would sit in the API's boot path (workforce-import/read-workbook.ts
// learned that with a production outage) — and both are `external` in tsup.config.ts.
//
// What leaves this file is cells, not values a person would type into a log: the caller (parse-
// rows.ts) turns them into register fields. Errors name an entry path, a column letter or a limit
// — never a cell's content.
//
// SHARED WITH THE SETTLEMENTS IMPORT (docs/12-planning/atm-settlements-phase1.md §5.1). The bank
// master workbook is read the same way: `reduceWorkbookToSheets` keeps several named sheets in one
// pass, and `readSheetRows` streams one of them. The error codes are the caller's (`errors`), so a
// settlements read never answers with a register code. And before JSZip builds a single entry, the
// end-of-central-directory record is checked: more than 500 entries, or any ZIP64 marker, is
// refused (SEC-13) — `loadAsync` builds every entry before any cap here applies, and no deadline
// can interrupt it.
import path from 'node:path';
import { Readable } from 'node:stream';
import { ErrorCodes, type ApiErrorDetail } from '@ecms/contracts';
// Type-only: erased at build, so JSZip itself is still loaded only by the `await import` below.
import type { JSZipObject } from 'jszip';
import { AppError } from '../../../../shared/errors';
import { EMPTY_CELL, unwrapCellValue, type RawCell } from './cell-convert';
import {
  REGISTER_COLUMN_COUNT,
  bindRegisterColumns,
  columnLetter,
  headerText,
  type BoundRegisterColumn,
} from './register-columns';

/** The sheet the register lives on (D8). */
export const REGISTER_SHEET_NAME = 'ATMs';

const MB = 1024 * 1024;

/** Inflated-size caps per zip entry; every named worksheet has `sheetBytes` of its own. */
export interface WorkbookPartLimits {
  workbookBytes: number;
  relsBytes: number;
  stylesBytes: number;
  sharedStringsBytes: number;
  sheetBytes: number;
}

export interface RegisterWorkbookLimits extends WorkbookPartLimits {
  // Inflated-size caps per zip entry (the real file's sizes, §6.2): workbook 2.5 KB, rels 1.7 KB,
  // styles 83 KB, shared strings 1.1 MB, sheet 35.8 MB.
  /** Rows the reader may iterate in total — the sentinel normally stops it at row 5000. */
  maxRowsIterated: number;
  /** Data rows without a sentinel. */
  maxDataRows: number;
  /** Wall-clock for the whole read, inflation included. */
  timeMs: number;
}

export const REGISTER_WORKBOOK_LIMITS: RegisterWorkbookLimits = {
  workbookBytes: 2 * MB,
  relsBytes: 2 * MB,
  stylesBytes: 10 * MB,
  sharedStringsBytes: 50 * MB,
  sheetBytes: 150 * MB,
  maxRowsIterated: 60_000,
  maxDataRows: 20_000,
  timeMs: 60_000,
};

const WORKBOOK_PATH = 'xl/workbook.xml';
const RELS_PATH = 'xl/_rels/workbook.xml.rels';
const STYLES_PATH = 'xl/styles.xml';
const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml';
/** The worksheet paths ExcelJS's streaming reader recognises. */
const READER_SHEET_PATH = /^xl\/worksheets\/sheet\d+\.xml$/;
/**
 * A workbook with no text cell at all has no shared-strings part; the reader would then spill the
 * sheet to disk while it waits for one. An empty table makes it read the sheet from the stream.
 */
const EMPTY_SHARED_STRINGS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>';

// ── Errors (codes, paths and letters — never a cell value) ─────────────────────────────────────

const UNREADABLE = 'not a readable .xlsx workbook';

/** §6.7: the library's own message is never echoed. */
export const unreadableWorkbook = (): AppError =>
  new AppError(ErrorCodes.VALIDATION_FAILED, 422, UNREADABLE, {
    details: [{ field: 'file', code: 'UNREADABLE', message: UNREADABLE }],
  });

/**
 * The caller's error codes (settlements §5.1): `layout` answers a missing sheet or header and every
 * limit (`TOO_LARGE`), `unreadable` a file that is not a workbook.
 */
export interface WorkbookReadErrors {
  layout(message: string, details: ApiErrorDetail[]): AppError;
  unreadable(): AppError;
}

/** The register's own answers — `ATM_REGISTER_IMPORT_LAYOUT` 422, and the unreadable 422. */
export const REGISTER_READ_ERRORS: WorkbookReadErrors = {
  layout: (message, details) =>
    new AppError(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT, 422, message, { details }),
  unreadable: unreadableWorkbook,
};

const layoutError = (message: string, details: ApiErrorDetail[]): AppError =>
  REGISTER_READ_ERRORS.layout(message, details);

const tooLargeOf = (errors: WorkbookReadErrors, what: string): AppError =>
  errors.layout('the workbook is larger than the import reads', [
    { field: 'file', code: 'TOO_LARGE', message: what },
  ]);

const tooLarge = (what: string): AppError => tooLargeOf(REGISTER_READ_ERRORS, what);

const missingSheet = (errors: WorkbookReadErrors, name: string): AppError =>
  errors.layout(`the workbook has no sheet named ${name}`, [
    { field: 'file', code: 'MISSING_SHEET', message: name },
  ]);

// ── The entry count, before JSZip builds anything (SEC-13) ──────────────────────────────────────

/** More entries than this is not a workbook either import reads (the BRK master has 39). */
export const ZIP_MAX_ENTRIES = 500;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** The record's 22 bytes plus the largest comment it can carry. */
const EOCD_SEARCH_BYTES = 22 + 0xffff;
const CENTRAL_HEADER_BYTES = 46;

/**
 * Refuse more than `ZIP_MAX_ENTRIES` entries, or any ZIP64 marker, from the end-of-central-
 * directory record and the central directory itself — the records JSZip will build. The EOCD is the
 * LAST signature of the final 65,557 bytes (JSZip reads the last one too); the central directory is
 * walked from where JSZip will start it (data prepended to the zip moves it by the same offset), so
 * an entry count the EOCD understates is counted all the same. Linear in the directory's size.
 */
export const checkZipEntryCount = (upload: Buffer, errors: WorkbookReadErrors): void => {
  const from = Math.max(0, upload.length - EOCD_SEARCH_BYTES);
  let eocd = -1;
  for (let at = upload.length - 22; at >= from; at -= 1) {
    if (upload.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw errors.unreadable();
  const entriesOnDisk = upload.readUInt16LE(eocd + 8);
  const entries = upload.readUInt16LE(eocd + 10);
  const directorySize = upload.readUInt32LE(eocd + 12);
  const directoryOffset = upload.readUInt32LE(eocd + 16);
  const zip64 =
    upload.readUInt16LE(eocd + 4) === 0xffff ||
    upload.readUInt16LE(eocd + 6) === 0xffff ||
    entriesOnDisk === 0xffff ||
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    (eocd >= 20 && upload.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE);
  if (zip64 || entries > ZIP_MAX_ENTRIES || entriesOnDisk > ZIP_MAX_ENTRIES) {
    throw tooLargeOf(errors, 'entries');
  }
  const prepended = eocd - (directoryOffset + directorySize);
  if (prepended < 0) throw errors.unreadable();
  let at = directoryOffset + prepended;
  let count = 0;
  while (at + CENTRAL_HEADER_BYTES <= upload.length) {
    if (upload.readUInt32LE(at) !== CENTRAL_HEADER_SIGNATURE) break;
    count += 1;
    if (count > ZIP_MAX_ENTRIES) throw tooLargeOf(errors, 'entries');
    at +=
      CENTRAL_HEADER_BYTES +
      upload.readUInt16LE(at + 28) +
      upload.readUInt16LE(at + 30) +
      upload.readUInt16LE(at + 32);
  }
};

// ── Zip: the parts the reader needs, inflated under caps, re-zipped in reading order ──────────

/**
 * Inflate one entry, counting bytes as they arrive. Past the cap (or the deadline) the stream is
 * paused and dropped, so the overshoot is at most the chunk in flight.
 */
const inflateCapped = (
  file: JSZipObject,
  cap: number,
  entryPath: string,
  deadline: number,
  errors: WorkbookReadErrors,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const stop = (error: AppError): void => {
      if (settled) return;
      settled = true;
      stream.removeAllListeners('data');
      stream.pause();
      (stream as { destroy?: () => void }).destroy?.();
      reject(error);
    };
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        stop(tooLargeOf(errors, entryPath));
        return;
      }
      if (Date.now() > deadline) {
        stop(tooLargeOf(errors, 'time'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => stop(errors.unreadable()));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });

const decodeXml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// THE SCANS BELOW ARE LINEAR, BY HAND (review finding SEC-2). The workbook and its rels are inflated
// up to 2 MB each, and a backtracking pattern over them — `<sheet\b[^>]*>` retried from every `<`
// of a part that never closes its tags — is quadratic: a sub-2 KB upload held the event loop for
// minutes, and no deadline can interrupt a running regex. So each part is walked once, tag by tag,
// and a tag's attributes once, name by name; every step moves forward.

/** The attributes of one start tag, by name (both quote styles), in one forward pass. */
export const attributes = (tag: string): Map<string, string> => {
  const out = new Map<string, string>();
  const name = /[\w:.-]+/y;
  const equals = /\s*=\s*/y;
  let at = 0;
  while (at < tag.length) {
    name.lastIndex = at;
    const found = name.exec(tag);
    if (found === null) {
      at += 1;
      continue;
    }
    at = name.lastIndex;
    equals.lastIndex = at;
    if (equals.exec(tag) === null) continue;
    const open = equals.lastIndex;
    const quote = tag.charAt(open);
    if (quote !== '"' && quote !== "'") {
      at = open;
      continue;
    }
    const close = tag.indexOf(quote, open + 1);
    if (close === -1) break;
    out.set(found[0], decodeXml(tag.slice(open + 1, close)));
    at = close + 1;
  }
  return out;
};

const TAG_NAME = /^<(?:[\w.-]+:)?([\w.-]+)/;

/** Every start tag `<[prefix:]localName …>` of a part, in one forward pass. */
export const startTags = (xml: string, localName: string): string[] => {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = xml.indexOf('<', from);
    if (open === -1) break;
    const close = xml.indexOf('>', open);
    if (close === -1) break;
    // A `<` inside an unclosed tag starts a new one; the scan back never passes `open`.
    const tag = xml.slice(xml.lastIndexOf('<', close), close + 1);
    if (TAG_NAME.exec(tag)?.[1] === localName) out.push(tag);
    from = close + 1;
  }
  return out;
};

/** The deadline is checked between the steps no chunk counter sees (SEC-2). */
const beforeDeadline = (deadline: number, errors: WorkbookReadErrors): void => {
  if (Date.now() > deadline) throw tooLargeOf(errors, 'time');
};

/** The zip path of the worksheet the workbook names `sheetName`, through its relationship id. */
const sheetPathOf = (workbookXml: string, relsXml: string, sheetName: string): string | null => {
  let relationshipId: string | null = null;
  for (const tag of startTags(workbookXml, 'sheet')) {
    const attrs = attributes(tag);
    if (attrs.get('name') !== sheetName) continue;
    for (const [name, value] of attrs) if (/(^|:)id$/.test(name)) relationshipId = value;
    break;
  }
  if (relationshipId === null) return null;
  for (const tag of startTags(relsXml, 'Relationship')) {
    const attrs = attributes(tag);
    if (attrs.get('Id') !== relationshipId) continue;
    const target = attrs.get('Target');
    if (target === undefined || target === '') return null;
    return target.startsWith('/')
      ? path.posix.normalize(target.slice(1))
      : path.posix.normalize(`xl/${target}`);
  }
  return null;
};

export interface ReducedWorkbook {
  /** rels, workbook, styles, shared strings, then the named sheets — nothing else, STORE only. */
  buffer: Buffer;
  /** Excel's 1904 date system flag (`<workbookPr date1904="1">`). */
  date1904: boolean;
  /** The kept sheets' names, in the order the streaming reader meets them. */
  sheets: string[];
  /** The caller's error codes, for the reads of this reduction. */
  errors: WorkbookReadErrors;
}

/** The register's reduction: the one `ATMs` sheet. */
export type ReducedRegisterWorkbook = ReducedWorkbook;

/**
 * Steps 1–2 of §6.2, for any named sheets: check the entry count, open the upload in memory,
 * inflate the workbook, its rels, the styles and the shared strings once and each named worksheet
 * under its own cap, and re-zip them with every worksheet AFTER the shared strings — the order in
 * which the streaming reader never spills (§5.1). One deadline covers the whole reduction.
 */
export const reduceWorkbookToSheets = async (
  upload: Buffer,
  sheetNames: readonly string[],
  limits: WorkbookPartLimits,
  deadline: number,
  errors: WorkbookReadErrors,
): Promise<ReducedWorkbook> => {
  checkZipEntryCount(upload, errors);
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(upload);
  } catch {
    throw errors.unreadable();
  }
  const entry = (entryPath: string): JSZipObject | null => {
    const file = zip.file(entryPath);
    return file === null || file.dir ? null : file;
  };

  const workbookFile = entry(WORKBOOK_PATH);
  const relsFile = entry(RELS_PATH);
  if (workbookFile === null || relsFile === null) throw errors.unreadable();
  const workbookXml = await inflateCapped(
    workbookFile,
    limits.workbookBytes,
    WORKBOOK_PATH,
    deadline,
    errors,
  );
  const relsXml = await inflateCapped(relsFile, limits.relsBytes, RELS_PATH, deadline, errors);
  beforeDeadline(deadline, errors);

  const workbookText = workbookXml.toString('utf8');
  const relsText = relsXml.toString('utf8');
  const sheets: { name: string; path: string; file: JSZipObject }[] = [];
  for (const name of sheetNames) {
    const sheetPath = sheetPathOf(workbookText, relsText, name);
    beforeDeadline(deadline, errors);
    const sheetFile = sheetPath === null ? null : entry(sheetPath);
    if (sheetPath === null || sheetFile === null) throw missingSheet(errors, name);
    // Two names on one part is not a workbook Excel writes.
    if (sheets.some((s) => s.path === sheetPath)) throw errors.unreadable();
    sheets.push({ name, path: sheetPath, file: sheetFile });
  }

  const stylesFile = entry(STYLES_PATH);
  const styles =
    stylesFile === null
      ? null
      : await inflateCapped(stylesFile, limits.stylesBytes, STYLES_PATH, deadline, errors);
  const sharedStringsFile = entry(SHARED_STRINGS_PATH);
  const sharedStrings =
    sharedStringsFile === null
      ? Buffer.from(EMPTY_SHARED_STRINGS, 'utf8')
      : await inflateCapped(
          sharedStringsFile,
          limits.sharedStringsBytes,
          SHARED_STRINGS_PATH,
          deadline,
          errors,
        );
  const sheetBytes: Buffer[] = [];
  for (const sheet of sheets) {
    sheetBytes.push(
      await inflateCapped(sheet.file, limits.sheetBytes, sheet.path, deadline, errors),
    );
  }
  beforeDeadline(deadline, errors);

  // JSZip writes entries in insertion order, so every sheet arrives after the shared strings. The
  // ORIGINAL path is kept when the reader recognises it; any other spelling gets the first free
  // `sheetN.xml` (the reader then names nothing by it — `readSheetRows` goes by position).
  // `createFolders: false` — exactly these entries, no directory records beside them.
  const kept = new Set(sheets.map((s) => s.path).filter((p) => READER_SHEET_PATH.test(p)));
  const written = new Set<string>();
  const targetOf = (sheetPath: string): string => {
    if (READER_SHEET_PATH.test(sheetPath)) return sheetPath;
    for (let n = 1; ; n += 1) {
      const candidate = `xl/worksheets/sheet${String(n)}.xml`;
      if (!kept.has(candidate) && !written.has(candidate)) return candidate;
    }
  };
  const reduced = new JSZip();
  const only = { createFolders: false };
  reduced.file(RELS_PATH, relsXml, only);
  reduced.file(WORKBOOK_PATH, workbookXml, only);
  if (styles !== null) reduced.file(STYLES_PATH, styles, only);
  reduced.file(SHARED_STRINGS_PATH, sharedStrings, only);
  sheets.forEach((sheet, i) => {
    const target = targetOf(sheet.path);
    written.add(target);
    reduced.file(target, sheetBytes[i] ?? Buffer.alloc(0), only);
  });
  const buffer = await reduced.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const date1904 = startTags(workbookText, 'workbookPr').some((tag) =>
    [...attributes(tag)].some(
      ([name, value]) => /(^|:)date1904$/.test(name) && (value === '1' || value === 'true'),
    ),
  );
  return { buffer, date1904, sheets: sheets.map((s) => s.name), errors };
};

/**
 * Steps 1–2 of §6.2 for the register: the `ATMs` sheet only, with the register's error codes.
 * Exported for its spec.
 */
export const reduceRegisterWorkbook = async (
  upload: Buffer,
  limits: RegisterWorkbookLimits = REGISTER_WORKBOOK_LIMITS,
  deadline: number = Date.now() + limits.timeMs,
): Promise<ReducedRegisterWorkbook> =>
  reduceWorkbookToSheets(upload, [REGISTER_SHEET_NAME], limits, deadline, REGISTER_READ_ERRORS);

// ── The sheet: row 1 binds, row 2 is the SUM band, row 3 on is data until `END` ─────────────────

export interface RegisterWorkbookRow {
  /** The Excel row number — the entry's `importRow`. */
  rowNumber: number;
  /** A1..AW1 positions, 49 cells, empty ones included. */
  cells: RawCell[];
}

export interface RegisterWorkbookRead {
  columns: BoundRegisterColumn[];
  date1904: boolean;
  /** Row 1's solid fills (EG-2: M, O, Z, AP are red in the owner's sheet). */
  headerFills: { column: string; fill: string }[];
  /** Rows 3.. with at least one value in A..AW, up to the sentinel. */
  rows: RegisterWorkbookRow[];
  sentinelRow: number | null;
  /** The last data row read (2 when there is none). */
  lastDataRow: number;
}

/** A solid fill as `argb`, `theme:<n>:<tint>` or `indexed:<n>`; none and white are not marks. */
export const solidFillOf = (fill: unknown): string | null => {
  if (typeof fill !== 'object' || fill === null) return null;
  const f = fill as {
    type?: unknown;
    pattern?: unknown;
    fgColor?: { argb?: unknown; theme?: unknown; tint?: unknown; indexed?: unknown };
  };
  if (f.type !== 'pattern' || f.pattern !== 'solid') return null;
  const color = f.fgColor ?? {};
  if (typeof color.argb === 'string') {
    return color.argb.toUpperCase() === 'FFFFFFFF' ? null : color.argb;
  }
  if (typeof color.theme === 'number') {
    return `theme:${String(color.theme)}:${typeof color.tint === 'number' ? String(color.tint) : '0'}`;
  }
  if (typeof color.indexed === 'number') return `indexed:${String(color.indexed)}`;
  return null;
};

interface ReaderCell {
  value: unknown;
  numFmt?: unknown;
  fill?: unknown;
}

interface ReaderRow {
  number: number;
  findCell(column: number): ReaderCell | undefined;
}

const readCell = (cell: ReaderCell | undefined, date1904: boolean): RawCell => {
  if (cell === undefined) return EMPTY_CELL;
  const numFmt = typeof cell.numFmt === 'string' ? cell.numFmt : null;
  return {
    value: unwrapCellValue(cell.value, numFmt, date1904),
    numFmt,
    fill: solidFillOf(cell.fill),
  };
};

const isBlank = (cell: RawCell): boolean =>
  cell.value.kind === 'empty' || (cell.value.kind === 'string' && cell.value.value.trim() === '');

// ── Any kept sheet, row by row (settlements §5.1) ───────────────────────────────────────────────

export interface SheetRowOptions {
  /** Rows the reader may iterate in this sheet, blank ones included. */
  maxRowsIterated: number;
  /** Rows yielded (at least one non-blank cell among the columns read). */
  maxDataRows: number;
  /** The caller's one deadline for the whole read (`Date.now()` milliseconds). */
  deadline: number;
  /**
   * The 1-based columns to read, in the order `cells` gives them — the same for every row, or per
   * row. A row with no column to read is skipped unread, so a caller reads exactly the cells it
   * needs and never the others.
   */
  columns: readonly number[] | ((row: number) => readonly number[]);
  /** Reading stops at the first row after this one. */
  lastRow?: number;
}

export interface SheetRow {
  /** The Excel row number. */
  row: number;
  /** The cells of `columns`, in that order. */
  cells: RawCell[];
}

/**
 * Stream one sheet of a reduction, row by row. Rows whose read cells are all blank are skipped.
 * The reduced zip is read again from the start for each sheet; the sheets before the one asked
 * for are drained unread. Errors use the reduction's codes; a library error is `unreadable`.
 */
export async function* readSheetRows(
  reduced: ReducedWorkbook,
  sheetName: string,
  options: SheetRowOptions,
): AsyncGenerator<SheetRow> {
  const position = reduced.sheets.indexOf(sheetName);
  if (position === -1) throw missingSheet(reduced.errors, sheetName);
  const { default: ExcelJS } = await import('exceljs');
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(reduced.buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });
  let seen = -1;
  let iterated = 0;
  let data = 0;
  try {
    for await (const worksheet of reader) {
      seen += 1;
      if (seen < position) continue; // drained unread by the reader
      for await (const excelRow of worksheet) {
        iterated += 1;
        if (iterated > options.maxRowsIterated) throw tooLargeOf(reduced.errors, 'rows');
        if (Date.now() > options.deadline) throw tooLargeOf(reduced.errors, 'time');
        const row = excelRow as unknown as ReaderRow;
        if (options.lastRow !== undefined && row.number > options.lastRow) return;
        const columns =
          typeof options.columns === 'function' ? options.columns(row.number) : options.columns;
        if (columns.length === 0) continue;
        const cells = columns.map((column) => readCell(row.findCell(column), reduced.date1904));
        if (cells.every(isBlank)) continue;
        data += 1;
        if (data > options.maxDataRows) throw tooLargeOf(reduced.errors, 'rows');
        yield { row: row.number, cells };
      }
      return;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw reduced.errors.unreadable();
  }
}

/**
 * Read the register sheet of an uploaded workbook (§6.2). The limits are a parameter so the spec
 * can shrink them; production passes none.
 */
export const readRegisterWorkbook = async (
  upload: Buffer,
  limits: RegisterWorkbookLimits = REGISTER_WORKBOOK_LIMITS,
): Promise<RegisterWorkbookRead> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceRegisterWorkbook(upload, limits, deadline);
  const { default: ExcelJS } = await import('exceljs');
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(reduced.buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });

  let columns: BoundRegisterColumn[] | null = null;
  let branchIndex = 0;
  const headerFills: { column: string; fill: string }[] = [];
  const rows: RegisterWorkbookRow[] = [];
  let sentinelRow: number | null = null;
  let iterated = 0;

  try {
    // The reduced zip holds exactly one worksheet: the `ATMs` sheet.
    sheets: for await (const worksheet of reader) {
      for await (const excelRow of worksheet) {
        iterated += 1;
        if (iterated > limits.maxRowsIterated) throw tooLarge('rows');
        if (Date.now() > deadline) throw tooLarge('time');
        const row = excelRow as unknown as ReaderRow;
        const cells: RawCell[] = [];
        for (let c = 1; c <= REGISTER_COLUMN_COUNT; c += 1) {
          cells.push(readCell(row.findCell(c), reduced.date1904));
        }

        if (row.number === 1) {
          const bound = bindRegisterColumns(
            Array.from({ length: REGISTER_COLUMN_COUNT }, (_, i) =>
              headerText(row.findCell(i + 1)?.value),
            ),
          );
          if ('missing' in bound) {
            throw layoutError(
              `the ${REGISTER_SHEET_NAME} sheet does not have the expected columns`,
              bound.missing.map((m) => ({
                field: m.column,
                code: 'MISSING_HEADER',
                message: m.header,
              })),
            );
          }
          columns = bound.columns;
          branchIndex = bound.columns.find((c) => c.def.excel === 'A')?.index ?? 0;
          cells.forEach((cell, i) => {
            if (cell.fill !== null)
              headerFills.push({ column: columnLetter(i + 1), fill: cell.fill });
          });
          continue;
        }
        if (columns === null) break sheets; // no header row → refused below
        if (row.number < 3) continue; // row 2 is the SUM band

        const branch = cells[branchIndex]?.value;
        if (branch?.kind === 'string' && branch.value.trim() === 'END') {
          sentinelRow = row.number;
          break sheets;
        }
        if (cells.every(isBlank)) continue;
        rows.push({ rowNumber: row.number, cells });
        if (rows.length > limits.maxDataRows) throw tooLarge('rows');
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadableWorkbook();
  }

  if (columns === null) {
    throw layoutError(
      `the ${REGISTER_SHEET_NAME} sheet does not have the expected columns`,
      bindMissingAll(),
    );
  }
  return {
    columns,
    date1904: reduced.date1904,
    headerFills,
    rows,
    sentinelRow,
    lastDataRow: rows.at(-1)?.rowNumber ?? 2,
  };
};

/** No header row at all: every column is missing. */
const bindMissingAll = (): ApiErrorDetail[] => {
  const bound = bindRegisterColumns([]);
  return 'missing' in bound
    ? bound.missing.map((m) => ({ field: m.column, code: 'MISSING_HEADER', message: m.header }))
    : [];
};
