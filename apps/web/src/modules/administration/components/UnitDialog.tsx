// A unit of measure (design §2.3.2, OD-07): add one, or correct one — written after Fleet's
// `CatalogItemDialog`. A unit retires through its Active box and is never deleted: items name it,
// and a retired unit keeps its name and code, so it is brought back rather than typed again (§5.3).
//
// The two names are two boxes, the Arabic right to left and the English left to right; the code is
// a symbol («pcs», «kg»), left to right. The sort order is a whole number, digits only. Writes are
// held at organization scope on the server (OD-04 A): a holder below it meets the refusal in the
// alert box, in the reader's language. A save refused because someone saved the unit meanwhile
// (`STALE_DOCUMENT`) rebases the form on the unit as it now is, so the next Save can be taken.
import { useEffect, useState } from 'react';
import { type AdministrationCatalogItemDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateUnit, useRereadUnit, useUpdateUnit } from '../api/catalog-queries';
import {
  CATALOG_CODE_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  catalogFormFrom,
  catalogRequired,
  sortOrderOf,
  unitChanges,
  unitCreateBody,
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

export const UnitDialog = ({
  open,
  onClose,
  unit,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new unit. */
  unit: AdministrationCatalogItemDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The unit as a stale save re-read it, kept only while the form edits that same unit.
  const [rebased, setRebased] = useState<AdministrationCatalogItemDto | null>(null);
  const base = unit !== null && rebased?.id === unit.id ? rebased : unit;
  const [form, setForm] = useState<CatalogForm>(catalogFormFrom(unit));
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    setRebased(null);
    setForm(catalogFormFrom(unit));
    setFailure(null);
  }, [open, unit]);
  const set = <K extends keyof CatalogForm>(key: K, value: CatalogForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const create = useCreateUnit();
  const update = useUpdateUnit();
  const rereadUnit = useRereadUnit();
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
        await create.mutateAsync(unitCreateBody(form));
        toast.success(t('administration.catalogs.unit.created'));
      } else {
        await update.mutateAsync({
          id: base.id,
          body: { ...unitChanges(form, base), version: base.version },
        });
        toast.success(t('administration.catalogs.unit.updated'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (base !== null && isStaleRefusal(error)) {
        const fresh = await rereadUnit(base.id).catch(() => null);
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
          ? t('administration.catalogs.unit.add')
          : t('administration.catalogs.unit.edit')
      }
      description={t('administration.catalogs.retireHint')}
      required={required}
      onSave={save}
      busy={create.isPending || update.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
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
          label={t('administration.catalogs.fields.code')}
          hint={t('administration.catalogs.unit.codeHint')}
          error={refusedWord('code')}
        >
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
