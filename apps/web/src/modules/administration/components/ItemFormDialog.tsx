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
// round trip; the server decides, and its refusals are worded on the field each names. A barcode
// with a space inside is marked the same way — the contract refuses one, and its refusal names no
// box. Writes are held at organization scope on the server (OD-04 A).
//
// A save refused because someone saved the item meanwhile (`STALE_DOCUMENT`) rebases the form on
// the item as it now is: the refusal stays in the alert box, the boxes show what was saved, and the
// next Save is judged against that version rather than refused again.
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
import { useCreateItem, useRereadItem, useUpdateItem } from '../api/catalog-queries';
import { DESCRIPTION_MAX, NAME_MAX } from '../lib/catalog-form';
import {
  BARCODE_MAX,
  NOTES_MAX,
  barcodeOk,
  itemChanges,
  itemCreateBody,
  itemFormFrom,
  itemRequired,
  levelProblems,
  type ItemForm,
} from '../lib/item-form';
import {
  carryEdits,
  fieldRefusal,
  isStaleRefusal,
  refusalFieldKeys,
  type RefusalField,
} from '../lib/refusals';
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
  // The item as a stale save re-read it, kept only while the form edits that same item; else the
  // one the form opened with.
  const [rebased, setRebased] = useState<AdministrationItemDto | null>(null);
  const base = item !== null && rebased?.id === item.id ? rebased : item;
  const [form, setForm] = useState<ItemForm>(itemFormFrom(item));
  const [failure, setFailure] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRebased(null);
    setForm(itemFormFrom(item));
    setFailure(null);
    setTried(false);
  }, [open, item]);
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const create = useCreateItem();
  const update = useUpdateItem();
  const rereadItem = useRereadItem();
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
  // A level that is no whole number is said as it is typed; the order and a barcode with a space
  // are marked once Save is pressed — also while other values are missing, so one press names
  // everything that stops the save — and a form half filled in is not accused before then.
  const pressed = tried || required.attempt > 0;
  const levels = levelProblems(form);
  const levelWord = (field: AdministrationStockLevelField): string | undefined => {
    const problem = levels[field];
    if (problem === 'wholeNumber') return t('administration.items.errors.wholeNumber');
    if (problem === 'outOfOrder' && pressed) return t('administration.refusals.levelsOutOfOrder');
    return fieldRefusal(refused, field, t);
  };
  const barcodeWrong = pressed && !barcodeOk(form.barcode);

  const save = async (): Promise<void> => {
    setTried(true);
    if (Object.keys(levelProblems(form)).length > 0 || !barcodeOk(form.barcode)) return;
    setFailure(null);
    try {
      if (base === null) {
        await create.mutateAsync(itemCreateBody(form));
        toast.success(t('administration.items.created'));
      } else {
        await update.mutateAsync({
          id: base.id,
          body: { ...itemChanges(form, base), version: base.version },
        });
        toast.success(t('administration.items.updated'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (base !== null && isStaleRefusal(error)) {
        const fresh = await rereadItem(base.id).catch(() => null);
        if (fresh !== null) {
          setRebased(fresh);
          setForm(carryEdits(itemFormFrom(base), form, itemFormFrom(fresh)));
        }
      }
    }
  };

  const categoryCurrent = base !== null && form.categoryId === base.categoryId;
  const unitCurrent = base !== null && form.unitId === base.unitId;
  const currentCategoryLabel = categoryCurrent ? itemCategoryLabel(base, locale) : undefined;
  const currentUnitLabel =
    unitCurrent && base.unitName !== null ? localized(base.unitName, locale) : undefined;

  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={base === null ? t('administration.items.create') : t('administration.items.edit')}
      {...(base === null ? {} : { description: `${localized(base.name, locale)} — ${base.code}` })}
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
          error={
            barcodeWrong ? t('administration.items.errors.barcodeSpaces') : refusedWord('barcode')
          }
        >
          <Input
            dir="ltr"
            value={form.barcode}
            maxLength={BARCODE_MAX}
            onChange={(e) => set('barcode', e.target.value)}
            error={barcodeWrong || refused.barcode !== undefined}
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
      {base !== null && (
        <Checkbox
          label={t('administration.items.fields.isActive')}
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      )}
    </AdministrationDialogFrame>
  );
};
