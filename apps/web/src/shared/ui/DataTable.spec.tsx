// How wide a table insists on being — and why that is a function of its columns.
//
// «ظبط عرض الجداول بعد الأعمدة الجديدة». The wrapper scrolls horizontally, but only below the
// table's own minimum width: above it the browser has room to SQUEEZE instead, and a thirteen-
// column register squeezed into a laptop is thirteen columns of two- and three-line cells. The
// grid is all there and none of it is readable.
//
// So the floor follows the column count, and the two ends of that rule are what is pinned here:
// a narrow table is exactly as wide as it always was, and a wide one asks for the room it needs.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: string;
}
const ROWS: Row[] = [{ id: 'r1' }];

const columns = (count: number): Column<Row>[] =>
  Array.from({ length: count }, (_unused, index) => ({
    key: `c${index}`,
    header: `العمود ${index}`,
    render: () => 'x',
  }));

/** The `min-width` the table asks for, in rem. */
const minWidth = (count: number, extra: Record<string, unknown> = {}): number => {
  const markup = renderToStaticMarkup(
    <DataTable columns={columns(count)} rows={ROWS} rowKey={(row) => row.id} {...extra} />,
  );
  const found = /min-width:\s*([\d.]+)rem/.exec(markup);
  if (found === null) throw new Error(`no min-width in ${markup.slice(0, 200)}`);
  return Number(found[1]);
};

describe('the width a table insists on', () => {
  it('leaves a narrow table exactly where it was — 40rem, as before', () => {
    // Every table in the app that nobody complained about. Five columns or fewer keep the floor
    // the component has always had, so this change is invisible to them.
    expect(minWidth(3)).toBe(40);
    expect(minWidth(5)).toBe(40);
  });

  it('asks for more room once the columns outgrow that floor', () => {
    // The workshop register: thirteen columns, and it needs about a hundred rem before a cell
    // stops having to wrap. Under the old flat floor it had 40 and squeezed.
    expect(minWidth(13)).toBeGreaterThan(90);
    expect(minWidth(13)).toBe(97.5);
  });

  it('grows one column at a time, with no cliff for a table to fall off', () => {
    const widths = [6, 7, 8, 9, 10].map((count) => minWidth(count));
    expect(widths).toEqual([45, 52.5, 60, 67.5, 75]);
  });

  it('counts the SELECTION column, which takes room like any other', () => {
    const plain = minWidth(9);
    const selectable = minWidth(9, {
      selection: { selectedIds: new Set<string>(), toggleRow: () => {}, toggleAll: () => {} },
    });
    expect(selectable).toBeGreaterThan(plain);
  });

  it('still lets the WRAPPER scroll rather than the page', () => {
    // The floor is only half the rule: without `overflow-x-auto` around it, a table that insists
    // on 97rem takes the whole page sideways instead of scrolling inside its own box.
    const markup = renderToStaticMarkup(
      <DataTable columns={columns(13)} rows={ROWS} rowKey={(row) => row.id} />,
    );
    expect(markup.slice(0, markup.indexOf('<table'))).toContain('overflow-x-auto');
  });
});
