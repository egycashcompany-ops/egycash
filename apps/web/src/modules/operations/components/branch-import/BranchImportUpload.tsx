// «استيراد فروع من شيت» (Round 29) — before the sheet is read: «1 اختر البنك» (the sheet does not
// name it — the owner's decision), «2 ارفع شيت الفروع» (.xlsx, the columns it reads named by their
// headers, the others never read), and «مقارنة بالفروع», which posts the file. The server reads
// it and answers the comparison; nothing is written yet. The fuel-card sheet's upload card
// (fleet/components/fuel-reconcile/ReconcileUploadCard.tsx), class for class.
import { type ReactNode } from 'react';
import { OPERATIONS_BRANCH_IMPORT_MAX_MB, type OperationsBankDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { FileUpload } from '../../../../shared/ui/FileUpload';
import { Select } from '../../../../shared/ui/form';
import { Spinner } from '../../../../shared/ui/Spinner';
import { CloseIcon } from '../../../../shared/ui/icons';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../../../fleet/components/FuelCardBoard';
import { FileName } from '../../../fleet/components/fuel-reconcile/reconcile-cells';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const W = 'operations.catalogs.branchImport.';

/** The columns the reader binds, in the owner's sheets' order. */
export const BRANCH_IMPORT_COLUMN_KEYS = ['name', 'code', 'areaAr', 'areaEn', 'address'] as const;

/** The step's number in its circle — «1 اختر البنك». */
export const Step = ({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children?: ReactNode;
}) => (
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

export const BranchImportUpload = ({
  banks,
  bankId,
  file,
  reading,
  onBank,
  onFile,
  onCompare,
  onBack,
}: {
  /** The ACTIVE banks — an import writes into one. */
  banks: readonly OperationsBankDto[];
  bankId: string;
  file: File | null;
  reading: boolean;
  onBank: (bankId: string) => void;
  onFile: (file: File | null) => void;
  onCompare: () => void;
  /** «رجوع إلى الفروع». */
  onBack: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <section
      data-branch-import-upload="true"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111827]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <span className="rounded-xl bg-[#5b4cff]/10 p-2.5 text-[#4f3dff] dark:bg-[#6c63ff]/15 dark:text-[#a59dff]">
          <BoardIcon d={PATH.excel} className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t(`${W}title`)}</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t(`${W}nothingWritten`)}
          </span>
        </span>
        <button
          type="button"
          data-branch-import-back="true"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {t(`${W}back`)}
        </button>
      </header>
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_auto]">
        {/* 1 — the bank */}
        <div className="space-y-3">
          <Step n={1} label={t(`${W}stepBank`)} />
          <Select
            aria-label={t(`${W}stepBank`)}
            data-branch-import-bank="true"
            value={bankId}
            onChange={(event) => onBank(event.target.value)}
          >
            <option value="">{t(`${W}bankPlaceholder`)}</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.opsName}
              </option>
            ))}
          </Select>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(`${W}bankHint`)}
          </p>
        </div>

        {/* 2 — the sheet */}
        <div className="space-y-3" data-branch-import-file="true">
          <Step n={2} label={t(`${W}stepSheet`)} />
          <span
            data-branch-import-columns="true"
            className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400"
          >
            {t(`${W}columnsNote`)}
            {BRANCH_IMPORT_COLUMN_KEYS.map((key) => (
              <span
                key={key}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-slate-600 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-slate-300"
              >
                {t(`${W}col.${key}`)}
              </span>
            ))}
            <span className="text-slate-500 dark:text-slate-400">{t(`${W}othersIgnored`)}</span>
          </span>
          {file === null ? (
            <div className="[&_[role=button]]:!min-h-[120px] [&_[role=button]]:!py-6">
              <FileUpload
                accept={XLSX}
                maxSizeMb={OPERATIONS_BRANCH_IMPORT_MAX_MB}
                onFiles={(files) => onFile(files[0] ?? null)}
              />
            </div>
          ) : (
            <div
              data-branch-import-file-chosen="true"
              className="flex min-h-[120px] items-center gap-3 rounded-xl border-2 border-emerald-500/50 bg-emerald-50 px-5 py-4 dark:bg-emerald-500/[0.07]"
            >
              <span className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-700 dark:text-emerald-300">
                <BoardIcon d={PATH.excel} className="h-6 w-6" />
              </span>
              <span className="flex min-w-0 flex-col">
                <FileName
                  name={file.name}
                  className="truncate text-start text-[15px] font-bold text-slate-900 dark:text-white"
                />
                <span
                  dir="ltr"
                  className={cn(NUM, 'text-end text-xs text-slate-500 dark:text-slate-400')}
                >
                  {(file.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB
                </span>
              </span>
              <button
                type="button"
                data-branch-import-file-remove="true"
                onClick={() => onFile(null)}
                aria-label={t(`${W}removeFile`)}
                title={t(`${W}removeFile`)}
                className="ms-auto rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(`${W}areaNote`)}
          </p>
        </div>

        {/* The comparison — what the two steps are for. */}
        <div className="flex flex-col items-stretch justify-center gap-2 lg:pt-9">
          <button
            type="button"
            data-branch-import-compare="true"
            disabled={bankId === '' || file === null || reading}
            onClick={onCompare}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-7 text-[15px] font-bold text-white shadow-[0_6px_24px_rgba(91,76,255,0.45)] transition hover:from-[#5a4aff] hover:to-[#7a6dff] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {reading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <BoardIcon d={PATH.trend} className="h-4 w-4" />
            )}
            {t(reading ? `${W}comparing` : `${W}compare`)}
          </button>
          <span
            className="min-h-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            data-branch-import-compare-hint="true"
          >
            {bankId === '' ? t(`${W}needsBank`) : file === null ? t(`${W}needsFile`) : ''}
          </span>
        </div>
      </div>
    </section>
  );
};
