// A worksheet's inline rich text, joined into one text before ExcelJS's STREAMING reader meets it:
// `<is><r><t>A</t></r><r><rPr><b/></rPr><t>B</t></r></is>` becomes
// `<is><t xml:space="preserve">AB</t></is>`.
//
// WHY. The streaming `WorksheetReader` starts a cell's value afresh at every `<t>`
// (exceljs/lib/stream/xlsx/worksheet-reader.js: `case 'is': case 't': current = c.v = {text: ''}`),
// so an inline string written as runs reads as its LAST run — ExcelJS's own streaming writer puts
// rich text inline, and «شاشة ديل » + «E2020H» read «E2020H», a name the register never had.
// `xlsx.load` reads the runs joined, and Excel shows them joined. The shared strings' runs need
// nothing: the streaming reader keeps each `<si>`'s runs apart, and they are joined when read.
//
// What is joined is the text Excel shows: an `<is>`'s own `<t>` and its runs' (`<r><t>`), in order,
// each run's bytes as they are — entities still escaped (the reader decodes them as it decodes any
// inline string), whitespace kept as the runs had it (as `xlsx.load` keeps it), the joined `<t>`
// marked `xml:space="preserve"` so the whitespace between runs is data. A phonetic guide
// (`<rPh>`, the reading Japanese text carries above it) is not shown in the cell, so it is left out.
// An `<is>` with one `<t>` is already read right and is left exactly as it is; so is everything
// outside an `<is>`.
//
// EACH RUN IS ITS OWN ESCAPED STRING. Excel's `_xHHHH_` escapes (ST_Xstring) are decoded run by
// run (ExcelJS's `text-xform.js` too), and the reader decodes them once the runs are one string —
// so a run that ends in the start of one («_x00») must not borrow its end from the next run
// («41_») and read «A» where Excel shows «_x0041_». Such a dangling `_` is written as Excel writes
// a typed one, `_x005F_`, which decodes back to `_` and completes nothing.
//
// LINEAR, BY HAND (as `one-sheet-zip.ts`, review finding SEC-2): the sheet is up to 6 MB, so it is
// walked once, tag by tag, never with a backtracking pattern; comments, CDATA sections and
// processing instructions are passed over whole, so no `<is>` is found inside one. Names are
// matched unprefixed, as the streaming reader matches them (a prefixed `<x:c>` it does not read at
// all). The result is written as the walk goes, into ONE buffer the sheet's size, made only when
// an `<is>` needs joining; otherwise the buffer handed in is handed back.

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const UNDERSCORE = 0x5f;
const LOWER_X = 0x78;

const OPEN_JOINED = Buffer.from('<t xml:space="preserve">', 'utf8');
const CLOSE_JOINED = Buffer.from('</t>', 'utf8');
/** Excel's escaped underscore: a `_` that is text, not the start of an escape. */
const ESCAPED_UNDERSCORE = Buffer.from('_x005F_', 'utf8');

const isSpace = (byte: number | undefined): boolean =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

const isHex = (byte: number | undefined): boolean =>
  byte !== undefined &&
  ((byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x46) ||
    (byte >= 0x61 && byte <= 0x66));

/** Whether the tag's name, `xml[from, to)`, is `name` (ASCII). */
const named = (xml: Buffer, from: number, to: number, name: string): boolean => {
  if (to - from !== name.length) return false;
  for (let index = 0; index < name.length; index += 1) {
    if (xml[from + index] !== name.charCodeAt(index)) return false;
  }
  return true;
};

/** The elements that matter inside an `<is>` — any other is `OTHER`. */
const OTHER = 0;
const INLINE_STRING = 1;
const RUN = 2;
const PHONETIC = 3;
const TEXT = 4;
type Element = typeof OTHER | typeof INLINE_STRING | typeof RUN | typeof PHONETIC | typeof TEXT;

const elementOf = (xml: Buffer, from: number, to: number): Element => {
  if (named(xml, from, to, 'is')) return INLINE_STRING;
  if (named(xml, from, to, 'r')) return RUN;
  if (named(xml, from, to, 'rPh')) return PHONETIC;
  if (named(xml, from, to, 't')) return TEXT;
  return OTHER;
};

/** A tag as the walk meets it. */
interface Tag {
  /** `<`. */
  start: number;
  /** After its `>`. */
  end: number;
  kind: 'open' | 'close' | 'empty' | 'skipped';
  element: Element;
}

/** Where `marker` ends, from `from` — or -1. */
const endOf = (xml: Buffer, marker: string, from: number): number => {
  const at = xml.indexOf(marker, from, 'latin1');
  return at === -1 ? -1 : at + marker.length;
};

/** The next tag from `from`, or null when there is none (or the XML stops inside one). */
const nextTag = (xml: Buffer, from: number): Tag | null => {
  const start = xml.indexOf(LT, from);
  if (start === -1) return null;
  const second = xml[start + 1];
  if (second === BANG || second === QUESTION) {
    // A comment, a CDATA section, a processing instruction or a declaration: passed over whole —
    // what is inside them is no markup.
    const head = xml.toString('latin1', start, start + 9);
    const closer = head.startsWith('<!--')
      ? '-->'
      : head === '<![CDATA['
        ? ']]>'
        : second === QUESTION
          ? '?>'
          : '>';
    const end = endOf(xml, closer, start + 2);
    return end === -1 ? null : { start, end, kind: 'skipped', element: OTHER };
  }
  // A start or end tag: up to its `>`, a `>` inside a quoted attribute value aside.
  let at = start + 1;
  let quote = 0;
  for (; at < xml.length; at += 1) {
    const byte = xml[at];
    if (quote !== 0) {
      if (byte === quote) quote = 0;
    } else if (byte === DOUBLE_QUOTE || byte === SINGLE_QUOTE) {
      quote = byte;
    } else if (byte === GT) {
      break;
    }
  }
  if (at >= xml.length) return null;
  const closing = second === SLASH;
  const nameStart = start + (closing ? 2 : 1);
  let nameEnd = nameStart;
  while (nameEnd < at && !isSpace(xml[nameEnd]) && xml[nameEnd] !== SLASH) nameEnd += 1;
  return {
    start,
    end: at + 1,
    kind: closing ? 'close' : xml[at - 1] === SLASH ? 'empty' : 'open',
    element: elementOf(xml, nameStart, nameEnd),
  };
};

/** Whether an escape `_xHHHH_` starts at `at`, within `[at, to)`. */
const escapeAt = (xml: Buffer, at: number, to: number): boolean =>
  at + 7 <= to &&
  xml[at] === UNDERSCORE &&
  xml[at + 1] === LOWER_X &&
  isHex(xml[at + 2]) &&
  isHex(xml[at + 3]) &&
  isHex(xml[at + 4]) &&
  isHex(xml[at + 5]) &&
  xml[at + 6] === UNDERSCORE;

/**
 * Where the text `[from, to)` leaves an escape unfinished — the `_` of a trailing «_», «_x»,
 * «_xH» … «_xHHHH» that no escape of its own takes up, which the next run could complete — or -1.
 * The escapes are found as the decoder finds them, left to right, none overlapping.
 */
export const danglingEscapeAt = (xml: Buffer, from: number, to: number): number => {
  // A byte at a time, within the text: `indexOf` would look on past `to`, to the sheet's end,
  // for every run of a sheet that has no `_` after it.
  let free = from;
  for (let at = from; at < to; at += 1) {
    if (escapeAt(xml, at, to)) {
      at += 6;
      free = at + 1;
    }
  }
  for (let at = Math.max(free, to - 6); at < to; at += 1) {
    if (xml[at] !== UNDERSCORE) continue;
    if (at + 1 < to && xml[at + 1] !== LOWER_X) continue;
    let hex = true;
    for (let digit = at + 2; digit < to; digit += 1) hex &&= isHex(xml[digit]);
    if (hex) return at;
  }
  return -1;
};

/**
 * The sheet with every inline string that holds more than one `<t>` written as one `<t>` of the
 * text Excel shows — or the very buffer handed in, when none does.
 */
export const joinInlineRuns = (sheet: Buffer): Buffer => {
  if (sheet.indexOf('<is', 0, 'latin1') === -1) return sheet;
  // The result, written as the walk goes — made only once an `<is>` needs joining, as large as
  // the sheet: joined runs are never longer than the runs on a real sheet, so it never grows but
  // for a sheet crafted of tiny ones (which the reducer then holds to the sheet's cap).
  const result: { out: Buffer | null; written: number } = { out: null, written: 0 };
  let copiedTo = 0;
  const put = (source: Buffer, start: number, end: number): void => {
    if (end <= start) return;
    let out = result.out ?? Buffer.allocUnsafe(sheet.length);
    const need = result.written + end - start;
    if (need > out.length) {
      const grown = Buffer.allocUnsafe(Math.max(need, out.length * 2));
      out.copy(grown, 0, 0, result.written);
      out = grown;
    }
    result.out = out;
    result.written += source.copy(out, result.written, start, end);
  };
  const literal = (bytes: Buffer): void => {
    put(bytes, 0, bytes.length);
  };

  // The `<is>` being read: where its content starts, the elements open inside it, its `<t>`s.
  let content = -1;
  const open: Element[] = [];
  let texts: number[] = [];
  let textStart = -1;
  let textCount = 0;

  for (let from = 0; ;) {
    const tag = nextTag(sheet, from);
    if (tag === null) break;
    from = tag.end;
    if (tag.kind === 'skipped') continue;
    if (content === -1) {
      if (tag.kind === 'open' && tag.element === INLINE_STRING) {
        content = tag.end;
        open.length = 0;
        texts = [];
        textStart = -1;
        textCount = 0;
      }
      continue;
    }
    // Inside an `<is>`: the `<t>` it shows are its own and its runs' — not a phonetic guide's.
    const shown = open.length === 0 || (open.length === 1 && open[0] === RUN);
    if (tag.element === TEXT && tag.kind !== 'close') {
      textCount += 1;
      if (tag.kind === 'open' && shown && textStart === -1) textStart = tag.end;
    }
    if (tag.kind === 'open') {
      open.push(tag.element);
      continue;
    }
    if (tag.kind === 'empty') continue;
    // A closing tag.
    if (open.length > 0) {
      const closed = open.pop();
      if (closed === TEXT && textStart !== -1) {
        texts.push(textStart, tag.start);
        textStart = -1;
      }
      continue;
    }
    // The `<is>`'s own end.
    if (textCount > 1) {
      put(sheet, copiedTo, content);
      literal(OPEN_JOINED);
      for (let index = 0; index < texts.length; index += 2) {
        const start = texts[index] ?? 0;
        const end = texts[index + 1] ?? 0;
        const dangling = index + 2 < texts.length ? danglingEscapeAt(sheet, start, end) : -1;
        if (dangling === -1) {
          put(sheet, start, end);
        } else {
          put(sheet, start, dangling);
          literal(ESCAPED_UNDERSCORE);
          put(sheet, dangling + 1, end);
        }
      }
      literal(CLOSE_JOINED);
      copiedTo = tag.start;
    }
    content = -1;
  }
  if (result.out === null) return sheet;
  put(sheet, copiedTo, sheet.length);
  return result.out.subarray(0, result.written);
};
