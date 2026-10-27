// Fleet's `.xlsx` writer, promoted to `shared/lib/xlsx-writer.ts` so ATM's REP. TAPE export can use
// the same one (docs/12-planning/atm-settlements-phase1.md DS-20). Re-exported unchanged, so no
// Fleet caller moves and every Fleet book is the same file it was (`xlsx-writer.spec.ts` pins the
// bytes).
export {
  buildXlsx,
  buildXlsxBook,
  sheetName,
  signatureColumns,
  xlsxFilename,
  type XlsxCell,
  type XlsxSheet,
} from '../../../shared/lib/xlsx-writer';
