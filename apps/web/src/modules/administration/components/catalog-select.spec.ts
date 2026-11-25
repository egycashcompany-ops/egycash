// What the unit and category selects offer (design §13.6 D): the live rows, and the current value
// whatever it has become; a subcategory under its parent's name; both levels for a filter; and,
// where an item is filed, a subcategory under a top-level category that has a live one
// (`ADMINISTRATION_SUBCATEGORY_REQUIRED`) — each subcategory judged on its own `isActive`.
import { describe, expect, it } from 'vitest';
import { category, unit } from '../screen-fixtures';
import { categoryLabel, categoryOptions, unitOptions, withCurrent } from './CatalogSelect';

const INKS = category();
const LASER = category({
  id: 'c-laser',
  name: { ar: 'حبر ليزر', en: 'Laser toner' },
  parentId: 'c-ink',
  parentName: { ar: 'الأحبار', en: 'Inks' },
});
const INKJET = category({
  id: 'c-jet',
  name: { ar: 'حبر نافث', en: 'Inkjet' },
  parentId: 'c-ink',
  parentName: { ar: 'الأحبار', en: 'Inks' },
  isActive: false,
});
const PAPER = category({ id: 'c-paper', name: { ar: 'الورق', en: 'Paper' } });
const OLD = category({ id: 'c-old', name: { ar: 'قديم', en: 'Old' }, isActive: false });
const ALL = [INKS, LASER, INKJET, PAPER, OLD];

const values = (options: { value: string }[]): string[] => options.map((option) => option.value);

describe('the category select', () => {
  it('labels a subcategory under its parent’s name, in the reader’s language', () => {
    expect(categoryLabel(LASER, 'ar')).toBe('الأحبار — حبر ليزر');
    expect(categoryLabel(LASER, 'en')).toBe('Inks — Laser toner');
    expect(categoryLabel(PAPER, 'ar')).toBe('الورق');
  });

  it('offers both levels to a filter, each parent followed by its live subcategories', () => {
    expect(values(categoryOptions(ALL, 'filter', '', 'ar'))).toEqual([
      'c-ink',
      'c-laser',
      'c-paper',
    ]);
  });

  it('files an item under a subcategory where its category has a live one', () => {
    expect(values(categoryOptions(ALL, 'field', '', 'ar'))).toEqual(['c-laser', 'c-paper']);
    // With its only live subcategory retired, a category takes items again.
    const retired = [INKS, { ...LASER, isActive: false }, PAPER];
    expect(values(categoryOptions(retired, 'field', '', 'ar'))).toEqual(['c-ink', 'c-paper']);
  });

  it('keeps the current value visible whatever it has become', () => {
    expect(values(categoryOptions(ALL, 'field', 'c-old', 'ar'))).toContain('c-old');
    expect(values(categoryOptions(ALL, 'field', 'c-jet', 'ar'))).toContain('c-jet');
    // An item filed before its category gained subcategories still shows where it is.
    expect(values(categoryOptions(ALL, 'field', 'c-ink', 'ar'))).toContain('c-ink');
  });

  it('judges a subcategory on its own status, not its parent’s', () => {
    const underRetired = [{ ...INKS, isActive: false }, LASER];
    expect(values(categoryOptions(underRetired, 'field', '', 'ar'))).toEqual(['c-laser']);
  });
});

describe('the unit select', () => {
  it('offers the live units and the current one', () => {
    const units = [unit(), unit({ id: 'u-kg', name: { ar: 'كيلو', en: 'kg' }, isActive: false })];
    expect(values(unitOptions(units, '', 'ar'))).toEqual(['u-pcs']);
    expect(values(unitOptions(units, 'u-kg', 'ar'))).toEqual(['u-pcs', 'u-kg']);
  });

  it('names a current value the list does not hold from the record itself', () => {
    expect(withCurrent([], 'u-x', 'قطعة')).toEqual([{ value: 'u-x', label: 'قطعة' }]);
    expect(withCurrent([{ value: 'u-x', label: 'قطعة' }], 'u-x', 'other')).toHaveLength(1);
    expect(withCurrent([], '', 'قطعة')).toEqual([]);
  });
});
