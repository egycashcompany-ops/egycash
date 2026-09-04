// The employee's social-insurance file (التأمينات الاجتماعية).
//
// It is NOT on the Overview tab beside the salary, and that placement is the point. The four wage
// figures here are statutory brackets that contributions are computed on — `الاجر الأساسي` takes
// six distinct values across the whole company — not what anybody is paid. Sitting them next to
// `employment.salary` would invite exactly the reading the data model refuses.
//
// Three states, and the card must say which one it is in, because two of them look identical if it
// does not: no file has been filed yet, a file exists, or a file may exist but this viewer is not
// allowed to read it. `insuranceVisible` is the server's answer to the third, and the reason the
// DTO carries a flag beside a nullable block at all.
import { useEffect, useState } from 'react';
import { INSURANCE_STATUSES, type EmployeeDto, type InsuranceStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Badge } from '../../../../../shared/ui/Badge';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useUpdateEmployeeInsurance } from '../api/employee-queries';

/** The editable shape, as strings — an empty box means "not filed", which is not the same as 0. */
interface Draft {
  insuranceNumber: string;
  occupation: string;
  occupationCode: string;
  grossWage: string;
  contributionWage: string;
  basicWage: string;
  employerShare: string;
  employeeShare: string;
  status: '' | InsuranceStatus;
}

const EMPTY: Draft = {
  insuranceNumber: '',
  occupation: '',
  occupationCode: '',
  grossWage: '',
  contributionWage: '',
  basicWage: '',
  employerShare: '',
  employeeShare: '',
  status: '',
};

const draftOf = (e: EmployeeDto): Draft => {
  const i = e.insurance;
  if (i === null) return EMPTY;
  const num = (v: number | null): string => (v === null ? '' : String(v));
  return {
    insuranceNumber: i.insuranceNumber ?? '',
    occupation: i.occupation ?? '',
    occupationCode: i.occupationCode ?? '',
    grossWage: num(i.grossWage),
    contributionWage: num(i.contributionWage),
    basicWage: num(i.basicWage),
    employerShare: num(i.employerShare),
    employeeShare: num(i.employeeShare),
    status: i.status ?? '',
  };
};

/** '' → null (not filed); anything else → the number. A blank box must not become a zero. */
const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export const EmployeeInsuranceCard = ({ e }: { e: EmployeeDto }): JSX.Element => {
  const t = useT();
  const update = useUpdateEmployeeInsurance(e.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(e));

  // Re-seed when the employee changes underneath us (a refetch, or another tab's write). Guarded on
  // `editing` so a background refresh never discards what somebody is halfway through typing.
  useEffect(() => {
    if (!editing) setDraft(draftOf(e));
  }, [e, editing]);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        insuranceNumber: strOrNull(draft.insuranceNumber),
        occupation: strOrNull(draft.occupation),
        occupationCode: strOrNull(draft.occupationCode),
        grossWage: numOrNull(draft.grossWage),
        contributionWage: numOrNull(draft.contributionWage),
        basicWage: numOrNull(draft.basicWage),
        employerShare: numOrNull(draft.employerShare),
        employeeShare: numOrNull(draft.employeeShare),
        status: draft.status === '' ? null : draft.status,
        version: e.version,
      });
      setEditing(false);
      toast.success(t('employees.insurance.saved'));
    } catch {
      // Refusals — a stale version, a scope denial — surface globally in the server's own words.
    }
  };

  // The viewer is not allowed to read it. Say so, rather than showing an empty card that reads as
  // "this employee has no insurance file".
  if (!e.insuranceVisible) {
    return (
      <Card>
        <CardHeader title={t('employees.insurance.title')} />
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('employees.insurance.hidden')}
          </p>
        </CardBody>
      </Card>
    );
  }

  const rows: { label: string; value: string | null }[] = [
    { label: t('employees.insurance.number'), value: e.insurance?.insuranceNumber ?? null },
    { label: t('employees.insurance.occupation'), value: e.insurance?.occupation ?? null },
    { label: t('employees.insurance.occupationCode'), value: e.insurance?.occupationCode ?? null },
    { label: t('employees.insurance.grossWage'), value: numText(e.insurance?.grossWage ?? null) },
    {
      label: t('employees.insurance.contributionWage'),
      value: numText(e.insurance?.contributionWage ?? null),
    },
    { label: t('employees.insurance.basicWage'), value: numText(e.insurance?.basicWage ?? null) },
    {
      label: t('employees.insurance.employerShare'),
      value: numText(e.insurance?.employerShare ?? null),
    },
    {
      label: t('employees.insurance.employeeShare'),
      value: numText(e.insurance?.employeeShare ?? null),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t('employees.insurance.title')}
        description={t('employees.insurance.hint')}
        actions={
          <Can permission="employee.manageInsurance">
            {editing ? null : (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
          </Can>
        }
      />
      <CardBody className="space-y-4">
        {editing ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('employees.insurance.number')} htmlFor="ins-number">
                <Input
                  id="ins-number"
                  value={draft.insuranceNumber}
                  onChange={(ev) => set('insuranceNumber')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={t('employees.insurance.status')} htmlFor="ins-status">
                <Select
                  id="ins-status"
                  value={draft.status}
                  onChange={(ev) => set('status')(ev.target.value)}
                >
                  <option value="">{t('employees.insurance.statusUnknown')}</option>
                  {INSURANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`employees.insurance.status.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('employees.insurance.occupation')} htmlFor="ins-occupation">
                <Input
                  id="ins-occupation"
                  value={draft.occupation}
                  onChange={(ev) => set('occupation')(ev.target.value)}
                />
              </Field>
              <Field label={t('employees.insurance.occupationCode')} htmlFor="ins-occupation-code">
                <Input
                  id="ins-occupation-code"
                  value={draft.occupationCode}
                  onChange={(ev) => set('occupationCode')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t('employees.insurance.grossWage')}
                htmlFor="ins-gross"
                hint={t('employees.insurance.wageHint')}
              >
                <Input
                  id="ins-gross"
                  type="number"
                  min={0}
                  value={draft.grossWage}
                  onChange={(ev) => set('grossWage')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={t('employees.insurance.contributionWage')} htmlFor="ins-contribution">
                <Input
                  id="ins-contribution"
                  type="number"
                  min={0}
                  value={draft.contributionWage}
                  onChange={(ev) => set('contributionWage')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={t('employees.insurance.basicWage')} htmlFor="ins-basic">
                <Input
                  id="ins-basic"
                  type="number"
                  min={0}
                  value={draft.basicWage}
                  onChange={(ev) => set('basicWage')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
              <div />
              <Field label={t('employees.insurance.employerShare')} htmlFor="ins-employer">
                <Input
                  id="ins-employer"
                  type="number"
                  min={0}
                  value={draft.employerShare}
                  onChange={(ev) => set('employerShare')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={t('employees.insurance.employeeShare')} htmlFor="ins-employee">
                <Input
                  id="ins-employee"
                  type="number"
                  min={0}
                  value={draft.employeeShare}
                  onChange={(ev) => set('employeeShare')(ev.target.value)}
                  dir="ltr"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void submit()} disabled={update.isPending}>
                {t('common.save')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(draftOf(e));
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </>
        ) : e.insurance === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('employees.insurance.none')}
          </p>
        ) : (
          <>
            {e.insurance.status === null ? null : (
              <Badge tone={e.insurance.status === 'insured' ? 'success' : 'neutral'}>
                {t(`employees.insurance.status.${e.insurance.status}`)}
              </Badge>
            )}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {rows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className="text-slate-500 dark:text-slate-400">{row.label}</dt>
                  <dd className="font-medium" dir="ltr">
                    {row.value ?? '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
};

/** A wage is shown as filed. `0` is a real filed figure and must not render as an em dash. */
function numText(v: number | null): string | null {
  return v === null ? null : String(v);
}
