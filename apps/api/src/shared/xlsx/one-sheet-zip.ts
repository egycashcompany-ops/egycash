// One worksheet of an uploaded .xlsx, re-zipped IN MEMORY so ExcelJS's streaming reader can parse
// it without ever writing to disk. Shared by every upload that reads a workbook (the ATM register
// import, the fuel-card sheet reconciliation), so the no-spill rule lives in one place.
//
// WHY. ExcelJS's streaming `WorkbookReader` writes every worksheet that comes before
// `xl/sharedStrings.xml` in the zip to an OS temp file and removes it only after its loop ends
// (exceljs/lib/stream/xlsx/workbook-reader.js). A workbook with NO shared-strings part at all
// (every text cell inline, as the fuel companies' sheets are) would always spill. So the upload is
// never handed to the reader as it came:
//
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
  /** An entry past its cap (`what` is its path), or the deadline (`what` is `'time'`). */
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
 * Open the upload in memory, inflate exactly five entries under their caps, and re-zip them in the
 * order the streaming reader needs. `'first'` takes the workbook's first tab.
 */
export const reduceToOneSheet = async (
  upload: Buffer,
  pick: OneSheetPick,
  limits: OneSheetZipLimits,
  deadline: number,
  errors: OneSheetZipErrors,
): Promise<ReducedOneSheetWorkbook> => {
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
