// An item category (design §2.3.3, OD-06 A): add one, or correct one — the unit dialog's fields,
// written after Fleet's `CatalogItemDialog`, plus the parent. Two levels: a parent is picked from the
// active top-level categories, and none is a top-level category itself. A category retires through
// its Active box and is never deleted (§5.3).
//
// What the server refuses of a parent — the category itself, one of its own subcategories, a
// subcategory, a retired one, or a move of a category that has subcategories
// (`ADMINISTRATION_CATEGORY_PARENT_INVALID`) — is said in the alert box and, in its own words,
// under the parent's box. The category itself is never offered as its own parent. A save refused
// because someone saved the category meanwhile (`STALE_DOCUMENT`) rebases the form on the category
// as it now is, so the next Save can be taken.
import { useEffect, useMemo, useState } from 'react';
import { type AdministrationItemCategoryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { SearchableSelect, type SearchableOption } from '../../../shared/ui/SearchableSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateCategory,
  useRereadCategory,
  useUpdateCategory,
  useWholeCategories,
} from '../api/catalog-queries';
import {
  CATALOG_CODE_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  catalogFormFrom,
  catalogRequired,
  categoryChanges,
  categoryCreateBody,
  sortOrderOf,
  type CatalogForm,
} from '../lib/catalog-form';
import {
  carryEdits,
  fieldRefusal,
  isStaleRefusal,
  refusalFieldKeys,
  type RefusalField,
} from '../lib/refusals';
import { AdministrationDialogFrame } from './AdministrationDialogFrame';

/**
 * The parents a category may take: the active top-level categories, never itself — and the parent
 * it already names, whatever that has become, so an edit never drops it.
 */
export const parentOptions = (
  categories: readonly AdministrationItemCategoryDto[],
  self: string | null,
  current: string,
  locale: Locale,
): SearchableOption[] =>
  categories
    .filter(
      (category) =>
        category.parentId === null &&
        category.id !== self &&
        (category.isActive || category.id === current),
    )
    .map((category) => ({ value: category.id, label: localized(category.name, locale) }));

export const ItemCategoryDialog = ({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new category. */
  category: AdministrationItemCategoryDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The category as a stale save re-read it, kept only while the form edits that same category.
  const [rebased, setRebased] = useState<AdministrationItemCategoryDto | null>(null);
  const base = category !== null && rebased?.id === category.id ? rebased : category;
  const [form, setForm] = useState<CatalogForm>(catalogFormFrom(category));
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    setRebased(null);
    setForm(catalogFormFrom(category));
    setFailure(null);
  }, [open, category]);
  const set = <K extends keyof CatalogForm>(key: K, value: CatalogForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const categories = useWholeCategories(open);
  const parents = useMemo(
    () => parentOptions(categories.data ?? [], base?.id ?? null, form.parentId, locale),
    [categories.data, base, form.parentId, locale],
  );

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const rereadCategory = useRereadCategory();
  const filled = catalogRequired(form);
  const sortOrderWrong = Number.isNaN(sortOrderOf(form.sortOrder));
  const required = useRequiredFields(
    [
      { key: 'nameAr', label: t('administration.catalogs.fields.nameAr'), ok: filled.nameAr },
      { key: 'nameEn', label: t('administration.catalogs.fields.nameEn'), ok: filled.nameEn },
    ],
    open,
  );
  const refused = refusalFieldKeys(failure);
  const refusedWord = (field: RefusalField): string | undefined => fieldRefusal(refused, field, t);

  const save = async (): Promise<void> => {
    if (sortOrderWrong) return;
    setFailure(null);
    try {
      if (base === null) {
        await create.mutateAsync(categoryCreateBody(form));
        toast.success(t('administration.catalogs.category.created'));
      } else {
        await update.mutateAsync({
          id: base.id,
          body: { ...categoryChanges(form, base), version: base.version },
        });
        toast.success(t('administration.catalogs.category.updated'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (base !== null && isStaleRefusal(error)) {
        const fresh = await rereadCategory(base.id).catch(() => null);
        if (fresh !== null) {
          setRebased(fresh);
          setForm(carryEdits(catalogFormFrom(base), form, catalogFormFrom(fresh)));
        }
      }
    }
  };

  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      title={
        base === null
          ? t('administration.catalogs.category.add')
          : t('administration.catalogs.category.edit')
      }
      description={t('administration.catalogs.retireHint')}
      required={required}
      onSave={save}
      busy={create.isPending || update.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
      tall
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('administration.catalogs.fields.nameAr')}
          required
          missing={required.isMissing('nameAr')}
          error={refusedWord('nameAr')}
        >
          <Input
            dir="rtl"
            value={form.nameAr}
            maxLength={NAME_MAX}
            onChange={(e) => set('nameAr', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.catalogs.fields.nameEn')}
          required
          missing={required.isMissing('nameEn')}
        >
          <Input
            dir="ltr"
            value={form.nameEn}
            maxLength={NAME_MAX}
            onChange={(e) => set('nameEn', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.catalogs.fields.parent')}
          hint={t('administration.catalogs.category.parentHint')}
          error={refusedWord('parentId')}
        >
          <SearchableSelect
            value={form.parentId}
            onChange={(id) => set('parentId', id)}
            options={parents}
            loading={categories.isPending}
            error={refused.parentId !== undefined}
            placeholder={t('administration.catalogs.category.noParent')}
            ariaLabel={t('administration.catalogs.fields.parent')}
            testId="administration-parent"
          />
        </Field>
        <Field label={t('administration.catalogs.fields.code')} error={refusedWord('code')}>
          <Input
            dir="ltr"
            value={form.code}
            maxLength={CATALOG_CODE_MAX}
            onChange={(e) => set('code', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.catalogs.fields.sortOrder')}
          hint={t('administration.catalogs.sortOrderHint')}
          error={sortOrderWrong ? t('administration.catalogs.errors.wholeNumber') : undefined}
        >
          <Input
            rule="integer"
            dir="ltr"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('administration.catalogs.fields.description')}>
        <Textarea
          rows={2}
          value={form.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      {base !== null && (
        <Checkbox
          label={t('administration.catalogs.fields.isActive')}
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      )}
    </AdministrationDialogFrame>
  );
};
