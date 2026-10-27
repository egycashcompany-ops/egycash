// A real `.xlsx`, written by hand — «مكان الاكسيل ... اعمل نفس دول بالظبط».
//
// PROMOTED FROM FLEET (docs/12-planning/atm-settlements-phase1.md DS-20, §8.5). It was
// `modules/fleet/lib/fleet-xlsx.ts`, which now re-exports this file so no Fleet caller moved; ATM's
// REP. TAPE export needs the same writer, and a module never copies another's code. Two things were
// added, neither of which changes a Fleet book:
//   · a cell-addressed GRID sheet (`XlsxGridSheet`: free cells, styles, merges, number formats,
//     left-to-right when asked) for a sheet that does not start with «م» in A1. A book with no grid
//     sheet writes today's `styles.xml` byte for byte; only a book holding one writes the extended
//     stylesheet, where the six table formats keep ids 0–5 and the grid's follow from 6;
//   · text escaping drops the characters XML 1.0 forbids (one would corrupt the whole file); a
//     string without them comes out exactly as before.
//
// The button has always been labelled «Excel» and has always produced a CSV. Excel opens a CSV,
// so that held for a while; it does not hold for the documents the owner sent back as the spec.
// Those are workbooks: the sheet is NAMED in Arabic, the header is bold on a fill, the numbers are
// numbers rather than text that happens to look like numbers, there is a «م» column down the edge
// and a totals row along the bottom, and the whole thing reads right-to-left. A CSV cannot carry
// any of it — it has no sheet name, no formatting, no second row of meaning.
//
// WRITTEN HERE RATHER THAN PULLED IN. `gold/components/receiving-import.ts` records the house
// rule: apps/web carries no spreadsheet library and SheetJS was rejected on advisory grounds. An
// xlsx is a ZIP of five small XML parts, and writing the five is less code than the wrapper around
// a dependency would be — so the rule stands and the workbook is real.
//
// STORED, NOT DEFLATED. The ZIP entries are written with compression method 0, which is a legal
// zip and which every reader accepts, and it means this file needs no compressor. These sheets are
// a few hundred rows; the difference on disk is not worth a DEFLATE implementation.

/** One cell: a number keeps its type, everything else is inline text. */
export type XlsxCell = string | number;

export interface XlsxSheet {
  /** The sheet's name — Arabic, and what the reader sees on the tab. */
  name: string;
  header: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /**
   * The bottom line, already laid out across the columns — `''` for the cells it does not fill.
   * Omitted entirely when the report has no total, rather than written as a row of blanks.
   */
  totals?: readonly XlsxCell[];
  /** The serial column's heading — «م». The numbers themselves are generated. */
  serialHeader: string;
  /**
   * Which of `header`'s columns hold MONEY, by index — shown to two decimals.
   *
   * A number format, not rounded text: the cell stays a number Excel will sum, and it still reads
   * «507.50» rather than «507.5» the way the sent workbooks do. Those are the two things a money
   * column has to be at once, and only a format gives both.
   */
  moneyColumns?: readonly number[];
  /**
   * Rows written UNDER the table, after a blank line — the signature block.
   *
   * The sent workbooks carry it inside the sheet, not only on the printed page: «القائم بالأعمال»,
   * «مدير إدارة الحركة» and the endorsement, each over its name and its «التوقيع /», laid across
   * the columns. That is what makes the file a document somebody prints and signs rather than a
   * dump of the table, and leaving it out was the whole of what was missing.
   *
   * Plain rows: no border, no fill, not bold — exactly as they read in the sent files.
   */
  trailer?: readonly (readonly XlsxCell[])[];
}

/**
 * A grid cell's look. The six table formats above are not offered here: a grid sheet names its
 * cells' styles itself, and each one is drawn in the sheet's body font unless it fixes its own
 * (`headDark`, `headRed`, `headBlue`, `dateLong`, `weekday`).
 *   · `plain` — a bordered, centred cell; `bold` — a bold label with no border;
 *   · `head` / `group` — a bold bordered header, `group` over merged column groups;
 *   · `headDark` — white Tahoma 13 bold on black; `headRed` / `headBlue` — Tahoma 10 in red / blue;
 *   · `int` / `totalInt` — `#,##0` (built-in 3), `totalInt` on the green `#C6EFCE` fill;
 *   · `dateShort` — Excel's built-in short date (14), which follows the reader's regional setting;
 *   · `dateLong` — `[$-409]d/mmm/yy;@` in Tahoma 16 bold on `#FFCC00`; `weekday` — the same look
 *     for a text cell;
 *   · `smallHead` — a plain bordered header holding a number.
 */
export type XlsxGridStyle =
  | 'plain'
  | 'bold'
  | 'head'
  | 'headDark'
  | 'headRed'
  | 'headBlue'
  | 'group'
  | 'int'
  | 'totalInt'
  | 'dateShort'
  | 'dateLong'
  | 'weekday'
  | 'smallHead';

export interface XlsxGridCell {
  /** 1-based, as Excel numbers rows. */
  row: number;
  /** 1-based: 1 is column A. */
  col: number;
  value: XlsxCell;
  /** `plain` when omitted. */
  style?: XlsxGridStyle;
}

/**
 * A sheet laid out cell by cell — for a sheet whose shape is someone else's (the bank's REP. TAPE
 * starts in column B at row 7 and reads left to right), which the table sheet above cannot draw.
 */
export interface XlsxGridSheet {
  kind: 'grid';
  name: string;
  rightToLeft: boolean;
  /** The sheet's body font. */
  font: 'tahoma10' | 'calibri13b';
  /** 1-based column numbers, as `col` above. */
  columns: readonly { index: number; width: number }[];
  /** Ranges such as `B6:C6`. */
  merges: readonly string[];
  cells: readonly XlsxGridCell[];
}

export type XlsxBookSheet = XlsxSheet | XlsxGridSheet;

const isGrid = (sheet: XlsxBookSheet): sheet is XlsxGridSheet =>
  (sheet as Partial<XlsxGridSheet>).kind === 'grid';

/** A 1-based column number as its letters: 1 → A, 27 → AA. */
export const columnLetter = (col: number): string => {
  if (!Number.isInteger(col) || col < 1) throw new RangeError('a column number starts at 1');
  let name = '';
  for (let n = col - 1; n >= 0; n = Math.floor(n / 26) - 1)
    name = String.fromCharCode(65 + (n % 26)) + name;
  return name;
};

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * The Excel serial of a calendar day ('YYYY-MM-DD'): days since 1899-12-30, so a date cell holds a
 * number Excel formats, never text that looks like a date.
 */
export const excelDaySerial = (day: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) throw new RangeError(`not a calendar day: ${day}`);
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((at - EXCEL_EPOCH_UTC) / 86_400_000);
};

/**
 * Where the three signature columns sit, for a sheet this many columns wide (the serial included).
 *
 * Thirds, which is where the sent company sheet has them — A, D and G across its nine. Exported
 * so the callers cannot each invent their own spacing and drift apart.
 */
export const signatureColumns = (columns: number): [number, number, number] => [
  0,
  Math.round(columns / 3),
  Math.round((columns * 2) / 3),
];

/**
 * The characters XML 1.0 has no place for: C0 controls other than TAB, LF and CR, U+FFFE, U+FFFF,
 * and a surrogate without its partner. Excel refuses the whole file over one of them, so they are
 * removed rather than escaped — XML has no escape for them either.
 */
const XML_INVALID =
  // eslint-disable-next-line no-control-regex -- the control characters ARE the pattern
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const esc = (value: string): string =>
  value
    .replace(XML_INVALID, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Excel refuses a sheet name holding any of `[]:*?/\`, longer than 31 characters, or empty — and
 * it refuses the WHOLE FILE, with a repair prompt rather than a message naming the sheet. Cleaned
 * here so a report title can be passed in without the caller having to know that.
 */
export const sheetName = (name: string): string => {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim();
  return cleaned === '' ? 'Sheet1' : cleaned.slice(0, 31);
};

/** A1, B1 … AA1 — `col` 0-based here, as the table sheet counts its columns. */
const ref = (col: number, row: number): string => `${columnLetter(col + 1)}${String(row)}`;

const cellXml = (value: XlsxCell, col: number, row: number, style: number): string => {
  const at = `${ref(col, row)}" s="${String(style)}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${at}"><v>${String(value)}</v></c>`;
  }
  const text = String(value);
  if (text === '') return `<c r="${at}"/>`;
  // INLINE strings, not a shared-strings part: one fewer file to keep consistent, and these
  // sheets are small enough that the sharing would save nothing worth the second index.
  return `<c r="${at}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
};

/** Style ids, in the order `styles.xml` below declares them. */
const S = { body: 0, head: 1, total: 2, money: 3, moneyTotal: 4, plain: 5 } as const;

const sheetXml = (sheet: XlsxSheet): string => {
  const head = [sheet.serialHeader, ...sheet.header];
  // Shifted by one, because column 0 is the serial the caller does not pass.
  const money = new Set((sheet.moneyColumns ?? []).map((index) => index + 1));
  const rows: string[] = [
    `<row r="1">${head.map((h, i) => cellXml(h, i, 1, S.head)).join('')}</row>`,
  ];
  sheet.rows.forEach((row, i) => {
    const n = i + 2;
    // The serial is GENERATED — it numbers the sheet so a reader can point at a line, and it is
    // never a row id: re-sort the screen and the same fine gets a different «م».
    const cells = [i + 1, ...row]
      .map((cell, c) => cellXml(cell, c, n, money.has(c) ? S.money : S.body))
      .join('');
    rows.push(`<row r="${String(n)}">${cells}</row>`);
  });
  if (sheet.totals !== undefined) {
    const n = sheet.rows.length + 2;
    const cells = ['', ...sheet.totals]
      .map((cell, c) => cellXml(cell, c, n, money.has(c) ? S.moneyTotal : S.total))
      .join('');
    rows.push(`<row r="${String(n)}">${cells}</row>`);
  }
  // THE SIGNATURE BLOCK, one blank line below the table. Written with the plain style — no border
  // and no fill — because a grid drawn round a person's name would read as another table.
  if (sheet.trailer !== undefined) {
    // The last row the table used, plus the blank one.
    let n = sheet.rows.length + (sheet.totals === undefined ? 1 : 2) + 2;
    for (const line of sheet.trailer) {
      const cells = line.map((cell, c) => cellXml(cell, c, n, S.plain)).join('');
      rows.push(`<row r="${String(n)}">${cells}</row>`);
      n += 1;
    }
  }
  // `rightToLeft` on the VIEW, so column A is on the right where an Arabic reader expects it —
  // the sheet reads the way the screen it came from reads.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="${String(head.length)}" width="18" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
};

// ONE WORKBOOK, SEVERAL SHEETS — sheet n is `sheetN.xml`, relationship `rIdN`, and the styles take
// the id after the last sheet. A one-sheet book comes out exactly as it always has.
const WORKBOOK = (
  names: readonly string[],
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('')}</sheets></workbook>`;

// Three formats, in the order `S` names them: the body, the bold header on its fill, and the bold
// total. Excel requires the two zero-index built-ins (`fonts[0]`, `fills[0]`, `fills[1]`) to be
// present and in that order, whether or not anything uses them.
const TABLE_FONTS =
  '<font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>';
const TABLE_FILLS =
  '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECECF7"/><bgColor indexed="64"/></patternFill></fill>';
const BORDERS =
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>';
const TABLE_XFS =
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';

const styleSheet = (parts: {
  numFmts: string;
  fonts: readonly string[];
  fills: readonly string[];
  xfs: readonly string[];
}): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${parts.numFmts}<fonts count="${String(parts.fonts.length + 2)}">${TABLE_FONTS}${parts.fonts.join('')}</fonts><fills count="${String(parts.fills.length + 3)}">${TABLE_FILLS}${parts.fills.join('')}</fills>${BORDERS}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${String(parts.xfs.length + 6)}">${TABLE_XFS}${parts.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** A book of table sheets only: exactly the stylesheet every Fleet export has always carried. */
const STYLES = styleSheet({ numFmts: '', fonts: [], fills: [], xfs: [] });

// ── The grid sheet's stylesheet: the table's, extended after its last id ───────────────────────

/** `REP. TAPE!D4`'s own format, declared at the first custom id. */
const DATE_LONG_FORMAT = '[$-409]d/mmm/yy;@';
const DATE_LONG_FORMAT_ID = 164;

const font = (size: number, name: string, opts: { bold?: boolean; rgb?: string } = {}): string =>
  `<font>${opts.bold === true ? '<b/>' : ''}<sz val="${String(size)}"/>${opts.rgb === undefined ? '' : `<color rgb="${opts.rgb}"/>`}<name val="${name}"/></font>`;

/** Font ids 2…, after the table's two. */
const GRID_FONTS = [
  font(10, 'Tahoma'), //                                  2
  font(10, 'Tahoma', { rgb: 'FFFF0000' }), //             3
  font(10, 'Tahoma', { rgb: 'FF0000FF' }), //             4
  font(13, 'Tahoma', { bold: true, rgb: 'FFFFFFFF' }), // 5
  font(16, 'Tahoma', { bold: true }), //                  6
  font(13, 'Calibri', { bold: true }), //                 7
  font(10, 'Tahoma', { bold: true }), //                  8
];
const F = { tahoma: 2, red: 3, blue: 4, darkHead: 5, tahoma16b: 6, calibri13b: 7, tahomaBold: 8 };

const solid = (rgb: string): string =>
  `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
/** Fill ids 3…, after the table's three. */
const GRID_FILLS = [solid('FF000000'), solid('FFFFCC00'), solid('FFC6EFCE')];
const L = { none: 0, black: 3, yellow: 4, green: 5 };

interface GridXf {
  font: number;
  fill: number;
  border: 0 | 1;
  numFmt: number;
  horizontal: 'center' | 'left';
  wrap?: boolean;
}

const GRID_STYLES: readonly XlsxGridStyle[] = [
  'plain',
  'bold',
  'head',
  'headDark',
  'headRed',
  'headBlue',
  'group',
  'int',
  'totalInt',
  'dateShort',
  'dateLong',
  'weekday',
  'smallHead',
];
const BODY_FONTS: readonly XlsxGridSheet['font'][] = ['tahoma10', 'calibri13b'];

const gridXf = (style: XlsxGridStyle, body: XlsxGridSheet['font']): GridXf => {
  const regular = body === 'tahoma10' ? F.tahoma : F.calibri13b;
  const bold = body === 'tahoma10' ? F.tahomaBold : F.calibri13b;
  const cell = { fill: L.none, border: 1, numFmt: 0, horizontal: 'center' } as const;
  switch (style) {
    case 'plain':
      return { ...cell, font: regular };
    case 'bold':
      return { ...cell, font: bold, border: 0, horizontal: 'left' };
    case 'head':
      return { ...cell, font: bold, wrap: true };
    case 'headDark':
      return { ...cell, font: F.darkHead, fill: L.black, wrap: true };
    case 'headRed':
      return { ...cell, font: F.red, wrap: true };
    case 'headBlue':
      return { ...cell, font: F.blue, wrap: true };
    case 'group':
      return { ...cell, font: bold };
    case 'int':
      return { ...cell, font: regular, numFmt: 3 };
    case 'totalInt':
      return { ...cell, font: regular, fill: L.green, numFmt: 3 };
    case 'dateShort':
      return { ...cell, font: regular, numFmt: 14 };
    case 'dateLong':
      return { ...cell, font: F.tahoma16b, fill: L.yellow, numFmt: DATE_LONG_FORMAT_ID };
    case 'weekday':
      return { ...cell, font: F.tahoma16b, fill: L.yellow };
    case 'smallHead':
      return { ...cell, font: regular };
  }
};

const xfXml = (xf: GridXf): string =>
  `<xf numFmtId="${String(xf.numFmt)}" fontId="${String(xf.font)}" fillId="${String(xf.fill)}" borderId="${String(xf.border)}" xfId="0"${xf.numFmt === 0 ? '' : ' applyNumberFormat="1"'} applyFont="1"${xf.fill === L.none ? '' : ' applyFill="1"'}${xf.border === 0 ? '' : ' applyBorder="1"'} applyAlignment="1"><alignment horizontal="${xf.horizontal}" vertical="center"${xf.wrap === true ? ' wrapText="1"' : ''}/></xf>`;

/** Grid style ids: 6 + (body font × styles) + style, every pair declared, in this order. */
const GRID_XF_BASE = 6;
const gridStyleId = (style: XlsxGridStyle, body: XlsxGridSheet['font']): number =>
  GRID_XF_BASE + BODY_FONTS.indexOf(body) * GRID_STYLES.length + GRID_STYLES.indexOf(style);

const GRID_STYLES_XML = styleSheet({
  numFmts: `<numFmts count="1"><numFmt numFmtId="${String(DATE_LONG_FORMAT_ID)}" formatCode="${esc(DATE_LONG_FORMAT)}"/></numFmts>`,
  fonts: GRID_FONTS,
  fills: GRID_FILLS,
  xfs: BODY_FONTS.flatMap((body) => GRID_STYLES.map((style) => xfXml(gridXf(style, body)))),
});

const gridSheetXml = (sheet: XlsxGridSheet): string => {
  const rows = new Map<number, Map<number, XlsxGridCell>>();
  for (const cell of sheet.cells) {
    if (
      !Number.isInteger(cell.row) ||
      cell.row < 1 ||
      !Number.isInteger(cell.col) ||
      cell.col < 1
    ) {
      throw new RangeError(
        `a grid cell is addressed from row 1, column 1 (${String(cell.row)}, ${String(cell.col)})`,
      );
    }
    const row = rows.get(cell.row) ?? new Map<number, XlsxGridCell>();
    row.set(cell.col, cell);
    rows.set(cell.row, row);
  }
  const data = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, cells]) => {
      const xml = [...cells.values()]
        .sort((a, b) => a.col - b.col)
        .map((cell) =>
          cellXml(cell.value, cell.col - 1, n, gridStyleId(cell.style ?? 'plain', sheet.font)),
        )
        .join('');
      return `<row r="${String(n)}">${xml}</row>`;
    })
    .join('');
  const cols = [...sheet.columns]
    .sort((a, b) => a.index - b.index)
    .map(
      (c) =>
        `<col min="${String(c.index)}" max="${String(c.index)}" width="${String(c.width)}" customWidth="1"/>`,
    )
    .join('');
  const merges =
    sheet.merges.length === 0
      ? ''
      : `<mergeCells count="${String(sheet.merges.length)}">${sheet.merges.map((m) => `<mergeCell ref="${esc(m)}"/>`).join('')}</mergeCells>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView${sheet.rightToLeft ? ' rightToLeft="1"' : ''} workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols === '' ? '' : `<cols>${cols}</cols>`}<sheetData>${data}</sheetData>${merges}</worksheet>`;
};

const CONTENT_TYPES = (
  count: number,
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({ length: count }, (_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = (
  count: number,
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('')}<Relationship Id="rId${String(count + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// ── The smallest ZIP that is still a ZIP ────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

interface Entry {
  name: string;
  bytes: Uint8Array;
}

/**
 * 1980-01-01, packed the way DOS packs a date: `(year - 1980) << 9 | month << 5 | day`.
 *
 * NOT a zero, which is what this wrote first and which is not a date at all — day 0 of month 0.
 * Python's zipfile and openpyxl both read that file happily; LibreOffice refused to open it with
 * «source file could not be loaded», and Excel would have been within its rights to do the same.
 * The one that caught it is the one that matters, so the stamp is now a real date.
 *
 * FIXED rather than `Date.now()`, deliberately: the same report exported twice is then byte for
 * byte the same file, and a document that is diffable is a document a reader can trust. The day a
 * workbook was taken is on its NAME, where a reader can see it.
 */
const DOS_DATE = (1 << 5) | 1;

/**
 * A stored (uncompressed) ZIP over the parts, as one `Blob`.
 *
 * Every offset and length here is little-endian and fixed-width — this is the format, not a
 * choice. The parts go in with compression method 0 and a zeroed date, so the same report exported
 * twice is byte-identical: a document that is diffable is a document a reader can trust.
 */
const zip = (entries: readonly Entry[]): Blob => {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u32 = (view: DataView, at: number, value: number): void => view.setUint32(at, value, true);
  const u16 = (view: DataView, at: number, value: number): void => view.setUint16(at, value, true);

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed
    u16(lv, 8, 0); // stored
    u16(lv, 10, 0); // modified time — midnight
    u16(lv, 12, DOS_DATE);
    u32(lv, 14, crc);
    u32(lv, 18, entry.bytes.length);
    u32(lv, 22, entry.bytes.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    chunks.push(local, entry.bytes);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50);
    u16(dv, 4, 20); // version made by
    u16(dv, 6, 20); // version needed
    u16(dv, 10, 0); // stored
    u16(dv, 12, 0); // modified time — midnight
    u16(dv, 14, DOS_DATE);
    u32(dv, 16, crc);
    u32(dv, 20, entry.bytes.length);
    u32(dv, 24, entry.bytes.length);
    u16(dv, 28, name.length);
    u32(dv, 42, offset);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + entry.bytes.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);

  // Concatenated into ONE buffer rather than handed to `Blob` as a list of views: a `Uint8Array`
  // may be backed by a `SharedArrayBuffer` as far as the type system is concerned, and `BlobPart`
  // will not take one. Copying a few hundred kilobytes once is cheaper than the cast would be
  // honest.
  const parts = [...chunks, ...central, end];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

/**
 * A workbook of several sheets, in order — the drivers' report is two: every fine, then one line
 * per driver. Names are cleaned and must come out distinct; Excel refuses two tabs of one name.
 * Table and grid sheets mix freely; the stylesheet grows only when a grid sheet is present.
 */
export const buildXlsxBook = (sheets: readonly XlsxBookSheet[]): Blob => {
  const names = sheets.map((sheet) => sheetName(sheet.name));
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  return zip([
    { name: '[Content_Types].xml', bytes: utf8(CONTENT_TYPES(sheets.length)) },
    { name: '_rels/.rels', bytes: utf8(ROOT_RELS) },
    { name: 'xl/workbook.xml', bytes: utf8(WORKBOOK(names)) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: utf8(WORKBOOK_RELS(sheets.length)) },
    { name: 'xl/styles.xml', bytes: utf8(sheets.some(isGrid) ? GRID_STYLES_XML : STYLES) },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${String(i + 1)}.xml`,
      bytes: utf8(
        isGrid(sheet) ? gridSheetXml(sheet) : sheetXml({ ...sheet, name: names[i] ?? sheet.name }),
      ),
    })),
  ]);
};

/** The workbook, ready to hand to `saveBlob`. */
export const buildXlsx = (sheet: XlsxSheet): Blob => buildXlsxBook([sheet]);

/** What the reader finds in their downloads: what it is, in Arabic, and the day they took it. */
export const xlsxFilename = (stem: string, today: string): string => `${stem}-${today}.xlsx`;
