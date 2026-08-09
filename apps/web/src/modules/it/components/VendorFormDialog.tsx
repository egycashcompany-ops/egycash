// Create/edit vendor (design §2.9). Contacts are EMBEDDED — bounded by business reality, not a
// growth collection — so they are edited as rows inside this dialog rather than on a screen of
// their own. Vendors archive rather than delete (FR-11): assets point at them through
// `purchase.vendorId` and `warranty.vendorId`.
import { useEffect, useState } from 'react';
import { type ItVendorContactDto, type ItVendorDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { useCreateItVendor, useUpdateItVendor } from '../api/it-queries';

const MAX_CONTACTS = 20;

interface ContactRow {
  name: string;
  role: string;
  phone: string;
  email: string;
}

interface FormState {
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  services: string;
  isActive: boolean;
  contacts: ContactRow[];
}

const toRow = (contact: ItVendorContactDto): ContactRow => ({
  name: contact.name,
  role: contact.role ?? '',
  phone: contact.phone ?? '',
  email: contact.email ?? '',
});

const fromVendor = (vendor: ItVendorDto | null): FormState => ({
  name: vendor?.name ?? '',
  code: vendor?.code ?? '',
  phone: vendor?.phone ?? '',
  email: vendor?.email ?? '',
  address: vendor?.address ?? '',
  services: vendor?.services ?? '',
  isActive: vendor?.isActive ?? true,
  contacts: (vendor?.contacts ?? []).map(toRow),
});

export const VendorFormDialog = ({
  open,
  onClose,
  vendor,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  vendor: ItVendorDto | null;
}): JSX.Element => {
  const t = useT();
  const [form, setForm] = useState<FormState>(fromVendor(vendor));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(fromVendor(vendor));
      setError(null);
    }
  }, [open, vendor]);

  const create = useCreateItVendor();
  const update = useUpdateItVendor();
  const busy = create.isPending || update.isPending;

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setContact = (index: number, key: keyof ContactRow, value: string): void =>
    setForm((prev) => ({
      ...prev,
      contacts: prev.contacts.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  // Every contact row must at least be named; a blank row is a mistake, not an empty contact.
  const contactsValid = form.contacts.every((row) => row.name.trim() !== '');
  const complete = form.name.trim() !== '' && contactsValid;

  const submit = async (): Promise<void> => {
    setError(null);
    const text = (value: string): string | undefined =>
      value.trim() === '' ? undefined : value.trim();
    const contacts = form.contacts.map((row) => ({
      name: row.name.trim(),
      ...(text(row.role) === undefined ? {} : { role: row.role.trim() }),
      ...(text(row.phone) === undefined ? {} : { phone: row.phone.trim() }),
      ...(text(row.email) === undefined ? {} : { email: row.email.trim() }),
    }));
    try {
      if (vendor === null) {
        await create.mutateAsync({
          name: form.name.trim(),
          contacts,
          ...(text(form.code) === undefined ? {} : { code: form.code.trim() }),
          ...(text(form.phone) === undefined ? {} : { phone: form.phone.trim() }),
          ...(text(form.email) === undefined ? {} : { email: form.email.trim() }),
          ...(text(form.address) === undefined ? {} : { address: form.address.trim() }),
          ...(text(form.services) === undefined ? {} : { services: form.services.trim() }),
        });
        toast.success(t('it.vendors.created'));
      } else {
        const nullable = (value: string): string | null =>
          value.trim() === '' ? null : value.trim();
        await update.mutateAsync({
          id: vendor.id,
          body: {
            name: form.name.trim(),
            code: nullable(form.code),
            phone: nullable(form.phone),
            email: nullable(form.email),
            address: nullable(form.address),
            services: nullable(form.services),
            contacts,
            isActive: form.isActive,
            version: vendor.version,
          },
        });
        toast.success(t('it.vendors.updated'));
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
      title={vendor === null ? t('it.vendors.create') : t('it.vendors.edit')}
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
        <Field label={t('it.vendors.fields.name')} required>
          <Input value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label={t('it.vendors.fields.code')}>
          <Input value={form.code} onChange={(e) => set('code')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.vendors.fields.phone')}>
          <Input value={form.phone} onChange={(e) => set('phone')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.vendors.fields.email')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.vendors.fields.address')}>
            <Input value={form.address} onChange={(e) => set('address')(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('it.vendors.fields.services')}>
            <Textarea
              rows={2}
              value={form.services}
              onChange={(e) => set('services')(e.target.value)}
            />
          </Field>
        </div>
        {vendor !== null && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set('isActive')(e.target.checked)}
              label={t('it.vendors.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.vendors.archiveHint')}
            </p>
          </div>
        )}
      </div>

      <fieldset className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('it.vendors.contacts')}
          </h3>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            disabled={form.contacts.length >= MAX_CONTACTS}
            onClick={() =>
              set('contacts')([...form.contacts, { name: '', role: '', phone: '', email: '' }])
            }
          >
            {t('it.vendors.addContact')}
          </Button>
        </div>
        {form.contacts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.vendors.noContacts')}</p>
        ) : (
          <ul className="space-y-3">
            {form.contacts.map((row, index) => (
              // The index IS the identity here: embedded rows have no id, and the list is only
              // ever appended to or spliced, never reordered.
              <li
                key={index}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('it.vendors.fields.contactName')} required>
                    <Input
                      value={row.name}
                      onChange={(e) => setContact(index, 'name', e.target.value)}
                      error={row.name.trim() === ''}
                    />
                  </Field>
                  <Field label={t('it.vendors.fields.contactRole')}>
                    <Input
                      value={row.role}
                      onChange={(e) => setContact(index, 'role', e.target.value)}
                    />
                  </Field>
                  <Field label={t('it.vendors.fields.phone')}>
                    <Input
                      value={row.phone}
                      onChange={(e) => setContact(index, 'phone', e.target.value)}
                      dir="ltr"
                    />
                  </Field>
                  <Field label={t('it.vendors.fields.email')}>
                    <Input
                      type="email"
                      value={row.email}
                      onChange={(e) => setContact(index, 'email', e.target.value)}
                      dir="ltr"
                    />
                  </Field>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                    onClick={() =>
                      set('contacts')(form.contacts.filter((_, i) => i !== index))
                    }
                  >
                    {t('it.vendors.removeContact')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </Dialog>
  );
};
