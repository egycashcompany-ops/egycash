// /atm/machines — the legacy /all_atm page (all_atm.ejs) by parity: every ACTIVE machine of the
// branch, with an Excel-style export. The legacy exported via a CDN-loaded xlsx build (:986); this
// exports the same four columns as CSV with a UTF-8 BOM so Excel opens the Arabic correctly — a
// dependency-free equivalent recorded in the port doc.
//
// «عايز فلتر كامل بكل حاجة فى الجدول زى فلتر الحركة كدا فى السيارات»: one filter per column of the
// table, in the table's order — Bank, ID, ATM Name, Area — on the vehicles registry's dark bar,
// each with its icon; the two name columns take several answers, the ID takes codes picked or
// pasted, the name a few typed letters. «وكمان عدد الماكينات والبنوك والمناطق يظهر فوق بجانب جملة
// كل الماكينات (ويتغير بناء على الفلتر)»: the three counts sit beside the title.
//
// EVERYTHING IS THE SERVER'S: the filters, the order, the pages, the counts and the export all
// send the same query (`lib/machine-directory.ts`), so a directory of some 2,600 machines is
// filtered, counted and exported whole — the page used to read ONE page of a hundred, and its
// search and its export never saw the rest.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  joinAtmNameList,
  splitAtmMachineCodeList,
  splitAtmNameList,
  type AtmMachineDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { DebouncedInput } from '../../../shared/ui/DebouncedInput';
import { FilterBar, FilterResetStyleContext } from '../../../shared/ui/FilterBar';
import { FilterWithIcon } from '../../../shared/ui/FilterWithIcon';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { DownloadIcon } from '../../../shared/ui/icons';
import { DARK_FILTER_BAR } from '../../../shared/ui/dark-filter-bar';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { chosenSorts, clickChosenSort, readSorts, writeSorts } from '../../../shared/lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import * as atmApi from '../api/atm-api';
import { useAtmMachines, useAtmMachinesSummary } from '../api/atm-queries';
import { MachineCodeFilter } from '../components/MachineCodeFilter';
import { MACHINE_ICON, MachineFigures } from '../components/MachineFigures';
import { boardFilterOptions } from '../lib/board-filters';
import {
  MACHINES_DEFAULT_PAGE_SIZE,
  MACHINES_DEFAULT_SORT,
  fetchMachinesForExport,
  hasMachineFilters,
  machineFilterQuery,
  machinesCsv,
} from '../lib/machine-directory';

/** Remembered across visits: this screen's filters, order and page size. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['areas', 'banks', 'codes', 'name', 'size', 'sort'] as const;

/** «زرار ريست … يكون لونه احمر»: the reset of the vehicles registry's bar — red, once a filter is set. */
const RESET_LIKE_VEHICLES = { tone: 'red', always: false } as const;

export const MachinesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // The address bar is the filter. A bank or an area may hold a comma — the list escapes it
  // (`joinAtmNameList`); codes hold none, and read normalized.
  const banks = splitAtmNameList(sp.get('banks') ?? '');
  const codes = splitAtmMachineCodeList(sp.get('codes') ?? '');
  const name = sp.get('name') ?? '';
  const areas = splitAtmNameList(sp.get('areas') ?? '');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(sp.get('size') ?? '') || MACHINES_DEFAULT_PAGE_SIZE),
  );
  const sortParam = sp.get('sort');
  const filters = { banks, codes, name, areas };
  const filtered = hasMachineFilters(filters);

  // Replaces rather than pushes: a filter is a view of this screen, not a place to go Back to. A
  // filter change starts again at the first page.
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    // The free-text search this screen carried before its column filters asks nothing any more; a
    // link or a remembered view still holding it loses it with the first write.
    next.delete('q');
    setSp(next, { replace: true });
  };

  const paramsKey = sp.toString();
  /** What the summary, the pages and the export all ask — the filters, nothing about pages. */
  const filterQuery = useMemo(() => machineFilterQuery(filters), [paramsKey]);
  // The reader's own order, or the screen's (by code) when they have not chosen one. The headers
  // show the reader's only — the screen's own order carries no arrow, as on the vehicles registry.
  const chosen = useMemo(() => chosenSorts(sortParam), [sortParam]);
  const order = useMemo(() => {
    const first = readSorts(sortParam, MACHINES_DEFAULT_SORT)[0];
    return { sortBy: first?.by ?? 'machineCode', sortDir: first?.dir ?? 'asc' };
  }, [sortParam]);
  const params = useMemo(
    () => ({ ...filterQuery, ...order, page, pageSize }),
    [filterQuery, order, page, pageSize],
  );
  const list = useAtmMachines(params);
  const rows = list.data?.items ?? [];
  const summary = useAtmMachinesSummary(filterQuery);

  const bankOptions = boardFilterOptions(summary.data?.options.banks ?? [], banks);
  const areaOptions = boardFilterOptions(summary.data?.options.areas ?? [], areas);
  /** The ID picker offers the machines the other three filters leave. */
  const codeNarrow = useMemo(() => machineFilterQuery({ ...filters, codes: [] }), [paramsKey]);

  const [exporting, setExporting] = useState(false);
  /** EVERY machine the filter matched, in the order on screen — not the page in hand. */
  const exportCsv = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await fetchMachinesForExport((pageNo, size) =>
        atmApi.listMachines({ ...filterQuery, ...order, page: pageNo, pageSize: size }),
      );
      const blob = new Blob([machinesCsv(all)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'atm-machines.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AtmMachineDto>[] = [
    {
      key: 'bank',
      header: t('atm.common.bank'),
      sortable: true,
      sortKey: 'bankName',
      render: (row) => row.bankName,
    },
    {
      key: 'code',
      header: t('atm.common.machineId'),
      sortable: true,
      sortKey: 'machineCode',
      render: (row) => row.machineCode,
    },
    {
      key: 'name',
      header: t('atm.common.machineName'),
      sortable: true,
      sortKey: 'name',
      render: (row) => row.name,
    },
    {
      key: 'area',
      header: t('atm.common.area'),
      sortable: true,
      sortKey: 'area',
      render: (row) => row.area,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('atm.machines.title')}
        figures={<MachineFigures counts={summary.data?.counts} locale={locale} />}
        actions={
          <Button
            variant="secondary"
            onClick={() => void exportCsv()}
            loading={exporting}
            disabled={list.data === undefined || list.data.meta.totalItems === 0}
          >
            <DownloadIcon className="h-4 w-4" />
            {t('atm.machines.export')}
          </Button>
        }
      />
      {/* The vehicles registry's bar: one control per column, in the table's order, each with its
          icon. Every dropdown takes several answers; within a column they are ORed, and the columns
          are ANDed. */}
      <div
        data-machine-filters="true"
        className={cn(DARK_FILTER_BAR, 'mb-4', '[&_[role=listbox]]:animate-menu-in')}
      >
        <FilterResetStyleContext.Provider value={RESET_LIKE_VEHICLES}>
          <FilterBar
            hasActiveFilters={filtered}
            onClear={() => patch({ banks: null, codes: null, name: null, areas: null })}
          >
            <FilterWithIcon
              icon={MACHINE_ICON.bank}
              tone="text-violet-600 dark:text-violet-300"
              className="w-36 shrink-0"
            >
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                chips
                label={t('atm.common.bank')}
                options={bankOptions}
                value={banks}
                onChange={(next) => patch({ banks: next.length === 0 ? null : joinAtmNameList(next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={MACHINE_ICON.code}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-32 shrink-0"
            >
              <MachineCodeFilter
                fullWidth
                density="tight"
                className="w-full"
                label={t('atm.common.machineId')}
                value={codes}
                narrow={codeNarrow}
                onChange={(next) => patch({ codes: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={MACHINE_ICON.name}
              tone="text-sky-600 dark:text-sky-400"
              className="w-44 shrink-0"
            >
              <DebouncedInput
                aria-label={t('atm.common.machineName')}
                placeholder={t('atm.common.machineName')}
                value={name}
                onValueChange={(next) => patch({ name: next === '' ? null : next })}
                density="tight"
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={MACHINE_ICON.area}
              tone="text-amber-700 dark:text-amber-300"
              className="w-36 shrink-0"
            >
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                chips
                label={t('atm.common.area')}
                options={areaOptions}
                value={areas}
                onChange={(next) => patch({ areas: next.length === 0 ? null : joinAtmNameList(next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </FilterResetStyleContext.Provider>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        sort={chosen}
        onSortChange={(by) => patch({ sort: writeSorts(clickChosenSort(sortParam, by)) })}
        empty={filtered ? t('atm.machines.emptyFiltered') : t('atm.machines.empty')}
      />
      {list.data !== undefined && list.data.meta.totalItems > 0 && (
        <Pagination
          meta={list.data.meta}
          onPageChange={(next) => patch({ page: String(next) }, false)}
          onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
        />
      )}
    </PageContainer>
  );
};
