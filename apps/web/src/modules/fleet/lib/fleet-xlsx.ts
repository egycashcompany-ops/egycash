// A real `.xlsx`, written by hand — «مكان الاكسيل ... اعمل نفس دول بالظبط».
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

const esc = (value: string): string =>
  value
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

/** A1, B1 … AA1. Columns past Z are why this is a loop and not a lookup. */
const ref = (col: number, row: number): string => {
  let name = '';
  for (let n = col; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return `${name}${String(row)}`;
};

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

const WORKBOOK = (name: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

// Three formats, in the order `S` names them: the body, the bold header on its fill, and the bold
// total. Excel requires the two zero-index built-ins (`fonts[0]`, `fills[0]`, `fills[1]`) to be
// present and in that order, whether or not anything uses them.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECECF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

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

/** The workbook, ready to hand to `saveBlob`. */
export const buildXlsx = (sheet: XlsxSheet): Blob => {
  const name = sheetName(sheet.name);
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  return zip([
    { name: '[Content_Types].xml', bytes: utf8(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: utf8(ROOT_RELS) },
    { name: 'xl/workbook.xml', bytes: utf8(WORKBOOK(name)) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: utf8(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', bytes: utf8(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', bytes: utf8(sheetXml({ ...sheet, name })) },
  ]);
};

/** What the reader finds in their downloads: what it is, in Arabic, and the day they took it. */
export const xlsxFilename = (stem: string, today: string): string => `${stem}-${today}.xlsx`;
