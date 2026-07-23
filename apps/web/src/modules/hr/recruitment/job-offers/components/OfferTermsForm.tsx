// The versioned offer package form (create + revise). Controlled; produces an `OfferTerms` on
// submit. Organizational references (job title / department / branch) are dropdowns fed by the
// existing platform endpoints; the reporting manager uses the ManagerPicker (user autocomplete).
// Client checks cover required fields + validUntil>startDate; the server stays authoritative.
import { useState } from 'react';
import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type Locale,
  type OfferTerms,
  type OfferTermsDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select, Textarea, FormActions } from '../../../../../shared/ui/form';
import { PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { localized } from '../../../../../shared/lib/format';
import { ManagerPicker, type ManagerRef } from './ManagerPicker';
import { useBranches, useDepartments, useJobTitles } from '../api/job-offer-queries';

interface AllowanceRow {
  name: string;
  amount: string;
  currency: string;
}

const toLocalDate = (iso: string): string => (iso === '' ? '' : iso.slice(0, 10));

export const OfferTermsForm = ({
  initial,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial: OfferTermsDto | null;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (terms: OfferTerms) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const branches = useBranches(can('branch.view'));
  const departments = useDepartments(can('department.view'));
  const jobTitles = useJobTitles(can('jobTitle.view'));

  const [jobTitleId, setJobTitleId] = useState(initial?.jobTitleId ?? '');
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? '');
  const [manager, setManager] = useState<ManagerRef | null>(
    initial === null || initial.managerId === null ? null : { id: initial.managerId, label: '' },
  );
  const [employmentType, setEmploymentType] = useState<'' | EmploymentType>(initial?.employmentType ?? '');
  const [salaryAmount, setSalaryAmount] = useState(
    initial === null || initial.salary === null ? '' : String(initial.salary.amount),
  );
  const [salaryCurrency, setSalaryCurrency] = useState(initial?.salary?.currency ?? 'EGP');
  const [allowances, setAllowances] = useState<AllowanceRow[]>(
    initial === null
      ? []
      : initial.allowances.map((a) => ({ name: a.name, amount: String(a.amount), currency: a.currency })),
  );
  const [benefits, setBenefits] = useState<string[]>(initial?.benefits ?? []);
  const [probationMonths, setProbationMonths] = useState(
    initial === null ? '3' : String(initial.probationMonths),
  );
  const [startDate, setStartDate] = useState(toLocalDate(initial?.startDate ?? ''));
  const [validUntil, setValidUntil] = useState(toLocalDate(initial?.validUntil ?? ''));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // Direct Manager and Salary are OPTIONAL (approved spec) — everything else stays required.
  const valid =
    jobTitleId !== '' &&
    departmentId !== '' &&
    branchId !== '' &&
    employmentType !== '' &&
    startDate !== '' &&
    validUntil !== '';

  const submit = (): void => {
    if (employmentType === '') return;
    if (new Date(validUntil) <= new Date(startDate)) {
      setError(t('offers.form.validUntilAfterStart'));
      return;
    }
    setError(null);
    const terms: OfferTerms = {
      jobTitleId,
      departmentId,
      branchId,
      managerId: manager?.id ?? null,
      employmentType,
      salary:
        salaryAmount.trim() === ''
          ? null
          : { amount: Number(salaryAmount), currency: salaryCurrency.trim().toUpperCase() || 'EGP' },
      allowances: allowances
        .filter((a) => a.name.trim() !== '')
        .map((a) => ({
          name: a.name.trim(),
          amount: Number(a.amount) || 0,
          currency: a.currency.trim().toUpperCase() || 'EGP',
        })),
      benefits: benefits.map((b) => b.trim()).filter((b) => b !== ''),
      probationMonths: Number(probationMonths) || 0,
      startDate: new Date(startDate),
      validUntil: new Date(validUntil),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    };
    onSubmit(terms);
  };

  const setAllowance = (i: number, patch: Partial<AllowanceRow>): void =>
    setAllowances((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('offers.form.jobTitle')} required>
          <Select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)}>
            <option value="">{can('jobTitle.view') ? t('offers.form.selectRef') : t('offers.form.noRefAccess')}</option>
            {jobTitles.data?.map((j) => (
              <option key={j.id} value={j.id}>{localized(j.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.department')} required>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{can('department.view') ? t('offers.form.selectRef') : t('offers.form.noRefAccess')}</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>{localized(d.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.branch')} required>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{can('branch.view') ? t('offers.form.selectRef') : t('offers.form.noRefAccess')}</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>{localized(b.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.manager')} hint={t('offers.form.optional')}>
          <ManagerPicker value={manager} onChange={setManager} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t('offers.form.employmentType')} required>
          <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType | '')}>
            <option value="">{t('offers.form.selectRef')}</option>
            {EMPLOYMENT_TYPES.map((et) => (
              <option key={et} value={et}>{t(`offers.employmentType.${et}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.salary')} hint={t('offers.form.optional')}>
          <Input type="number" min={0} value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('offers.form.currency')}>
          <Input value={salaryCurrency} onChange={(e) => setSalaryCurrency(e.target.value)} maxLength={3} dir="ltr" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t('offers.form.probation')}>
          <Input type="number" min={0} max={24} value={probationMonths} onChange={(e) => setProbationMonths(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('offers.form.startDate')} required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('offers.form.validUntil')} required>
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} dir="ltr" />
        </Field>
      </div>

      {/* Allowances */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('offers.form.allowances')}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setAllowances((r) => [...r, { name: '', amount: '', currency: salaryCurrency }])}
          >
            {t('offers.form.addAllowance')}
          </Button>
        </div>
        {allowances.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              className="flex-1"
              value={a.name}
              onChange={(e) => setAllowance(i, { name: e.target.value })}
              placeholder={t('offers.form.allowanceName')}
            />
            <Input
              type="number"
              min={0}
              className="w-28"
              value={a.amount}
              onChange={(e) => setAllowance(i, { amount: e.target.value })}
              placeholder={t('offers.form.amount')}
              dir="ltr"
            />
            <Input
              className="w-20"
              value={a.currency}
              onChange={(e) => setAllowance(i, { currency: e.target.value })}
              maxLength={3}
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setAllowances((r) => r.filter((_, idx) => idx !== i))}
              className="text-slate-400 hover:text-red-600"
              aria-label={t('common.remove')}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Benefits */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('offers.form.benefits')}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setBenefits((b) => [...b, ''])}
          >
            {t('offers.form.addBenefit')}
          </Button>
        </div>
        {benefits.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={b}
              onChange={(e) => setBenefits((rows) => rows.map((r, idx) => (idx === i ? e.target.value : r)))}
              placeholder={t('offers.form.benefit')}
            />
            <button
              type="button"
              onClick={() => setBenefits((rows) => rows.filter((_, idx) => idx !== i))}
              className="text-slate-400 hover:text-red-600"
              aria-label={t('common.remove')}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <Field label={t('offers.form.notes')}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
      </Field>

      {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <FormActions>
        <Button type="submit" loading={submitting} disabled={!valid}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
};
