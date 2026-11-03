// Copying rows of a table (2026-11-03): «لما أخد Copy من الجدول تطلعهولى بشكل جدول لأنه بيطلع بالشكل
// دا … فالكلام داخل في بعضه .. عايز حافظ على شكلة كجدول لما أبعته واتساب». The browser's tab between
// cells disappears in a chat; the copy is written as lines with « | » between cells, and as an HTML
// table for a sheet or a document. Every name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  COPY_CELL_SEPARATOR,
  copiedCellText,
  copiedLine,
  copiedGrid,
  tableClipboard,
  type CopiedCell,
} from './table-copy';

const row = (...texts: string[]): CopiedCell[] => texts.map((text, column) => ({ column, text }));

describe('the text a chat pastes', () => {
  it('a line per row, « | » between its cells — the owner’s three rows no longer run together', () => {
    const { text } = tableClipboard(
      copiedGrid([
        row('MISR', '1150744', 'SYN فرع القصر العينى', 'مسائي'),
        row('MISR', '1150183', 'SYN الدواوين 3', 'مسائي'),
        row('NBE', '25990323', 'SYN معهد التعاون', 'مبكر جدا'),
      ]),
    );
    // Read without its direction marks (below), the text is the rows, cell by cell.
    expect(text.replace(/[\u200F\u2068\u2069]/g, '')).toBe(
      [
        'MISR | 1150744 | SYN فرع القصر العينى | مسائي',
        'MISR | 1150183 | SYN الدواوين 3 | مسائي',
        'NBE | 25990323 | SYN معهد التعاون | مبكر جدا',
      ].join('\n'),
    );
    expect(text).not.toContain('\t');
    expect(COPY_CELL_SEPARATOR).toBe(' | ');
  });

  it('each line reads right to left with every cell whole — the schedule never lands inside a name', () => {
    // « | » is neutral: unmarked, a line opening with «MISR» reads left to right in WhatsApp and two
    // Arabic cells side by side run together and swap. A right-to-left mark opens the line, and
    // each cell is isolated (FSI … PDI).
    expect(copiedLine(['MISR', 'SYN فرع القصر العينى', 'مسائي'])).toBe(
      '\u200F\u2068MISR\u2069 | \u2068SYN فرع القصر العينى\u2069 | \u2068مسائي\u2069',
    );
    const { text } = tableClipboard([
      ['MISR', '1'],
      ['NBE', '2'],
    ]);
    expect(text.split('\n').every((line) => line.startsWith('\u200F'))).toBe(true);
  });

  it('a cell’s text on one line, its spaces one', () => {
    expect(copiedCellText('  SYN SERVICE \n  بريد  ')).toBe('SYN SERVICE بريد');
  });
});

describe('the grid', () => {
  it('keeps every row’s cells under their columns, a cell a row did not reach left empty', () => {
    // A selection that starts in the middle of the first row and ends in the middle of the last.
    const rows: CopiedCell[][] = [
      [
        { column: 2, text: 'SYN A' },
        { column: 3, text: 'مسائي' },
      ],
      row('NBE', '25990323', 'SYN B', 'مبكر'),
      [
        { column: 0, text: 'CIB' },
        { column: 1, text: '70493' },
      ],
    ];
    expect(copiedGrid(rows)).toEqual([
      ['', '', 'SYN A', 'مسائي'],
      ['NBE', '25990323', 'SYN B', 'مبكر'],
      ['CIB', '70493', '', ''],
    ]);
  });

  it('drops a column empty in every row — a checkbox’s, a row of buttons’ — and an empty row', () => {
    const rows: CopiedCell[][] = [
      [
        { column: 0, text: '' },
        { column: 1, text: 'MISR' },
        { column: 4, text: '' },
      ],
      [],
      [
        { column: 0, text: '' },
        { column: 1, text: 'NBE' },
        { column: 4, text: '' },
      ],
    ];
    expect(copiedGrid(rows)).toEqual([['MISR'], ['NBE']]);
  });
});

describe('the table a sheet or a document pastes', () => {
  it('is a real table, right to left, a row per row and a cell per cell', () => {
    const { html } = tableClipboard([
      ['MISR', '1150744'],
      ['NBE', '25990323'],
    ]);
    expect(html).toContain('<table dir="rtl"');
    expect(html).toContain(
      '<tr><td>MISR</td><td>1150744</td></tr><tr><td>NBE</td><td>25990323</td></tr>',
    );
    expect(html.startsWith('<meta charset="utf-8">')).toBe(true);
  });

  it('writes a cell’s text as text — never as markup', () => {
    const { html } = tableClipboard([['<b>A & "B"</b>']]);
    expect(html).toContain('<td>&lt;b&gt;A &amp; &quot;B&quot;&lt;/b&gt;</td>');
    expect(html).not.toContain('<b>');
  });
});
