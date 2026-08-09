// Create/edit an IT catalog row (design §2.4). Rows ARCHIVE, never delete (FR-11) — history and
// live assets point at them — so the edit mode offers an Active toggle and there is no delete
// action anywhere on this screen.
import { useEffect, useState } from 'react';
import { type ItCatalogItemDto, type ItCatalogKind } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItCatalogItem, useUpdateItCatalogItem } from '../api/it-queries';

interface FormState {
  nameAr: string;
  nameEn: string;
  code: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

const fromItem = (item: ItCatalogItemDto | null): FormState => ({
  nameAr: item?.name.ar ?? '',
  nameEn: item?.name.en ?? '',
  code: item?.code ?? '',
  description: item?.description ?? '',
  sortOrder: String(item?.sortOrder ?? 0),
  isActive: item?.isActive ?? true,
});

export const CatalogItemDialog = ({
  open,
  onClose,
  kind,
  item,
}: {
  open: boolean;
  onClose: () => void;
  kind: ItCatalogKind;
  /** null → create mode. */
  item: ItCatalogItemDto | null;
}): JSX.Element => {
  const t = useT();
  const [form, setForm] = useState<FormState>(fromItem(item));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(fromItem(item));
      setError(null);
    }
  }, [open, item]);

  const create = useCreateItCatalogItem();
  const update = useUpdateItCatalogItem();
  const busy = create.isPending || update.isPending;

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const complete = form.nameAr.trim() !== '' && form.nameEn.trim() !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    const text = (value: string): string | undefined =>
      value.trim() === '' ? undefined : value.trim();
    const sortOrder = Number(form.sortOrder);
    try {
      if (item === null) {
        await create.mutateAsync({
          kind,
          name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
          sortOrder: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0,
          ...(text(form.code) === undefined ? {} : { code: form.code.trim() }),
          ...(text(form.description) === undefined
            ? {}
            : { description: form.description.trim() }),
        });
        toast.success(t('it.catalogs.created'));
      } else {
        await update.mutateAsync({
          id: item.id,
          body: {
            name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
            code: form.code.trim() === '' ? null : form.code.trim(),
            description: form.description.trim() === '' ? null : form.description.trim(),
            sortOrder: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0,
            isActive: form.isActive,
            version: item.version,
          },
        });
        toast.success(t('it.catalogs.updated'));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item === null ? t('it.catalogs.addItem') : t('it.catalogs.editItem')}
      description={t(`it.catalogs.kind.${kind}`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('it.catalogs.fields.nameAr')} required>
          <Input value={form.nameAr} onChange={(e) => set('nameAr')(e.target.value)} dir="rtl" />
        </Field>
        <Field label={t('it.catalogs.fields.nameEn')} required>
          <Input value={form.nameEn} onChange={(e) => set('nameEn')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.catalogs.fields.code')}>
          <Input value={form.code} onChange={(e) => set('code')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.catalogs.fields.sortOrder')}>
          <Input
            type="number"
            min="0"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.catalogs.fields.description')}>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </Field>
        </div>
        {item !== null && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set('isActive')(e.target.checked)}
              label={t('it.catalogs.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.catalogs.archiveHint')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
