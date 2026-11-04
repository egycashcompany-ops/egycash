// What makes a `MultiSelect` a table's column filter («يكون Drop Down بـ Multi select», 2026-11-02).
// A closed list's markup does not depend on most of these props — the list, the search rule, the
// «every match» row and the floating panel show only when it is open, which a static render never
// is — so they are pinned here on the props `ColumnFilterSelect` hands its `MultiSelect`.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { columnSearchMatches } from '../lib/column-filter';
import { ColumnFilterSelect } from './ColumnFilterSelect';
import { type MultiSelectOption } from './MultiSelect';

type Handed = Record<string, unknown> & {
  options: readonly MultiSelectOption[];
  loadOptions: () => readonly MultiSelectOption[];
  onChange: (next: string[]) => void;
};
let handed: Handed | null = null;
vi.mock('./MultiSelect', () => ({
  MultiSelect: (props: Handed) => {
    handed = props;
    return null;
  },
}));

const render = (props: Partial<Parameters<typeof ColumnFilterSelect>[0]> = {}): Handed => {
  handed = null;
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as Locale, dir: 'rtl' as const } },
  });
  renderToStaticMarkup(
    <Provider store={store}>
      <ColumnFilterSelect
        value={[]}
        choices={() => ['70492', '70493', '']}
        onChange={() => {}}
        label="فلترة الكود"
        columnKey="code"
        {...props}
      />
    </Provider>,
  );
  if (handed === null) throw new Error('MultiSelect was not rendered');
  return handed;
};

describe('a column filter is a MultiSelect that…', () => {
  it('floats over the page, compact, naming its picks, with «every match» and the column’s search', () => {
    const props = render();
    expect(props.floating).toBe(true);
    expect(props.size).toBe('sm');
    expect(props.density).toBe('tight');
    expect(props.fullWidth).toBe(true);
    expect(props.showSelectedValues).toBe(true);
    expect(props.pickMatches).toBe(true);
    // The search keeps a date's «/» — not the app's search rule, which drops it.
    expect(props.match).toBe(columnSearchMatches);
    expect(props.label).toBe('فلترة الكود');
    // Nothing picked: «الكل».
    expect(props.placeholder).toBe('الكل');
  });

  it('asks for its values only when the list asks — the empty value named «(فارغ)»', () => {
    const choices = vi.fn(() => ['70492', '70493', '']);
    const props = render({ choices });
    expect(choices).not.toHaveBeenCalled();
    expect(props.loadOptions()).toEqual([
      { value: '70492', label: '70492' },
      { value: '70493', label: '70493' },
      { value: '', label: '(فارغ)' },
    ]);
    expect(choices).toHaveBeenCalledTimes(1);
  });

  it('names the picks for the closed trigger from the picks alone', () => {
    const props = render({ value: ['70493', ''] });
    expect(props.options).toEqual([
      { value: '70493', label: '70493' },
      { value: '', label: '(فارغ)' },
    ]);
    expect(props.value).toEqual(['70493', '']);
  });

  it('reports the picks as they are', () => {
    const onChange = vi.fn();
    render({ onChange }).onChange(['70492']);
    expect(onChange).toHaveBeenCalledWith(['70492']);
  });
});

describe('a list that starts over each time it opens — the area (2026-11-03)', () => {
  // «لما أضغط على فلتر (المنطقة فقط) يعمله Reset وأقدر أختار من الأول في كل الصفحات بتاعت ATM».
  it('clears the column’s picks as its list opens', () => {
    const onChange = vi.fn();
    const props = render({ value: ['SYN الدقي', 'SYN زايد'], onChange, freshOnOpen: true });
    expect(typeof props.onOpen).toBe('function');
    (props.onOpen as () => void)();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('has nothing to clear while nothing is picked, and other columns keep their picks', () => {
    expect(render({ value: [], freshOnOpen: true }).onOpen).toBeUndefined();
    expect(render({ value: ['70493'] }).onOpen).toBeUndefined();
  });
});
