// Minimal Platform-Identity panel on the employee detail (ADR-017): shows the Employee Code and the
// hiring Branch Code, lets an authorized user create the login account for the employee (username
// defaults to the Employee Code), edit the username later, and see the account's data scopes. This
// is deliberately the *minimum* identity UI — no full account-administration dashboard.
import { useState } from 'react';
import { type CreateEmployeeLogin, type EmployeeDto, type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Badge } from '../../../../../shared/ui/Badge';
import { Field, Input, Form, FormActions, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../../shared/lib/api-client';
import {
  useBranch,
  useCreateEmployeeLogin,
  useLinkedUser,
  useUpdateUser,
  useUserAssignments,
} from '../api/employee-queries';

type LocalizedValue = { ar: string; en: string };
const empty: LocalizedValue = { ar: '', en: '' };

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

const CreateLoginDialog = ({
  employee,
  onClose,
}: {
  employee: EmployeeDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateEmployeeLogin(employee.id);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState(employee.code);
  const [firstName, setFirstName] = useState<LocalizedValue>(empty);
  const [lastName, setLastName] = useState<LocalizedValue>(empty);
  const [phone, setPhone] = useState('');
  const [locale, setLocale] = useState<Locale>('ar');

  const submit = async (): Promise<void> => {
    if (email.trim() === '') return void toast.error(t('employees.account.emailRequired'));
    if (firstName.ar.trim() === '' || firstName.en.trim() === '' || lastName.ar.trim() === '' || lastName.en.trim() === '') {
      return void toast.error(t('employees.account.nameRequired'));
    }
    const body: CreateEmployeeLogin = {
      email: email.trim(),
      username: username.trim() === '' ? undefined : username.trim(),
      firstName: firstName as LocalizedString,
      lastName: lastName as LocalizedString,
      locale,
      ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
    };
    try {
      const result = await create.mutateAsync(body);
      toast.success(t('employees.account.created', { username: result.user.username ?? employee.code }));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') toast.error(t('employees.account.conflict'));
      // other errors surface globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('employees.account.createTitle')}
      description={t('employees.account.createHint', { code: employee.code })}
      size="lg"
    >
      <Form onSubmit={() => void submit()}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('employees.account.email')} required>
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('employees.account.username')} hint={t('employees.account.usernameHint')}>
            <Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('employees.account.firstName')} (${t('employees.account.ar')})`} required>
            <Input dir="rtl" value={firstName.ar} onChange={(e) => setFirstName({ ...firstName, ar: e.target.value })} />
          </Field>
          <Field label={`${t('employees.account.firstName')} (${t('employees.account.en')})`} required>
            <Input dir="ltr" value={firstName.en} onChange={(e) => setFirstName({ ...firstName, en: e.target.value })} />
          </Field>
          <Field label={`${t('employees.account.lastName')} (${t('employees.account.ar')})`} required>
            <Input dir="rtl" value={lastName.ar} onChange={(e) => setLastName({ ...lastName, ar: e.target.value })} />
          </Field>
          <Field label={`${t('employees.account.lastName')} (${t('employees.account.en')})`} required>
            <Input dir="ltr" value={lastName.en} onChange={(e) => setLastName({ ...lastName, en: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('employees.account.phone')}>
            <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('employees.account.locale')}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </div>
        <FormActions>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t('employees.account.createLogin')}
          </Button>
        </FormActions>
      </Form>
    </Dialog>
  );
};

const UsernameEditor = ({ userId, current }: { userId: string; current: string }): JSX.Element => {
  const t = useT();
  const update = useUpdateUser(userId);
  const { data: user } = useLinkedUser(userId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);

  const save = async (): Promise<void> => {
    if (user === undefined) return;
    try {
      await update.mutateAsync({ username: value.trim(), version: user.version });
      toast.success(t('employees.account.usernameUpdated'));
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') toast.error(t('employees.account.conflict'));
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-sm" dir="ltr">{current}</span>
        <Can permission="user.edit">
          <button type="button" onClick={() => { setValue(current); setEditing(true); }} className="text-xs text-brand-600 hover:underline">
            {t('common.edit')}
          </button>
        </Can>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Input dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-40" />
      <Button size="sm" loading={update.isPending} onClick={() => void save()}>{t('common.save')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
    </span>
  );
};

export const EmployeeAccountCard = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const { data: branch } = useBranch(employee.employment.branchId);
  const { data: user } = useLinkedUser(employee.userId);
  const { data: assignments = [] } = useUserAssignments(employee.userId);
  const scopeTones = { own: 'neutral', section: 'info', department: 'info', branch: 'brand', organization: 'success' } as const;

  return (
    <Card>
      <CardHeader title={t('employees.account.title')} />
      <CardBody>
        <dl className="space-y-3 text-sm">
          <Row label={t('employees.account.employeeCode')}>
            <span className="font-mono" dir="ltr">{employee.code}</span>
          </Row>
          <Row label={t('employees.account.branchCode')}>
            <span className="font-mono" dir="ltr">{branch?.code ?? '—'}</span>
          </Row>
          <Row label={t('employees.account.login')}>
            {employee.userId === null ? (
              <div className="flex flex-col items-start gap-2">
                <span className="text-slate-400">{t('employees.account.noLogin')}</span>
                <Can permission="user.create">
                  <Button size="sm" onClick={() => setCreating(true)}>{t('employees.account.createLogin')}</Button>
                </Can>
              </div>
            ) : (
              <UsernameEditor userId={employee.userId} current={user?.username ?? employee.code} />
            )}
          </Row>
          {employee.userId !== null && (
            <Row label={t('employees.account.dataScope')}>
              {assignments.length === 0 ? (
                <span className="text-slate-400">{t('employees.account.noScopes')}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {assignments.map((a) => (
                    <Badge key={a.id} tone={scopeTones[a.scope]}>
                      {t(`employees.scope.${a.scope}`)}
                    </Badge>
                  ))}
                </div>
              )}
            </Row>
          )}
        </dl>
      </CardBody>
      {creating && <CreateLoginDialog employee={employee} onClose={() => setCreating(false)} />}
    </Card>
  );
};
