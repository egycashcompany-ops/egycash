// One worksheet of an uploaded .xlsx, re-zipped IN MEMORY so ExcelJS's streaming reader can parse
// it without ever writing to disk — the fuel-card sheet reconciliation's reducer. (The ATM register
// and settlements imports read their workbooks through their own module's reader,
// `modules/atm/register/import/read-register-workbook.ts`, under the same rules; a business module
// never imports another module's code, so this one lives in shared.)
//
// WHY. ExcelJS's streaming `WorkbookReader` writes every worksheet that comes before
// `xl/sharedStrings.xml` in the zip to an OS temp file and removes it only after its loop ends
// (exceljs/lib/stream/xlsx/workbook-reader.js). A workbook with NO shared-strings part at all
// (every text cell inline, as the fuel companies' sheets are) would always spill. So the upload is
// never handed to the reader as it came:
//
//   0. before JSZip builds a single entry, the end-of-central-directory record and the directory
//      itself are checked: more than 500 entries, or any ZIP64 marker, is refused (SEC-13) —
//      `loadAsync` builds every entry before any cap here applies, and no deadline can interrupt
//      it;
//   1. the zip is opened in memory (JSZip) and only five entries are ever inflated — the workbook,
//      its relationships, the styles, the shared strings, and the ONE worksheet asked for — each
//      through a byte counter that stops the inflation past its cap (a zip bomb cannot grow
//      further than that, and no other sheet is inflated at all);
//   2. those five are re-zipped in memory, worksheet LAST (an empty shared-strings table stands in
//      when the workbook has none), so the reader has the shared strings before it meets the sheet
//      and parses the sheet straight from the stream.
//
// JSZip is CommonJS and loaded with `await import` at the point of use — never at module scope,
// where it would sit in the API's boot path (check-bundle-require.mjs) — and it is `external` in
// tsup.config.ts. Errors are the caller's own: this file names entry paths and limits, never a
// cell's content.
import path from 'node:path';
// Type-only: erased at build, so JSZip itself is still loaded only by the `await import` below.
import type { JSZipObject } from 'jszip';

/** Inflated-size caps per zip entry, in bytes. */
export interface OneSheetZipLimits {
  workbookBytes: number;
  relsBytes: number;
  stylesBytes: number;
  sharedStringsBytes: number;
  sheetBytes: number;
}

/** The caller's refusals — each module words (and codes) its own. */
export interface OneSheetZipErrors {
  /** Not a zip, or not a workbook (no workbook part, an entry that will not inflate). */
  unreadable(): Error;
  /**
   * An entry past its cap (`what` is its path), the deadline (`what` is `'time'`), or more entries
   * than a workbook carries (`what` is `'entries'`).
   */
  tooLarge(what: string): Error;
  /** The sheet asked for is not in the workbook. */
  missingSheet(): Error;
}

/** Which worksheet: the one the workbook names so, or the first tab. */
export type OneSheetPick = { name: string } | 'first';

export interface ReducedOneSheetWorkbook {
  /** rels, workbook, styles, shared strings, then the one sheet — nothing else, STORE only. */
  buffer: Buffer;
  /** Excel's 1904 date system flag (`<workbookPr date1904="1">`). */
  date1904: boolean;
}

const WORKBOOK_PATH = 'xl/workbook.xml';
const RELS_PATH = 'xl/_rels/workbook.xml.rels';
const STYLES_PATH = 'xl/styles.xml';
const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml';
/** The worksheet paths ExcelJS's streaming reader recognises. */
const READER_SHEET_PATH = /^xl\/worksheets\/sheet\d+\.xml$/;

/**
 * A workbook with no text cell at all (or only inline ones) has no shared-strings part; the reader
 * would then spill the sheet to disk while it waits for one. An empty table makes it read the
 * sheet from the stream.
 */
export const EMPTY_SHARED_STRINGS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>';

// ── The entry count, before JSZip builds anything (SEC-13) ──────────────────────────────────────

/** More entries than this is not a workbook an upload reads (the companies' sheets carry ~10). */
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
 * an entry count the EOCD understates is counted all the same. Linear in the directory's size. The
 * same check as the ATM reader's `checkZipEntryCount`, in the caller's own errors.
 */
export const checkZipEntryCount = (upload: Buffer, errors: OneSheetZipErrors): void => {
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
    throw errors.tooLarge('entries');
  }
  const prepended = eocd - (directoryOffset + directorySize);
  if (prepended < 0) throw errors.unreadable();
  let at = directoryOffset + prepended;
  let count = 0;
  while (at + CENTRAL_HEADER_BYTES <= upload.length) {
    if (upload.readUInt32LE(at) !== CENTRAL_HEADER_SIGNATURE) break;
    count += 1;
    if (count > ZIP_MAX_ENTRIES) throw errors.tooLarge('entries');
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
export const inflateCapped = (
  file: JSZipObject,
  cap: number,
  entryPath: string,
  deadline: number,
  errors: OneSheetZipErrors,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const stop = (error: Error): void => {
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
        stop(errors.tooLarge(entryPath));
        return;
      }
      if (Date.now() > deadline) {
        stop(errors.tooLarge('time'));
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

export const decodeXml = (s: string): string =>
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
export const beforeDeadline = (deadline: number, errors: OneSheetZipErrors): void => {
  if (Date.now() > deadline) throw errors.tooLarge('time');
};

/** The zip path of the worksheet picked, through its relationship id. */
const pickedSheetPath = (
  workbookXml: string,
  relsXml: string,
  pick: OneSheetPick,
): string | null => {
  let relationshipId: string | null = null;
  for (const tag of startTags(workbookXml, 'sheet')) {
    const attrs = attributes(tag);
    if (pick !== 'first' && attrs.get('name') !== pick.name) continue;
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

/**
 * Check the entry count, open the upload in memory, inflate exactly five entries under their caps,
 * and re-zip them in the order the streaming reader needs. `'first'` takes the workbook's first
 * tab.
 */
export const reduceToOneSheet = async (
  upload: Buffer,
  pick: OneSheetPick,
  limits: OneSheetZipLimits,
  deadline: number,
  errors: OneSheetZipErrors,
): Promise<ReducedOneSheetWorkbook> => {
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
  const sheetPath = pickedSheetPath(workbookText, relsXml.toString('utf8'), pick);
  beforeDeadline(deadline, errors);
  const sheetFile = sheetPath === null ? null : entry(sheetPath);
  if (sheetPath === null || sheetFile === null) throw errors.missingSheet();

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
  const sheet = await inflateCapped(sheetFile, limits.sheetBytes, sheetPath, deadline, errors);
  beforeDeadline(deadline, errors);

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
