// Read-only render of an offer's terms (used for the live package, revisions, and the accepted
// snapshot). Organizational references resolve to names via the cached reference lists (same as the
// form); the manager resolves via UserName. Falls back to a short reference without directory access.
import { type ReactNode } from 'react';
import { type Locale, type OfferTermsDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { formatDate, formatMoney, localized } from '../../../../../shared/lib/format';
import { UserName } from './UserName';
import { useBranches, useDepartments, useJobTitles } from '../api/job-offer-queries';

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const TermsView = ({ terms }: { terms: OfferTermsDto }): JSX.Element => {
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
        <Row label={t('offers.form.jobTitle')}>{nameOf(jobTitles.data, terms.jobTitleId)}</Row>
        <Row label={t('offers.form.department')}>{nameOf(departments.data, terms.departmentId)}</Row>
        <Row label={t('offers.form.branch')}>{nameOf(branches.data, terms.branchId)}</Row>
        <Row label={t('offers.form.manager')}>{terms.managerId === null ? '—' : <UserName id={terms.managerId} />}</Row>
        <Row label={t('offers.form.employmentType')}>{t(`offers.employmentType.${terms.employmentType}`)}</Row>
        <Row label={t('offers.form.salary')}>{terms.salary === null ? '—' : formatMoney(terms.salary.amount, terms.salary.currency, locale)}</Row>
        <Row label={t('offers.form.probation')}>{t('offers.terms.months', { n: terms.probationMonths })}</Row>
        <Row label={t('offers.form.startDate')}>{formatDate(terms.startDate, locale)}</Row>
        <Row label={t('offers.form.validUntil')}>{formatDate(terms.validUntil, locale)}</Row>
      </dl>

      {terms.allowances.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-400">{t('offers.form.allowances')}</p>
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {terms.allowances.map((a, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{a.name}</span>
                <span dir="ltr">{formatMoney(a.amount, a.currency, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {terms.benefits.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-400">{t('offers.form.benefits')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {terms.benefits.map((b, i) => (
              <li key={i} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {terms.notes !== null && terms.notes !== '' && (
        <Row label={t('offers.form.notes')}>{terms.notes}</Row>
      )}
    </div>
  );
};
