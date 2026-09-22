// «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
//
// A Fleet LIST screen's workbook, as against the violations report's. The two are different
// documents and the difference is the point:
//
//   · the violations sheets are a FORM — they go up for signature and carry the block to sign;
//   · these are the register, filtered, as data. Nobody signs a list of odometer readings, so
//     there is no `trailer` here and no settings are read. `buildXlsx` takes the block or leaves
//     it out; this path never passes one.
//
// WHAT THE FILTER MATCHED, NOT WHAT THE PAGE SHOWS. The tables are paged at fifty; a reader who
// narrows to three hundred rows and presses Excel means the three hundred. Exporting the visible
// page would hand them a file that is silently short — the worst kind of wrong, because it looks
// complete. `fetchWholeCatalog` already walks a list's pages under a hard stop and is proven; the
// export borrows it rather than growing a second loop with the same arithmetic in it.
import { type Paginated } from '@ecms/contracts';
import { saveBlob } from '../../../shared/lib/api-client';
import { fetchWholeCatalog } from './whole-catalog';
import { buildXlsx, xlsxFilename, type XlsxCell } from './fleet-xlsx';

/**
 * Every row the filter matched, in one array.
 *
 * `fetchPage` is the seam — the caller passes its own list call with its own params bound, a test
 * passes a stub. The params are the SCREEN's params: the export asks the question the reader is
 * looking at, not a broader one, which is the whole of «اللى الفلتر عامله بس».
 */
export const fetchFilteredRows = async <T>(
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
): Promise<T[]> => (await fetchWholeCatalog(fetchPage)).items;

/**
 * A screen's query params with the PAGING taken off.
 *
 * Every list screen hands its hook one object holding both the reader's filters and where they
 * are in the pages. The export wants the first and must not carry the second: left in, `page: 3`
 * would make the walk start on the third page and the file would open with a third of the rows
 * missing — silently, because a short file looks like a complete one.
 *
 * Written here rather than destructured at each call site: eight screens doing it by hand is
 * eight chances to keep one of the two, and the linter only catches the unused half.
 */
export const filtersOnly = <T extends { page?: unknown; pageSize?: unknown }>(
  params: T,
): Omit<T, 'page' | 'pageSize'> => {
  const rest: Record<string, unknown> = { ...params };
  delete rest['page'];
  delete rest['pageSize'];
  return rest as Omit<T, 'page' | 'pageSize'>;
};

export interface SheetExport {
  /** The sheet's name and the file's stem — Arabic, and what the screen is called. */
  name: string;
  serialHeader: string;
  header: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** Which of `header`'s columns hold money, by index — two decimals, still summable. */
  moneyColumns?: readonly number[];
}

/**
 * Write the workbook and hand it to the browser. NO signature block, by instruction.
 *
 * The day is on the NAME rather than inside the sheet: a reader looking through a downloads
 * folder for last week's register finds it by the file, and a row of metadata above the header
 * is a row every formula below it then has to be told to skip.
 */
export const saveSheet = (sheet: SheetExport, today: string): void => {
  saveBlob(
    buildXlsx({
      name: sheet.name,
      serialHeader: sheet.serialHeader,
      header: sheet.header,
      rows: sheet.rows,
      ...(sheet.moneyColumns === undefined ? {} : { moneyColumns: sheet.moneyColumns }),
    }),
    xlsxFilename(sheet.name, today),
  );
};

/** Today, as the file name spells it. Passed in by the caller so this module stays pure. */
export const sheetDay = (now: Date): string => now.toISOString().slice(0, 10);
