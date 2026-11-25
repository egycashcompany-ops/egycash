// The item's form (design §2.3.4, OD-05 to OD-09): add an item to the catalog, or correct one —
// opened from the register and from the item's own page, never a route. Written after IT's
// `ConsumableFormDialog`, with the module's frame.
//
// NO CODE FIELD: the server takes «ITM-00001» inside the create (OD-05 A); the barcode is the one
// code typed here, as a scanner types it. NO QUANTITY either: an item carries no stock — stock moves
// only with a document (ADR-024). The Arabic name may carry a brand or a model in Latin letters
// («حبر HP 85A»), so it takes no Arabic-only rule; it is written right to left, the English name
// left to right.
//
// The category is filed where an item may be filed (OD-06 (i)): a subcategory, or a top-level
// category with no active subcategory — `CatalogSelect`'s `field` list. The three levels are whole
// numbers (OD-08) in the order min ≤ reorder point ≤ max where set (OD-09), marked on Save before a
// round trip; the server decides, and its refusals are worded on the field each names. Writes are
// held at organization scope on the server (OD-04 A).
import { useEffect, useState } from 'react';
import {
  ADMINISTRATION_STOCK_LEVEL_FIELDS,
  type AdministrationItemDto,
  type AdministrationStockLevelField,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItem, useUpdateItem } from '../api/catalog-queries';
import { DESCRIPTION_MAX, NAME_MAX } from '../lib/catalog-form';
import {
  BARCODE_MAX,
  NOTES_MAX,
  itemChanges,
  itemCreateBody,
  itemFormFrom,
  itemRequired,
  levelProblems,
  type ItemForm,
} from '../lib/item-form';
import { fieldRefusal, refusalFieldKeys, type RefusalField } from '../lib/refusals';
import { AdministrationDialogFrame } from './AdministrationDialogFrame';
import { CatalogSelect } from './CatalogSelect';

/** The level boxes' labels, in the contract's order. */
const LEVEL_LABEL: Record<AdministrationStockLevelField, string> = {
  minQty: 'administration.items.fields.minQty',
  reorderPointQty: 'administration.items.fields.reorderPointQty',
  maxQty: 'administration.items.fields.maxQty',
};

/** The item's category as the record names it — «الأحبار — حبر ليزر» under a parent. */
export const itemCategoryLabel = (
  item: AdministrationItemDto,
  locale: Locale,
): string | undefined => {
  if (item.categoryName === null) return undefined;
  const name = localized(item.categoryName, locale);
  return item.categoryParentName === null
    ? name
    : `${localized(item.categoryParentName, locale)} — ${name}`;
};

export const ItemFormDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new item. */
  item: AdministrationItemDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<ItemForm>(itemFormFrom(item));
  const [failure, setFailure] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(itemFormFrom(item));
    setFailure(null);
    setTried(false);
  }, [open, item]);
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const create = useCreateItem();
  const update = useUpdateItem();
  const filled = itemRequired(form);
  const required = useRequiredFields(
    [
      { key: 'nameAr', label: t('administration.items.fields.nameAr'), ok: filled.nameAr },
      { key: 'nameEn', label: t('administration.items.fields.nameEn'), ok: filled.nameEn },
      {
        key: 'categoryId',
        label: t('administration.items.fields.category'),
        ok: filled.categoryId,
      },
      { key: 'unitId', label: t('administration.items.fields.unit'), ok: filled.unitId },
    ],
    open,
  );
  const refused = refusalFieldKeys(failure);
  const refusedWord = (field: RefusalField): string | undefined => fieldRefusal(refused, field, t);
  // A level that is no whole number is said as it is typed; the order is marked once Save is
  // pressed, so a form half filled in is not accused of an order it has not finished yet.
  const levels = levelProblems(form);
  const levelWord = (field: AdministrationStockLevelField): string | undefined => {
    const problem = levels[field];
    if (problem === 'wholeNumber') return t('administration.items.errors.wholeNumber');
    if (problem === 'outOfOrder' && tried) return t('administration.refusals.levelsOutOfOrder');
    return fieldRefusal(refused, field, t);
  };

  const save = async (): Promise<void> => {
    setTried(true);
    if (Object.keys(levelProblems(form)).length > 0) return;
    setFailure(null);
    try {
      if (item === null) {
        await create.mutateAsync(itemCreateBody(form));
        toast.success(t('administration.items.created'));
      } else {
        await update.mutateAsync({
          id: item.id,
          body: { ...itemChanges(form, item), version: item.version },
        });
        toast.success(t('administration.items.updated'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
    }
  };

  const categoryCurrent = item !== null && form.categoryId === item.categoryId;
  const unitCurrent = item !== null && form.unitId === item.unitId;
  const currentCategoryLabel = categoryCurrent ? itemCategoryLabel(item, locale) : undefined;
  const currentUnitLabel =
    unitCurrent && item.unitName !== null ? localized(item.unitName, locale) : undefined;

  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={item === null ? t('administration.items.create') : t('administration.items.edit')}
      {...(item === null ? {} : { description: `${localized(item.name, locale)} — ${item.code}` })}
      required={required}
      onSave={save}
      busy={create.isPending || update.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('administration.items.fields.nameAr')}
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
          label={t('administration.items.fields.nameEn')}
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
          label={t('administration.items.fields.category')}
          required
          missing={required.isMissing('categoryId')}
          hint={t('administration.items.fields.categoryHint')}
          error={refusedWord('categoryId')}
        >
          <CatalogSelect
            kind="category"
            mode="field"
            value={form.categoryId}
            onChange={(id) => set('categoryId', id)}
            ariaLabel={t('administration.items.fields.category')}
            error={refused.categoryId !== undefined}
            {...(currentCategoryLabel === undefined ? {} : { currentLabel: currentCategoryLabel })}
          />
        </Field>
        <Field
          label={t('administration.items.fields.unit')}
          required
          missing={required.isMissing('unitId')}
          error={refusedWord('unitId')}
        >
          <CatalogSelect
            kind="unit"
            value={form.unitId}
            onChange={(id) => set('unitId', id)}
            ariaLabel={t('administration.items.fields.unit')}
            error={refused.unitId !== undefined}
            {...(currentUnitLabel === undefined ? {} : { currentLabel: currentUnitLabel })}
          />
        </Field>
        <Field
          label={t('administration.items.fields.barcode')}
          hint={t('administration.items.fields.barcodeHint')}
          error={refusedWord('barcode')}
        >
          <Input
            dir="ltr"
            value={form.barcode}
            maxLength={BARCODE_MAX}
            onChange={(e) => set('barcode', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {ADMINISTRATION_STOCK_LEVEL_FIELDS.map((field) => (
          <Field key={field} label={t(LEVEL_LABEL[field])} error={levelWord(field)}>
            <Input
              rule="integer"
              dir="ltr"
              value={form[field]}
              onChange={(e) => set(field, e.target.value)}
              error={levelWord(field) !== undefined}
              data-item-level={field}
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('administration.items.fields.levelsHint')}
      </p>
      <Field label={t('administration.items.fields.description')}>
        <Textarea
          rows={2}
          value={form.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <Field label={t('administration.items.fields.notes')}>
        <Textarea
          rows={2}
          value={form.notes}
          maxLength={NOTES_MAX}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>
      {item !== null && (
        <Checkbox
          label={t('administration.items.fields.isActive')}
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      )}
    </AdministrationDialogFrame>
  );
};
