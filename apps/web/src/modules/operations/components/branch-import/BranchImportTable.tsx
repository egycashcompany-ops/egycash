// «استيراد فروع من شيت» (Round 29) — every row of the sheet and what it comes to: «جديد», «تحديث»
// (the held code and area → the sheet's), «بدون تغيير», «كود معدَّل» (the sheet's code → the code
// stored) and «مشكلة» (not written, and why) — and «للمراجعة» (Round 29 critic): «قد يكون مكرَّرًا»
// on a new row whose name the bank holds spelt another way, and why an area is not the sheet's own.
// Filters by outcome over the table (toggle buttons, one Tab stop each, `aria-pressed`), and a search
// by name, code or area. The fuel-card comparison's table look (ReconcileTable.tsx).
import { type ReactNode } from 'react';
import {
  isOperationsBranchImportSuffixedWrite,
  type OperationsBranchImportRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM } from '../../../fleet/components/FuelCardBoard';
import { BRANCH_IMPORT_FILTERS, type BranchImportFilter } from '../../lib/branch-import';

const W = 'operations.catalogs.branchImport.';

/** Each outcome's colour — the chip, the filter, the tile. */
export const OUTCOME_TONE: Record<BranchImportFilter, string> = {
  all: 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  new: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  update:
    'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
  unchanged:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
  suffixed:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  review:
    'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300',
  problem:
    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
};

const CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold';
const TH = 'px-3 py-2.5 text-xs font-bold whitespace-nowrap';
const TD = 'px-3 py-2 align-top text-sm';
const MUTED = 'text-slate-400 dark:text-slate-500';

/**
 * «old → new», the arrow pointing the way the line reads. A screen reader hears «كان … أصبح …»: the
 * strike-through and the arrow are drawn only (Round 29 critic).
 */
const Change = ({ from, to, tone }: { from: ReactNode; to: ReactNode; tone?: string }) => {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-branch-import-change="true">
      <span className="text-slate-400 line-through decoration-slate-400/60 dark:text-slate-500">
        <span className="sr-only">{t(`${W}change.was`)} </span>
        {from}
      </span>
      <BoardIcon
        d={['M5 12h14m-5-5l5 5-5 5']}
        className="h-3.5 w-3.5 shrink-0 text-slate-400 rtl:rotate-180"
      />
      <span className={cn('font-bold', tone)}>
        <span className="sr-only">{t(`${W}change.now`)} </span>
        {to}
      </span>
    </span>
  );
};

const Code = ({ code }: { code: string | null }) =>
  code === null ? (
    <span className={MUTED}>—</span>
  ) : (
    <span dir="ltr" className={cn(NUM, 'text-[13px]')}>
      {code}
    </span>
  );

const CodeCell = ({ row }: { row: OperationsBranchImportRowDto }) => {
  if (row.outcome === 'problem') return <Code code={row.sheetCode} />;
  const after = row.after?.code ?? null;
  if (row.before !== null && row.before.code !== after) {
    return (
      <Change
        from={<Code code={row.before.code} />}
        to={<Code code={after} />}
        tone={
          row.codeSuffixed ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-sky-300'
        }
      />
    );
  }
  if (isOperationsBranchImportSuffixedWrite(row)) {
    return (
      <Change
        from={<Code code={row.sheetCode} />}
        to={<Code code={after} />}
        tone="text-amber-700 dark:text-amber-300"
      />
    );
  }
  // Held with its suffix already, and written nothing: the code it keeps, and the sheet's.
  if (row.codeSuffixed) return <HeldSuffix row={row} code={after} />;
  return <Code code={after} />;
};

const HeldSuffix = ({ row, code }: { row: OperationsBranchImportRowDto; code: string | null }) => {
  const t = useT();
  return (
    <span className="flex flex-col items-start gap-0.5" data-branch-import-held-suffix="true">
      <Code code={code} />
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        {t(`${W}sheetCode`)}{' '}
        <span dir="ltr" className={NUM}>
          {row.sheetCode}
        </span>
      </span>
    </span>
  );
};

const Area = ({ name }: { name: string | null }) =>
  name === null ? <span className={MUTED}>—</span> : <span dir="auto">{name}</span>;

const AreaCell = ({ row }: { row: OperationsBranchImportRowDto }) => {
  const t = useT();
  if (row.outcome === 'problem') return <Area name={row.sheetArea.ar ?? row.sheetArea.en} />;
  const after = row.after?.opsAreaName ?? null;
  const before = row.before;
  const changed =
    before !== null &&
    (before.opsAreaName !== after ||
      before.financeAreaName !== (row.after?.financeAreaName ?? null));
  return (
    <span className="flex flex-col items-start gap-1">
      {changed ? (
        <Change
          from={<Area name={before.opsAreaName} />}
          to={<Area name={after} />}
          tone="text-sky-700 dark:text-sky-300"
        />
      ) : (
        <Area name={after} />
      )}
      {changed && before.financeAreaName !== before.opsAreaName && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {t(`${W}financeWas`, { area: before.financeAreaName ?? '—' })}
        </span>
      )}
      <span className="flex flex-wrap gap-1">
        {row.areaIsNew && (
          <span className={cn(CHIP, OUTCOME_TONE.new)} data-branch-import-new-area="true">
            {t(`${W}badge.newArea`)}
          </span>
        )}
        {row.areaLatinOnly && (
          <span className={cn(CHIP, OUTCOME_TONE.unchanged)}>{t(`${W}badge.latin`)}</span>
        )}
      </span>
      {row.areaNote !== null && (
        <span
          data-branch-import-area-note={row.areaNote}
          className="max-w-[18rem] text-[11px] leading-relaxed text-orange-700 dark:text-orange-300"
        >
          {t(`${W}areaNote.${row.areaNote}`, {
            area: [row.sheetArea.ar, row.sheetArea.en].filter((part) => part !== null).join(' | '),
            en: row.sheetArea.en ?? row.sheetArea.ar ?? '—',
          })}
        </span>
      )}
    </span>
  );
};

const OutcomeCell = ({ row }: { row: OperationsBranchImportRowDto }) => {
  const t = useT();
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-1">
        <span
          className={cn(CHIP, OUTCOME_TONE[row.outcome])}
          data-branch-import-outcome={row.outcome}
        >
          {t(`${W}outcome.${row.outcome}`)}
        </span>
        {isOperationsBranchImportSuffixedWrite(row) && (
          <span className={cn(CHIP, OUTCOME_TONE.suffixed)} data-branch-import-suffixed="true">
            {t(`${W}filter.suffixed`)}
          </span>
        )}
        {row.similarTo !== null && (
          <span className={cn(CHIP, OUTCOME_TONE.review)} data-branch-import-similar="true">
            {t(`${W}badge.similar`)}
          </span>
        )}
        {row.inactive && (
          <span className={cn(CHIP, OUTCOME_TONE.unchanged)}>{t(`${W}badge.inactive`)}</span>
        )}
      </span>
      {row.problem !== null && (
        <span className="max-w-[18rem] text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
          {t(`${W}problem.${row.problem}`)}
        </span>
      )}
      {row.similarTo !== null && (
        <span className="max-w-[18rem] text-[11px] leading-relaxed text-orange-700 dark:text-orange-300">
          {t(`${W}similarTo`, { name: row.similarTo.name, code: row.similarTo.code })}
        </span>
      )}
    </span>
  );
};

export const BranchImportTable = ({
  rows,
  counts,
  filter,
  search,
  onFilter,
  onSearch,
}: {
  /** The rows the filter and the search leave. */
  rows: readonly OperationsBranchImportRowDto[];
  counts: Record<BranchImportFilter, number>;
  filter: BranchImportFilter;
  search: string;
  onFilter: (filter: BranchImportFilter) => void;
  onSearch: (search: string) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <section
      data-branch-import-table="true"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t(`${W}filterLabel`)}>
          {/* «للمراجعة» only when a row needs it — the one filter that is not always there. */}
          {BRANCH_IMPORT_FILTERS.filter(
            (option) => option !== 'review' || counts.review > 0 || filter === 'review',
          ).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              data-branch-import-filter={option}
              onClick={() => onFilter(option)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition',
                filter === option
                  ? cn(OUTCOME_TONE[option], 'ring-2 ring-[#6c63ff]/50')
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-slate-300',
              )}
            >
              {t(`${W}filter.${option}`)}
              <span dir="ltr" className={cn(NUM, 'text-[11px] opacity-80')}>
                {counts[option]}
              </span>
            </button>
          ))}
        </div>
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t(`${W}search`)}
          debounceMs={150}
          className="w-full sm:ms-auto sm:w-72"
        />
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse" data-branch-import-rows={rows.length}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 text-slate-500 dark:bg-[#0c1322] dark:text-slate-400 [&_th]:shadow-[inset_0_-1px_0_#cbd5e1] dark:[&_th]:shadow-[inset_0_-1px_0_#233552]">
              <th className={cn(TH, 'w-14 text-center')}>{t(`${W}col.row`)}</th>
              <th className={cn(TH, 'text-start')}>{t(`${W}col.branch`)}</th>
              <th className={cn(TH, 'text-start')}>{t(`${W}col.codeHead`)}</th>
              <th className={cn(TH, 'text-start')}>{t(`${W}col.areaHead`)}</th>
              <th className={cn(TH, 'text-start')}>{t(`${W}col.addressHead`)}</th>
              <th className={cn(TH, 'text-start')}>{t(`${W}col.outcome`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.row}
                data-branch-import-row={row.row}
                className={cn(
                  'border-t border-slate-100 dark:border-slate-800/80',
                  row.outcome === 'problem' && 'bg-rose-50/60 dark:bg-rose-500/[0.05]',
                )}
              >
                <td className={cn(TD, 'text-center')}>
                  <span dir="ltr" className={cn(NUM, 'text-xs text-slate-400 dark:text-slate-500')}>
                    {row.row}
                  </span>
                </td>
                <td className={cn(TD, 'font-bold text-slate-900 dark:text-white')}>
                  {row.name === null ? (
                    <span className={MUTED}>—</span>
                  ) : (
                    <span dir="auto">{row.name}</span>
                  )}
                </td>
                <td className={TD}>
                  <CodeCell row={row} />
                </td>
                <td className={cn(TD, 'text-slate-700 dark:text-slate-300')}>
                  <AreaCell row={row} />
                </td>
                <td className={cn(TD, 'max-w-[16rem] text-xs text-slate-600 dark:text-slate-400')}>
                  <Area name={row.after?.address ?? row.sheetAddress} />
                </td>
                <td className={TD}>
                  <OutcomeCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p
            className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
            data-branch-import-empty="true"
          >
            {t(`${W}empty`)}
          </p>
        )}
      </div>
    </section>
  );
};
