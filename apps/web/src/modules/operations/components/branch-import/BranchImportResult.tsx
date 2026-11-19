// «استيراد فروع من شيت» (Round 29) — the comparison, drawn: the sheet that was read (bank, file,
// rows) with «رفع شيت آخر»; how it was read (its tab, its header row, the column of each label);
// the five counts; the areas «المناطق» will gain (Arabic and English) and the English names it will
// fill; the table. «تأكيد الاستيراد» sits in the sheet's strip at the top. A refusal of the apply because the comparison went out of
// date says so and offers «مقارنة من جديد». Rows to look at before confirming (a new branch the bank
// may hold spelt another way, an area not written as the sheet gives it — Round 29 critic) are
// said above the counts, with «اعرضها». Nothing here writes — the confirmation does.
import { useState } from 'react';
import { type OperationsBranchImportCompareDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { pluralKey } from '../../../../shared/lib/plural';
import { Spinner } from '../../../../shared/ui/Spinner';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../../../fleet/components/FuelCardBoard';
import { FileName } from '../../../fleet/components/fuel-reconcile/reconcile-cells';
import {
  filterCounts,
  visibleRows,
  writesAnything,
  type BranchImportFilter,
} from '../../lib/branch-import';
import { BranchImportTable, OUTCOME_TONE } from './BranchImportTable';

const W = 'operations.catalogs.branchImport.';

/** One count across the top — the fuel-card comparison's tile (BoardKpi), in five tones. */
const Kpi = ({
  filter,
  value,
  on,
  onPick,
}: {
  filter: Exclude<BranchImportFilter, 'all'>;
  value: number;
  on: boolean;
  onPick: () => void;
}) => {
  const t = useT();
  return (
    <button
      type="button"
      data-branch-import-kpi={filter}
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        'flex flex-col gap-0.5 rounded-xl border bg-white px-4 py-3 text-start transition dark:bg-[#111827]',
        on
          ? 'border-[#6c63ff] shadow-[0_0_0_1px_#6c63ff]'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {t(`${W}kpi.${filter}`)}
        </span>
        <span className={cn('h-2.5 w-2.5 rounded-full border', OUTCOME_TONE[filter])} />
      </span>
      <span
        dir="ltr"
        className={cn(NUM, 'text-end text-2xl font-black text-slate-900 dark:text-white')}
      >
        {value}
      </span>
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {t(`${W}kpi.${filter}Note`)}
      </span>
    </button>
  );
};

export const BranchImportResult = ({
  result,
  outOfDate,
  refusal,
  busy,
  onAnother,
  onCompareAgain,
  onConfirm,
}: {
  result: OperationsBranchImportCompareDto;
  /** The apply was refused: the comparison is out of date. */
  outOfDate: boolean;
  /** A refusal's words, or null. */
  refusal: string | null;
  busy: boolean;
  /** «رفع شيت آخر» — back to the two steps. */
  onAnother: () => void;
  onCompareAgain: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [filter, setFilter] = useState<BranchImportFilter>('all');
  const [search, setSearch] = useState('');
  const counts = filterCounts(result);
  const rows = visibleRows(result.rows, filter, search);
  const anything = writesAnything(result);
  const latin = result.rows.some((row) => row.areaLatinOnly);
  const rowsText = t(pluralKey(`${W}rowsCount`, locale, result.counts.rows), {
    count: result.counts.rows,
  });
  return (
    <div className="space-y-4" data-branch-import-result="true">
      {/* The sheet that was read, and a way to read another. */}
      <section
        data-branch-import-sheet="true"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-[#111827]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-lg font-bold text-slate-900 dark:text-white">
            {t(`${W}resultTitle`, { bank: result.bankName })}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <BoardIcon d={PATH.excel} className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <FileName
              name={result.fileName}
              className="font-bold text-slate-800 dark:text-slate-200"
            />
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {rowsText}
            </span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-branch-import-again="true"
            onClick={onAnother}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <BoardIcon
              d={PATH.excel}
              className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
            />
            {t(`${W}another`)}
          </button>
          {/* «تأكيد الاستيراد» — at the top, in reach before the long table. */}
          <button
            type="button"
            data-branch-import-confirm="true"
            disabled={!anything || busy || outOfDate}
            onClick={onConfirm}
            title={anything ? t(`${W}confirmHint`) : t(`${W}confirmNothing`)}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-sm shadow-emerald-700/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <BoardIcon d={['M5 13l4 4L19 7']} className="h-4 w-4" />
            )}
            {t(`${W}confirm`)}
          </button>
        </span>
        <span
          data-branch-import-confirm-hint="true"
          className="basis-full text-[11px] text-slate-500 dark:text-slate-400"
        >
          {anything ? t(`${W}confirmHint`) : t(`${W}confirmNothing`)}
        </span>
      </section>

      {/* How the sheet was read. */}
      <p
        data-branch-import-layout="true"
        className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
      >
        {t(`${W}layout`, { sheet: result.sheetName, row: result.headerRow })}
        {result.layout.map((column) => (
          <span
            key={column.role}
            className="rounded border border-slate-200 bg-white px-1.5 py-px font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-slate-300"
          >
            {t(`${W}col.${column.role}`)}{' '}
            {/* No ligatures: the digits' font draws «(C)» as «©» in a left-to-right line. */}
            <span
              dir="ltr"
              data-branch-import-column={column.column}
              className={cn(NUM, 'text-[11px] text-slate-400 [font-variant-ligatures:none]')}
            >
              ({column.column})
            </span>
          </span>
        ))}
      </p>
      {counts.review > 0 && (
        <p
          data-branch-import-review="true"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-orange-300/70 bg-orange-50 px-4 py-2.5 text-xs font-medium text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200"
        >
          <span>{t(`${W}reviewNote`)}</span>
          <button
            type="button"
            data-branch-import-review-show="true"
            onClick={() => setFilter('review')}
            className="rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-[11px] font-bold text-orange-800 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-100"
          >
            {t(`${W}reviewShow`, { count: counts.review })}
          </button>
        </p>
      )}
      {latin && (
        <p
          data-branch-import-latin="true"
          className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          {t(`${W}latinNote`)}
        </p>
      )}

      {(outOfDate || refusal !== null) && (
        <div
          role="alert"
          data-branch-import-refusal={outOfDate ? 'changed' : 'other'}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          <span className="flex items-start gap-2">
            <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
            {refusal}
          </span>
          {outOfDate && (
            <button
              type="button"
              data-branch-import-compare-again="true"
              onClick={onCompareAgain}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100"
            >
              {t(`${W}compareAgain`)}
            </button>
          )}
        </div>
      )}

      {/* The counts — each one the table's filter too. */}
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        data-branch-import-counts="true"
      >
        {(['new', 'update', 'unchanged', 'suffixed', 'problem'] as const).map((option) => (
          <Kpi
            key={option}
            filter={option}
            value={counts[option]}
            on={filter === option}
            onPick={() => setFilter(filter === option ? 'all' : option)}
          />
        ))}
      </section>

      {/* The areas «المناطق» gains, and the English names it fills. */}
      {(result.newAreas.length > 0 || result.filledAreas.length > 0) && (
        <section
          data-branch-import-areas="true"
          className="space-y-2.5 rounded-2xl border border-emerald-300/60 bg-emerald-50/50 px-4 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/[0.05]"
        >
          {result.newAreas.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                {t(`${W}areas.title`, { count: result.newAreas.length })}
              </h3>
              <ul className="flex max-h-[8.5rem] flex-wrap gap-2 overflow-y-auto pe-1">
                {result.newAreas.map((area) => (
                  <li
                    key={area.name}
                    data-branch-import-area={area.name}
                    className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs dark:border-emerald-500/30 dark:bg-[#0b0f19]"
                  >
                    <span dir="auto" className="font-bold text-slate-900 dark:text-white">
                      {area.name}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    {area.nameEn === null ? (
                      <span className="text-slate-400">{t(`${W}areas.noEnglish`)}</span>
                    ) : (
                      <span dir="ltr" className="text-slate-600 dark:text-slate-300">
                        {area.nameEn}
                      </span>
                    )}
                    <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {t(pluralKey(`${W}rowsCount`, locale, area.rows), { count: area.rows })}
                    </span>
                    {area.latinOnly && (
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        {t(`${W}badge.latin`)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.filledAreas.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <span className="font-bold">{t(`${W}areas.filled`)}</span>
              {result.filledAreas.map((area) => (
                <span
                  key={area.id}
                  className="rounded border border-slate-200 bg-white px-1.5 py-px dark:border-slate-700 dark:bg-[#0b0f19]"
                >
                  <span dir="auto">{area.name}</span>:{' '}
                  <span dir="ltr" className="font-bold">
                    {area.nameEn}
                  </span>
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      <BranchImportTable
        rows={rows}
        counts={counts}
        filter={filter}
        search={search}
        onFilter={setFilter}
        onSearch={setSearch}
      />
    </div>
  );
};
