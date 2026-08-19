// Bulk intake for a receiving receipt — CSV, parsed in the browser.
//
// WHY CSV AND NOT XLSX. The gold system read .xlsx through SheetJS. The npm mirror of that library
// is frozen at 0.18.5 and carries two unfixed advisories, so bringing it into this repository would
// have added a known-vulnerable dependency to the platform for one screen's convenience. CSV is
// what every spreadsheet exports, needs no dependency at all, and loses nothing the import ever
// used: the intake reads ONE sheet of flat rows, which is exactly what CSV is.
//
// The column matching is deliberately fuzzy and BILINGUAL, because the files come from the owners'
// own accountants and no two of them name the columns the same way. A row counts as a bar when it
// carries a serial or a weight; anything else in the file is ignored.
//
// Vault and drawer arrive as free text and are resolved against the real vaults and drawers by the
// caller. What cannot be matched is reported, never guessed: a bar filed into the wrong drawer is
// worse than a bar with no drawer.

export interface ImportedLine {
  serialNumber: string;
  brand: string;
  metalType: 'gold' | 'silver' | 'platinum';
  weight: string;
  purity: string;
  weightBeforePacking: string;
  weightAfterPacking: string;
  vaultRaw: string;
  drawerRaw: string;
}

/**
 * The separators a spreadsheet might have written.
 *
 * A comma is the default, but Excel writes the LIST SEPARATOR of the machine's locale — which is a
 * semicolon across most of Europe and the Arab world — and "export as tab-delimited" is common
 * enough to be worth reading too. Guessing wrong turns every row into one long cell, so the parser
 * tries all three and keeps whichever produces the widest header.
 */
const DELIMITERS = [',', ';', '\t'] as const;

/**
 * RFC 4180 tokenizer: quoted fields may contain the delimiter, a newline, or a doubled `""` quote.
 *
 * Written out rather than reached for in a library because the whole grammar is the state machine
 * below, and a dependency for it would be a dependency to keep patched.
 */
export const parseCsv = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i] ?? '';
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      // CRLF is one line break, not two.
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // A file that does not end with a newline still ends with a row.
  if (field !== '' || row.length > 0) endRow();
  return rows;
};

/** The delimiter that splits the header into the most columns — see DELIMITERS. */
export const detectDelimiter = (text: string): string => {
  let best: string = DELIMITERS[0];
  let widest = 0;
  for (const candidate of DELIMITERS) {
    const width = parseCsv(text, candidate)[0]?.length ?? 0;
    if (width > widest) {
      widest = width;
      best = candidate;
    }
  }
  return best;
};

/** Column headers, normalized for matching: trimmed, unquoted, case-folded. */
const headerIndex = (headers: string[], pattern: RegExp): number =>
  headers.findIndex((header) => pattern.test(header.trim()));

const metalOf = (value: string): ImportedLine['metalType'] => {
  if (/silver|فض/i.test(value)) return 'silver';
  if (/plat|بلاتين/i.test(value)) return 'platinum';
  return 'gold';
};

/**
 * Turn CSV text into importable lines.
 *
 * Exported separately from `parseImportFile` so the mapping can be tested without a `File`.
 */
export const parseImportText = (text: string): ImportedLine[] => {
  // A spreadsheet's UTF-8 export usually starts with a byte-order mark; left in place it becomes
  // part of the first header's name and that column stops matching.
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean);
  const rows = parseCsv(clean, delimiter);
  const headers = rows[0];
  if (headers === undefined) return [];

  const columns = {
    serialNumber: headerIndex(headers, /serial|تسلسل|سيريال|سبيك/i),
    brand: headerIndex(headers, /brand|ماركة/i),
    metalType: headerIndex(headers, /metal|معدن|نوع/i),
    weight: headerIndex(headers, /^weight$|الوزن|^وزن$/i),
    purity: headerIndex(headers, /pur|عيار|نقا/i),
    weightBeforePacking: headerIndex(headers, /before|قبل/i),
    weightAfterPacking: headerIndex(headers, /after|بعد/i),
    vaultRaw: headerIndex(headers, /vault|خزين/i),
    drawerRaw: headerIndex(headers, /drawer|درج/i),
  };

  const cell = (row: string[], index: number): string =>
    index < 0 ? '' : (row[index] ?? '').trim();

  return rows
    .slice(1)
    .map((row) => ({
      serialNumber: cell(row, columns.serialNumber),
      brand: cell(row, columns.brand),
      metalType: metalOf(cell(row, columns.metalType)),
      weight: cell(row, columns.weight),
      purity: cell(row, columns.purity),
      weightBeforePacking: cell(row, columns.weightBeforePacking),
      weightAfterPacking: cell(row, columns.weightAfterPacking),
      vaultRaw: cell(row, columns.vaultRaw),
      drawerRaw: cell(row, columns.drawerRaw),
    }))
    .filter((line) => line.serialNumber !== '' || line.weight !== '');
};

export const parseImportFile = async (file: File): Promise<ImportedLine[]> =>
  parseImportText(await file.text());
