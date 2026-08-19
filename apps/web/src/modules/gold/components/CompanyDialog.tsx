// Create or edit an owner. One dialog for both, as the gold screen had it.
//
// The logo goes through the platform Files service: the gold system uploaded to Cloudinary and
// stored the URL, which would have carried a second file stack into ECMS. Uploading needs
// `file.create` and a configured file category; without either the control says so rather than
// failing on save.
import { useState, type FormEvent } from 'react';
import {
  type CreateGoldCompany,
  type GoldCompanyDto,
  type GoldActiveStatus,
  type GoldCompanyType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { uploadCompanyLogo } from '../api/gold-api';
import {
  useCreateGoldCompany,
  useGoldFileCategories,
  useUpdateGoldCompany,
} from '../api/gold-queries';
import { companyTypeOptions } from './gold-labels';
import { CompanyLogo } from './CompanyLogo';

export const CompanyDialog = ({
  company,
  onClose,
}: {
  company: GoldCompanyDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const create = useCreateGoldCompany();
  const update = useUpdateGoldCompany();
  const mayUpload = can('file.create');
  const categories = useGoldFileCategories(mayUpload);
  const categoryId = categories.data?.items[0]?.id ?? '';

  const [name, setName] = useState(company?.name ?? '');
  const [type, setType] = useState<GoldCompanyType>(company?.type ?? 'company');
  const [status, setStatus] = useState<GoldActiveStatus>(company?.status ?? 'active');
  const [phone, setPhone] = useState(company?.phone ?? '');
  const [email, setEmail] = useState(company?.email ?? '');
  const [notes, setNotes] = useState(company?.notes ?? '');
  const [logoFileId, setLogoFileId] = useState<string | null>(company?.logoFileId ?? null);
  const [uploading, setUploading] = useState(false);

  const onPickLogo = async (file: File | undefined): Promise<void> => {
    if (file === undefined || categoryId === '') return;
    setUploading(true);
    try {
      const uploaded = await uploadCompanyLogo(file, categoryId);
      setLogoFileId(uploaded.id);
      toast.success(t('gold.companies.logoUploaded'));
    } catch {
      toast.error(t('gold.companies.logoFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    const shared = {
      name: trimmed,
      type,
      status,
      phone: phone.trim() === '' ? undefined : phone.trim(),
      email: email.trim() === '' ? undefined : email.trim(),
      notes: notes.trim() === '' ? undefined : notes.trim(),
    } satisfies Omit<CreateGoldCompany, 'logoFileId'>;
    try {
      if (company === null) {
        await create.mutateAsync({
          ...shared,
          ...(logoFileId === null ? {} : { logoFileId }),
        });
      } else {
        await update.mutateAsync({
          id: company.id,
          body: { ...shared, logoFileId, version: company.version },
        });
      }
      toast.success(t('gold.common.saved'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={company === null ? t('gold.companies.newTitle') : t('gold.companies.editTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button
            form="gold-company-form"
            type="submit"
            loading={create.isPending || update.isPending}
            disabled={name.trim() === ''}
          >
            {t('gold.common.save')}
          </Button>
        </>
      }
    >
      <form id="gold-company-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="flex items-center gap-3">
          <CompanyLogo fileId={logoFileId} name={name === '' ? '؟' : name} size={64} />
          <div className="min-w-0">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('gold.companies.logo')}
            </span>
            {mayUpload && categoryId !== '' ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    void onPickLogo(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  className="mt-1 text-xs text-slate-600 file:me-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-slate-700 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
                />
                {uploading && (
                  <span className="text-xs text-brand-600 dark:text-brand-400">
                    {t('gold.companies.logoUploading')}
                  </span>
                )}
                {logoFileId !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoFileId(null);
                    }}
                    className="mt-1 block text-xs text-red-600 dark:text-red-400"
                  >
                    {t('gold.companies.logoRemove')}
                  </button>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('gold.companies.logoNoCategory')}
              </p>
            )}
          </div>
        </div>

        <Field label={t('gold.companies.nameField')} required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('gold.companies.type')}>
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as GoldCompanyType);
              }}
            >
              {companyTypeOptions(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.common.status')}>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as GoldActiveStatus);
              }}
            >
              <option value="active">{t('gold.activeStatus.active')}</option>
              <option value="inactive">{t('gold.activeStatus.inactive')}</option>
            </Select>
          </Field>
          <Field label={t('gold.companies.phone')}>
            <Input
              value={phone}
              dir="ltr"
              onChange={(e) => {
                setPhone(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.companies.email')}>
            <Input
              value={email}
              type="email"
              dir="ltr"
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </Field>
        </div>
        <Field label={t('gold.common.notes')}>
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
};
