// What a reader gets when they copy rows of a table — «لما أخد Copy من الجدول تطلعهولى بشكل جدول
// لأنه بيطلع بالشكل دا … فالكلام داخل في بعضه .. عايز حافظ على شكلة كجدول لما أبعته واتساب»
// (2026-11-03).
//
// The browser's own copy puts a TAB between cells. A sheet reads that as columns, but a chat does
// not: WhatsApp draws a tab as a narrow space, and «MISR 1150744 فرع القصر العينى مسائي» runs
// together. So a copy that spans cells of a table is written twice on the clipboard:
//   · as TEXT, each row one line, its cells separated by « | » — what a chat, a note or an SMS
//     pastes, and still reads as columns there;
//   · as an HTML TABLE — what a sheet, a document or an e-mail pastes, as real rows and columns.
// A selection inside one cell — part of a name — is the browser's to copy, as it always was.
//
// Only what the reader could select is taken: a cell the table keeps out of a selection
// (`select-none`, the boards' timers and buttons) stays out, and so does the text of a control in
// a cell (a button's label, a checkbox) — what is copied is what the rows SAY.

/** Between two cells of a copied row, as text. */
export const COPY_CELL_SEPARATOR = ' | ';

/** One cell of a copied row: its column and the text it shows. */
export interface CopiedCell {
  column: number;
  text: string;
}

/** Pure: a cell's text as it is copied — every run of spaces and line breaks one space. */
export const copiedCellText = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

/**
 * Pure: the copied rows as a grid — every row's cells under the same columns, a cell a row did
 * not reach left empty, and a column empty in every row (a checkbox's, a row of buttons') dropped.
 * A row with nothing in it is dropped too.
 */
export const copiedGrid = (rows: readonly (readonly CopiedCell[])[]): string[][] => {
  const filled = new Set<number>();
  for (const row of rows) for (const cell of row) if (cell.text !== '') filled.add(cell.column);
  const columns = [...filled].sort((a, b) => a - b);
  return rows
    .map((row) => {
      const byColumn = new Map(row.map((cell) => [cell.column, cell.text]));
      return columns.map((column) => byColumn.get(column) ?? '');
    })
    .filter((cells) => cells.some((text) => text !== ''));
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Pure: what goes on the clipboard for a grid — the text a chat pastes (a line per row, « | »
 * between cells) and the table a sheet or a document pastes. Right to left, as the pages are.
 */
export const tableClipboard = (
  grid: readonly (readonly string[])[],
): { text: string; html: string } => ({
  text: grid.map((row) => row.join(COPY_CELL_SEPARATOR)).join('\n'),
  html:
    '<meta charset="utf-8"><table dir="rtl" border="1" cellpadding="4" style="border-collapse:collapse">' +
    grid
      .map((row) => `<tr>${row.map((text) => `<td>${escapeHtml(text)}</td>`).join('')}</tr>`)
      .join('') +
    '</table>',
});

// ── The page's side: reading the selection ─────────────────────────────────────────────────────

/** The elements whose text is a control's, not the row's. */
const CONTROL_SELECTOR = 'button, input, select, textarea, [aria-hidden="true"], .sr-only';

/**
 * A cell's shown text, read the way the reader sees it: a control's text left out, and a space
 * wherever the layout breaks the text (a badge beside a name in a flex row, a second line) — so
 * «SYN SERVICE» and its «بريد» badge do not run together.
 */
const shownText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.matches(CONTROL_SELECTOR)) return '';
  const inner = [...node.childNodes].map(shownText).join('');
  const display = getComputedStyle(node).display;
  return display === 'inline' || display === 'contents' ? inner : ` ${inner} `;
};

/** Can the reader select this cell — or does the table keep it out (`select-none`)? */
const selectable = (cell: Element): boolean => {
  const style = getComputedStyle(cell);
  const userSelect = style.userSelect || style.getPropertyValue('-webkit-user-select');
  return userSelect !== 'none';
};

/**
 * The rows of a table a selection covers, each with the cells it reaches — or null when the
 * selection is not one that spans cells (nothing selected, a part of one cell, not in a table).
 */
export const selectedTableRows = (selection: Selection): CopiedCell[][] | null => {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const at = common instanceof Element ? common : common.parentElement;
  if (at === null || at.closest('td, th') !== null) return null;
  const table = at.closest('table');
  if (table === null) return null;
  const rows: CopiedCell[][] = [];
  for (const body of [...table.tBodies]) {
    for (const row of [...body.rows]) {
      if (!range.intersectsNode(row)) continue;
      rows.push(
        [...row.cells]
          .filter((cell) => range.intersectsNode(cell) && selectable(cell))
          .map((cell) => ({ column: cell.cellIndex, text: copiedCellText(shownText(cell)) })),
      );
    }
  }
  return rows.length === 0 ? null : rows;
};

/**
 * The copy of a page whose tables copy this way: a selection that spans cells of a table inside
 * `isInScope` is written as text and as a table; anything else is left to the browser.
 */
export const tableCopyHandler =
  (isInScope: (element: Element) => boolean) =>
  (event: ClipboardEvent): void => {
    const selection = document.getSelection();
    if (selection === null || event.clipboardData === null) return;
    if (selection.rangeCount === 0) return;
    const common = selection.getRangeAt(0).commonAncestorContainer;
    const at = common instanceof Element ? common : common.parentElement;
    if (at === null || !isInScope(at)) return;
    const rows = selectedTableRows(selection);
    if (rows === null) return;
    const grid = copiedGrid(rows);
    if (grid.length === 0) return;
    const { text, html } = tableClipboard(grid);
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
  };
