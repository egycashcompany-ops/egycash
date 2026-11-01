// The counts beside a settlement page's title (`PageHeader figures`, §9.4–§9.6): counts only — a
// money total never sits in the header (UI-30) — each a label and a number, a dash while the first
// answer is on its way.
import { type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../../shared/lib/format';

export const SettlementFigures = ({
  figures,
  locale,
  label,
}: {
  figures: readonly { key: string; label: string; value: number | undefined }[];
  locale: Locale;
  /** The group's accessible name — the page's title. */
  label: string;
}): JSX.Element => (
  <div
    role="group"
    aria-label={label}
    data-settlement-figures="true"
    className="flex flex-wrap items-center gap-1.5"
  >
    {figures.map((figure) => (
      <span
        key={figure.key}
        data-settlement-figure={figure.key}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm dark:border-slate-800 dark:bg-[#111827]"
      >
        <span className="text-slate-500 dark:text-slate-400">{figure.label}</span>
        <strong className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {formatNumber(figure.value, locale)}
        </strong>
      </span>
    ))}
  </div>
);
