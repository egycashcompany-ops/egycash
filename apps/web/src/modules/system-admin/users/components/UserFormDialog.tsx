// Create and edit an account. One dialog for both, because the two forms differ only in which
// fields are writable and which call they end in — two components would drift.
//
// The rule this form exists to make visible: an account needs at least one login identifier.
// Neither email nor username is individually required, and an account with neither can never sign
// in — `findByIdentifier` matches username, email or employee code, and a platform account has no
// employee code. The server refuses it (schema on create, stored-state check on update); the form
// says so before the round-trip, because "you must fill in one of these two" is not something a
// field-level error on either one can express.
//
// No password anywhere. Creation issues a one-time setup link and delivers it over the channels the
// account has; the administrator never chooses, sees or relays a credential. That is the existing
// flow (§14) and this dialog does not add a way around it.
import { useState } from 'react';
import {
  type CreateUser,
  type Locale,
  type UpdateUser,
  type UserDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import {
  Button,
  Dialog,
  Field,
  Form,
  Input,
  Select,
  toast,
} from '../../../../shared/ui';
import { useBranchOptions, useCreateUser, useUpdateUser } from '../api/user-queries';

interface Draft {
  firstNameAr: string;
  firstNameEn: string;
  lastNameAr: string;
  lastNameEn: string;
  email: string;
  username: string;
  phone: string;
  locale: 'ar' | 'en';
  branchId: string;
}

const draftFrom = (user: UserDto | null): Draft => ({
  firstNameAr: user?.firstName.ar ?? '',
  firstNameEn: user?.firstName.en ?? '',
  lastNameAr: user?.lastName.ar ?? '',
  lastNameEn: user?.lastName.en ?? '',
  email: user?.email ?? '',
  username: user?.username ?? '',
  phone: user?.phone ?? '',
  locale: user?.locale ?? 'ar',
  branchId: user?.organization.branchId ?? '',
});

const trimmed = (value: string): string | null => {
  const next = value.trim();
  return next === '' ? null : next;
};

export const UserFormDialog = ({
  open,
  onClose,
  user,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` creates; a user edits that account. */
  user: UserDto | null;
  onCreated?: (created: UserDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(user));
  const [identifierError, setIdentifierError] = useState(false);

  const isCreate = user === null;
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const { data: branches = [] } = useBranchOptions(open);
  const busy = create.isPending || update.isPending;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (key === 'email' || key === 'username') setIdentifierError(false);
  };

  const submit = (): void => {
    const email = trimmed(draft.email);
    const username = trimmed(draft.username);
    if (email === null && username === null) {
      setIdentifierError(true);
      return;
    }
    const names = {
      firstName: { ar: draft.firstNameAr.trim(), en: draft.firstNameEn.trim() },
      lastName: { ar: draft.lastNameAr.trim(), en: draft.lastNameEn.trim() },
    };
    const phone = trimmed(draft.phone);
    const branchId = trimmed(draft.branchId);

    if (isCreate) {
      const body: CreateUser = {
        ...names,
        ...(email === null ? {} : { email }),
        ...(username === null ? {} : { username }),
        ...(phone === null ? {} : { phone }),
        locale: draft.locale,
        organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
      };
      create.mutate(body, {
        onSuccess: (created) => {
          toast.success(t('systemAdmin.users.created'));
          onClose();
          onCreated?.(created);
        },
      });
      return;
    }

    const body: UpdateUser = {
      ...names,
      // Nullable on the wire: an account that signs in by username may drop its email. The server
      // refuses the change when it would leave the account with no identifier at all.
      email,
      phone,
      locale: draft.locale,
      ...(username === null ? {} : { username }),
      // Sent only when it MOVED. The select is populated from the active branches, so an account
      // placed in a branch that has since been deactivated shows no selection — and an
      // unconditional send would read that as "clear the placement" and quietly do it.
      ...(branchId === (user.organization.branchId ?? null) ? {} : { organization: { branchId } }),
      version: user.version,
    };
    update.mutate(body, {
      onSuccess: () => {
        toast.success(t('systemAdmin.users.updated'));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t(isCreate ? 'systemAdmin.users.form.createTitle' : 'systemAdmin.users.form.editTitle')}
      description={t(
        isCreate ? 'systemAdmin.users.form.createHint' : 'systemAdmin.users.form.editHint',
      )}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={busy} onClick={submit}>
            {t(isCreate ? 'systemAdmin.users.form.create' : 'systemAdmin.users.form.save')}
          </Button>
        </div>
      }
    >
      <Form onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('systemAdmin.users.form.firstNameAr')} required>
            <Input
              dir="rtl"
              value={draft.firstNameAr}
              onChange={(e) => set('firstNameAr', e.target.value)}
              required
            />
          </Field>
          <Field label={t('systemAdmin.users.form.firstNameEn')} required>
            <Input
              dir="ltr"
              value={draft.firstNameEn}
              onChange={(e) => set('firstNameEn', e.target.value)}
              required
            />
          </Field>
          <Field label={t('systemAdmin.users.form.lastNameAr')} required>
            <Input
              dir="rtl"
              value={draft.lastNameAr}
              onChange={(e) => set('lastNameAr', e.target.value)}
              required
            />
          </Field>
          <Field label={t('systemAdmin.users.form.lastNameEn')} required>
            <Input
              dir="ltr"
              value={draft.lastNameEn}
              onChange={(e) => set('lastNameEn', e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('systemAdmin.users.fields.username')}
            hint={t('systemAdmin.users.form.usernameHint')}
            error={identifierError ? t('systemAdmin.users.form.identifierRequired') : undefined}
          >
            <Input
              dir="ltr"
              value={draft.username}
              error={identifierError}
              onChange={(e) => set('username', e.target.value)}
              placeholder="001025"
            />
          </Field>
          <Field
            label={t('systemAdmin.users.fields.email')}
            hint={t('systemAdmin.users.form.emailHint')}
          >
            <Input
              dir="ltr"
              type="email"
              value={draft.email}
              error={identifierError}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t('systemAdmin.users.fields.phone')}>
            <Input dir="ltr" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t('systemAdmin.users.fields.locale')}>
            <Select
              value={draft.locale}
              onChange={(e) => set('locale', e.target.value === 'en' ? 'en' : 'ar')}
            >
              <option value="ar">{t('systemAdmin.users.locale.ar')}</option>
              <option value="en">{t('systemAdmin.users.locale.en')}</option>
            </Select>
          </Field>
          <Field
            label={t('systemAdmin.users.fields.branch')}
            hint={t('systemAdmin.users.form.branchHint')}
          >
            <Select value={draft.branchId} onChange={(e) => set('branchId', e.target.value)}>
              <option value="">{t('systemAdmin.users.form.noBranch')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name[locale]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {isCreate && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.users.form.setupLinkNote')}
          </p>
        )}
      </Form>
    </Dialog>
  );
};
