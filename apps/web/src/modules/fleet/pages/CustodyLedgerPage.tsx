// «سجل العهدة» — «فين الهيستورى بتاع كل حاجه من دول»: the fund's own history. Every «شحن العهدة»,
// «استعاضة العهدة» and «تسوية العهدة», with «إجمالي العهدة» after it; between two of them, the
// receipts the fund paid, summed into one muted line («97 إيصالًا صُرفت من العهدة»). The last line of
// the whole history carries «الآن»: its «بعدها» IS the fund.
//
// Over the table, the fund's formula as tiles — «إجمالي الشحن» − «مصروفات الإيصالات» + «إجمالي
// الاستعاضة» − «إجمالي التسوية» = «إجمالي العهدة — الآن» — over the WHOLE history, whatever the
// filters (a fund below zero in red). The filters choose the lines, never what is after them: a
// line's «بعدها» is its place in the whole history.
//
// An operation's eye opens its drawer (`?open=<id>`) — what it carried and its letter; its printer
// opens the same drawer at the letter (`&letter=1`). A receipts line's eye goes to «العهدة» over its
// days. The toolbar carries the fund's three actions, as «العهدة» does; their dialogs open here too.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FLEET_CUSTODY_LEDGER_OPS,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyLedgerOp,
  type FleetCustodyLedgerRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, PrinterIcon } from '../../../shared/ui/icons';
import { formatMoneyParts } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import {
  useCustodyFundSummary,
  useCustodyLedger,
  useCustodyLedgerTotals,
} from '../api/fleet-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { CUSTODY_FUND } from '../components/CustodyKinds';
import { CustodyTabs } from '../components/CustodyTabs';
import { CUSTODY_OPS, CustodyFundActions } from '../components/CustodyFundActions';
import { CustodyFundDialogs } from '../components/CustodyFundDialogs';
import { CustodyOperationDrawer, useLedgerWordsKit } from '../components/CustodyOperationDrawer';
import { ACTION_GROUP, actionTone } from '../components/row-actions-look';
import { BoardIcon, NUM, ymd } from '../components/FuelCardBoard';
import { CAIRO, CARD_BORDER, CARD_SURFACE, TITLE } from '../components/custody-dashboard-parts';
import {
  CUSTODY_FILTER_LOOK,
  CUSTODY_TAB_TABLE,
  EMBEDDED_TABLE,
  MOVES_CHIP,
  SECTION_CARD,
  SECTION_FOOT,
  SECTION_STRIP,
} from '../components/custody-board-looks';
import {
  ExportPill,
  FIGURE,
  MUTED_INK,
  Money,
  PHONE_CARD,
  RECEIPT_ICON,
  SPEND_LOOK,
  Signed,
  TIGHT,
} from '../components/custody-memo-parts';
import { ledgerCount, ledgerWords, partsPhrase } from '../lib/custody-ledger-words';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';

/** Remembered across visits: the filters, the page size and the order. Never `page`, never a drawer. */
const REMEMBERED_FILTERS = ['from', 'to', 'op', 'size', 'sort'] as const;
const DEFAULT_PAGE_SIZE = 25;
/** Newest first — the line with «الآن» on top. Only the date orders the log. */
const DEFAULT_SORT = 'date:desc';
const COUNT = new Intl.NumberFormat('en-US');
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
/** «العملية» as the address holds it, kept to what the server knows. */
const ledgerOps = (raw: string | null): FleetCustodyLedgerOp[] =>
  csv(raw).filter((v): v is FleetCustodyLedgerOp =>
    (FLEET_CUSTODY_LEDGER_OPS as readonly string[]).includes(v),
  );

/** A line's own words for its operation — the three actions' names, and the receipts'. */
const opLabelKey = (op: FleetCustodyLedgerOp): string =>
  op === 'spend' ? 'fleet.custody.ledger.op.spend' : CUSTODY_OPS[op].label;

/** The receipts' line, muted: it is what was paid, not an operation. */
const SPEND_ROW = 'bg-slate-50/80 dark:bg-white/[0.025]';
const NOW_CHIP =
  'rounded-full bg-emerald-100 px-2 py-px text-[11px] leading-4 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
const NOW_INK = 'text-emerald-800 dark:text-emerald-300';
const NEGATIVE_INK = 'text-red-600 dark:text-red-400';

const OpChip = ({ op }: { op: FleetCustodyLedgerOp }): JSX.Element => {
  const t = useT();
  const look =
    op === 'spend'
      ? { chip: SPEND_LOOK.chip, icon: RECEIPT_ICON }
      : { chip: CUSTODY_OPS[op].chip, icon: CUSTODY_OPS[op].icon };
  return (
    <span
      data-ledger-op={op}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[14px] leading-5',
        CAIRO,
        look.chip,
      )}
    >
      <BoardIcon d={look.icon} className="h-3.5 w-3.5" />
      {t(opLabelKey(op))}
    </span>
  );
};

/** A line's date — a receipts line its first and last day, one over the other, muted. */
const LedgerDate = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  return row.op === 'spend' ? (
    <span className="inline-flex flex-col items-center leading-[18px]" data-ledger-date="span">
      <span dir="ltr" className={cn(FIGURE, MUTED_INK, 'text-sm leading-[18px]')}>
        {ymd(row.date)}
      </span>
      <span className={cn('whitespace-nowrap text-sm leading-[18px]', MUTED_INK)}>
        <span className="text-[11px] text-slate-400">{t('fleet.custody.parts.to')} </span>
        <span dir="ltr" className={FIGURE}>
          {ymd(row.dateTo ?? row.date)}
        </span>
      </span>
    </span>
  ) : (
    <span
      dir="ltr"
      data-ledger-date="day"
      className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}
    >
      {ymd(row.date)}
    </span>
  );
};

/** The receipts of a line, on «العهدة» over its days. */
const spendLink = (row: FleetCustodyLedgerRowDto): string =>
  `/fleet/custody?from=${row.date}&to=${row.dateTo ?? row.date}`;

const LedgerActions = ({
  row,
  open,
}: {
  row: FleetCustodyLedgerRowDto;
  open: (id: string, letter: boolean) => void;
}): JSX.Element => {
  const t = useT();
  return row.op === 'spend' ? (
    <span className={ACTION_GROUP} data-row-actions="custody-ledger">
      <Link
        to={spendLink(row)}
        title={t('fleet.custody.ledger.viewReceipts')}
        aria-label={t('fleet.custody.ledger.viewReceipts')}
        className={actionTone('view')}
        data-ledger-receipts={row.id}
      >
        <EyeIcon className="h-4 w-4" />
      </Link>
    </span>
  ) : (
    <span className={ACTION_GROUP} data-row-actions="custody-ledger">
      <button
        type="button"
        data-ledger-view={row.id}
        title={t('fleet.custody.ledger.view')}
        aria-label={t('fleet.custody.ledger.view')}
        onClick={() => open(row.id, false)}
        className={actionTone('view')}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-ledger-print={row.id}
        title={t('fleet.custody.ledger.print')}
        aria-label={t('fleet.custody.ledger.print')}
        onClick={() => open(row.id, true)}
        className={actionTone('print')}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
    </span>
  );
};

/** «إجمالي العهدة بعدها» — the last line of the whole history with «الآن»; a fund below zero red. */
const After = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  const ink =
    row.after < 0
      ? NEGATIVE_INK
      : row.latest
        ? NOW_INK
        : row.op === 'spend'
          ? MUTED_INK
          : undefined;
  return (
    <span className="inline-flex items-center gap-2" data-ledger-after={row.id}>
      <Money value={row.after} ink={ink} />
      {row.latest && (
        <span className={NOW_CHIP} data-ledger-now="true">
          {t('fleet.custody.ledger.now')}
        </span>
      )}
    </span>
  );
};

// ── The formula, as tiles ─────────────────────────────────────────────────────────────────────

const OPERATOR =
  'absolute -start-[1.3rem] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-base font-black text-slate-700 shadow-sm xl:flex dark:border-slate-600 dark:bg-[#0b0f19] dark:text-slate-200';

/** One term of «إجمالي العهدة = شحن − مصروفات + استعاضة − تسوية». */
const Term = ({
  term,
  label,
  value,
  sign,
  note,
  icon,
  tile,
  accent,
  operator,
}: {
  term: string;
  label: string;
  value: number;
  sign: '+' | '−';
  note: string;
  icon: readonly string[];
  tile: string;
  accent: string;
  operator: string | null;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
  return (
    <div className="relative" data-ledger-term={term}>
      {operator !== null && (
        <span aria-hidden="true" className={cn(OPERATOR, NUM)}>
          {operator}
        </span>
      )}
      <div
        className={cn(
          CARD_SURFACE,
          CARD_BORDER,
          'flex h-full min-w-0 flex-col justify-between rounded-2xl p-3 sm:p-4 xl:p-3 min-[1700px]:p-4',
          accent,
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300">
              {label}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-1 xl:flex-nowrap">
              <span
                dir="ltr"
                data-ledger-term-value={value}
                className={cn(
                  'text-base font-black tracking-tight sm:text-2xl xl:text-lg min-[1700px]:text-2xl',
                  NUM,
                  sign === '+' ? 'text-emerald-700 dark:text-emerald-400' : NEGATIVE_INK,
                )}
              >
                {sign}
                {figure}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {currency}
              </span>
            </span>
          </span>
          <span
            className={cn(
              'hidden shrink-0 rounded-xl p-2.5 sm:inline-flex xl:p-2 min-[1700px]:p-2.5',
              tile,
            )}
          >
            <BoardIcon
              d={icon}
              className="h-5 w-5 xl:h-4 xl:w-4 min-[1700px]:h-5 min-[1700px]:w-5"
            />
          </span>
        </span>
        <span className="mt-1.5 truncate border-t border-slate-100 pt-1.5 text-[11px] text-slate-600 sm:text-xs dark:border-[#1c273b] dark:text-slate-400">
          {note}
        </span>
      </div>
    </div>
  );
};

/** The four terms and the fund they make — over the whole history, whatever the filters. */
const LedgerFigures = ({ fund }: { fund: FleetCustodyFundSummaryDto }): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const now = formatMoneyParts(Math.abs(fund.fundTotal), 'EGP', locale);
  const negative = fund.fundTotal < 0;
  return (
    <section
      data-ledger-figures="true"
      className="grid shrink-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)] xl:gap-5"
    >
      <Term
        term="charged"
        label={t('fleet.custody.ledger.tiles.charged')}
        value={fund.charged.amount}
        sign="+"
        note={t(`fleet.custody.ledger.tiles.chargedNote.${kit.form(fund.charged.count)}`, {
          count: COUNT.format(fund.charged.count),
        })}
        icon={CUSTODY_OPS.charge.icon}
        tile={CUSTODY_OPS.charge.tile}
        accent={CUSTODY_OPS.charge.accent}
        operator={null}
      />
      <Term
        term="spent"
        label={t('fleet.custody.ledger.tiles.spent')}
        value={fund.spent.amount}
        sign="−"
        note={kit.count('receipt', fund.spent.count)}
        icon={RECEIPT_ICON}
        tile={SPEND_LOOK.tile}
        accent={SPEND_LOOK.accent}
        operator="−"
      />
      <Term
        term="replenished"
        label={t('fleet.custody.ledger.tiles.replenished')}
        value={fund.replenished.amount}
        sign="+"
        note={kit.count('memo', fund.replenished.memos)}
        icon={CUSTODY_OPS.replenish.icon}
        tile={CUSTODY_OPS.replenish.tile}
        accent={CUSTODY_OPS.replenish.accent}
        operator="+"
      />
      <Term
        term="settled"
        label={t('fleet.custody.ledger.tiles.settled')}
        value={fund.settled.amount}
        sign="−"
        note={partsPhrase(fund.settled.parts, kit)}
        icon={CUSTODY_OPS.settle.icon}
        tile={CUSTODY_OPS.settle.tile}
        accent={CUSTODY_OPS.settle.accent}
        operator="−"
      />
      <div className="relative col-span-2 xl:col-span-1">
        <span aria-hidden="true" className={cn(OPERATOR, NUM)}>
          =
        </span>
        <div
          data-ledger-fund-now={fund.fundTotal}
          {...(negative ? { 'data-ledger-fund-negative': 'true' } : {})}
          className={cn(
            CARD_SURFACE,
            'flex h-full min-w-0 flex-col justify-between rounded-2xl border p-3 sm:p-4 xl:p-3 min-[1700px]:p-4',
            CUSTODY_FUND.card,
            CUSTODY_FUND.accent,
          )}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className={cn('block text-xs', CUSTODY_FUND.label)}>
                {t('fleet.custody.ledger.tiles.fundNow')}
              </span>
              <span className="mt-1 flex flex-wrap items-baseline gap-1">
                <span
                  dir="ltr"
                  className={cn(
                    'text-xl font-black tracking-tight sm:text-2xl xl:text-lg min-[1700px]:text-2xl',
                    NUM,
                    negative ? NEGATIVE_INK : 'text-slate-900 dark:text-white',
                  )}
                >
                  {negative ? '−' : ''}
                  {now.figure}
                </span>
                <span className={cn('text-xs', CUSTODY_FUND.unit)}>{now.currency}</span>
              </span>
            </span>
            <span className={cn('shrink-0 rounded-xl p-2.5 xl:p-2', CUSTODY_FUND.tile)}>
              <BoardIcon d={CUSTODY_FUND.icon} className="h-5 w-5 xl:h-4 xl:w-4" />
            </span>
          </span>
          <span className="mt-1.5 whitespace-nowrap border-t border-slate-200 pt-1.5 text-[11px] text-slate-600 dark:border-[#1c273b] dark:text-slate-400">
            {t('fleet.custody.ledger.tiles.formula')}
          </span>
        </div>
      </div>
    </section>
  );
};

/** A phone: each line of the log as a card — what, when, how much, the fund after it. */
const LedgerCard = ({
  row,
  open,
}: {
  row: FleetCustodyLedgerRowDto;
  open: (id: string, letter: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const words = ledgerWords(row, kit);
  return (
    <li
      data-ledger-card={row.id}
      className={cn(PHONE_CARD, row.op === 'spend' && 'bg-slate-50 dark:bg-white/[0.025]')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <OpChip op={row.op} />
        {row.op === 'spend' ? (
          <span className={cn('whitespace-nowrap text-[13px] font-bold', MUTED_INK)}>
            <span dir="ltr" className={NUM}>
              {ymd(row.date)}
            </span>{' '}
            {t('fleet.custody.parts.to')}{' '}
            <span dir="ltr" className={NUM}>
              {ymd(row.dateTo ?? row.date)}
            </span>
          </span>
        ) : (
          <span
            dir="ltr"
            className={cn(FIGURE, 'text-sm font-bold text-slate-700 dark:text-slate-200')}
          >
            {ymd(row.date)}
          </span>
        )}
      </div>
      <p
        className={cn(
          'mt-2 text-[15px] font-bold leading-snug',
          row.op === 'spend'
            ? 'text-slate-600 dark:text-slate-300'
            : 'text-slate-900 dark:text-white',
        )}
      >
        {words.title}
      </p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{words.note}</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5 dark:border-[#1c273b]">
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {t('fleet.custody.ledger.columns.amount')}
          </span>
          <span className="text-[15px] font-bold">
            <Signed value={row.amount} />
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {t('fleet.custody.ledger.columns.after')}
          </span>
          <span className="text-[15px] font-bold">
            <After row={row} />
          </span>
        </span>
      </div>
      <div className="mt-2 flex justify-end">
        <LedgerActions row={row} open={open} />
      </div>
    </li>
  );
};

export const CustodyLedgerPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();
  const kit = useLedgerWordsKit();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const opsParam = sp.get('op') ?? '';
  const ops = ledgerOps(opsParam);
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
  const openId = sp.get('open') ?? '';
  const toLetter = sp.get('letter') === '1';

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // An arrow reorders the same lines: the reader stays on the page they are reading.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  /** Open an operation's drawer — at its letter when `letter`. */
  const openOperation = (id: string, letter: boolean): void => {
    const next = new URLSearchParams(sp);
    next.set('open', id);
    if (letter) next.set('letter', '1');
    else next.delete('letter');
    setSp(next);
  };
  const closeOperation = (): void => {
    const next = new URLSearchParams(sp);
    next.delete('open');
    next.delete('letter');
    setSp(next);
  };
  const hasActiveFilters = from !== '' || to !== '' || ops.length > 0;
  const clearFilters = (): void => patch({ from: null, to: null, op: null });

  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      op: ops.length > 0 ? ops : undefined,
    }),
    [from, to, opsParam],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const fund = useCustodyFundSummary();
  const totals = useCustodyLedgerTotals(filters);
  const { data, isLoading, isError, error, refetch } = useCustodyLedger(params);
  const rows = data?.items ?? [];
  const count = totals.data === undefined ? '' : ledgerCount(totals.data, kit);

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const columns: Column<FleetCustodyLedgerRowDto>[] = [
    {
      key: 'date',
      header: t('fleet.custody.ledger.columns.date'),
      align: 'center',
      sortable: true,
      render: (row) => <LedgerDate row={row} />,
    },
    {
      key: 'op',
      header: t('fleet.custody.ledger.columns.op'),
      align: 'center',
      render: (row) => <OpChip op={row.op} />,
    },
    {
      key: 'detail',
      header: t('fleet.custody.ledger.columns.detail'),
      align: 'center',
      render: (row) => {
        const words = ledgerWords(row, kit);
        // Words, so Cairo with its own spaces — not the table's figure face.
        return (
          <span
            data-ledger-detail={row.id}
            className={cn('inline-flex flex-col items-center leading-tight', CAIRO)}
          >
            <span
              className={cn(
                'whitespace-nowrap text-[15px] leading-[22px]',
                row.op === 'spend'
                  ? 'text-slate-600 dark:text-slate-300'
                  : 'text-slate-900 dark:text-white',
              )}
            >
              {words.title}
            </span>
            {words.note !== '' && (
              <span className="whitespace-nowrap text-[12px] leading-4 text-slate-500 [&&]:!font-medium dark:text-slate-400">
                {words.note}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: t('fleet.custody.ledger.columns.amount'),
      align: 'center',
      render: (row) => <Signed value={row.amount} />,
    },
    {
      key: 'after',
      header: t('fleet.custody.ledger.columns.after'),
      align: 'center',
      className: 'bg-slate-50 dark:bg-[#131f35]/50',
      headerClassName: 'bg-slate-200/80 dark:bg-[#131f35]',
      render: (row) => <After row={row} />,
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'center',
      render: (row) => <LedgerActions row={row} open={openOperation} />,
    },
  ];

  // ── Excel / PDF: every line the filters match, in the table's order ──────────────────────────
  const header = [
    t('fleet.custody.ledger.columns.date'),
    t('fleet.custody.ledger.export.to'),
    t('fleet.custody.ledger.columns.op'),
    t('fleet.custody.ledger.columns.detail'),
    t('fleet.custody.ledger.export.note'),
    t('fleet.custody.ledger.columns.amount'),
    t('fleet.custody.ledger.columns.after'),
  ];
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listCustodyLedger({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const line = (row: FleetCustodyLedgerRowDto): (string | number)[] => {
    const words = ledgerWords(row, kit);
    return [
      ymd(row.date),
      row.dateTo === null ? '' : ymd(row.dateTo),
      t(opLabelKey(row.op)),
      words.title,
      words.note,
      row.amount,
      row.after,
    ];
  };
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      const all = await allRows();
      saveSheet({
        name: t('fleet.custody.ledger.title'),
        serialHeader: t('fleet.violations.report.serial'),
        header,
        rows: all.map(line),
        moneyColumns: [5, 6],
      });
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };
  const printSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      const all = await allRows();
      const summary = fund.data;
      try {
        printFleetReport({
          title: t('fleet.custody.ledger.title'),
          department: t('fleet.violations.report.department'),
          subtitle: '',
          header,
          rows: all.map((row) =>
            line(row).map((cell, i) => (i >= 5 ? reportMoney(Number(cell)) : String(cell))),
          ),
          totals:
            summary === undefined
              ? []
              : [
                  {
                    label: t('fleet.custody.ledger.tiles.charged'),
                    value: reportMoney(summary.charged.amount),
                  },
                  {
                    label: t('fleet.custody.ledger.tiles.spent'),
                    value: reportMoney(summary.spent.amount),
                  },
                  {
                    label: t('fleet.custody.ledger.tiles.replenished'),
                    value: reportMoney(summary.replenished.amount),
                  },
                  {
                    label: t('fleet.custody.ledger.tiles.settled'),
                    value: reportMoney(summary.settled.amount),
                  },
                  {
                    label: t('fleet.custody.ledger.tiles.fundNow'),
                    value: reportMoney(summary.fundTotal),
                  },
                ],
          signatories,
          serialHeader: t('fleet.violations.report.serial'),
          emptyLabel: t('fleet.violations.report.empty'),
        });
      } catch {
        toast.error(t('fleet.violations.popupBlocked'));
      }
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };

  // «من» / «إلى» as the custody board draws them: the coloured calendar opens the picker, and the
  // word sits in the box while it is empty, gone the moment the box is focused.
  const dateBound = (labelKey: string, value: string, param: 'from' | 'to'): JSX.Element => (
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
        onChange={(e) =>
          patch(
            param === 'from' ? { from: e.target.value || null } : { to: e.target.value || null },
          )
        }
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

  return (
    <PageContainer fullHeight>
      <CustodyTabs />
      <div className={BOARD_FRAME} data-custody-ledger="true">
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-ledger-toolbar="true"
        >
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {count}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            {/* Not offered when the log failed: the file behind it would be empty or short. */}
            {!isError && (
              <ExportPill
                name="custody-ledger"
                exporting={exporting}
                onExcel={() => void exportSheet()}
                onPdf={() => void printSheet()}
              />
            )}
            <CustodyFundActions />
          </span>
        </div>

        <div
          data-ledger-filter-bar="true"
          className={cn(DARK_FILTER_BAR, CUSTODY_FILTER_LOOK, '[&_[role=listbox]]:animate-menu-in')}
        >
          <FilterBar hasActiveFilters={hasActiveFilters} onClear={clearFilters}>
            {dateBound('fleet.receipts.filters.from', from, 'from')}
            {dateBound('fleet.receipts.filters.to', to, 'to')}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.custody.ledger.filters.op')}
                options={FLEET_CUSTODY_LEDGER_OPS.map((value) => ({
                  value,
                  label: t(opLabelKey(value)),
                }))}
                value={ops}
                onChange={(next) => patch({ op: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {fund.data !== undefined && <LedgerFigures fund={fund.data} />}

        <section
          data-ledger-table="true"
          className={cn(
            SECTION_CARD,
            'flex shrink-0 flex-col lg:min-h-[18rem] lg:flex-1 lg:shrink',
          )}
        >
          <div className={SECTION_STRIP}>
            <h2 className={TITLE}>{t('fleet.custody.ledger.title')}</h2>
            {count !== '' && (
              <span data-ledger-count="true" className={cn(MOVES_CHIP, NUM)}>
                {count}
              </span>
            )}
          </div>
          <ul
            className="flex flex-col gap-2 bg-slate-50/60 p-2.5 sm:hidden dark:bg-transparent"
            data-ledger-cards="true"
          >
            {rows.map((row) => (
              <LedgerCard key={row.id} row={row} open={openOperation} />
            ))}
          </ul>
          <div
            className={cn(
              CUSTODY_TAB_TABLE,
              EMBEDDED_TABLE,
              BOARD_TABLE_FILL,
              'hidden sm:block',
              '[&_td_a]:!h-6 [&_td_a]:!w-6 [&_tbody_td]:!py-1.5 [&_thead_th]:!py-2',
            )}
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              empty={t('fleet.custody.ledger.empty')}
              rowProps={(row) => ({ 'data-ledger-row': row.id }) as never}
              rowClassName={(row) => (row.op === 'spend' ? SPEND_ROW : undefined)}
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
      <CustodyFundDialogs />
      {openId !== '' && (
        <CustodyOperationDrawer
          key={openId}
          id={openId}
          toLetter={toLetter}
          onClose={closeOperation}
        />
      )}
    </PageContainer>
  );
};
