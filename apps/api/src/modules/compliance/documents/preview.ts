// «View» for a Word or an Excel file (design §6.2). A browser shows a PDF itself; it cannot show a
// .docx or a .xlsx, so the file is read here into the plain structure the page draws: a document's
// headings, paragraphs and tables, a workbook's visible sheets as rows of cell text. Formatting,
// pictures and formulas are not carried — the download is the file itself.
//
// UNDER THE SAME RULES AS EVERY WORKBOOK THE API OPENS (SEC-2, SEC-13):
//   * the zip's entry count is checked from its directory before JSZip builds anything
//     (`checkZipEntryCount`);
//   * each entry is inflated through a byte counter and stopped at a bound — here a PREFIX is
//     kept rather than the read refused, because a preview of the first 500 rows needs only the
//     front of a large sheet; what was cut is reported as `truncated`;
//   * every XML part is walked once, tag by tag, by hand — no backtracking pattern runs over a part;
//   * one deadline covers the whole read.
//
// Anything unreadable answers `unavailable`, never an error: the person can still download it.
// JSZip is loaded with `await import` at the point of use, never at module scope.
import path from 'node:path';
import type JSZip from 'jszip';
import type { JSZipObject } from 'jszip';
import {
  COMPLIANCE_PREVIEW_LIMITS,
  type ComplianceDocumentKind,
  type CompliancePreviewBlockDto,
  type CompliancePreviewDto,
  type CompliancePreviewSheetDto,
} from '@ecms/contracts';
import {
  attributes,
  checkZipEntryCount,
  decodeXml,
  type OneSheetZipErrors,
} from '../../../shared/xlsx/one-sheet-zip';

/** How long one preview may take, all parts together. */
const DEADLINE_MS = 10_000;
/** The most of any one part that is inflated: the front of a large part is enough to preview. */
const PART_PREFIX_BYTES = 8 * 1024 * 1024;
/** Small parts (the workbook, its relationships, the styles) are read whole up to this. */
const SMALL_PART_BYTES = 2 * 1024 * 1024;
/** Each cell's text is cut to this, so one pasted essay does not fill the page. */
const CELL_CHARS = 500;
const BLOCK_CHARS = 5_000;

class PreviewUnavailable extends Error {}

const errors: OneSheetZipErrors = {
  unreadable: () => new PreviewUnavailable('unreadable'),
  tooLarge: (what) => new PreviewUnavailable(`too large: ${what}`),
  missingSheet: () => new PreviewUnavailable('missing sheet'),
};

// ── Inflate, keeping a prefix ───────────────────────────────────────────────

/** Up to `limit` bytes of one entry, and whether that was all of it. */
const inflatePrefix = (
  file: JSZipObject,
  limit: number,
  deadline: number,
): Promise<{ buffer: Buffer; complete: boolean }> =>
  new Promise((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (complete: boolean): void => {
      if (settled) return;
      settled = true;
      stream.removeAllListeners('data');
      stream.pause();
      if (!complete) (stream as { destroy?: () => void }).destroy?.();
      const buffer = Buffer.concat(chunks);
      resolve({ buffer: buffer.subarray(0, Math.min(buffer.length, limit)), complete });
    };
    stream.on('data', (chunk: Buffer) => {
      if (Date.now() > deadline) {
        if (!settled) {
          settled = true;
          stream.removeAllListeners('data');
          (stream as { destroy?: () => void }).destroy?.();
          reject(new PreviewUnavailable('time'));
        }
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
      if (total >= limit) finish(false);
    });
    stream.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new PreviewUnavailable('unreadable'));
    });
    stream.on('end', () => finish(true));
  });

// ── A linear walk over an XML part ──────────────────────────────────────────

type XmlEvent =
  | { kind: 'open'; name: string; tag: string; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

/** The local name of a tag body such as `w:p w:rsidR="…"` or `/w:p`. */
const localName = (body: string): string => {
  let end = 0;
  while (end < body.length && !/[\s/>]/.test(body.charAt(end))) end += 1;
  const qualified = body.slice(0, end);
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
};

/**
 * Every tag and every run of text of a part, in order, in one forward pass. `visit` returns false
 * to stop early — the walk never reads past what the preview needs.
 */
const walkXml = (xml: string, visit: (event: XmlEvent) => boolean): void => {
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf('<', at);
    if (open === -1) {
      if (!visit({ kind: 'text', text: xml.slice(at) })) return;
      return;
    }
    if (open > at && !visit({ kind: 'text', text: xml.slice(at, open) })) return;
    const close = xml.indexOf('>', open);
    if (close === -1) return;
    const body = xml.slice(open + 1, close);
    at = close + 1;
    const first = body.charAt(0);
    if (first === '?' || first === '!') continue;
    if (first === '/') {
      if (!visit({ kind: 'close', name: localName(body.slice(1)) })) return;
      continue;
    }
    const selfClosing = body.endsWith('/');
    if (!visit({ kind: 'open', name: localName(body), tag: `<${body}>`, selfClosing })) return;
    if (selfClosing && !visit({ kind: 'close', name: localName(body) })) return;
  }
};

const clip = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

// ── A budget over the whole preview ─────────────────────────────────────────

/**
 * Characters a preview may still carry. One budget for every sheet or block of one file, so the
 * per-sheet, per-row and per-cell bounds cannot multiply into a response of hundreds of MB.
 */
export interface PreviewBudget {
  left: number;
}

export const previewBudget = (): PreviewBudget => ({
  left: COMPLIANCE_PREVIEW_LIMITS.characters,
});

/** Spend `size` characters from the budget; false — and the budget closed — when they do not fit. */
const spend = (budget: PreviewBudget, size: number): boolean => {
  if (size > budget.left) {
    budget.left = 0;
    return false;
  }
  budget.left -= size;
  return true;
};

/**
 * Trailing spaces and tabs off every line, then the ends off the whole. Linear by construction —
 * split and the native trimEnd — because a pattern such as /[ \t]+\n/ backtracks over a long run of
 * spaces with no newline after it, and a tiny file of a million spaces would hold the event loop.
 */
export const tidyLines = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

// ── Word (.docx) ────────────────────────────────────────────────────────────

/** A style that heads: by its id in an English Word, or by its name in any other. */
const HEADING_STYLE = /^(heading|title|subtitle)/i;
const HEADING_NAME = /^(heading \d|title|subtitle)$/i;

/**
 * The ids of the heading styles `word/styles.xml` declares, by their built-in NAMES: a Word in
 * another language writes «Heading1» as «1» or «عنوان1», but names it «heading 1» all the same.
 */
export const readHeadingStyleIds = (xml: string): Set<string> => {
  const ids = new Set<string>();
  let current: string | null = null;
  walkXml(xml, (event) => {
    if (event.kind === 'open' && event.name === 'style') {
      current = null;
      for (const [name, value] of attributes(event.tag))
        if (/(^|:)styleId$/.test(name)) current = value;
    } else if (event.kind === 'open' && event.name === 'name' && current !== null) {
      for (const [name, value] of attributes(event.tag))
        if (/(^|:)val$/.test(name) && HEADING_NAME.test(value.trim())) ids.add(current);
    } else if (event.kind === 'close' && event.name === 'style') {
      current = null;
    }
    return true;
  });
  return ids;
};

/**
 * The blocks of `word/document.xml`: headings, paragraphs and top-level tables, in order.
 *
 * A paragraph inside a text box sits inside its anchoring paragraph, so paragraphs are counted
 * by depth and an inner one's text joins the outer one's. A text box is also written twice — the
 * drawing (`mc:Choice`) and its older copy (`mc:Fallback`) — and the copy is skipped, so the box
 * is read once.
 */
export const readDocxBlocks = (
  xml: string,
  headingIds: ReadonlySet<string> = new Set(),
  budget: PreviewBudget = previewBudget(),
): { blocks: CompliancePreviewBlockDto[]; truncated: boolean } => {
  const blocks: CompliancePreviewBlockDto[] = [];
  let truncated = false;
  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string[] | null = null;
  let paragraph: string | null = null;
  let paragraphDepth = 0;
  let style: string | null = null;
  let inText = false;
  let fallbackDepth = 0;

  const stop = (): false => {
    truncated = true;
    return false;
  };
  const push = (block: CompliancePreviewBlockDto): boolean => {
    if (blocks.length >= COMPLIANCE_PREVIEW_LIMITS.blocks) return stop();
    const size =
      block.type === 'table'
        ? block.rows.reduce((sum, line) => sum + line.join('').length, 0)
        : block.text.length;
    if (!spend(budget, size)) return stop();
    blocks.push(block);
    return true;
  };
  const isHeading = (id: string | null): boolean =>
    id !== null && (headingIds.has(id) || HEADING_STYLE.test(id));

  walkXml(xml, (event) => {
    if (event.kind !== 'text' && event.name === 'Fallback') {
      fallbackDepth += event.kind === 'open' ? 1 : -1;
      return true;
    }
    if (fallbackDepth > 0) return true;
    if (event.kind === 'text') {
      if (inText && paragraph !== null) paragraph += decodeXml(event.text);
      return true;
    }
    if (event.kind === 'open') {
      switch (event.name) {
        case 'p':
          if (paragraphDepth === 0) {
            paragraph = '';
            style = null;
          } else if (paragraph !== null && paragraph !== '') {
            paragraph += '\n';
          }
          paragraphDepth += 1;
          break;
        case 'pStyle':
          // The outer paragraph's style decides; an inner one's is its text box's own.
          if (paragraphDepth === 1)
            for (const [name, value] of attributes(event.tag))
              if (/(^|:)val$/.test(name)) style = value;
          break;
        case 't':
          inText = !event.selfClosing;
          break;
        case 'tab':
          if (paragraph !== null) paragraph += ' ';
          break;
        case 'br':
        case 'cr':
          if (paragraph !== null) paragraph += '\n';
          break;
        case 'tbl':
          tableDepth += 1;
          if (tableDepth === 1) rows = [];
          break;
        case 'tr':
          if (tableDepth === 1) row = [];
          break;
        case 'tc':
          if (tableDepth === 1) cell = [];
          break;
        default:
          break;
      }
      return true;
    }
    switch (event.name) {
      case 't':
        inText = false;
        return true;
      case 'p': {
        paragraphDepth = Math.max(0, paragraphDepth - 1);
        if (paragraphDepth > 0) return true;
        const text = tidyLines(paragraph ?? '');
        paragraph = null;
        if (tableDepth > 0) {
          if (cell !== null && text !== '') cell.push(text);
          return true;
        }
        if (text === '') return true;
        return push(
          isHeading(style)
            ? { type: 'heading', text: clip(text, BLOCK_CHARS) }
            : { type: 'paragraph', text: clip(text, BLOCK_CHARS) },
        );
      }
      case 'tc':
        if (tableDepth === 1 && row !== null && cell !== null) {
          row.push(clip(cell.join('\n'), CELL_CHARS));
          cell = null;
        }
        return true;
      case 'tr':
        if (tableDepth === 1 && row !== null) {
          if (row.length > COMPLIANCE_PREVIEW_LIMITS.columns) truncated = true;
          if (rows.length < COMPLIANCE_PREVIEW_LIMITS.rows) {
            rows.push(row.slice(0, COMPLIANCE_PREVIEW_LIMITS.columns));
          } else {
            truncated = true;
          }
          row = null;
        }
        return true;
      case 'tbl':
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0 && rows.length > 0) return push({ type: 'table', rows });
        return true;
      default:
        return true;
    }
  });
  return { blocks, truncated };
};

// ── Excel (.xlsx) ───────────────────────────────────────────────────────────

/** «B12» → column 1 (zero-based); null for a reference that names no column. */
export const columnIndexOf = (ref: string): number | null => {
  let index = 0;
  let letters = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
    letters += 1;
  }
  return letters === 0 ? null : index - 1;
};

/** The shared strings table: each `<si>`'s text, its runs joined, its phonetic hints left out. */
export const readSharedStrings = (xml: string): string[] => {
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  walkXml(xml, (event) => {
    if (event.kind === 'text') {
      if (current !== null && inText && phonetic === 0) current += decodeXml(event.text);
    } else if (event.kind === 'open') {
      if (event.name === 'si') current = '';
      else if (event.name === 'rPh') phonetic += 1;
      else if (event.name === 't') inText = !event.selfClosing;
    } else if (event.name === 'si') {
      strings.push(current ?? '');
      current = null;
    } else if (event.name === 'rPh') {
      phonetic = Math.max(0, phonetic - 1);
    } else if (event.name === 't') {
      inText = false;
    }
    return true;
  });
  return strings;
};

/** How a number cell's format prints it: as a date, a time of day, both, or a plain number. */
export type CellFormat = 'date' | 'time' | 'datetime' | null;

/** Excel's built-in formats that print dates or times. */
const BUILT_IN_FORMATS: ReadonlyMap<number, Exclude<CellFormat, null>> = new Map([
  ...[14, 15, 16, 17, 27, 30, 36, 50, 57].map((id) => [id, 'date'] as const),
  ...[18, 19, 20, 21, 45, 46, 47].map((id) => [id, 'time'] as const),
  [22, 'datetime'] as const,
]);

/**
 * What a custom format code prints. Quoted text, bracketed parts and escaped characters are not
 * format letters; an «m» beside an «h» or an «s» is minutes, anywhere else a month.
 */
export const formatOfCode = (code: string): CellFormat => {
  // A real format code is a few dozen characters; a longer one is not judged at all, so no pattern
  // below ever runs over a crafted run of thousands of letters.
  if (code.length > 200) return null;
  const bare = code
    .replace(/"[^"]*"/g, '')
    // An elapsed-time part — «[h]», «[mm]», «[ss]» — is a time letter; any other bracket is not.
    .replace(/\[([hms])\1*\]/gi, '$1')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  const date = /[dy]/i.test(bare) || /m/i.test(bare.replace(/[hs]+:?m+|m+:?s+/gi, ''));
  const time = /[hs]/i.test(bare);
  return date && time ? 'datetime' : date ? 'date' : time ? 'time' : null;
};

/** For each cell style index, how it prints a number — read from `xl/styles.xml`. */
export const readCellFormats = (xml: string): CellFormat[] => {
  const custom = new Map<number, CellFormat>();
  const styles: CellFormat[] = [];
  let inCellXfs = false;
  walkXml(xml, (event) => {
    if (event.kind === 'open') {
      if (event.name === 'numFmt') {
        const attrs = attributes(event.tag);
        const id = Number(attrs.get('numFmtId'));
        if (Number.isInteger(id)) custom.set(id, formatOfCode(attrs.get('formatCode') ?? ''));
      } else if (event.name === 'cellXfs') {
        inCellXfs = true;
      } else if (event.name === 'xf' && inCellXfs) {
        const id = Number(attributes(event.tag).get('numFmtId') ?? '0');
        styles.push(custom.has(id) ? (custom.get(id) ?? null) : (BUILT_IN_FORMATS.get(id) ?? null));
      }
    } else if (event.kind === 'close' && event.name === 'cellXfs') {
      inCellXfs = false;
    }
    return true;
  });
  return styles;
};

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * An Excel serial as its format prints it: «2026-11-25» for a date (with «14:30» when it carries a
 * time of day), «14:30» or «14:30:15» for a time, «2026-11-25 14:30» for both.
 */
export const serialText = (
  serial: number,
  format: Exclude<CellFormat, null>,
  date1904: boolean,
): string => {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + Math.round(serial * 86_400_000));
  if (Number.isNaN(at.getTime())) return String(serial);
  const day = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  const seconds = at.getUTCSeconds();
  const clock = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}${seconds === 0 ? '' : `:${pad(seconds)}`}`;
  if (format === 'time') return clock;
  if (format === 'datetime') return `${day} ${clock}`;
  return at.getUTCHours() === 0 && at.getUTCMinutes() === 0 && seconds === 0
    ? day
    : `${day} ${clock}`;
};

/** A number cell's text: its value as Excel stores it, past 15 digits' floating-point noise. */
export const numberText = (raw: string): string => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return String(Number(value.toPrecision(15)));
};

/** One worksheet's first rows as cell text, bounded by the preview's limits and its budget. */
export const readSheetRows = (
  xml: string,
  shared: readonly string[],
  formats: readonly CellFormat[],
  date1904: boolean,
  budget: PreviewBudget = previewBudget(),
): { rows: string[][]; truncated: boolean } => {
  const { rows: maxRows, columns: maxColumns } = COMPLIANCE_PREVIEW_LIMITS;
  const grid: string[][] = [];
  let truncated = false;
  let row: string[] | null = null;
  let cell: { column: number | null; type: string; style: number } | null = null;
  let value: string | null = null;
  let capture = false;
  let lastRowNumber = 0;

  walkXml(xml, (event) => {
    if (event.kind === 'text') {
      if (capture && value !== null) value += event.text;
      return true;
    }
    if (event.kind === 'open') {
      if (event.name === 'row') {
        const number = Number(attributes(event.tag).get('r') ?? lastRowNumber + 1);
        // A row past the limit — reached by rows or by the gap before it — ends the read.
        if (grid.length >= maxRows || (Number.isInteger(number) && number > maxRows)) {
          truncated = true;
          return false;
        }
        // Empty rows between two written ones are kept, so the sheet keeps its shape.
        while (Number.isInteger(number) && lastRowNumber + 1 < number) {
          grid.push([]);
          lastRowNumber += 1;
        }
        lastRowNumber = Number.isInteger(number) ? number : lastRowNumber + 1;
        row = [];
      } else if (event.name === 'c' && row !== null) {
        const attrs = attributes(event.tag);
        cell = {
          column: columnIndexOf(attrs.get('r') ?? ''),
          type: attrs.get('t') ?? 'n',
          style: Number(attrs.get('s') ?? '0'),
        };
        value = '';
      } else if ((event.name === 'v' || event.name === 't') && cell !== null) {
        capture = !event.selfClosing;
      }
      return true;
    }
    if (event.name === 'v' || event.name === 't') {
      capture = false;
    } else if (event.name === 'c' && row !== null && cell !== null) {
      const raw = decodeXml(value ?? '');
      let text = raw;
      if (cell.type === 's') text = shared[Number(raw)] ?? '';
      else if (cell.type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
      else if (cell.type === 'n' && raw !== '') {
        const format = formats[cell.style] ?? null;
        text =
          format !== null && Number.isFinite(Number(raw))
            ? serialText(Number(raw), format, date1904)
            : numberText(raw);
      }
      const column = cell.column ?? row.length;
      if (column < maxColumns) {
        const shown = clip(text, CELL_CHARS);
        if (!spend(budget, shown.length)) {
          truncated = true;
          return false;
        }
        while (row.length < column) row.push('');
        row[column] = shown;
      } else if (text !== '') {
        truncated = true;
      }
      cell = null;
      value = null;
    } else if (event.name === 'row' && row !== null) {
      grid.push(row);
      row = null;
    }
    return true;
  });
  // A row cut off by the budget still shows what it read.
  if (row !== null) grid.push(row);
  // Trailing empty cells and rows carry nothing.
  for (const line of grid) while (line.length > 0 && line[line.length - 1] === '') line.pop();
  while (grid.length > 0 && (grid[grid.length - 1] ?? []).length === 0) grid.pop();
  return { rows: grid, truncated };
};

const HIDDEN_STATES: ReadonlySet<string> = new Set(['hidden', 'veryHidden']);

/** The visible sheets of `xl/workbook.xml`, in tab order, with their parts' paths. */
const visibleSheets = (
  workbookXml: string,
  relsXml: string,
): { sheets: { name: string; path: string }[]; date1904: boolean } => {
  const targets = new Map<string, string>();
  walkXml(relsXml, (event) => {
    if (event.kind === 'open' && event.name === 'Relationship') {
      const attrs = attributes(event.tag);
      const id = attrs.get('Id');
      const target = attrs.get('Target');
      if (id !== undefined && target !== undefined && target !== '') {
        targets.set(
          id,
          target.startsWith('/')
            ? path.posix.normalize(target.slice(1))
            : path.posix.normalize(`xl/${target}`),
        );
      }
    }
    return true;
  });
  const sheets: { name: string; path: string }[] = [];
  let date1904 = false;
  walkXml(workbookXml, (event) => {
    if (event.kind !== 'open') return true;
    const attrs = attributes(event.tag);
    if (event.name === 'workbookPr') {
      const flag = attrs.get('date1904');
      date1904 = flag === '1' || flag === 'true';
    }
    if (event.name !== 'sheet') return true;
    if (HIDDEN_STATES.has(attrs.get('state') ?? 'visible')) return true;
    let relationshipId: string | undefined;
    for (const [name, value] of attrs) if (/(^|:)id$/.test(name)) relationshipId = value;
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId);
    if (target !== undefined) sheets.push({ name: attrs.get('name') ?? '', path: target });
    return true;
  });
  return { sheets, date1904 };
};

// ── The preview ─────────────────────────────────────────────────────────────

type Zip = JSZip;

const openZip = async (buffer: Buffer): Promise<Zip> => {
  checkZipEntryCount(buffer, errors);
  const { default: Loader } = await import('jszip');
  try {
    return await Loader.loadAsync(buffer);
  } catch {
    throw new PreviewUnavailable('unreadable');
  }
};

const partOf = (zip: Zip, entryPath: string): JSZipObject | null => {
  const file = zip.file(entryPath);
  return file === null || file.dir ? null : file;
};

const previewDocx = async (buffer: Buffer, deadline: number): Promise<CompliancePreviewDto> => {
  const zip = await openZip(buffer);
  const part = partOf(zip, 'word/document.xml');
  if (part === null) return { kind: 'unavailable' };
  const stylesPart = partOf(zip, 'word/styles.xml');
  const headingIds =
    stylesPart === null
      ? new Set<string>()
      : readHeadingStyleIds(
          (await inflatePrefix(stylesPart, SMALL_PART_BYTES, deadline)).buffer.toString('utf8'),
        );
  const { buffer: xml, complete } = await inflatePrefix(part, PART_PREFIX_BYTES, deadline);
  const { blocks, truncated } = readDocxBlocks(xml.toString('utf8'), headingIds, previewBudget());
  return { kind: 'document', blocks, truncated: truncated || !complete };
};

const previewXlsx = async (buffer: Buffer, deadline: number): Promise<CompliancePreviewDto> => {
  const zip = await openZip(buffer);
  const workbook = partOf(zip, 'xl/workbook.xml');
  const rels = partOf(zip, 'xl/_rels/workbook.xml.rels');
  if (workbook === null || rels === null) return { kind: 'unavailable' };
  const workbookXml = await inflatePrefix(workbook, SMALL_PART_BYTES, deadline);
  const relsXml = await inflatePrefix(rels, SMALL_PART_BYTES, deadline);
  // Without the whole tab list and its relationships, the sheets cannot be told apart reliably.
  if (!workbookXml.complete || !relsXml.complete) return { kind: 'unavailable' };
  const { sheets, date1904 } = visibleSheets(
    workbookXml.buffer.toString('utf8'),
    relsXml.buffer.toString('utf8'),
  );

  // A styles or shared-strings part cut at its prefix leaves later cells without their format or
  // their text: the preview then says it is incomplete.
  let partsCut = false;
  const stylesPart = partOf(zip, 'xl/styles.xml');
  let formats: CellFormat[] = [];
  if (stylesPart !== null) {
    const styles = await inflatePrefix(stylesPart, SMALL_PART_BYTES, deadline);
    partsCut ||= !styles.complete;
    formats = readCellFormats(styles.buffer.toString('utf8'));
  }
  const sharedPart = partOf(zip, 'xl/sharedStrings.xml');
  let shared: string[] = [];
  if (sharedPart !== null) {
    const strings = await inflatePrefix(sharedPart, PART_PREFIX_BYTES, deadline);
    partsCut ||= !strings.complete;
    shared = readSharedStrings(strings.buffer.toString('utf8'));
  }

  const budget = previewBudget();
  const out: CompliancePreviewSheetDto[] = [];
  const seen = new Set<string>();
  let truncated = partsCut || sheets.length > COMPLIANCE_PREVIEW_LIMITS.sheets;
  for (const sheet of sheets.slice(0, COMPLIANCE_PREVIEW_LIMITS.sheets)) {
    // Two tabs pointing at one part are one sheet: read once.
    if (seen.has(sheet.path)) continue;
    seen.add(sheet.path);
    const part = partOf(zip, sheet.path);
    if (part === null) continue;
    if (budget.left <= 0) {
      truncated = true;
      break;
    }
    const { buffer: xml, complete } = await inflatePrefix(part, PART_PREFIX_BYTES, deadline);
    const read = readSheetRows(xml.toString('utf8'), shared, formats, date1904, budget);
    // A part cut short whose rows all fit is cut in its tail, past the rows shown — still cut.
    const cut = read.truncated || !complete || partsCut;
    truncated ||= cut;
    out.push({ name: sheet.name, rows: read.rows, truncated: cut });
  }
  return { kind: 'sheets', sheets: out, truncated };
};

/**
 * The preview of one stored file. A PDF is not previewed here — the browser shows the file — and
 * an older .doc or .xls, or anything that does not read, is `unavailable`.
 */
export const previewOf = async (
  kind: ComplianceDocumentKind,
  fileName: string,
  buffer: Buffer,
): Promise<CompliancePreviewDto> => {
  const extension = path.extname(fileName).toLowerCase();
  const deadline = Date.now() + DEADLINE_MS;
  try {
    if (kind === 'word' && extension === '.docx') return await previewDocx(buffer, deadline);
    if (kind === 'excel' && extension === '.xlsx') return await previewXlsx(buffer, deadline);
    return { kind: 'unavailable' };
  } catch (error) {
    if (error instanceof PreviewUnavailable) return { kind: 'unavailable' };
    throw error;
  }
};
