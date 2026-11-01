// The Full list import's differences report as a file (docs/12-planning/atm-settlements-phase1.md
// §5.3, §9.5, MON-21, GS-1): one sheet — row, code, outcome, flags, machine name — built in the
// browser from the PREVIEW, with the shared writer, so Efficiency can act on the rows (receive the
// missing machines in the register, fix an ID). A run row keeps counts only, so the file exists
// only from a preview.
//
// NO COUNTS AND NO AMOUNTS: the cassette slots before and after are on the screen, never in the
// file that is handed on.
import {
  type AtmBankCode,
  type AtmLayoutImportFlag,
  type AtmLayoutImportOutcome,
  type AtmLayoutImportResultDto,
} from '@ecms/contracts';
import { buildXlsx, type XlsxSheet } from '../../../../shared/lib/xlsx-writer';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The sheet's words, from the caller's translator (the import page passes its own). */
export interface ImportReportWords {
  sheet: string;
  serial: string;
  row: string;
  code: string;
  outcome: string;
  flags: string;
  name: string;
  outcomeLabel: (outcome: AtmLayoutImportOutcome) => string;
  flagLabel: (flag: AtmLayoutImportFlag) => string;
}

export const importReportWords = (t: Translate): ImportReportWords => ({
  sheet: t('atm.layoutImport.report.sheet'),
  serial: t('atm.layoutImport.report.serial'),
  row: t('atm.layoutImport.column.row'),
  code: t('atm.settlement.machineCode'),
  outcome: t('atm.layoutImport.column.outcome'),
  flags: t('atm.layoutImport.column.notes'),
  name: t('atm.settlement.machineName'),
  outcomeLabel: (outcome) => t(`atm.layoutImport.outcome.${outcome}`),
  flagLabel: (flag) => t(`atm.layoutImport.flag.${flag}`),
});

/** The report's one sheet: a row per file row, in the file's order. */
export const importReportSheet = (
  dto: Pick<AtmLayoutImportResultDto, 'rows'>,
  words: ImportReportWords,
): XlsxSheet => ({
  name: words.sheet,
  serialHeader: words.serial,
  header: [words.row, words.code, words.outcome, words.flags, words.name],
  rows: [...dto.rows]
    .sort((a, b) => a.row - b.row)
    .map((row) => [
      row.row,
      row.code ?? '',
      words.outcomeLabel(row.outcome),
      row.flags.map(words.flagLabel).join(' · '),
      row.machineName ?? '',
    ]),
});

/** `Full list differences BRK dd-mm-yyyy.xlsx`, the day being the one it was taken. */
export const importReportFilename = (bankCode: AtmBankCode, day: string): string => {
  const [y = '', m = '', d = ''] = day.split('-');
  return `Full list differences ${bankCode} ${d}-${m}-${y}.xlsx`;
};

export const buildImportReportXlsx = (
  dto: Pick<AtmLayoutImportResultDto, 'rows' | 'bankCode'>,
  words: ImportReportWords,
  day: string,
): { blob: Blob; filename: string } => ({
  blob: buildXlsx(importReportSheet(dto, words)),
  filename: importReportFilename(dto.bankCode, day),
});
