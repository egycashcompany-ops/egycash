// Read-only render of an employee's employment terms (copied from the accepted offer snapshot).
// Reuses the Job Offer feature's reference hooks + UserName so org/manager names resolve from the
// same cache — no new API. Falls back to a short reference without directory access.
import { type ReactNode } from 'react';
import { type EmploymentDetailsDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { formatDate, formatMoney, localized } from '../../../../../shared/lib/format';
import { UserName } from '../../../recruitment/job-offers/components/UserName';
import { useBranches, useDepartments, useJobTitles } from '../../../recruitment/job-offers/api/job-offer-queries';

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const EmploymentView = ({
  employment,
  compensationVisible = true,
}: {
  employment: EmploymentDetailsDto;
  /** false → salary/allowances were redacted server-side (no employee.viewCompensation). */
  compensationVisible?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useBranches(can('branch.view'));
  const departments = useDepartments(can('department.view'));
  const jobTitles = useJobTitles(can('jobTitle.view'));

  const nameOf = (
    list: { id: string; name: { ar: string; en: string } }[] | undefined,
    id: string,
  ): string => {
    const hit = list?.find((x) => x.id === id);
    return hit === undefined ? `#${id.slice(-6)}` : localized(hit.name, locale);
  };

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label={t('offers.form.jobTitle')}>{nameOf(jobTitles.data, employment.jobTitleId)}</Row>
        <Row label={t('offers.form.department')}>{nameOf(departments.data, employment.departmentId)}</Row>
        <Row label={t('offers.form.branch')}>{nameOf(branches.data, employment.branchId)}</Row>
        <Row label={t('offers.form.manager')}>{employment.managerId === null ? '—' : <UserName id={employment.managerId} />}</Row>
        <Row label={t('offers.form.employmentType')}>{t(`offers.employmentType.${employment.employmentType}`)}</Row>
        <Row label={t('offers.form.salary')}>
          {!compensationVisible
            ? t('employees.compensation.hidden')
            : employment.salary === null
              ? '—'
              : formatMoney(employment.salary.amount, employment.salary.currency, locale)}
        </Row>
        <Row label={t('offers.form.probation')}>{t('offers.terms.months', { n: employment.probationMonths })}</Row>
        <Row label={t('offers.form.startDate')}>{formatDate(employment.startDate, locale)}</Row>
      </dl>

      {employment.allowances.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-400">{t('offers.form.allowances')}</p>
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {employment.allowances.map((a, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{a.name}</span>
                <span dir="ltr">{formatMoney(a.amount, a.currency, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {employment.benefits.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-400">{t('offers.form.benefits')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {employment.benefits.map((b, i) => (
              <li key={i} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
