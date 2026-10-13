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

export interface RegisterWorkbookLimits {
  /** Inflated-size caps per zip entry (the real file's sizes in brackets, §6.2). */
  workbookBytes: number; // (2.5 KB)
  relsBytes: number; // (1.7 KB)
  stylesBytes: number; // (83 KB)
  sharedStringsBytes: number; // (1.1 MB)
  sheetBytes: number; // (35.8 MB)
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

const layoutError = (message: string, details: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT, 422, message, { details });

const tooLarge = (what: string): AppError =>
  layoutError('the workbook is larger than the import reads', [
    { field: 'file', code: 'TOO_LARGE', message: what },
  ]);

const noRegisterSheet = (): AppError =>
  layoutError(`the workbook has no sheet named ${REGISTER_SHEET_NAME}`, [
    { field: 'file', code: 'MISSING_SHEET', message: REGISTER_SHEET_NAME },
  ]);

// ── Zip: five entries, inflated under caps, re-zipped in reading order ─────────────────────────

/**
 * Inflate one entry, counting bytes as they arrive. Past the cap (or the deadline) the stream is
 * paused and dropped, so the overshoot is at most the chunk in flight.
 */
const inflateCapped = (
  file: JSZipObject,
  cap: number,
  entryPath: string,
  deadline: number,
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
        stop(tooLarge(entryPath));
        return;
      }
      if (Date.now() > deadline) {
        stop(tooLarge('time'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => stop(unreadableWorkbook()));
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
const beforeDeadline = (deadline: number): void => {
  if (Date.now() > deadline) throw tooLarge('time');
};

/** The zip path of the worksheet the workbook names `ATMs`, through its relationship id. */
const registerSheetPath = (workbookXml: string, relsXml: string): string | null => {
  let relationshipId: string | null = null;
  for (const tag of startTags(workbookXml, 'sheet')) {
    const attrs = attributes(tag);
    if (attrs.get('name') !== REGISTER_SHEET_NAME) continue;
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

export interface ReducedRegisterWorkbook {
  /** rels, workbook, styles, shared strings, then the ATMs sheet — nothing else, STORE only. */
  buffer: Buffer;
  /** Excel's 1904 date system flag (`<workbookPr date1904="1">`). */
  date1904: boolean;
}

/**
 * Steps 1–2 of §6.2: open the upload in memory, inflate exactly five entries under their caps,
 * and re-zip them in the order the streaming reader needs. Exported for its spec.
 */
export const reduceRegisterWorkbook = async (
  upload: Buffer,
  limits: RegisterWorkbookLimits = REGISTER_WORKBOOK_LIMITS,
  deadline: number = Date.now() + limits.timeMs,
): Promise<ReducedRegisterWorkbook> => {
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(upload);
  } catch {
    throw unreadableWorkbook();
  }
  const entry = (entryPath: string): JSZipObject | null => {
    const file = zip.file(entryPath);
    return file === null || file.dir ? null : file;
  };

  const workbookFile = entry(WORKBOOK_PATH);
  const relsFile = entry(RELS_PATH);
  if (workbookFile === null || relsFile === null) throw unreadableWorkbook();
  const workbookXml = await inflateCapped(
    workbookFile,
    limits.workbookBytes,
    WORKBOOK_PATH,
    deadline,
  );
  const relsXml = await inflateCapped(relsFile, limits.relsBytes, RELS_PATH, deadline);
  beforeDeadline(deadline);

  const workbookText = workbookXml.toString('utf8');
  const sheetPath = registerSheetPath(workbookText, relsXml.toString('utf8'));
  beforeDeadline(deadline);
  const sheetFile = sheetPath === null ? null : entry(sheetPath);
  if (sheetPath === null || sheetFile === null) throw noRegisterSheet();

  const stylesFile = entry(STYLES_PATH);
  const styles =
    stylesFile === null
      ? null
      : await inflateCapped(stylesFile, limits.stylesBytes, STYLES_PATH, deadline);
  const sharedStringsFile = entry(SHARED_STRINGS_PATH);
  const sharedStrings =
    sharedStringsFile === null
      ? Buffer.from(EMPTY_SHARED_STRINGS, 'utf8')
      : await inflateCapped(
          sharedStringsFile,
          limits.sharedStringsBytes,
          SHARED_STRINGS_PATH,
          deadline,
        );
  const sheet = await inflateCapped(sheetFile, limits.sheetBytes, sheetPath, deadline);
  beforeDeadline(deadline);

  // JSZip writes entries in insertion order, so the sheet arrives after the shared strings. The
  // ORIGINAL path is kept when the reader recognises it; any other spelling gets the reader's own
  // (this zip holds one worksheet, so which number it carries changes nothing).
  // `createFolders: false` — exactly these entries, no directory records beside them.
  const reduced = new JSZip();
  const only = { createFolders: false };
  reduced.file(RELS_PATH, relsXml, only);
  reduced.file(WORKBOOK_PATH, workbookXml, only);
  if (styles !== null) reduced.file(STYLES_PATH, styles, only);
  reduced.file(SHARED_STRINGS_PATH, sharedStrings, only);
  reduced.file(
    READER_SHEET_PATH.test(sheetPath) ? sheetPath : 'xl/worksheets/sheet1.xml',
    sheet,
    only,
  );
  const buffer = await reduced.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const date1904 = startTags(workbookText, 'workbookPr').some((tag) =>
    [...attributes(tag)].some(
      ([name, value]) => /(^|:)date1904$/.test(name) && (value === '1' || value === 'true'),
    ),
  );
  return { buffer, date1904 };
};

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
