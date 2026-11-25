// The units' and item categories' form state (design §2.3.2–§2.3.3), mirroring the contracts: what
// the dialog holds as text, the body a create sends, and the fields an edit changes. Pure, so a spec
// proves the payloads without a browser.
//
// An edit sends only what moved, plus `version` (`UpdateAdministration…Schema`); a box emptied of an
// optional value — the code, the description, the parent — is `null`, which clears it. A row is
// retired or brought back with the Active box, never deleted (§5.3).
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type CreateAdministrationCatalogItem,
  type CreateAdministrationItemCategory,
  type UpdateAdministrationCatalogItem,
  type UpdateAdministrationItemCategory,
} from '@ecms/contracts';

/** The contracts' bounds, so a long value stops at the box rather than at a 400. */
export const NAME_MAX = 200;
export const CATALOG_CODE_MAX = 30;
export const DESCRIPTION_MAX = 500;

export interface CatalogForm {
  nameAr: string;
  nameEn: string;
  code: string;
  /** Digits only (`Input rule="integer"`); empty is 0, the contract's default. */
  sortOrder: string;
  description: string;
  /** A category's parent; '' is a top-level category. Units have none. */
  parentId: string;
  isActive: boolean;
}

type CatalogRow = AdministrationCatalogItemDto | AdministrationItemCategoryDto;

export const catalogFormFrom = (row: CatalogRow | null): CatalogForm => ({
  nameAr: row?.name.ar ?? '',
  nameEn: row?.name.en ?? '',
  code: row?.code ?? '',
  sortOrder: row === null ? '' : String(row.sortOrder),
  description: row?.description ?? '',
  parentId: row !== null && 'parentId' in row ? (row.parentId ?? '') : '',
  isActive: row?.isActive ?? true,
});

/** The sort order the box holds: a whole number from 0, empty as 0 — or NaN when it is neither. */
export const sortOrderOf = (text: string): number => {
  const value = text.trim();
  if (value === '') return 0;
  return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : Number.NaN;
};

/** Both names filled — the two the contracts require (§2.1). */
export const catalogRequired = (form: CatalogForm): { nameAr: boolean; nameEn: boolean } => ({
  nameAr: form.nameAr.trim() !== '',
  nameEn: form.nameEn.trim() !== '',
});

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const nameOf = (form: CatalogForm): { ar: string; en: string } => ({
  ar: form.nameAr.trim(),
  en: form.nameEn.trim(),
});

export const unitCreateBody = (
  form: CatalogForm,
): Omit<CreateAdministrationCatalogItem, 'kind'> => ({
  name: nameOf(form),
  sortOrder: sortOrderOf(form.sortOrder),
  ...(orNull(form.code) === null ? {} : { code: form.code.trim() }),
  ...(orNull(form.description) === null ? {} : { description: form.description.trim() }),
});

/** What an edit of a unit changes — nothing else is sent. A category's shared fields alike. */
export const unitChanges = (
  form: CatalogForm,
  row: CatalogRow,
): Omit<UpdateAdministrationCatalogItem, 'version'> => {
  const name = nameOf(form);
  const code = orNull(form.code);
  const description = orNull(form.description);
  const sortOrder = sortOrderOf(form.sortOrder);
  return {
    ...(name.ar === row.name.ar && name.en === row.name.en ? {} : { name }),
    ...(code === row.code ? {} : { code }),
    ...(description === row.description ? {} : { description }),
    ...(sortOrder === row.sortOrder ? {} : { sortOrder }),
    ...(form.isActive === row.isActive ? {} : { isActive: form.isActive }),
  };
};

export const categoryCreateBody = (form: CatalogForm): CreateAdministrationItemCategory => ({
  ...unitCreateBody(form),
  ...(form.parentId === '' ? {} : { parentId: form.parentId }),
});

/** What an edit of a category changes — `parentId: null` moves a subcategory to the top level. */
export const categoryChanges = (
  form: CatalogForm,
  row: AdministrationItemCategoryDto,
): Omit<UpdateAdministrationItemCategory, 'version'> => {
  const parentId = form.parentId === '' ? null : form.parentId;
  return {
    ...unitChanges(form, row),
    ...(parentId === row.parentId ? {} : { parentId }),
  };
};
