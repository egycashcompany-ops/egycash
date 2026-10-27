// «تاريخ التغذية» with its «اليوم» / «غدًا» chips (DS-25, §9.4, §9.6, §9.7): the day a page works
// on. The pages decide what the day opens on — tomorrow for the plan, the server's suggested day
// for Preparation and Control — and never remember it.
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Input } from '../../../../shared/ui/form';
import { cairoToday, cairoTomorrow } from '../../lib/settlement-dates';

export const DayField = ({
  value,
  onChange,
  id = 'settlement-day',
}: {
  /** 'YYYY-MM-DD'. */
  value: string;
  onChange: (day: string) => void;
  id?: string;
}): JSX.Element => {
  const t = useT();
  const today = cairoToday();
  const tomorrow = cairoTomorrow();
  const chip = (day: string, key: string): JSX.Element => (
    <button
      type="button"
      onClick={() => onChange(day)}
      aria-pressed={value === day}
      className={cn(
        'h-9 rounded-lg border px-3 text-sm',
        value === day
          ? 'border-brand-400 bg-brand-50 font-medium text-brand-700 dark:border-brand-500 dark:bg-brand-950 dark:text-brand-300'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
      )}
    >
      {t(key)}
    </button>
  );
  return (
    <div className="flex flex-wrap items-end gap-2" data-day-field="true">
      <label className="block space-y-1.5" htmlFor={id}>
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('atm.settlement.date')}
        </span>
        <Input
          id={id}
          type="date"
          value={value}
          onChange={(e) => {
            if (e.target.value !== '') onChange(e.target.value);
          }}
          className="min-w-44 max-w-44"
        />
      </label>
      {chip(today, 'atm.settlement.today')}
      {chip(tomorrow, 'atm.settlement.tomorrow')}
    </div>
  );
};

/** The page's one state when no work branch resolves (DS-22): the reason, and nothing else. */
export const BlockedNotice = ({ text }: { text: string }): JSX.Element => (
  <p
    role="status"
    data-settlement-blocked="true"
    className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
  >
    {text}
  </p>
);
