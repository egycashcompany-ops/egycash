// The item form's state (design §2.3.4, OD-05 to OD-09), mirroring the contracts: what the dialog
// holds as text, which values are missing or wrong, the body a create sends, and the fields an edit
// changes. Pure, so a spec proves each payload and each mark without a browser.
//
// No code field: the server takes «ITM-00001» inside the create (OD-05 A). No quantity on hand
// either — stock moves only with a document (ADR-024). The levels are whole units of the base unit
// from 0 (OD-08), bounded as the contract bounds them, and keep min ≤ reorder point ≤ max where set
// (OD-09): the same comparisons the server judges (`ADMINISTRATION_STOCK_LEVELS_ORDER`), so a press
// of Save marks them before a round trip — the server still decides.
import {
  ADMINISTRATION_STOCK_LEVEL_FIELDS,
  ADMINISTRATION_STOCK_LEVEL_MAX,
  type AdministrationItemDto,
  type AdministrationStockLevelField,
  type CreateAdministrationItem,
  type UpdateAdministrationItem,
} from '@ecms/contracts';

/** The contracts' bounds, so a long value stops at the box rather than at a 400. */
export const BARCODE_MAX = 64;
export const NOTES_MAX = 2000;

export interface ItemForm {
  nameAr: string;
  nameEn: string;
  barcode: string;
  categoryId: string;
  unitId: string;
  /** Digits only (`Input rule="integer"`); empty is «no level». */
  minQty: string;
  reorderPointQty: string;
  maxQty: string;
  description: string;
  notes: string;
  isActive: boolean;
}

const levelText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

export const itemFormFrom = (item: AdministrationItemDto | null): ItemForm => ({
  nameAr: item?.name.ar ?? '',
  nameEn: item?.name.en ?? '',
  barcode: item?.barcode ?? '',
  categoryId: item?.categoryId ?? '',
  unitId: item?.unitId ?? '',
  minQty: levelText(item?.minQty),
  reorderPointQty: levelText(item?.reorderPointQty),
  maxQty: levelText(item?.maxQty),
  description: item?.description ?? '',
  notes: item?.notes ?? '',
  isActive: item?.isActive ?? true,
});

/** The four values an item cannot be saved without (`CreateAdministrationItemSchema`). */
export const itemRequired = (
  form: ItemForm,
): Record<'nameAr' | 'nameEn' | 'categoryId' | 'unitId', boolean> => ({
  nameAr: form.nameAr.trim() !== '',
  nameEn: form.nameEn.trim() !== '',
  categoryId: form.categoryId !== '',
  unitId: form.unitId !== '',
});

/** A level the box holds: null when empty, NaN when it is no whole number the contract takes. */
export const levelOf = (text: string): number | null => {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+$/u.test(value)) return Number.NaN;
  const level = Number(value);
  return level <= ADMINISTRATION_STOCK_LEVEL_MAX ? level : Number.NaN;
};

export type LevelProblem = 'wholeNumber' | 'outOfOrder';

/**
 * What is wrong with each level, if anything: not a whole number within the bound, or out of
 * order. Each comparison that fails names both its ends, the server's own reading, so every box
 * the reader must look at is marked.
 */
export const levelProblems = (
  form: ItemForm,
): Partial<Record<AdministrationStockLevelField, LevelProblem>> => {
  const problems: Partial<Record<AdministrationStockLevelField, LevelProblem>> = {};
  const levels = Object.fromEntries(
    ADMINISTRATION_STOCK_LEVEL_FIELDS.map((field) => [field, levelOf(form[field])]),
  ) as Record<AdministrationStockLevelField, number | null>;
  for (const field of ADMINISTRATION_STOCK_LEVEL_FIELDS) {
    if (Number.isNaN(levels[field])) problems[field] = 'wholeNumber';
  }
  ADMINISTRATION_STOCK_LEVEL_FIELDS.forEach((lower, i) => {
    for (const upper of ADMINISTRATION_STOCK_LEVEL_FIELDS.slice(i + 1)) {
      const low = levels[lower];
      const high = levels[upper];
      if (low === null || high === null || Number.isNaN(low) || Number.isNaN(high)) continue;
      if (low > high) {
        problems[lower] ??= 'outOfOrder';
        problems[upper] ??= 'outOfOrder';
      }
    }
  });
  return problems;
};

/**
 * The barcode as the contract takes it: empty (none), or what a scan types — no space inside
 * (`/^\S+$/`). Judged here because the contract's refusal is a plain 400 that names no box.
 */
export const barcodeOk = (text: string): boolean => {
  const value = text.trim();
  return value === '' || /^\S+$/u.test(value);
};

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export const itemCreateBody = (form: ItemForm): CreateAdministrationItem => {
  const body: CreateAdministrationItem = {
    name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
    categoryId: form.categoryId,
    unitId: form.unitId,
  };
  const barcode = orNull(form.barcode);
  if (barcode !== null) body.barcode = barcode;
  for (const field of ADMINISTRATION_STOCK_LEVEL_FIELDS) {
    const level = levelOf(form[field]);
    if (level !== null) body[field] = level;
  }
  const description = orNull(form.description);
  if (description !== null) body.description = description;
  const notes = orNull(form.notes);
  if (notes !== null) body.notes = notes;
  return body;
};

/** What an edit changes — only the facts that moved; an emptied optional box is `null`. */
export const itemChanges = (
  form: ItemForm,
  item: AdministrationItemDto,
): Omit<UpdateAdministrationItem, 'version'> => {
  const changes: Omit<UpdateAdministrationItem, 'version'> = {};
  const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
  if (name.ar !== item.name.ar || name.en !== item.name.en) changes.name = name;
  const barcode = orNull(form.barcode);
  if (barcode !== item.barcode) changes.barcode = barcode;
  if (form.categoryId !== item.categoryId) changes.categoryId = form.categoryId;
  if (form.unitId !== item.unitId) changes.unitId = form.unitId;
  for (const field of ADMINISTRATION_STOCK_LEVEL_FIELDS) {
    const level = levelOf(form[field]);
    if (level !== item[field]) changes[field] = level;
  }
  const description = orNull(form.description);
  if (description !== item.description) changes.description = description;
  const notes = orNull(form.notes);
  if (notes !== item.notes) changes.notes = notes;
  if (form.isActive !== item.isActive) changes.isActive = form.isActive;
  return changes;
};
