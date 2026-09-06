// Read-only render of an employee's employment terms (copied from the accepted offer snapshot).
//
// Unit NAMES come from the DTO's `placement`, resolved by the server — not from the browser-side
// catalogues this used to consult. Those are paginated at 100 and gated by their own `*.view`, so
// on a deployment with 142 job titles every title past the hundredth rendered as `#4db1e9`: the
// last six characters of an id, shown to a person as their job. A unit the server could not
// resolve is a dash, which is at least honest. Manager names still resolve through `UserName`.
import { type ReactNode } from 'react';
import { type EmployeePlacementDto, type EmploymentDetailsDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { formatDate, formatMoney, localized } from '../../../../../shared/lib/format';
import { UserName } from '../../../recruitment/job-offers/components/UserName';

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const EmploymentView = ({
  employment,
  placement,
  compensationVisible = true,
}: {
  employment: EmploymentDetailsDto;
  /** The same placement, resolved to names by the server. */
  placement: EmployeePlacementDto;
  /** false → salary/allowances were redacted server-side (no employee.viewCompensation). */
  compensationVisible?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const nameOf = (unit: EmployeePlacementDto[keyof EmployeePlacementDto]): string =>
    unit === null ? '—' : localized(unit.name, locale);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label={t('offers.form.jobTitle')}>{nameOf(placement.jobTitle)}</Row>
        <Row label={t('offers.form.department')}>{nameOf(placement.department)}</Row>
        <Row label={t('offers.form.branch')}>{nameOf(placement.branch)}</Row>
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
