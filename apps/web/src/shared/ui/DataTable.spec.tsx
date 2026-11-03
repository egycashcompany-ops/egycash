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
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { DataTable, groupRuns, type Column } from './DataTable';

interface Row {
  id: string;
}
const ROWS: Row[] = [{ id: 'r1' }];

/** The filter lists speak the reader's language, so a table that has them renders in a store. */
const inStore = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as Locale, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

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

describe('a wide table stays inside its own scroll', () => {
  // «الشاشة بتبوس كده في التليفون» — the vehicles screen zoomed out on a phone. A cell's
  // `sr-only` label (absolutely positioned, no positioned ancestor) escaped the scroll's clip and
  // stretched the whole document to the table's width. The scroll wrapper is its containing block.
  it('positions the scroll wrapper, so nothing absolutely placed in a cell escapes it', () => {
    const markup = renderToStaticMarkup(
      <DataTable columns={columns(12)} rows={ROWS} rowKey={(row) => row.id} />,
    );
    expect(markup).toMatch(/^<div class="relative overflow-x-auto/);
  });
});

describe('a line above each group of rows', () => {
  // The ATM open boards, by area: «كل منطقة تظهر اعطالها وتغذياتها تحت بعض». The table only draws
  // the lines; the rows come in group order.
  interface Grouped {
    id: string;
    area: string;
  }
  const rows: Grouped[] = [
    { id: 'r1', area: 'الدقي' },
    { id: 'r2', area: 'الدقي' },
    { id: 'r3', area: 'زايد' },
  ];
  const render = (extra: Record<string, unknown> = {}): string =>
    renderToStaticMarkup(
      <DataTable
        columns={[
          { key: 'id', header: 'id', render: (row: Grouped, index) => `${row.id}#${index}` },
          { key: 'area', header: 'area', render: (row: Grouped) => row.area },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        group={{ of: (row: Grouped) => row.area, label: (g: string) => `«${g}»`, count: String }}
        {...extra}
      />,
    );

  it('draws one line where each group starts, naming it and counting its rows', () => {
    const markup = render();
    const lines = [...markup.matchAll(/<tr data-row-group="([^"]*)"/g)].map((m) => m[1]);
    expect(lines).toEqual(['الدقي', 'زايد']);
    expect(markup).toContain('«الدقي»');
    expect(markup).toMatch(/«الدقي»<span[^>]*>2<\/span>/);
    expect(markup).toMatch(/«زايد»<span[^>]*>1<\/span>/);
    // Each line sits right before its group's first row.
    expect(markup.indexOf('data-row-group="الدقي"')).toBeLessThan(markup.indexOf('r1#0'));
    expect(markup.indexOf('r2#1')).toBeLessThan(markup.indexOf('data-row-group="زايد"'));
    expect(markup.indexOf('data-row-group="زايد"')).toBeLessThan(markup.indexOf('r3#2'));
  });

  it('keeps the name in view when a wide table scrolls sideways', () => {
    // The name sticks to the start edge, at the cell's own gutter — a board wider than the screen
    // must not turn its group lines into blank bars.
    const line = (extra: Record<string, unknown> = {}): string => {
      const markup = render(extra);
      const at = markup.indexOf('data-row-group="الدقي"');
      return markup.slice(at, markup.indexOf('</tr>', at));
    };
    expect(line()).toMatch(/<span class="sticky inline-flex[^"]*start-4/);
    expect(line({ dense: true })).toMatch(/<span class="sticky inline-flex[^"]*start-3/);
    expect(line({ dense: true, tightGutter: true })).toMatch(
      /<span class="sticky inline-flex[^"]*start-2/,
    );
  });

  it('leaves the rows’ own index alone — the lines are not rows', () => {
    const markup = render();
    expect(markup).toContain('r1#0');
    expect(markup).toContain('r3#2');
  });

  it('spans the whole row, the selection box included', () => {
    expect(render()).toContain('colSpan="2"');
    const selectable = render({
      selection: { selectedIds: new Set<string>(), toggleRow: () => {}, toggleAll: () => {} },
    });
    expect(selectable).toContain('colSpan="3"');
    // The line holds no box of its own.
    expect(selectable.match(/aria-label="select row"/g)).toHaveLength(3);
  });

  it('draws no line at all without `group`', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        columns={[{ key: 'id', header: 'id', render: (row: Grouped) => row.id }]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    expect(markup).not.toContain('data-row-group');
  });

  it('splits a group that comes in two pieces into two runs — the caller orders the rows', () => {
    expect(
      groupRuns(['a', 'a', 'b', 'a'], (value) => value).map((run) => [run.group, run.size]),
    ).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
    ]);
  });
});

describe('a row of filter lists under the head', () => {
  // «فلتر لكل عمود», then «يكون Drop Down بـ Multi select» (2026-11-02): one multi-pick list per
  // filterable column; the page filters the rows.
  interface Row {
    id: string;
  }
  const render = (extra: Record<string, unknown> = {}, values: Record<string, string[]> = {}) =>
    inStore(
      <DataTable
        columns={[
          { key: 'code', header: 'الكود', render: (row: Row) => row.id, filterable: true },
          { key: 'name', header: 'الاسم', render: (row: Row) => row.id, filterable: true },
          {
            key: 'actions',
            header: '',
            render: () => 'x',
            headerClassName: 'sticky end-0 PINNED',
          },
        ]}
        rows={[{ id: 'r1' }]}
        rowKey={(row) => row.id}
        columnFilters={{
          values,
          onChange: () => {},
          choices: () => {
            throw new Error('a closed list asks for no values');
          },
          label: (header: string) => `فلترة ${header}`,
        }}
        {...extra}
      />,
    );
  const filterRow = (markup: string): string => {
    const at = markup.indexOf('data-column-filters="true"');
    return markup.slice(at, markup.indexOf('</tr>', at));
  };
  /** One column's control, from its box to the box's end. */
  const filterOf = (markup: string, key: string): string => {
    const at = markup.indexOf(`data-column-filter="${key}"`);
    return markup.slice(at, markup.indexOf('</th>', at));
  };

  it('draws a list for each filterable column only, inside the head, named by its header', () => {
    const markup = render();
    const row = filterRow(markup);
    expect(markup.indexOf('data-column-filters="true"')).toBeLessThan(markup.indexOf('</thead>'));
    expect(row.match(/data-column-filter="/g)).toHaveLength(2);
    expect(row).toContain('data-column-filter="code"');
    expect(row).toContain('data-column-filter="name"');
    expect(filterOf(markup, 'code')).toContain('aria-label="فلترة الكود"');
    expect(filterOf(markup, 'code')).toContain('aria-haspopup="listbox"');
    // Nothing picked: the trigger says «الكل», and no text box is left in the row.
    expect(filterOf(markup, 'code')).toContain('>الكل<');
    expect(row).not.toContain('<input');
  });

  it('fills the column and never sizes it — the compact trigger', () => {
    const control = filterOf(render(), 'code');
    // A floor for «الكل» and its chevron; inside it, a box that fills the cell without sizing it.
    expect(control).toMatch(
      /^data-column-filter="code" class="min-w-\[4\.5rem\]"><div class="w-0 min-w-full">/,
    );
    expect(control).toMatch(/<button[^>]*class="[^"]*\bh-8\b[^"]*\btext-xs\b/);
  });

  it('names what each list has picked, and keeps a pinned column pinned', () => {
    const markup = render({}, { code: ['70493', ''] });
    // The picks, in the order picked; an empty cell picked is «(فارغ)».
    expect(filterOf(markup, 'code')).toContain('70493, (فارغ)');
    expect(filterOf(markup, 'name')).toContain('>الكل<');
    // The actions column's head is pinned; its cell in the filter row is too.
    expect(filterRow(markup)).toContain('sticky end-0 PINNED');
  });

  it('keeps an empty cell for the selection box, so the lists stay under their columns', () => {
    const selectable = render({
      selection: { selectedIds: new Set<string>(), toggleRow: () => {}, toggleAll: () => {} },
    });
    expect(filterRow(selectable)).toMatch(
      /^data-column-filters="true"[^>]*><th class="px-4 pb-2"><\/th>/,
    );
  });

  it('draws no row without `columnFilters`, or when no column is filterable', () => {
    expect(
      renderToStaticMarkup(
        <DataTable
          columns={[
            { key: 'code', header: 'الكود', render: (row: Row) => row.id, filterable: true },
          ]}
          rows={[{ id: 'r1' }]}
          rowKey={(row) => row.id}
        />,
      ),
    ).not.toContain('data-column-filters');
    expect(
      renderToStaticMarkup(
        <DataTable
          columns={[{ key: 'code', header: 'الكود', render: (row: Row) => row.id }]}
          rows={[{ id: 'r1' }]}
          rowKey={(row) => row.id}
          columnFilters={{
            values: {},
            onChange: () => {},
            choices: () => [],
            label: (h: string) => h,
          }}
        />,
      ),
    ).not.toContain('data-column-filters');
  });
});

describe('columns that keep their widths — `steadyColumns` (2026-11-03)', () => {
  // «عرض الأعمدة فى الجدول بيتغير لما بعمل فلتر !! عايزك تثبته». The widths are taken in the
  // browser, after the first layout; what the table draws before that is pinned here.
  const html = (steadyColumns: boolean): string =>
    renderToStaticMarkup(
      <DataTable
        columns={columns(3)}
        rows={ROWS}
        rowKey={(row) => row.id}
        steadyColumns={steadyColumns}
      />,
    );

  it('draws the first layout as the browser lays it out — no widths before they are taken', () => {
    expect(html(true)).not.toContain('<colgroup');
    expect(html(true)).toContain('<thead');
  });

  it('is off unless asked for: every other table is laid out exactly as before', () => {
    expect(html(false)).toBe(
      renderToStaticMarkup(<DataTable columns={columns(3)} rows={ROWS} rowKey={(row) => row.id} />),
    );
  });

  it('measures the table itself and keeps the widths as its first child', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./DataTable.tsx', import.meta.url), 'utf8');
    expect(source).toContain('enabled: steadyColumns,');
    expect(source).toContain('ref={steady.ref}');
    expect(source).toMatch(
      /style=\{\{ minWidth: `\$\{minTableWidth\}rem` \}\}\s*>\s*<SteadyColGroup shares=\{steady\.shares\} \/>/,
    );
  });
});
