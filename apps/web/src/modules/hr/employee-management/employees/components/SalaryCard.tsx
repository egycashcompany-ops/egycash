// «الراتب» — its own section, out of «شروط التوظيف».
//
// «عاوز اشيل حتت الراتب دي و اعملها سكشن لوحدها». HR types ONE figure, the gross; the fixed salary,
// the attendance bonus, the insurance salary and the gross in words follow from it and cannot be
// typed — a figure that is a formula does not get a second, hand-entered answer to disagree with.
//
// What is saved is unchanged: the gross, as the employee's salary, exactly as the old field saved
// it. The rest is computed from it wherever it is shown.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { MoneyInput } from '../../../../../shared/ui/MoneyInput';
import { Field } from '../../../../../shared/ui/form';
import { formatMoney } from '../../../../../shared/lib/format';
import { amountInArabicWords, salaryBreakdown } from '@ecms/contracts';

/** A figure that follows from the gross: shown like a field, but not one anybody can type in. */
const Computed = ({ value, locale }: { value: number | null; locale: Locale }): JSX.Element => (
  <div
    className="min-h-[2.5rem] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    dir="ltr"
  >
    {value === null ? '—' : formatMoney(value, 'EGP', locale)}
  </div>
);

export const SalaryCard = ({
  value,
  onChange,
}: {
  /** The gross as MoneyInput holds it — a plain decimal string, or '' for none. */
  value: string;
  onChange: (next: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const gross = value.trim() === '' ? null : Number(value);
  const parts = salaryBreakdown(gross);

  return (
    <Card>
      <CardHeader title={t('employees.salary.title')} />
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('employees.salary.gross')} hint={t('offers.form.optional')}>
            <MoneyInput value={value} onChange={onChange} />
          </Field>
          <Field label={t('employees.salary.fixed')} hint={t('employees.salary.fixedRule')}>
            <Computed value={parts?.fixed ?? null} locale={locale} />
          </Field>
          <Field label={t('employees.salary.attendanceBonus')} hint={t('employees.salary.attendanceBonusRule')}>
            <Computed value={parts?.attendanceBonus ?? null} locale={locale} />
          </Field>
          <Field label={t('employees.salary.insurance')} hint={t('employees.salary.insuranceRule')}>
            <Computed value={parts?.insurance ?? null} locale={locale} />
          </Field>
          {/* Always Arabic, whatever the screen's language: these are the words a salary paper carries. */}
          <div className="sm:col-span-2">
            <Field label={t('employees.salary.inWords')}>
              <div
                className="min-h-[2.5rem] rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200"
                dir="rtl"
                lang="ar"
              >
                {parts === null ? '—' : amountInArabicWords(parts.gross)}
              </div>
            </Field>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('employees.salary.computedNote')}</p>
      </CardBody>
    </Card>
  );
};
