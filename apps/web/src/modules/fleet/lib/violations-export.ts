// The two halves' «Excel» buttons, as data.
//
// CSV, NOT xlsx — the house rule, written down in `gold/components/receiving-import.ts`: apps/web
// carries no spreadsheet library, and SheetJS was rejected on advisory grounds. Excel opens this
// file; what it is called in the toolbar is what the business calls the button.
//
// Built here rather than on the server because both panels already HOLD everything they print: a
// rollup comes back whole and the driver page is the page on screen. An export endpoint would be
// a second source of truth for figures the screen has in hand — and would export a different set
// of rows than the reader is looking at.
//
// The escaping and the BOM follow `atm/pages/MachinesPage.tsx` exactly: Excel misreads UTF-8
// Arabic without the mark, and a comma inside a driver's name would otherwise split a column.
const escape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Header row plus body rows, BOM-prefixed. Everything is stringified by the caller. */
export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  '﻿' +
  [header.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');

/** A file name a reader can find again: what it is, and the day they took it. */
export const exportFilename = (stem: string, today: string): string => `${stem}-${today}.csv`;
