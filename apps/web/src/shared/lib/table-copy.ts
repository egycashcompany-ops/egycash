// What a reader gets when they copy rows of a table — «لما أخد Copy من الجدول تطلعهولى بشكل جدول
// لأنه بيطلع بالشكل دا … فالكلام داخل في بعضه .. عايز حافظ على شكلة كجدول لما أبعته واتساب»
// (2026-11-03).
//
// The browser's own copy puts a TAB between cells. A sheet reads that as columns, but a chat does
// not: WhatsApp draws a tab as a narrow space, and «MISR 1150744 فرع القصر العينى مسائي» runs
// together. So a copy that spans cells of a table is written twice on the clipboard:
//   · as TEXT, each row one line, its cells separated by « | » and a blank line between rows —
//     what a chat, a note or an SMS pastes, and still reads as columns there, right to left, each
//     cell whole (`copiedLine`), each row apart from the next (`COPY_ROW_SEPARATOR`);
//   · as an HTML TABLE — what a sheet, a document or an e-mail pastes, as real rows and columns.
// A selection inside one cell — part of a name — is the browser's to copy, as it always was.
//
// Only what the reader could select is taken: a cell the table keeps out of a selection
// (`select-none`, the boards' timers and buttons) stays out, and so does the text of a control in
// a cell (a button's label, a checkbox) — what is copied is what the rows SAY.

/** Between two cells of a copied row, as text. */
export const COPY_CELL_SEPARATOR = ' | ';

/**
 * Between two copied rows, as text: a blank line. «عايز فى موضوع الـ Copy إنه يسيب مسافة بين كل صف
 * والتاني» (2026-11-03) — in a chat, rows that follow line on line read as one block; a blank line
 * between them sets each machine apart.
 */
export const COPY_ROW_SEPARATOR = '\n\n';

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

/** Right-to-left mark: the line reads right to left, whatever its first letter. */
const RLM = '\u200F';
/** First-strong isolate and its end: a cell keeps its own direction and its place in the line. */
const FSI = '\u2068';
const PDI = '\u2069';

/**
 * Pure: one copied row as a line of text a chat lays out right. « | » is a neutral character, so
 * without marks a line opening with a Latin bank code reads left to right, and two Arabic cells
 * side by side run together and swap — the schedule landing inside the machine's name. The line
 * opens with a right-to-left mark and each cell is isolated: the cells read right to left in the
 * table's order, each one whole.
 */
export const copiedLine = (row: readonly string[]): string =>
  RLM + row.map((cell) => FSI + cell + PDI).join(COPY_CELL_SEPARATOR);

/**
 * Pure: what goes on the clipboard for a grid — the text a chat pastes (a line per row, « | »
 * between cells, right to left, a blank line between rows) and the table a sheet or a document
 * pastes, row under row as it always was.
 */
export const tableClipboard = (
  grid: readonly (readonly string[])[],
): { text: string; html: string } => ({
  text: grid.map(copiedLine).join(COPY_ROW_SEPARATOR),
  html:
    '<meta charset="utf-8"><table dir="rtl" border="1" cellpadding="4" style="border-collapse:collapse">' +
    grid
      .map((row) => `<tr>${row.map((text) => `<td>${escapeHtml(text)}</td>`).join('')}</tr>`)
      .join('') +
    '</table>',
});

// ── The page's side: reading the selection ─────────────────────────────────────────────────────

/** Inside a row of data: the elements whose text is a control's, not the row's. */
const BODY_CONTROLS = 'button, input, select, textarea, [aria-hidden="true"], .sr-only';
/**
 * Inside the head: a header's sort button carries the column's name, so it is read — but not the
 * row of column filters under the names, whose triggers say «الكل».
 */
const HEAD_CONTROLS =
  'input, select, textarea, [aria-hidden="true"], .sr-only, [data-column-filter]';

/**
 * A cell's shown text, read the way the reader sees it: a control's text left out, and a space
 * wherever the layout breaks the text (a badge beside a name in a flex row, a second line) — so
 * «SYN SERVICE» and its «بريد» badge do not run together.
 */
const shownText = (node: Node, controls: string): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.matches(controls)) return '';
  const inner = [...node.childNodes].map((child) => shownText(child, controls)).join('');
  const display = getComputedStyle(node).display;
  return display === 'inline' || display === 'contents' ? inner : ` ${inner} `;
};

/**
 * Can the reader select this cell — or does the table keep it out? Read from the classes the
 * table sets (`select-none` around it, `select-text` on the copy columns), not from the computed
 * value: browsers do not agree on whether `user-select` is inherited, and Firefox reads a cell
 * under a `select-none` table as selectable.
 */
const selectable = (cell: Element): boolean => {
  const marked = cell.closest('.select-none, .select-text');
  return marked === null || marked.classList.contains('select-text');
};

/**
 * Does the range cover some of this node's content — not merely touch it at an edge? A drag that
 * ends past a row's last copy column ends at the very start of the next cell (or the next row's
 * first cell), which a plain `intersectsNode` counts as reached.
 */
const covers = (range: Range, node: Node): boolean => {
  const inner = node.ownerDocument?.createRange();
  if (inner === undefined) return false;
  inner.selectNodeContents(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, inner) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, inner) > 0
  );
};

const elementOf = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

/**
 * The rows of one table a selection covers, head and body, each with the cells it covers — or
 * null when the selection is not one that spans cells of one table (nothing selected, a part of
 * one cell, nothing in a table, or two tables at once). Every range of the selection counts:
 * Firefox splits a drag across unselectable cells into several.
 */
export const selectedTableRows = (selection: Selection): CopiedCell[][] | null => {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  const ranges = Array.from({ length: selection.rangeCount }, (_, at) => selection.getRangeAt(at));
  const tables = new Set<HTMLTableElement>();
  for (const range of ranges) {
    const at = elementOf(range.commonAncestorContainer);
    if (at === null) return null;
    const host = at.closest('table');
    if (host !== null) tables.add(host);
    else
      for (const table of at.querySelectorAll('table')) if (covers(range, table)) tables.add(table);
  }
  if (tables.size !== 1) return null;
  const [table] = [...tables] as [HTMLTableElement];
  const rows: CopiedCell[][] = [];
  let cellsCovered = 0;
  for (const row of [...table.rows]) {
    if (!ranges.some((range) => covers(range, row))) continue;
    const inHead = row.parentElement?.tagName === 'THEAD';
    const cells = [...row.cells].filter(
      (cell) => selectable(cell) && ranges.some((range) => covers(range, cell)),
    );
    cellsCovered += cells.length;
    rows.push(
      cells.map((cell) => ({
        column: cell.cellIndex,
        text: copiedCellText(shownText(cell, inHead ? HEAD_CONTROLS : BODY_CONTROLS)),
      })),
    );
  }
  // A part of one cell is the browser's to copy, as it always was.
  return cellsCovered <= 1 ? null : rows;
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
    const at = elementOf(selection.getRangeAt(0).commonAncestorContainer);
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
