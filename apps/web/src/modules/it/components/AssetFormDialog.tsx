// Create/edit asset dialog (design §2.2, §4.1). One controlled form for both modes.
//
// Two things this form deliberately does NOT have, because the server owns them:
//   • `assetCode` — allocated by the sequence on create (FR-1) and never editable afterwards.
//   • `status`    — derived from operations (FR-2); no write schema even has the field.
// Everything else is shaped here and judged there: uniqueness, reference validity and scoping
// all come back as API errors, which the dialog surfaces rather than pre-guessing.
//
// `branchId` is create-only: the design makes it the data-scope anchor that "changes only via
// transfer" (§2.2), and transfer is IT-2 — so the edit form does not offer it.
//
// «المواصفات والمشتملات» are what the custody acknowledgment prints for the device (FR-18): a box
// per row of its specifications table, and the accessories one per line. Left empty, a row is
// left off the paper.
//
// A NEW asset starts from the last one of the category picked for it — «لو عندي 20 جهاز بنفس
// المواصفات … هفضل أكتب نفس المواصفات !؟ أكيد لأ» — every empty box but the per-unit ones (serial,
// printed tag, location, notes); see `lib/asset-form.ts`.
import { useEffect, useState } from 'react';
import { type ItAssetDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { ItCatalogSelect } from './ItCatalogSelect';
import { VendorPicker } from './VendorPicker';
import { useCreateItAsset, useItBranchOptions, useUpdateItAsset } from '../api/it-queries';
import * as api from '../api/it-api';
import { SPEC_FIELDS, fromLines, specsInput, type SpecsDraft } from '../lib/asset-specs';
import {
  assetFormFrom,
  prefillFrom,
  type AssetFormState as FormState,
  type AssetTextKey as TextKey,
} from '../lib/asset-form';

export const AssetFormDialog = ({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  asset: ItAssetDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<FormState>(assetFormFrom(asset));
  const [error, setError] = useState<string | null>(null);
  // The asset a new one was filled from, and what it filled — so a second category swaps it out.
  const [template, setTemplate] = useState<{ code: string; form: FormState } | null>(null);
  useEffect(() => {
    if (open) {
      setForm(assetFormFrom(asset));
      setError(null);
      setTemplate(null);
    }
  }, [open, asset]);

  const branches = useItBranchOptions();
  const create = useCreateItAsset();
  const update = useUpdateItAsset();
  const busy = create.isPending || update.isPending;

  const set = (key: TextKey) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const setSpec = (key: keyof SpecsDraft) => (value: string) =>
    setForm((prev) => ({ ...prev, specs: { ...prev.specs, [key]: value } }));

  /**
   * Picking a category for a NEW asset fills it from the last one registered in that category. A
   * convenience, never a gate: no earlier asset, or a read that fails, leaves the form as it was.
   */
  const pickCategory = async (categoryId: string): Promise<void> => {
    set('categoryId')(categoryId);
    if (asset !== null || categoryId === '') return;
    try {
      const page = await api.listAssets({
        categoryId,
        sortBy: 'createdAt',
        sortDir: 'desc',
        page: 1,
        pageSize: 1,
      });
      const [last] = page.items;
      if (last === undefined) return;
      const filled = assetFormFrom(last);
      // Only if the category is still the one picked — a quicker second pick wins.
      setForm((current) =>
        current.categoryId === categoryId
          ? prefillFrom(current, filled, template?.form ?? null)
          : current,
      );
      setTemplate({ code: last.assetCode, form: filled });
    } catch {
      // Typing the device in by hand is still possible; nothing to report.
    }
  };

  const complete =
    form.name.trim() !== '' && form.categoryId !== '' && (asset !== null || form.branchId !== '');

  // A warranty is a pair: both ends or neither. Caught here so the user sees it on the field
  // rather than as a validation error from the server after a round trip.
  const warrantyHalf =
    (form.warrantyStart === '') !== (form.warrantyEnd === '') ? t('it.assets.warrantyPair') : null;
  const warrantyOrder =
    form.warrantyStart !== '' && form.warrantyEnd !== '' && form.warrantyEnd < form.warrantyStart
      ? t('it.assets.warrantyOrder')
      : null;
  const fieldError = warrantyHalf ?? warrantyOrder;

  const submit = async (): Promise<void> => {
    if (fieldError !== null) return;
    setError(null);
    const text = (value: string): string | undefined =>
      value.trim() === '' ? undefined : value.trim();
    const purchaseSet =
      form.purchaseDate !== '' ||
      form.purchaseCost.trim() !== '' ||
      form.purchaseVendorId !== '' ||
      form.invoiceRef.trim() !== '';
    const purchase = purchaseSet
      ? {
          ...(form.purchaseDate === '' ? {} : { date: new Date(form.purchaseDate) }),
          ...(form.purchaseCost.trim() === '' ? {} : { cost: Number(form.purchaseCost) }),
          ...(form.purchaseVendorId === '' ? {} : { vendorId: form.purchaseVendorId }),
          ...(text(form.invoiceRef) === undefined ? {} : { invoiceRef: form.invoiceRef.trim() }),
        }
      : undefined;
    const warranty =
      form.warrantyStart !== '' && form.warrantyEnd !== ''
        ? {
            start: new Date(form.warrantyStart),
            end: new Date(form.warrantyEnd),
            ...(form.warrantyVendorId === '' ? {} : { vendorId: form.warrantyVendorId }),
            ...(text(form.warrantyTerms) === undefined
              ? {}
              : { terms: form.warrantyTerms.trim() }),
          }
        : undefined;
    const specs = specsInput(form.specs);
    const accessories = fromLines(form.accessories);

    try {
      if (asset === null) {
        await create.mutateAsync({
          name: form.name.trim(),
          categoryId: form.categoryId,
          branchId: form.branchId,
          ...(text(form.description) === undefined ? {} : { description: form.description.trim() }),
          ...(text(form.serialNumber) === undefined
            ? {}
            : { serialNumber: form.serialNumber.trim() }),
          ...(text(form.model) === undefined ? {} : { model: form.model.trim() }),
          ...(text(form.manufacturer) === undefined
            ? {}
            : { manufacturer: form.manufacturer.trim() }),
          ...(text(form.externalTag) === undefined ? {} : { externalTag: form.externalTag.trim() }),
          ...(text(form.location) === undefined ? {} : { location: form.location.trim() }),
          ...(purchase === undefined ? {} : { purchase }),
          ...(warranty === undefined ? {} : { warranty }),
          ...(text(form.notes) === undefined ? {} : { notes: form.notes.trim() }),
          ...(specs === undefined ? {} : { specs }),
          ...(accessories.length === 0 ? {} : { accessories }),
        });
        toast.success(t('it.assets.created'));
      } else {
        // On edit, an emptied optional field is an ERASED fact — it submits as null, not as
        // "untouched". `branchId` is absent by design (see the header note).
        const nullable = (value: string): string | null =>
          value.trim() === '' ? null : value.trim();
        await update.mutateAsync({
          id: asset.id,
          body: {
            name: form.name.trim(),
            categoryId: form.categoryId,
            description: nullable(form.description),
            serialNumber: nullable(form.serialNumber),
            model: nullable(form.model),
            manufacturer: nullable(form.manufacturer),
            externalTag: nullable(form.externalTag),
            location: nullable(form.location),
            purchase: purchase ?? null,
            warranty: warranty ?? null,
            notes: nullable(form.notes),
            // The whole table and the whole list, as the form shows them: emptied is erased.
            specs: specs ?? null,
            accessories,
            version: asset.version,
          },
        });
        toast.success(t('it.assets.updated'));
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
      size="lg"
      title={asset === null ? t('it.assets.create') : t('it.assets.edit')}
      description={asset === null ? t('it.assets.codeAllocated') : asset.assetCode}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={!complete || fieldError !== null}
            onClick={() => void submit()}
          >
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
        <Field label={t('it.assets.fields.name')} required>
          <Input value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label={t('it.assets.fields.category')} required>
          <ItCatalogSelect
            kind="assetCategory"
            value={form.categoryId}
            onChange={(categoryId) => void pickCategory(categoryId)}
            className="w-full"
            ariaLabel={t('it.assets.fields.category')}
          />
        </Field>
        {asset === null && template !== null && (
          <p
            role="note"
            className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 sm:col-span-2 dark:bg-sky-950/40 dark:text-sky-200"
          >
            {t('it.assets.prefilledFrom', { code: template.code })}
          </p>
        )}
        <Field label={t('it.assets.fields.serialNumber')} hint={t('it.assets.serialHint')}>
          <Input
            value={form.serialNumber}
            onChange={(e) => set('serialNumber')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.assets.fields.externalTag')} hint={t('it.assets.externalTagHint')}>
          <Input
            value={form.externalTag}
            onChange={(e) => set('externalTag')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.assets.fields.manufacturer')}>
          <Input
            value={form.manufacturer}
            onChange={(e) => set('manufacturer')(e.target.value)}
          />
        </Field>
        <Field label={t('it.assets.fields.model')}>
          <Input value={form.model} onChange={(e) => set('model')(e.target.value)} />
        </Field>
        {asset === null ? (
          <Field label={t('it.assets.fields.branch')} required>
            <Select value={form.branchId} onChange={(e) => set('branchId')(e.target.value)}>
              <option value="">{t('common.select')}</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('it.assets.fields.branch')} hint={t('it.assets.branchLocked')}>
            <Input
              value={
                localized(
                  (branches.data ?? []).find((b) => b.id === asset.branchId)?.name ?? {
                    ar: '',
                    en: '',
                  },
                  locale,
                ) || '—'
              }
              readOnly
              disabled
            />
          </Field>
        )}
        <Field label={t('it.assets.fields.location')}>
          <Input value={form.location} onChange={(e) => set('location')(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.assets.fields.description')}>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <fieldset className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <legend className="sr-only">{t('it.assets.sections.purchase')}</legend>
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('it.assets.sections.purchase')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('it.assets.fields.purchaseDate')}>
            <Input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set('purchaseDate')(e.target.value)}
            />
          </Field>
          <Field label={t('it.assets.fields.purchaseCost')}>
            <MoneyInput value={form.purchaseCost} onChange={set('purchaseCost')} />
          </Field>
          <Field label={t('it.assets.fields.invoiceRef')}>
            <Input
              value={form.invoiceRef}
              onChange={(e) => set('invoiceRef')(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('it.assets.fields.purchaseVendor')}>
            <VendorPicker
              value={form.purchaseVendorId}
              onChange={set('purchaseVendorId')}
              ariaLabel={t('it.assets.fields.purchaseVendor')}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <legend className="sr-only">{t('it.assets.sections.warranty')}</legend>
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('it.assets.sections.warranty')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('it.assets.fields.warrantyStart')} error={warrantyHalf ?? undefined}>
            <Input
              type="date"
              value={form.warrantyStart}
              onChange={(e) => set('warrantyStart')(e.target.value)}
            />
          </Field>
          <Field
            label={t('it.assets.fields.warrantyEnd')}
            error={(warrantyHalf ?? warrantyOrder) ?? undefined}
          >
            <Input
              type="date"
              value={form.warrantyEnd}
              onChange={(e) => set('warrantyEnd')(e.target.value)}
            />
          </Field>
          <Field label={t('it.assets.fields.warrantyVendor')}>
            <VendorPicker
              value={form.warrantyVendorId}
              onChange={set('warrantyVendorId')}
              ariaLabel={t('it.assets.fields.warrantyVendor')}
            />
          </Field>
          <Field label={t('it.assets.fields.warrantyTerms')}>
            <Input
              value={form.warrantyTerms}
              onChange={(e) => set('warrantyTerms')(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <legend className="sr-only">{t('it.assets.sections.specs')}</legend>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('it.assets.sections.specs')}
        </h3>
        <p className="mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t('it.assets.specsHint')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SPEC_FIELDS.map(({ key, label }) => (
            <Field key={key} label={t(label)}>
              <Input
                value={form.specs[key]}
                onChange={(e) => setSpec(key)(e.target.value)}
                maxLength={200}
                dir="auto"
              />
            </Field>
          ))}
          <Field label={t('it.assets.specs.networkAdapters')} hint={t('it.assets.onePerLine')}>
            <Textarea
              rows={2}
              value={form.specs.networkAdapters}
              onChange={(e) => setSpec('networkAdapters')(e.target.value)}
              dir="auto"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('it.assets.fields.accessories')} hint={t('it.assets.accessoriesHint')}>
              <Textarea
                rows={3}
                value={form.accessories}
                onChange={(e) => set('accessories')(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <legend className="sr-only">{t('it.assets.fields.notes')}</legend>
        <Field label={t('it.assets.fields.notes')}>
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
};
