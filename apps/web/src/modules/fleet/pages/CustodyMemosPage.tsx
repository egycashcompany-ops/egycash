// «المذكرات» — the custody screen's second tab: every memo the fund's receipts were gathered onto,
// صيانة · وقود · كاوتش · غسيل, each printed on his paper of its kind.
//
// «مكان اشوف فيه المذكرات»: the boards' look throughout — the tabs, then a toolbar with the count,
// the Excel / PDF pair, «إعداد المذكرات» and «+ مذكرة جديدة»; the custody filter bar (the period,
// the kind, the status); the receipts no memo holds yet, kind by kind, each with its «+ مذكرة X»;
// and the memos on the custody board's table card — the figures over the whole filtered set, never
// this page's rows. A memo's name is the one he typed, or «مذكرة <النوع> رقم N» in muted ink.
//
// Each row: the eye (its paper), the pen, the printer and the bin. A memo the fund has replenished
// («استعاضة عهدة») is history — its pen and bin stay in their places, faded, saying why. Deleting a
// memo sends its receipts back to «إيصالات لم تدخل أي مذكرة بعد»; the row stays in the database
// (soft delete) and its number is never given to another memo.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FLEET_CUSTODY_MEMO_STATUSES,
  FLEET_CUSTODY_SOURCES,
  type FleetCustodyMemoRowDto,
  type FleetCustodyMemoStatus,
  type FleetCustodySource,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { CogIcon, EyeIcon, PrinterIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import * as fleetApi from '../api/fleet-api';
import {
  custodyQueryKeys,
  useCustodyMemoTotals,
  useCustodyMemos,
  useCustodyMemosOutside,
  useDeleteCustodyMemo,
} from '../api/fleet-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FleetPager } from '../components/FleetPager';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { CustodyKindBadge } from '../components/CustodyKinds';
import { CustodyFundHeader } from '../components/CustodyFundHeader';
import { CustodyMemoPaperView, usePrintOutcome } from '../components/CustodyMemoPaperView';
import { LockedRowAction } from '../components/LockedRowAction';
import { ACTION_GROUP, actionTone } from '../components/row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../components/row-action-icons';
import { CAIRO, NOTE, TITLE } from '../components/custody-dashboard-parts';
import {
  ADD_BUTTON,
  BRAND_BUTTON,
  CUSTODY_FILTER_LOOK,
  CUSTODY_TAB_TABLE,
  EMBEDDED_TABLE,
  MOVES_CHIP,
  SECTION_CARD,
  SECTION_FOOT,
  SECTION_STRIP,
} from '../components/custody-board-looks';
import {
  COUNT_BADGE,
  Dates,
  ExportPill,
  FIGURE,
  MEMO_NO,
  MemoName,
  MemoStatus,
  Money,
  PHONE_CARD,
  RECEIPT_ICON,
  SPEND_LOOK,
  TIGHT,
  memoDisplayName,
} from '../components/custody-memo-parts';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { memoFileName, memoPaperOf, memoSheets, printPaperAfter } from '../lib/custody-papers';
import { useCustodyCount } from '../lib/custody-words';
import { memoRefusalOf } from '../lib/custody-memo-editor';

/** Remembered across visits: the filters, the page size and the order. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['from', 'to', 'kind', 'status', 'size', 'sort'] as const;
const DEFAULT_PAGE_SIZE = 25;
/** The newest memo first — the highest number at the top. */
const DEFAULT_SORT = 'no:desc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
/** «النوع» as the address holds it, kept to the custody kinds the server knows. */
const memoKinds = (raw: string | null): FleetCustodySource[] =>
  csv(raw).filter((v): v is FleetCustodySource =>
    (FLEET_CUSTODY_SOURCES as readonly string[]).includes(v),
  );
/** «الحالة» as the address holds it — one of the two, or no filter at all. */
const memoStatusOf = (raw: string | null): FleetCustodyMemoStatus | '' =>
  (FLEET_CUSTODY_MEMO_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as FleetCustodyMemoStatus)
    : '';

/** What a row's actions do — the page owns the dialogs and the printing. */
interface MemoRowActions {
  onView: (memo: FleetCustodyMemoRowDto) => void;
  onPrint: (memo: FleetCustodyMemoRowDto) => void;
  onDelete: (memo: FleetCustodyMemoRowDto) => void;
}

/**
 * The eye, the pen, the printer and the bin — the owner's four in one box. A replenished memo keeps
 * its eye and printer; its pen and bin stay in their places, faded, with the reason on hover. The
 * grants still decide whether the pen and the bin show at all.
 */
const MemoActions = ({
  memo,
  onView,
  onPrint,
  onDelete,
}: { memo: FleetCustodyMemoRowDto } & MemoRowActions): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locked = memo.replenishment !== null;
  return (
    <span className={ACTION_GROUP} data-row-actions="custody-memo">
      <button
        type="button"
        data-memo-view-open={memo.no}
        title={t('fleet.custody.papers.viewMemo')}
        aria-label={t('fleet.custody.papers.viewMemo')}
        onClick={() => onView(memo)}
        className={actionTone('view')}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      {can('fleetReceipt.edit') &&
        (locked ? (
          <LockedRowAction
            kind="edit"
            reason={t('fleet.custody.memos.lockedEdit')}
            mark="custody-memo-edit"
          >
            <SquarePenIcon className="h-4 w-4" />
          </LockedRowAction>
        ) : (
          <Link
            to={`/fleet/custody/memos/${encodeURIComponent(memo.id)}`}
            data-memo-edit={memo.no}
            title={t('common.edit')}
            aria-label={t('common.edit')}
            className={actionTone('edit')}
          >
            <SquarePenIcon className="h-4 w-4" />
          </Link>
        ))}
      <button
        type="button"
        data-memo-print={memo.no}
        title={t('fleet.custody.papers.printMemo')}
        aria-label={t('fleet.custody.papers.printMemo')}
        onClick={() => onPrint(memo)}
        className={actionTone('print')}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {can('fleetReceipt.delete') &&
        (locked ? (
          <LockedRowAction
            kind="delete"
            reason={t('fleet.custody.memos.lockedDelete')}
            mark="custody-memo-delete"
          >
            <Trash2Icon className="h-4 w-4" />
          </LockedRowAction>
        ) : (
          <button
            type="button"
            data-memo-delete={memo.no}
            title={t('common.delete')}
            aria-label={t('common.delete')}
            onClick={() => onDelete(memo)}
            className={actionTone('delete')}
          >
            <Trash2Icon className="h-4 w-4" />
          </button>
        ))}
    </span>
  );
};

/** A phone has no room for eight columns: each memo is a card, its actions at its foot. */
const MemoCard = ({
  memo,
  ...actions
}: { memo: FleetCustodyMemoRowDto } & MemoRowActions): JSX.Element => {
  const t = useT();
  const { count } = useCustodyCount();
  return (
    <li data-memo-card={memo.no} className={PHONE_CARD}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className={cn(MEMO_NO, FIGURE, 'font-bold')}>{memo.no}</span>
          <CustodyKindBadge kind={memo.kind} />
        </span>
        <span className="text-[15px] font-bold">
          <Money value={memo.total} />
        </span>
      </div>
      <p className="mt-2 font-bold">
        <MemoName memo={memo} />
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-sm">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
          {t('fleet.custody.memos.columns.period')}
        </span>
        <span className="font-bold">
          <Dates from={memo.from} to={memo.to} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300">
          {count('receipt', memo.receipts)}
        </span>
        <MemoStatus memo={memo} />
      </div>
      <div className="mt-2.5 flex justify-end border-t border-slate-100 pt-2.5 dark:border-[#1c273b]">
        <MemoActions memo={memo} {...actions} />
      </div>
    </li>
  );
};

/**
 * «إيصالات لم تدخل أي مذكرة بعد» — what a new memo can still take, kind by kind, each with its way
 * into «مذكرة جديدة». Says nothing while it is read, and nothing when every receipt is on a memo.
 */
const OutsideBanner = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { count } = useCustodyCount();
  const outside = useCustodyMemosOutside();
  const kinds = (outside.data ?? []).filter((line) => line.count > 0);
  if (kinds.length === 0) return null;
  const receipts = kinds.reduce((sum, line) => sum + line.count, 0);
  const total = kinds.reduce((sum, line) => sum + Math.round(line.total * 100), 0) / 100;
  const { figure, currency } = formatMoneyParts(total, 'EGP', locale);
  return (
    <div
      data-memos-outside="true"
      className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-2.5 dark:border-[rgba(71,85,105,.6)] dark:bg-[#0d1424]/60"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn('shrink-0 rounded-xl p-2.5', SPEND_LOOK.tile)}>
          <BoardIcon d={RECEIPT_ICON} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-slate-900 dark:text-white',
              CAIRO,
            )}
          >
            {t('fleet.custody.memos.outside.title')}
            <span
              data-memos-outside-total="true"
              className="whitespace-nowrap text-sm text-slate-600 dark:text-slate-300"
            >
              {count('receipt', receipts)} ·{' '}
              <span dir="ltr" className={NUM}>
                {figure}
              </span>{' '}
              {currency}
            </span>
          </span>
          <span className={cn('block', NOTE)}>{t('fleet.custody.memos.outside.note')}</span>
        </span>
      </span>
      <span className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {kinds.map((line) => (
          <span
            key={line.kind}
            data-memos-outside-kind={line.kind}
            className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:py-1.5 sm:pe-1.5 sm:ps-2 dark:border-slate-700 dark:bg-[#111827]"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <CustodyKindBadge kind={line.kind} />
                <span className="whitespace-nowrap text-[13px] font-bold text-slate-600 dark:text-slate-300">
                  {count('receipt', line.count)}
                </span>
              </span>
              <span className="ps-1 text-[15px] font-bold">
                <Money value={line.total} />
              </span>
            </span>
            {can('fleetReceipt.create') && (
              <Link
                to={`/fleet/custody/memos/new/${line.kind}`}
                data-memos-outside-new={line.kind}
                className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2.5 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200"
              >
                <BoardIcon d={PATH.plus} className="h-3 w-3" width={2.5} />
                {t('fleet.custody.memos.outside.make', {
                  kind: t(`fleet.custody.source.${line.kind}`),
                })}
              </Link>
            )}
          </span>
        ))}
      </span>
    </div>
  );
};

export const CustodyMemosPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const signatories = useReportSignatories();
  const { count } = useCustodyCount();
  const qc = useQueryClient();
  const announce = usePrintOutcome();
  // One file at a time; the pressed one spins while the rows are gathered.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [viewing, setViewing] = useState<FleetCustodyMemoRowDto | null>(null);
  const [deleting, setDeleting] = useState<FleetCustodyMemoRowDto | null>(null);
  const remove = useDeleteCustodyMemo();

  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const kindParam = sp.get('kind');
  const kinds = useMemo(() => memoKinds(kindParam), [kindParam]);
  const status = memoStatusOf(sp.get('status'));
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // An arrow reorders the same rows: the reader stays on the page they are reading.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const hasActiveFilters = from !== '' || to !== '' || kinds.length > 0 || status !== '';

  // The filters alone — the table's, the strip's and the files' question is one question.
  const filters = useMemo(
    () => ({
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      ...(kinds.length === 0 ? {} : { kind: kinds }),
      ...(status === '' ? {} : { status }),
    }),
    [from, to, kinds, status],
  );
  const params = useMemo(
    () => ({ page, pageSize, ...filters, ...sortQuery(sorts) }),
    [page, pageSize, filters, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useCustodyMemos(params);
  // The strip's count and total over every memo the filters match — the server's, never the page's.
  const totals = useCustodyMemoTotals(filters);
  const rows = data?.items ?? [];

  /** The row's printer: the tab opens inside the click, then the memo is read and printed. */
  const printMemo = (memo: FleetCustodyMemoRowDto): void => {
    announce(
      printPaperAfter(async () => {
        const detail = await qc.fetchQuery({
          queryKey: custodyQueryKeys.memo(memo.id),
          queryFn: () => fleetApi.getCustodyMemo(memo.id),
          staleTime: 30_000,
        });
        return { sheets: memoSheets(memoPaperOf(detail)), title: memoFileName(detail) };
      }, t('fleet.custody.papers.printing')),
    );
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('fleet.custody.memos.deletedToast'));
      setDeleting(null);
    } catch (failure) {
      // Replenished, or deleted elsewhere, since the list was read: said in so many words, and the
      // list read again so the row shows what happened to it.
      const refusal = memoRefusalOf(failure);
      if (refusal === 'locked' || refusal === 'gone') {
        toast.error(
          t(
            refusal === 'locked'
              ? 'fleet.custody.memos.refusedDelete'
              : 'fleet.custody.memos.goneDelete',
          ),
        );
        setDeleting(null);
        void refetch();
        void totals.refetch();
        return;
      }
      toast.error(errorMessage(failure, locale));
    }
  };

  const actions: MemoRowActions = {
    onView: setViewing,
    onPrint: printMemo,
    onDelete: setDeleting,
  };
  // «تحسين شكل البيانات»: every value and header centred, the number in its chip, the name he
  // typed (or its muted stand-in), the kind's pill, the period on two lines, money with «ج.م.».
  const columns: Column<FleetCustodyMemoRowDto>[] = [
    {
      key: 'no',
      align: 'center',
      header: t('fleet.custody.memos.columns.no'),
      sortable: true,
      render: (memo) => <span className={cn(MEMO_NO, FIGURE)}>{memo.no}</span>,
    },
    {
      key: 'name',
      align: 'center',
      header: t('fleet.custody.memos.columns.name'),
      render: (memo) => <MemoName memo={memo} boxed />,
    },
    {
      key: 'kind',
      align: 'center',
      header: t('fleet.custody.memos.columns.kind'),
      render: (memo) => <CustodyKindBadge kind={memo.kind} />,
    },
    {
      key: 'period',
      align: 'center',
      header: t('fleet.custody.memos.columns.period'),
      render: (memo) => <Dates from={memo.from} to={memo.to} stack />,
    },
    {
      key: 'receipts',
      align: 'center',
      header: t('fleet.custody.memos.columns.receipts'),
      render: (memo) => <span className={cn(COUNT_BADGE, FIGURE)}>{memo.receipts}</span>,
    },
    {
      key: 'total',
      align: 'center',
      header: t('fleet.custody.memos.columns.total'),
      render: (memo) => <Money value={memo.total} />,
    },
    {
      key: 'status',
      align: 'center',
      header: t('fleet.custody.memos.columns.status'),
      render: (memo) => <MemoStatus memo={memo} />,
    },
    {
      key: 'actions',
      align: 'center',
      header: t('fleet.vehicles.columns.actions'),
      render: (memo) => <MemoActions memo={memo} {...actions} />,
    },
  ];

  // «اكسلات هتاخد اللى الفلتر عامله بس»: every memo the filters match, in the table's order.
  const header = [
    t('fleet.custody.memos.columns.no'),
    t('fleet.custody.memos.columns.name'),
    t('fleet.custody.memos.columns.kind'),
    t('fleet.custody.memos.export.from'),
    t('fleet.custody.memos.export.to'),
    t('fleet.custody.memos.columns.receipts'),
    t('fleet.custody.memos.columns.total'),
    t('fleet.custody.memos.columns.status'),
    t('fleet.custody.memos.export.replenishedAt'),
  ];
  const statusText = (memo: FleetCustodyMemoRowDto): string =>
    t(
      memo.replenishment === null
        ? 'fleet.custody.parts.status.pending'
        : 'fleet.custody.parts.status.replenished',
    );
  const lineOf = (memo: FleetCustodyMemoRowDto): string[] => [
    String(memo.no),
    memoDisplayName(memo, t),
    t(`fleet.custody.source.${memo.kind}`),
    ymd(memo.from),
    ymd(memo.to),
    String(memo.receipts),
  ];
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listCustodyMemos({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const writeSheet = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.custody.memos.title'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((memo) => [
        ...lineOf(memo),
        memo.total,
        statusText(memo),
        memo.replenishment === null ? '' : ymd(memo.replenishment.date),
      ]),
      moneyColumns: [6],
    });
  };
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      await writeSheet();
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };
  const printSheet = async (): Promise<void> => {
    const all = await allRows();
    const figures = totals.data;
    try {
      printFleetReport({
        title: t('fleet.custody.memos.title'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: all.map((memo) => [
          ...lineOf(memo),
          reportMoney(memo.total),
          statusText(memo),
          memo.replenishment === null ? '—' : ymd(memo.replenishment.date),
        ]),
        totals:
          figures === undefined
            ? []
            : [
                { label: t('fleet.custody.memos.totals.count'), value: String(figures.count) },
                {
                  label: t('fleet.custody.memos.totals.receipts'),
                  value: String(figures.receipts),
                },
                { label: t('fleet.custody.memos.totals.total'), value: reportMoney(figures.total) },
              ],
        signatories,
        serialHeader: t('fleet.violations.report.serial'),
        emptyLabel: t('fleet.violations.report.empty'),
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };
  const onPrint = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      await printSheet();
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };

  // «من» / «إلى» as the custody board draws them: the coloured calendar opens the picker, and the
  // word sits in the box while it is empty, gone the moment the box is focused.
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-36 shrink-0"
      datePicker={{ label: t(labelKey) }}
    >
      <Input
        type="date"
        dir="ltr"
        density={TIGHT}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
        className={cn(
          'dark:[color-scheme:dark]',
          value === '' && 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0',
        )}
      />
      {value === '' && (
        <span
          aria-hidden="true"
          data-date-caption={param}
          className="pointer-events-none absolute inset-y-0 left-2 right-10 flex items-center justify-center truncate text-sm text-slate-500 peer-focus:hidden dark:text-slate-400"
        >
          {t(labelKey)}
        </span>
      )}
    </FilterWithIcon>
  );

  const figures = totals.data;
  const sum = figures === undefined ? null : formatMoneyParts(figures.total, 'EGP', locale);
  return (
    <PageContainer fullHeight>
      <CustodyFundHeader />
      <div className={BOARD_FRAME} data-custody-memos="true">
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-custody-memos-toolbar="true"
        >
          {/* How many memos the filters matched, over the whole set — nothing while the answer is
              on its way. */}
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined ? '' : count('memo', data.meta.totalItems)}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            {/* Not offered when the list failed: the file behind it would be empty or short. */}
            {!isError && (
              <ExportPill
                name="custody-memos"
                exporting={exporting}
                onExcel={() => void exportSheet()}
                onPdf={() => void onPrint()}
              />
            )}
            {/* The names every memo and letter prints with — as licence expenses' «إعداد النماذج». */}
            {can('fleetReceipt.edit') && (
              <Link
                to="/fleet/custody/memos/setup"
                data-custody-papers-setup="true"
                className={BRAND_BUTTON}
              >
                <CogIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                {t('fleet.custody.memos.setup')}
              </Link>
            )}
            {can('fleetReceipt.create') && (
              <Link
                to="/fleet/custody/memos/new"
                data-memo-new="true"
                title={t('fleet.custody.memos.new')}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span className="sm:hidden">{t('fleet.vehicles.board.addShort')}</span>
                <span className="hidden sm:inline">{t('fleet.custody.memos.new')}</span>
              </Link>
            )}
          </span>
        </div>

        {/* The custody board's bar: every filter's name in its box, an icon at its start. */}
        <div
          data-custody-memos-filters="true"
          className={cn(DARK_FILTER_BAR, CUSTODY_FILTER_LOOK, '[&_[role=listbox]]:animate-menu-in')}
        >
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() => patch({ from: null, to: null, kind: null, status: null })}
          >
            {dateBound('fleet.receipts.filters.from', from, 'from')}
            {dateBound('fleet.receipts.filters.to', to, 'to')}
            {/* Four kinds, so several at once, with the clear-all. */}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.custody.memos.filters.kind')}
                options={FLEET_CUSTODY_SOURCES.map((value) => ({
                  value,
                  label: t(`fleet.custody.source.${value}`),
                }))}
                value={kinds}
                onChange={(next) => patch({ kind: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            {/* «الحالة»: ONE answer — waiting or replenished; clearing it is «all». */}
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-sky-600 dark:text-sky-400">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.custody.memos.filters.status')}
                options={FLEET_CUSTODY_MEMO_STATUSES.map((value) => ({
                  value,
                  label: t(`fleet.custody.parts.status.${value}`),
                }))}
                value={status === '' ? [] : [status]}
                onChange={(next) => patch({ status: pickOne(status === '' ? [] : [status], next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <OutsideBanner />

        <section
          data-custody-memos-card="true"
          className={cn(
            SECTION_CARD,
            'flex shrink-0 flex-col lg:min-h-[22rem] lg:flex-1 lg:shrink',
          )}
        >
          <div className={SECTION_STRIP}>
            <h2 className={TITLE}>{t('fleet.custody.memos.title')}</h2>
            {figures !== undefined && (
              <span className="flex items-center gap-2" data-memos-figures="true">
                <span data-memos-count="true" className={cn(MOVES_CHIP, NUM)}>
                  {count('memo', figures.count)}
                </span>
                <span data-memos-total="true" className={MOVES_CHIP}>
                  <span dir="ltr" className={NUM}>
                    {sum?.figure}
                  </span>{' '}
                  {sum?.currency}
                </span>
              </span>
            )}
          </div>
          {/* A phone: one card per memo. */}
          <ul
            className="flex flex-col gap-2 bg-slate-50/60 p-2.5 sm:hidden dark:bg-transparent"
            data-memo-cards="true"
          >
            {isLoading && (
              <li className="flex justify-center py-6">
                <Spinner className="h-5 w-5" />
              </li>
            )}
            {data !== undefined && rows.length === 0 && (
              <li className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('fleet.custody.memos.empty')}
              </li>
            )}
            {rows.map((memo) => (
              <MemoCard key={memo.id} memo={memo} {...actions} />
            ))}
          </ul>
          <div
            className={cn(
              CUSTODY_TAB_TABLE,
              EMBEDDED_TABLE,
              BOARD_TABLE_FILL,
              'hidden sm:block [&_tbody_td]:!py-1.5',
            )}
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(memo) => memo.id}
              rowProps={(memo) => ({ 'data-memo-row': String(memo.no) }) as never}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              empty={t('fleet.custody.memos.empty')}
              sort={sorts}
              onSortChange={changeSort}
              minColumnWidth={4}
              stickyHead
            />
          </div>
          {data !== undefined && data.meta.totalItems > 0 && (
            <div className={SECTION_FOOT}>
              <FleetPager
                meta={data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            </div>
          )}
        </section>
      </div>

      {viewing !== null && (
        <CustodyMemoPaperView memoId={viewing.id} onClose={() => setViewing(null)} />
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.custody.memos.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              data-memo-delete-confirm="true"
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          {deleting === null ? '' : memoDisplayName(deleting, t)}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.custody.memos.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
