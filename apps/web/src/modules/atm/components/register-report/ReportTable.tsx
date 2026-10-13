// The table under each Data Report chart — the sheet's own cells (spec §8.5): sections 1 and 2 are
// a labels row over a values row (AD2:AJ3, AD4:AK5), section 3 the branches × banks block
// (AD7:AJ14) with no totals, as the sheet has none. It is also the chart's accessible view.
//
// `dir="ltr"` so it reads from AD at the left like the sheet (DEC-19); every label keeps
// `dir="auto"`. A zero is written `0`, never left blank (D7). Each value cell carries the sheet
// cell's key (`s1.NXT`, `s3.EGYCASH-1.NBE` …), the same keys the import's 57-number check uses.
import { cn } from '../../../../shared/lib/cn';
import { reportCount } from '../../lib/register-report-view';

// `cn` joins classes without resolving Tailwind conflicts, so no two of these set the same property.
const CELL = 'border border-slate-200 px-3 py-1.5 dark:border-slate-700';
const HEAD = 'bg-slate-50 text-xs dark:bg-slate-800/60';
const HEAD_TEXT = 'font-semibold text-slate-700 dark:text-slate-200';
const STRONG_TEXT = 'font-bold text-slate-900 dark:text-white';

export interface ReportTableColumn {
  key: string;
  label: string;
  strong: boolean;
}

export interface ReportTableRow {
  key: string;
  /** The row's own label (section 3's branch); null for the one values row of sections 1–2. */
  label: string | null;
  cells: { key: string; value: number; strong: boolean }[];
}

export const ReportTable = ({
  section,
  caption,
  corner,
  columns,
  rows,
}: {
  section: 1 | 2 | 3;
  caption: string;
  /** Names the row-label column for a screen reader (section 3); the sheet's corner is empty. */
  corner?: string;
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
}): JSX.Element => {
  const labelled = rows.some((row) => row.label !== null);
  return (
    <div dir="ltr" data-report-table={section} className="overflow-x-auto print:overflow-visible">
      {/* Equal columns, like the sheet's; below the minimum width the table scrolls. */}
      <table className="w-full min-w-[36rem] table-fixed border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {labelled && (
              <th scope="col" className={cn(CELL, HEAD)}>
                {corner !== undefined && <span className="sr-only">{corner}</span>}
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-report-column={column.key}
                className={cn(CELL, HEAD, 'text-center', column.strong ? STRONG_TEXT : HEAD_TEXT)}
              >
                <span dir="auto">{column.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-report-row={row.key}>
              {labelled && (
                <th scope="row" className={cn(CELL, HEAD, HEAD_TEXT, 'text-start')}>
                  <span dir="auto">{row.label ?? ''}</span>
                </th>
              )}
              {row.cells.map((cell) => (
                <td
                  key={cell.key}
                  data-report-cell={cell.key}
                  className={cn(
                    CELL,
                    'text-center tabular-nums',
                    cell.strong ? STRONG_TEXT : 'text-slate-800 dark:text-slate-100',
                  )}
                >
                  {reportCount(cell.value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
