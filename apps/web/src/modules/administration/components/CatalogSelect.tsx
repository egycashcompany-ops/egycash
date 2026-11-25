// The unit and category selects (design §13.6 D): one control over the module's cached catalogs,
// used by the item form and by the item register's filters. Drawn with the shared
// `SearchableSelect` — a short list is a plain select, a list that grows is typed into.
//
// The options are the live ACTIVE rows, with one exception that matters: a retired row stays
// visible while it is the current value, so editing an old item never silently drops its unit or
// category (IT's `ItCatalogSelect` rule; retired rows are kept because records still name them).
//
// Categories have two levels (OD-06 A), and a subcategory is labelled under its parent's name,
// «الأحبار — حبر ليزر». Where they are offered depends on the question:
//   • `filter` — both levels, each parent followed by its subcategories: the register's filter
//     reads a top-level category with its subcategories' items (§19.4);
//   • `field` — where an item may be filed: a top-level category that has active subcategories is
//     not offered, its subcategories are (OD-06 (i), `ADMINISTRATION_SUBCATEGORY_REQUIRED`).
//
// The option lists are the pure helpers below the component, proven without a browser.
import { useMemo } from 'react';
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { localized } from '../../../shared/lib/format';
import { SearchableSelect, type SearchableOption } from '../../../shared/ui/SearchableSelect';
import { useWholeCategories, useWholeUnits } from '../api/catalog-queries';

export type CatalogSelectKind = 'unit' | 'category';
export type CategoryOptionsMode = 'filter' | 'field';

export const CatalogSelect = ({
  kind,
  mode = 'field',
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
  error = false,
  currentLabel,
  testId,
}: {
  kind: CatalogSelectKind;
  /** Categories only: which of the two levels are offered (see the header). */
  mode?: CategoryOptionsMode;
  value: string;
  onChange: (id: string) => void;
  /** What the box reads while nothing is chosen — «الكل» for a filter. */
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  error?: boolean;
  /** The current value's name when the list may not hold it (the item DTO names its references). */
  currentLabel?: string;
  testId?: string;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const units = useWholeUnits(kind === 'unit');
  const categories = useWholeCategories(kind === 'category');
  const options = useMemo(() => {
    const listed =
      kind === 'unit'
        ? unitOptions(units.data ?? [], value, locale)
        : categoryOptions(categories.data ?? [], mode, value, locale);
    return withCurrent(listed, value, currentLabel);
  }, [kind, mode, value, locale, currentLabel, units.data, categories.data]);
  const loading = kind === 'unit' ? units.isPending : categories.isPending;
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      error={error}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
      {...(id === undefined ? {} : { id })}
      testId={testId ?? `administration-${kind}`}
    />
  );
};

/** «الأحبار — حبر ليزر» for a subcategory; a top-level category by its own name. */
export const categoryLabel = (category: AdministrationItemCategoryDto, locale: Locale): string =>
  category.parentName === null
    ? localized(category.name, locale)
    : `${localized(category.parentName, locale)} — ${localized(category.name, locale)}`;

/** The active units, and the current one whatever it has become. */
export const unitOptions = (
  units: readonly AdministrationCatalogItemDto[],
  value: string,
  locale: Locale,
): SearchableOption[] =>
  units
    .filter((unit) => unit.isActive || unit.id === value)
    .map((unit) => ({ value: unit.id, label: localized(unit.name, locale) }));

/**
 * The categories a select offers, each parent followed by its subcategories, in the catalog's own
 * order. `filter` offers both levels; `field` offers where an item may be filed — a subcategory,
 * or a top-level category with no active subcategory. Either way the current value stays.
 */
export const categoryOptions = (
  categories: readonly AdministrationItemCategoryDto[],
  mode: CategoryOptionsMode,
  value: string,
  locale: Locale,
): SearchableOption[] => {
  const offered = (category: AdministrationItemCategoryDto): boolean =>
    category.isActive || category.id === value;
  const options: SearchableOption[] = [];
  for (const parent of categories.filter((category) => category.parentId === null)) {
    const children = categories.filter((category) => category.parentId === parent.id);
    const liveChildren = children.filter((child) => child.isActive);
    const parentFiles = mode === 'filter' || liveChildren.length === 0;
    if (offered(parent) && (parentFiles || parent.id === value)) {
      options.push({ value: parent.id, label: categoryLabel(parent, locale) });
    }
    // A subcategory is judged on its own `isActive`, not its parent's (the server's reading).
    for (const child of children.filter(offered)) {
      options.push({ value: child.id, label: categoryLabel(child, locale) });
    }
  }
  return options;
};

/** The current value with its name, when the list does not hold it (yet). */
export const withCurrent = (
  options: SearchableOption[],
  value: string,
  label: string | undefined,
): SearchableOption[] =>
  value === '' || label === undefined || options.some((option) => option.value === value)
    ? options
    : [{ value, label }, ...options];
