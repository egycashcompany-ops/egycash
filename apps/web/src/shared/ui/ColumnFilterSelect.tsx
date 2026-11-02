// One column's filter in a table's filter row — «فلتر لكل عمود», then «لأ عايز الفلتر الكبير اللى
// فوق الجداول يكون Drop Down بـ Multi select» (2026-11-02, the ATM tables): a drop-down of the
// values the column's cells show, several of them pickable, the way the bank and area filters
// above the table are. `DataTable` draws a row of these under its head (`columnFilters`); a table
// built by hand renders them in a row of its own `<thead>`. The rules are
// `shared/lib/column-filter.ts`.
import { useT } from '../../platform/localization/useT';
import { columnSearchMatches } from '../lib/column-filter';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';

/**
 * One column's list. Its values are asked for only while it is open (`choices`), it opens over
 * the page rather than inside the table's scrolling box, the closed trigger names what is picked,
 * and what its search finds can be picked at once (`pickMatches`) — «704» then Enter ticks every
 * code holding 704 that the column shows NOW (a row that arrives later with another such code is
 * not among the picks). The search keeps a date's «/» and a time's «:» (`columnSearchMatches`).
 *
 * The control FILLS its column and never sizes it (`w-0 min-w-full` on the inner box): a trigger
 * naming its picks at its natural width would widen the column the moment something is picked,
 * and squeeze every other column of the table. One floor only (`min-w-[4.5rem]` on the outer
 * box): «الكل» and its chevron whole, even under a column as narrow as a bank's «NBE».
 */
export const ColumnFilterSelect = ({
  value,
  choices,
  onChange,
  label,
  columnKey,
  placeholder,
}: {
  value: readonly string[];
  /** The column's values, in the order to list them — `columnFilterChoices`. */
  choices: () => readonly string[];
  onChange: (picked: string[]) => void;
  label: string;
  columnKey: string;
  placeholder?: string;
}): JSX.Element => {
  const t = useT();
  // An empty cell is a value too — «(فارغ)» — and it is `''` underneath.
  const option = (choice: string): MultiSelectOption => ({
    value: choice,
    label: choice === '' ? t('common.filters.blank') : choice,
  });
  return (
    <div data-column-filter={columnKey} className="min-w-[4.5rem]">
      <div className="w-0 min-w-full">
        <MultiSelect
          label={label}
          options={value.map(option)}
          loadOptions={() => choices().map(option)}
          value={value}
          onChange={onChange}
          density="tight"
          size="sm"
          fullWidth
          floating
          pickMatches
          match={columnSearchMatches}
          showSelectedValues
          panelWidth="w-64"
          placeholder={placeholder ?? t('common.filters.all')}
          className="w-full"
        />
      </div>
    </div>
  );
};
