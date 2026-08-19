// Create or edit a customer login.
//
// The one thing worth noticing is what is NOT here: a password. Staff never choose or see one.
// Creating an account returns a one-time setup link, which this shows once for hand-over — after
// that it is unrecoverable and a new one has to be issued, which is the point of it.
import { useState, type FormEvent } from 'react';
import { type GoldPortalAccountDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateGoldPortalAccount, useUpdateGoldPortalAccount } from '../api/gold-queries';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';

export const PortalAccountDialog = ({
  account,
  onClose,
}: {
  account: GoldPortalAccountDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const companies = useGoldCompanyOptions();
  const create = useCreateGoldPortalAccount();
  const update = useUpdateGoldPortalAccount();

  const [companyId, setCompanyId] = useState(account?.companyId ?? '');
  const [firstNameAr, setFirstNameAr] = useState('');
  const [lastNameAr, setLastNameAr] = useState('');
  const [firstNameEn, setFirstNameEn] = useState('');
  const [lastNameEn, setLastNameEn] = useState('');
  const [username, setUsername] = useState(account?.username ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [setupLink, setSetupLink] = useState<string | null>(null);

  const editing = account !== null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      if (editing) {
        await update.mutateAsync({
          id: account.id,
          body: {
            companyId,
            email: email.trim() === '' ? null : email.trim(),
            phone: phone.trim() === '' ? null : phone.trim(),
            version: account.version,
          },
        });
        toast.success(t('gold.common.saved'));
        onClose();
        return;
      }
      const created = await create.mutateAsync({
        companyId,
        firstName: { ar: firstNameAr.trim(), en: firstNameEn.trim() || firstNameAr.trim() },
        lastName: { ar: lastNameAr.trim(), en: lastNameEn.trim() || lastNameAr.trim() },
        username: username.trim(),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
      });
      setSetupLink(created.activationToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  if (setupLink !== null) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={t('gold.portalAccounts.created')}
        footer={<Button onClick={onClose}>{t('gold.common.cancel')}</Button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('gold.portalAccounts.setupLinkHint')}
          </p>
          <code className="block break-all rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">
            {setupLink}
          </code>
        </div>
      </Dialog>
    );
  }

  const complete = companyId !== '' && (editing || (username.trim() !== '' && firstNameAr.trim() !== ''));

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t('gold.portalAccounts.editTitle') : t('gold.portalAccounts.newTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button
            disabled={!complete}
            onClick={(event) => {
              void submit(event);
            }}
          >
            {t('gold.common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Field label={t('gold.portalAccounts.company')} required>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">{t('gold.common.select')}</option>
            {companies.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {!editing && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('gold.portalAccounts.firstNameAr')} required>
                <Input value={firstNameAr} onChange={(e) => setFirstNameAr(e.target.value)} />
              </Field>
              <Field label={t('gold.portalAccounts.lastNameAr')} required>
                <Input value={lastNameAr} onChange={(e) => setLastNameAr(e.target.value)} />
              </Field>
              <Field label={t('gold.portalAccounts.firstNameEn')}>
                <Input value={firstNameEn} onChange={(e) => setFirstNameEn(e.target.value)} />
              </Field>
              <Field label={t('gold.portalAccounts.lastNameEn')}>
                <Input value={lastNameEn} onChange={(e) => setLastNameEn(e.target.value)} />
              </Field>
            </div>
            <Field label={t('gold.portalAccounts.username')} required>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('gold.portalAccounts.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('gold.representatives.phone')}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
};
