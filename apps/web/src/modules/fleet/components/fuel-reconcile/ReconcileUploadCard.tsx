// «مطابقة أرصدة الكروت» — before the sheet is read: «1 اختر الشركة» (وطنية / شل أوت, each with its
// cards and balance from «شحن الكروت»'s own summary), «2 ارفع شيت الأرصدة» (.xlsx, its three
// columns named), and «مقارنة بالأرصدة», which posts the file. The server reads it and answers the
// comparison; nothing is written yet. The approved sample's card (cs1, cs2), class for class.
import { type ReactNode } from 'react';
import {
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_SHEET_COLUMNS,
  FLEET_FUEL_SHEET_MAX_MB,
  FLEET_FUEL_SHEET_NAME_PREFIX,
  type FleetFuelCardCompany,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { FileUpload } from '../../../../shared/ui/FileUpload';
import { Spinner } from '../../../../shared/ui/Spinner';
import { CloseIcon } from '../../../../shared/ui/icons';
import { cn } from '../../../../shared/lib/cn';
import { useFuelCardSummary } from '../../api/fleet-queries';
import { BoardIcon, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { TITLE } from '../custody-dashboard-parts';
import { money } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The step's number in its circle — «1 اختر الشركة». */
const Step = ({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children?: ReactNode;
}): JSX.Element => (
  <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
    <span
      className={cn(
        NUM,
        'flex h-6 w-6 items-center justify-center rounded-full bg-[#5b4cff] text-xs text-white shadow-[0_0_14px_-3px_rgba(91,76,255,0.7)]',
      )}
    >
      {n}
    </span>
    {label}
    {children}
  </span>
);

/** One company's radio card: its badge, its name and prefix, its cards and their balance. */
const CompanyOption = ({
  company,
  on,
  onPick,
}: {
  company: FleetFuelCardCompany;
  on: boolean;
  onPick: () => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const summary = useFuelCardSummary({ company }).data;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-recon-company={company}
      onClick={onPick}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-3.5 text-start transition',
        on
          ? 'border-[#6c63ff] shadow-[0_0_0_1px_#6c63ff,0_0_22px_-6px_rgba(108,99,255,0.55)] [background:linear-gradient(145deg,rgba(108,99,255,0.12),rgba(255,255,255,0.95))] dark:[background:linear-gradient(145deg,rgba(108,99,255,0.25),rgba(15,23,60,0.7))]'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-[#0b0f19] dark:hover:border-slate-600',
      )}
    >
      <span className="flex w-full items-center gap-3">
        <CompanyBadge company={company} size="lg" />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-slate-900 dark:text-white">
            {t(`fleet.fuelCards.company.${company}`)}
          </span>
          <span
            dir="ltr"
            className={cn(NUM, 'text-end text-xs text-slate-500 dark:text-slate-400')}
          >
            {FLEET_FUEL_SHEET_NAME_PREFIX[company]}…
          </span>
        </span>
        <span
          className={cn(
            'ms-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
            on ? 'border-[#6c63ff] bg-[#6c63ff]' : 'border-slate-300 dark:border-slate-600',
          )}
        >
          {on && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        <span>{summary === undefined ? '—' : count.cards(summary.cardCount)}</span>
        <span className="flex items-baseline gap-1">
          <span dir="ltr" className={cn(NUM, 'font-bold text-slate-700 dark:text-slate-200')}>
            {summary === undefined
              ? '—'
              : money(company === 'wataniya' ? summary.wataniyaBalance : summary.chilloutBalance)}
          </span>
          {t('fleet.fuelCards.board.kpi.currency')}
        </span>
      </span>
    </button>
  );
};

export const ReconcileUploadCard = ({
  company,
  file,
  reading,
  onCompany,
  onFile,
  onCompare,
}: {
  company: FleetFuelCardCompany | null;
  file: File | null;
  reading: boolean;
  onCompany: (company: FleetFuelCardCompany) => void;
  onFile: (file: File | null) => void;
  onCompare: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <section
      data-recon-upload="true"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111827]"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <span className="rounded-xl bg-[#5b4cff]/10 p-2.5 text-[#4f3dff] dark:bg-[#6c63ff]/15 dark:text-[#a59dff]">
          <BoardIcon d={PATH.link} className="h-5 w-5" />
        </span>
        <h1 className={cn(TITLE, 'text-lg')}>{t('fleet.fuelCards.reconcile.title')}</h1>
      </header>
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)_auto]">
        {/* 1 — the company */}
        <div className="space-y-3">
          <Step n={1} label={t('fleet.fuelCards.reconcile.stepCompany')} />
          <div
            className="grid grid-cols-2 gap-3"
            role="radiogroup"
            aria-label={t('fleet.fuelCards.reconcile.stepCompany')}
          >
            {FLEET_FUEL_CARD_COMPANIES.map((option) => (
              <CompanyOption
                key={option}
                company={option}
                on={company === option}
                onPick={() => onCompany(option)}
              />
            ))}
          </div>
        </div>

        {/* 2 — the sheet */}
        <div className="space-y-3" data-recon-file="true">
          <Step n={2} label={t('fleet.fuelCards.reconcile.stepSheet')}>
            <span className="ms-1 inline-flex flex-wrap items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t('fleet.fuelCards.reconcile.dropNote')}
              {FLEET_FUEL_SHEET_COLUMNS.map((column) => (
                <span
                  key={column}
                  dir="ltr"
                  className={cn(
                    NUM,
                    'rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-slate-600 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-slate-300',
                  )}
                >
                  {column}
                </span>
              ))}
            </span>
          </Step>
          {file === null ? (
            <div className="[&_[role=button]]:!min-h-[132px] [&_[role=button]]:!py-6">
              <FileUpload
                accept={XLSX}
                maxSizeMb={FLEET_FUEL_SHEET_MAX_MB}
                onFiles={(files) => onFile(files[0] ?? null)}
              />
            </div>
          ) : (
            // The file that will be read — in the board's own look, its size in Latin figures.
            <div
              data-recon-file-chosen="true"
              className="flex min-h-[132px] items-center gap-3 rounded-xl border-2 border-emerald-500/50 bg-emerald-50 px-5 py-4 dark:bg-emerald-500/[0.07]"
            >
              <span className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-700 dark:text-emerald-300">
                <BoardIcon d={PATH.excel} className="h-6 w-6" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  dir="ltr"
                  className="truncate text-end text-[15px] font-bold text-slate-900 dark:text-white"
                >
                  {file.name}
                </span>
                <span
                  dir="ltr"
                  className={cn(NUM, 'text-end text-xs text-slate-500 dark:text-slate-400')}
                >
                  {(file.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB
                </span>
              </span>
              <button
                type="button"
                data-recon-file-remove="true"
                onClick={() => onFile(null)}
                aria-label={t('fleet.fuelCards.reconcile.removeFile')}
                title={t('fleet.fuelCards.reconcile.removeFile')}
                className="ms-auto rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* The comparison — under no step of its own: it is what the two steps are for. */}
        <div className="flex flex-col items-stretch justify-center gap-2 lg:pt-9">
          <button
            type="button"
            data-recon-compare="true"
            disabled={company === null || file === null || reading}
            onClick={onCompare}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-7 text-[15px] font-bold text-white shadow-[0_6px_24px_rgba(91,76,255,0.45)] transition hover:from-[#5a4aff] hover:to-[#7a6dff] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {reading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <BoardIcon d={PATH.trend} className="h-4 w-4" />
            )}
            {reading
              ? t('fleet.fuelCards.reconcile.reading')
              : t('fleet.fuelCards.reconcile.compare')}
          </button>
          <span
            className="min-h-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            data-recon-compare-hint="true"
          >
            {company === null
              ? t('fleet.fuelCards.reconcile.compareNeedsCompany')
              : file === null
                ? t('fleet.fuelCards.reconcile.compareNeedsFile')
                : ''}
          </span>
        </div>
      </div>
    </section>
  );
};
