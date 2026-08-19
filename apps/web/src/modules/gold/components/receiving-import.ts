// Bulk intake from a spreadsheet — the gold system's Excel/CSV import, parsed in the browser.
//
// The column matching is deliberately fuzzy and BILINGUAL, because the files come from the owners'
// own accountants and no two of them name the columns the same way. A row counts as a bar when it
// has a serial or a weight; anything else on the sheet is ignored.
//
// Vault and drawer arrive as free text and are resolved against the real vaults and drawers by the
// caller. What cannot be matched is reported, never guessed: a bar filed into the wrong drawer is
// worse than a bar with no drawer.
import * as XLSX from 'xlsx';

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

const pick = (row: Record<string, unknown>, pattern: RegExp): string => {
  const key = Object.keys(row).find((k) => pattern.test(k));
  return key === undefined ? '' : String(row[key] ?? '').trim();
};

const metalOf = (value: string): ImportedLine['metalType'] => {
  if (/silver|فض/i.test(value)) return 'silver';
  if (/plat|بلاتين/i.test(value)) return 'platinum';
  return 'gold';
};

export const parseSpreadsheet = async (file: File): Promise<ImportedLine[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const first = workbook.SheetNames[0];
  if (first === undefined) return [];
  const sheet = workbook.Sheets[first];
  if (sheet === undefined) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rows
    .map((row) => ({
      serialNumber: pick(row, /serial|تسلسل|سيريال|سبيك/i),
      brand: pick(row, /brand|ماركة/i),
      metalType: metalOf(pick(row, /metal|معدن|نوع/i)),
      weight: pick(row, /^weight$|الوزن|^وزن$/i),
      purity: pick(row, /pur|عيار|نقا/i),
      weightBeforePacking: pick(row, /before|قبل/i),
      weightAfterPacking: pick(row, /after|بعد/i),
      vaultRaw: pick(row, /vault|خزين/i),
      drawerRaw: pick(row, /drawer|درج/i),
    }))
    .filter((line) => line.serialNumber !== '' || line.weight !== '');
};
