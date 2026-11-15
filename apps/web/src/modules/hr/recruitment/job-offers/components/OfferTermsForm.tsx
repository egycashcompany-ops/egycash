// The versioned offer package form (create + revise). Controlled; produces an `OfferTerms` on
// submit. Organizational references (job title / department / branch) are fed by the existing
// platform endpoints; the reporting manager uses the ManagerPicker (user autocomplete, or a name
// typed by hand for a manager with no account). Client checks cover required fields +
// validUntil>startDate; the server stays authoritative.
//
// A28 — «اكتب العرض» opens FILLED IN (`defaults`, from `GET /hr/job-offers/defaults`): the job,
// department and branch of the candidate's placement, their direct manager from the organization
// chart, «دوام كامل», and the job's «الراتب الثابت». The job is typed into, not only picked («ممكن
// اكتب اول كلمه او اول كام حرف فيقوم جيبلي ليستت الوظايف»). Changing the job brings its salary,
// until the salary is typed by hand.
import { useState } from 'react';
import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type Locale,
  type OfferDefaultsDto,
  type OfferTerms,
  type OfferTermsDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { MoneyInput } from '../../../../../shared/ui/MoneyInput';
import { Field, Input, Select, Textarea, FormActions } from '../../../../../shared/ui/form';
import { Combobox } from '../../../../../shared/ui/Combobox';
import { PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { localized } from '../../../../../shared/lib/format';
import { ManagerPicker, type ManagerRef } from './ManagerPicker';
import {
  useBranchOptions,
  useDepartmentReferenceOptions,
  useJobTitleReferenceOptions,
} from '../../../../organization/shared/references';

interface AllowanceRow {
  name: string;
  amount: string;
  currency: string;
}

const toLocalDate = (iso: string): string => (iso === '' ? '' : iso.slice(0, 10));

/** The salary a job starts an offer at — its «الراتب الثابت» — as the form's text; '' when none. */
export const salaryOfJob = (
  jobSalaries: OfferDefaultsDto['jobSalaries'],
  jobTitleId: string,
): { amount: string; currency: string } | null => {
  const row = jobSalaries.find((s) => s.jobTitleId === jobTitleId);
  return row === undefined ? null : { amount: String(row.amount), currency: row.currency };
};

/** The manager the form starts with: the offer's, else the direct manager from the chart. */
export const startingManager = (
  initial: OfferTermsDto | null,
  defaults: OfferDefaultsDto | null,
  locale: Locale,
): ManagerRef | null => {
  if (initial !== null) {
    if (initial.managerId !== null) return { id: initial.managerId, label: '' };
    // A name typed by hand rides as a ref with no id.
    return initial.managerName === null ? null : { id: '', label: initial.managerName };
  }
  return defaults?.manager == null ? null : { id: defaults.manager.id, label: localized(defaults.manager.name, locale) };
};

export const OfferTermsForm = ({
  initial,
  defaults = null,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial: OfferTermsDto | null;
  /** A new offer's starting values (A28); ignored when revising (`initial` is the offer). */
  defaults?: OfferDefaultsDto | null;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (terms: OfferTerms) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  // The reference OPTIONS, not the `<unit>.view`-gated administration lists. All three fields are
  // required, so a reader without those grants had three empty pickers and a Submit that could
  // never be satisfied — they could not write an offer at all.
  const branches = useBranchOptions();
  const departments = useDepartmentReferenceOptions();
  const jobTitles = useJobTitleReferenceOptions();

  const start = initial === null ? defaults : null;
  const jobSalaries = start?.jobSalaries ?? [];
  const [jobTitleId, setJobTitleId] = useState(initial?.jobTitleId ?? start?.jobTitleId ?? '');
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? start?.departmentId ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? start?.branchId ?? '');
  const [manager, setManager] = useState<ManagerRef | null>(startingManager(initial, defaults, locale));
  // «نوع التوظيف هيبقا by default دوام كامل مع امكانية الاختيار».
  const [employmentType, setEmploymentType] = useState<'' | EmploymentType>(
    initial?.employmentType ?? start?.employmentType ?? 'fullTime',
  );
  const startSalary = initial === null ? (start?.salary ?? null) : initial.salary;
  const [salaryAmount, setSalaryAmount] = useState(startSalary === null ? '' : String(startSalary.amount));
  const [salaryCurrency, setSalaryCurrency] = useState(startSalary?.currency ?? 'EGP');
  // The salary follows the job until somebody types it.
  const [salaryTyped, setSalaryTyped] = useState(initial !== null);
  // The section of the placement (or of the offer) stays while its department does.
  const startSection = initial?.sectionId ?? start?.sectionId ?? null;
  const startDepartment = initial?.departmentId ?? start?.departmentId ?? '';

  const chooseJob = (next: string): void => {
    setJobTitleId(next);
    if (salaryTyped) return;
    const salary = salaryOfJob(jobSalaries, next);
    setSalaryAmount(salary?.amount ?? '');
    setSalaryCurrency(salary?.currency ?? 'EGP');
  };
  const chooseBranch = (next: string): void => {
    setBranchId(next);
    // A department belongs to one branch: another branch's department does not stay chosen.
    const department = departments.data?.find((d) => d.id === departmentId);
    if (department !== undefined && department.parentId !== next) setDepartmentId('');
  };
  const departmentsInBranch = (departments.data ?? []).filter((d) => branchId === '' || d.parentId === branchId);
  const jobName = new Map((jobTitles.data ?? []).map((j) => [j.id, localized(j.name, locale)]));
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
      sectionId: departmentId === startDepartment ? startSection : null,
      managerId: manager === null || manager.id === '' ? null : manager.id,
      managerName: manager !== null && manager.id === '' ? manager.label : null,
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
          {/* «مش select بس لا هكتب كمان و هو يجبلي الحاجه» — type a few letters, pick from the list. */}
          <Combobox
            value={jobTitleId}
            options={(jobTitles.data ?? []).map((j) => j.id)}
            optionLabel={(id) => jobName.get(id) ?? id}
            onChange={chooseJob}
            placeholder={t('offers.form.jobTitleSearch')}
            emptyText={t('common.noResults')}
            clearLabel={t('common.clear')}
            testId="offer-job-title"
          />
        </Field>
        <Field label={t('offers.form.department')} required>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{t('offers.form.selectRef')}</option>
            {departmentsInBranch.map((d) => (
              <option key={d.id} value={d.id}>{localized(d.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.branch')} required>
          <Select value={branchId} onChange={(e) => chooseBranch(e.target.value)}>
            <option value="">{t('offers.form.selectRef')}</option>
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
          <MoneyInput
            value={salaryAmount}
            onChange={(next) => {
              setSalaryAmount(next);
              setSalaryTyped(true);
            }}
          />
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
            <MoneyInput
              className="w-28"
              value={a.amount}
              onChange={(next) => setAllowance(i, { amount: next })}
              placeholder={t('offers.form.amount')}
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
