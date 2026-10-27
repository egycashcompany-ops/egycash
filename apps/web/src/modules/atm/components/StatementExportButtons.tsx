// «Excel» and «PDF» on the four operation tables — the statement of what the table holds,
// «بيان تغذية/صيانة ماكينات الصراف الآلي عن يوم … / عن الفترة من … إلى …» (2026-10-27).
//
// THE TABLE'S ROWS, AS THEY ARE ON SCREEN. Every one of these tables is already whole in the
// browser (`lib/whole-board.ts`), so the files are made from the rows in hand — the day view, the
// filters and the reader's order already applied — with no second read that could disagree with
// what the reader was looking at.
//
// ONE PAIR OF BUTTONS, ONE WORKBOOK WRITER, ONE REPORT FORM. The buttons are the IT registers'
// (`RegisterExportButtons`: one file at a time, the spinner, the failure named); the workbook is
// the app's own `.xlsx` writer and the printed page the company's report form, both under Fleet,
// which needed them first — the IT registers reuse them the same way.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { saveBlob } from '../../../shared/lib/api-client';
import { openPrintDocument } from '../../../shared/lib/print-window';
import { buildXlsx } from '../../fleet/lib/fleet-xlsx';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import { RegisterExportButtons } from '../../it/components/RegisterExportButtons';
import {
  statementFileName,
  statementLines,
  statementTitle,
  type AtmOperationKind,
  type SheetColumn,
} from '../lib/operation-sheet';

export const StatementExportButtons = <T,>({
  kind,
  name,
  sheetName,
  range,
  rows,
  columns,
  filterLine,
}: {
  kind: AtmOperationKind;
  /** Which table — `data-export` / `data-print` on the buttons. */
  name: string;
  /** The workbook tab's name — the page's own title. */
  sheetName: string;
  /** The day or days the statement is «عن». */
  range: { from: string; to: string };
  /** The table's rows, in its order. */
  rows: readonly T[];
  columns: readonly SheetColumn<T>[];
  /** What narrows the table, under the printed title; '' when nothing does. */
  filterLine: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const title = statementTitle(t, kind, range, locale);
  const header = columns.map((column) => column.header);

  const excel = (): Promise<void> => {
    saveBlob(
      buildXlsx({
        name: sheetName,
        title,
        serialHeader: t('atm.export.serial'),
        header,
        // An empty cell is a filterable blank in a sheet.
        rows: statementLines(rows, columns, ''),
      }),
      statementFileName(t, kind, range),
    );
    return Promise.resolve();
  };

  const pdf = (): Promise<boolean> => {
    const win = openPrintDocument(
      buildFleetReportHtml({
        title,
        department: t('atm.export.department'),
        subtitle: filterLine,
        header,
        // On paper an empty box reads as something left out, so it says «—».
        rows: statementLines(rows, columns, '—'),
        totals: [],
        serialHeader: t('atm.export.serial'),
        emptyLabel: t('atm.export.empty'),
        orientation: 'landscape',
      }),
    );
    return Promise.resolve(win !== null);
  };

  return <RegisterExportButtons name={name} onExcel={excel} onPdf={pdf} />;
};
