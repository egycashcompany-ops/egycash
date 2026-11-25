// The supplier's form (design §2.3.6, OD-11 A, OD-12 A): add a supplier to the register, or correct
// one — opened from the register and from the supplier's own page, never a route. Written after the
// module's item form, with its frame; the contact people are rows inside it, as IT's vendor form
// writes them (`VendorFormDialog.tsx`): reality bounds the list (at most 20).
//
// NO CODE FIELD: the server takes «SUP-00001» inside the create (OD-05 A). No papers: they are filed
// on the record, each with its file. No VAT status until OD-29 gives its values. No bank data.
//
// A TAX NUMBER ANOTHER SUPPLIER HOLDS IS A WARNING, NEVER A BLOCK (OD-11 (i)): a supplier's branches
// may be separate records. The edit opened from the record says so beside the box while the number
// is the one the record holds; any save whose answer names other holders says so as it closes, and
// the record keeps saying it. Writes are held at organization scope on the server (OD-04 A).
//
// A SAVE REFUSED FOR A MOVED VERSION OVERWRITES NOTHING (Fleet's custody papers rule): the form
// reads the supplier afresh and shows it as it now is, the change typed over the old one dropped,
// and says so — the next Save then carries the version the record holds, instead of meeting the
// same refusal until the dialog is closed.
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ErrorCodes,
  type AdministrationItemCategoryDto,
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber, localized } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { supplierKey } from '../api/administration-keys';
import { useWholeCategories } from '../api/catalog-queries';
import { getSupplier } from '../api/suppliers-api';
import { useCreateSupplier, useUpdateSupplier } from '../api/suppliers-queries';
import { NAME_MAX } from '../lib/catalog-form';
import { carryEdits, fieldRefusal, refusalFieldKeys, type RefusalField } from '../lib/refusals';
import {
  ADDRESS_MAX,
  CONTACT_NAME_MAX,
  CONTACT_ROLE_MAX,
  EMAIL_MAX,
  EMPTY_CONTACT,
  MAX_CONTACTS,
  PAYMENT_TERMS_MAX,
  PHONE_MAX,
  REGISTRY_NUMBER_MAX,
  SUPPLIER_NOTES_MAX,
  emailProblems,
  hasEmailProblem,
  supplierChanges,
  supplierCreateBody,
  supplierFormFrom,
  supplierRequired,
  taxNumberHolders,
  type SupplierContactRow,
  type SupplierForm,
} from '../lib/supplier-form';
import { AdministrationDialogFrame } from './AdministrationDialogFrame';
import { categoryLabel, categoryOptions } from './CatalogSelect';

/**
 * The categories a supplier may name: both levels, each parent followed by its subcategories (an
 * RFQ matches either, P3), the active ones — and every one already picked, whatever it has become,
 * so a category that retired after it was named never silently drops off the record (IT's
 * `ItCatalogSelect` rule).
 */
export const supplierCategoryOptions = (
  categories: readonly AdministrationItemCategoryDto[],
  picked: readonly string[],
  named: AdministrationSupplierDto['categories'],
  locale: Locale,
): MultiSelectOption[] => {
  const options: MultiSelectOption[] = categoryOptions(categories, 'filter', '', locale);
  const offered = new Set(options.map((option) => option.value));
  const kept: MultiSelectOption[] = [];
  for (const id of picked) {
    if (offered.has(id)) continue;
    const known = categories.find((category) => category.id === id);
    const name = named.find((category) => category.id === id)?.name ?? null;
    const label =
      known !== undefined
        ? categoryLabel(known, locale)
        : name === null
          ? id
          : localized(name, locale);
    kept.push({ value: id, label });
  }
  return [...kept, ...options];
};

/** The other holders of a tax number, as one line: «SUP-00002 — مورد ما، SUP-00003 — …». */
const holdersLine = (
  holders: AdministrationSupplierDetailDto['taxNumberMatches'],
  locale: Locale,
  retired: string,
): string =>
  holders
    .map(
      (holder) =>
        `${holder.code} — ${localized(holder.name, locale)}${holder.isActive ? '' : ` (${retired})`}`,
    )
    .join(locale === 'ar' ? '، ' : ', ');

export const SupplierFormDialog = ({
  open,
  onClose,
  supplier,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new supplier. The record's own page hands its detail, with its warning. */
  supplier: AdministrationSupplierDto | AdministrationSupplierDetailDto | null;
}): JSX.Element => {
  const t = useT();
  const qc = useQueryClient();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The supplier the form was seeded from: the one opened, or — after a save refused for a moved
  // version — the record as it now is. Every edit is measured against it and carries its version.
  const [base, setBase] = useState(supplier);
  const [form, setForm] = useState<SupplierForm>(supplierFormFrom(supplier));
  const [failure, setFailure] = useState<unknown>(null);
  const [reread, setReread] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBase(supplier);
    setForm(supplierFormFrom(supplier));
    setFailure(null);
    setReread(false);
    setTried(false);
  }, [open, supplier]);
  const set = <K extends keyof SupplierForm>(key: K, value: SupplierForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const setContact = (index: number, key: keyof SupplierContactRow, value: string): void =>
    setForm((prev) => ({
      ...prev,
      contacts: prev.contacts.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const categories = useWholeCategories(open);
  const categoryChoices = useMemo(
    () =>
      supplierCategoryOptions(
        categories.data ?? [],
        form.categoryIds,
        base?.categories ?? [],
        locale,
      ),
    [categories.data, form.categoryIds, base, locale],
  );

  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const filled = supplierRequired(form);
  const required = useRequiredFields(
    [
      { key: 'nameAr', label: t('administration.suppliers.fields.nameAr'), ok: filled.nameAr },
      { key: 'nameEn', label: t('administration.suppliers.fields.nameEn'), ok: filled.nameEn },
      ...filled.contacts.map((ok, i) => ({
        key: `contact-${String(i)}`,
        label: t('administration.suppliers.fields.contactNameOf', {
          n: formatNumber(i + 1, locale),
        }),
        ok,
      })),
    ],
    open,
  );
  const refused = refusalFieldKeys(failure);
  const refusedWord = (field: RefusalField): string | undefined => fieldRefusal(refused, field, t);
  // A box holding no e-mail address is marked once Save is pressed, as the server would refuse it.
  const emails = emailProblems(form);
  const emailWord = (wrong: boolean | undefined): string | undefined =>
    tried && wrong === true ? t('administration.suppliers.errors.email') : undefined;
  const holders = taxNumberHolders(form, base);

  /**
   * Saved elsewhere meanwhile: read the supplier afresh and lay the reader's own changes over it, as
   * the module's other dialogs do (`carryEdits`) — a box they did not touch shows the other save.
   */
  const rereadAfterStale = async (
    opened: AdministrationSupplierDto | AdministrationSupplierDetailDto,
    typed: SupplierForm,
  ): Promise<void> => {
    const fresh = await qc
      .fetchQuery({
        queryKey: supplierKey(opened.id),
        queryFn: () => getSupplier(opened.id),
        staleTime: 0,
      })
      .catch(() => null);
    if (fresh === null) return;
    setBase(fresh);
    setForm(carryEdits(supplierFormFrom(opened), typed, supplierFormFrom(fresh)));
    setReread(true);
  };

  const save = async (): Promise<void> => {
    setTried(true);
    if (hasEmailProblem(form)) return;
    setFailure(null);
    setReread(false);
    try {
      const saved =
        base === null
          ? await create.mutateAsync(supplierCreateBody(form))
          : await update.mutateAsync({
              id: base.id,
              body: { ...supplierChanges(form, base), version: base.version },
            });
      toast.success(
        t(base === null ? 'administration.suppliers.created' : 'administration.suppliers.updated'),
      );
      // Saved all the same: the warning names who else holds the number (OD-11 (i)).
      if (saved.taxNumberMatches.length > 0) {
        toast.warning(
          t('administration.suppliers.taxNumberShared.title'),
          holdersLine(saved.taxNumberMatches, locale, t('administration.status.inactive')),
        );
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (base !== null && error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {
        await rereadAfterStale(base, form);
      }
    }
  };

  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={
        base === null ? t('administration.suppliers.create') : t('administration.suppliers.edit')
      }
      {...(base === null ? {} : { description: `${localized(base.name, locale)} — ${base.code}` })}
      required={required}
      onSave={save}
      busy={create.isPending || update.isPending}
      error={
        failure === null
          ? null
          : reread
            ? t('administration.suppliers.errors.stale')
            : errorMessage(failure, locale)
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t('administration.suppliers.fields.nameAr')}
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
          label={t('administration.suppliers.fields.nameEn')}
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
        <Field label={t('administration.suppliers.fields.phone')}>
          <Input
            dir="ltr"
            value={form.phone}
            maxLength={PHONE_MAX}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label={t('administration.suppliers.fields.email')} error={emailWord(emails.email)}>
          <Input
            type="email"
            dir="ltr"
            value={form.email}
            maxLength={EMAIL_MAX}
            error={emailWord(emails.email) !== undefined}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <Field className="sm:col-span-2" label={t('administration.suppliers.fields.address')}>
          <Input
            value={form.address}
            maxLength={ADDRESS_MAX}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.suppliers.fields.taxNumber')}
          hint={t('administration.suppliers.fields.taxNumberHint')}
          {...(holders.length === 0
            ? {}
            : {
                warning: `${t('administration.suppliers.taxNumberShared.title')}: ${holdersLine(
                  holders,
                  locale,
                  t('administration.status.inactive'),
                )}`,
              })}
        >
          <Input
            dir="ltr"
            value={form.taxNumber}
            maxLength={REGISTRY_NUMBER_MAX}
            onChange={(e) => set('taxNumber', e.target.value)}
            data-supplier-tax-number=""
          />
        </Field>
        <Field label={t('administration.suppliers.fields.commercialRegistry')}>
          <Input
            dir="ltr"
            value={form.commercialRegistry}
            maxLength={REGISTRY_NUMBER_MAX}
            onChange={(e) => set('commercialRegistry', e.target.value)}
          />
        </Field>
        <Field
          className="sm:col-span-2"
          label={t('administration.suppliers.fields.categories')}
          hint={t('administration.suppliers.fields.categoriesHint')}
          error={refusedWord('categoryIds')}
        >
          <MultiSelect
            clearable
            showSelectedValues
            // Every pick named in the box, and the list as wide as the box (Fleet's form select):
            // a category's name and its parent's read on one line.
            summaryMax={Math.max(form.categoryIds.length, 1)}
            panelWidth="w-full"
            fullWidth
            className="w-full"
            label={t('administration.suppliers.fields.categories')}
            placeholder={t('common.select')}
            options={categoryChoices}
            value={form.categoryIds}
            onChange={(next) => set('categoryIds', next)}
          />
        </Field>
        <Field className="sm:col-span-2" label={t('administration.suppliers.fields.paymentTerms')}>
          <Textarea
            rows={2}
            value={form.paymentTerms}
            maxLength={PAYMENT_TERMS_MAX}
            onChange={(e) => set('paymentTerms', e.target.value)}
          />
        </Field>
        <Field className="sm:col-span-2" label={t('administration.suppliers.fields.notes')}>
          <Textarea
            rows={2}
            value={form.notes}
            maxLength={SUPPLIER_NOTES_MAX}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
        {base !== null && (
          <div className="sm:col-span-2">
            <Checkbox
              label={t('administration.suppliers.fields.isActive')}
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
          </div>
        )}
      </div>

      <fieldset className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('administration.suppliers.contacts.title')}
          </h3>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            disabled={form.contacts.length >= MAX_CONTACTS}
            onClick={() => set('contacts', [...form.contacts, { ...EMPTY_CONTACT }])}
          >
            {t('administration.suppliers.contacts.add')}
          </Button>
        </div>
        {form.contacts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('administration.suppliers.contacts.none')}
          </p>
        ) : (
          <ul className="space-y-3">
            {form.contacts.map((row, index) => (
              // The index IS the identity: embedded rows have no id, and the list is only ever
              // appended to or spliced, never reordered (IT's vendor form).
              <li
                key={index}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                data-supplier-contact={index}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label={t('administration.suppliers.contacts.name')}
                    required
                    missing={required.isMissing(`contact-${String(index)}`)}
                  >
                    <Input
                      value={row.name}
                      maxLength={CONTACT_NAME_MAX}
                      onChange={(e) => setContact(index, 'name', e.target.value)}
                    />
                  </Field>
                  <Field label={t('administration.suppliers.contacts.role')}>
                    <Input
                      value={row.role}
                      maxLength={CONTACT_ROLE_MAX}
                      onChange={(e) => setContact(index, 'role', e.target.value)}
                    />
                  </Field>
                  <Field label={t('administration.suppliers.fields.phone')}>
                    <Input
                      dir="ltr"
                      value={row.phone}
                      maxLength={PHONE_MAX}
                      onChange={(e) => setContact(index, 'phone', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('administration.suppliers.fields.email')}
                    error={emailWord(emails.contacts[index])}
                  >
                    <Input
                      type="email"
                      dir="ltr"
                      value={row.email}
                      maxLength={EMAIL_MAX}
                      error={emailWord(emails.contacts[index]) !== undefined}
                      onChange={(e) => setContact(index, 'email', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                    onClick={() =>
                      set(
                        'contacts',
                        form.contacts.filter((_, i) => i !== index),
                      )
                    }
                  >
                    {t('administration.suppliers.contacts.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </AdministrationDialogFrame>
  );
};
