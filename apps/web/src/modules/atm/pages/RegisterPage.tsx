// /atm/register — the efficiency register (spec §8.3): the owner's `ATMs` sheet as a live, paged
// grid, one row per custody period of a machine — received from the bank, handed back to it.
//
// The screen is the sheet the owner works in, so it keeps the sheet's shape: the 49 columns in
// their own order under their group names, Branch · Area · Bank · ATM ID · Name frozen, handed-back
// rows dark green. Around it, what the sheet could not do: the server pages through ALL of it (the
// 100-row cap is per page, never per register), filters it, and decides who sees what — key
// columns arrive empty for a reader without the keys permission, and the safe-door combination
// never arrives at all; reading it is the audited Reveal (D3).
//
// Writing goes through the dialogs, each one request: Receive (a new period), Edit, Record
// receipt (a pending entry), Hand over, Link (an imported entry the Operations list does not know
// yet), Delete. Each also moves the machine in the Operations list as the owner decided (D2), and
// says so in its toast. Which buttons a reader sees follows their keys; the server's branch-reach
// rule (DEC-29) is the actual gate.
//
// THE URL HOLDS THE VIEW. This file reads exactly the remembered params below, plus `page` (the
// persistence census, `remembered-filters-coverage.spec.ts`); the filter bar reports changes and
// never touches the URL itself.
//
// The banks are the catalog's (DEC-35). The owner's call (final): a bank added at runtime is a full
// register bank — so the bank filter takes any well-shaped code (whether it exists is the server's
// answer, and a stale one simply matches nothing), and «البنوك» in the header opens the catalog for
// whoever keeps it: Efficiency curate banks HERE, having no navigation row to /atm/data-edit.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ATM_BANK_CODE_PATTERN,
  ATM_REGISTER_STATUSES,
  type AtmRegisterEntryDto,
  type AtmRegisterStatus,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { Button } from '../../../shared/ui/Button';
import { Pagination } from '../../../shared/ui/Pagination';
import {
  BuildingIcon,
  ChartIcon,
  DownloadIcon,
  PlusIcon,
  UploadIcon,
} from '../../../shared/ui/icons';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { exportRegisterEntries, type RegisterListParams } from '../api/register-api';
import { useRegisterEntries, useRegisterMeta } from '../api/register-queries';
import { BankCatalogDialog } from '../components/catalog/BankCatalogDialog';
import { DeleteEntryDialog } from '../components/register/DeleteEntryDialog';
import { EditEntryDialog } from '../components/register/EditEntryDialog';
import { HandoverDialog } from '../components/register/HandoverDialog';
import { LinkEntryDialog } from '../components/register/LinkEntryDialog';
import { ReceiveEntryDialog } from '../components/register/ReceiveEntryDialog';
import { ReceivePendingDialog } from '../components/register/ReceivePendingDialog';
import { RegisterFilters, type RegisterFilterValues } from '../components/register/RegisterFilters';
import { RegisterGrid } from '../components/register/RegisterGrid';
import { type RegisterRowAction } from '../components/register/RegisterRowActions';
import { RevealCombinationDialog } from '../components/register/RevealCombinationDialog';
import { makeBankLookup } from '../lib/bank-catalog';
import {
  REGISTER_PAGE_SIZES,
  nextRegisterSort,
  parseRegisterPageSize,
  parseRegisterSort,
  type RegisterActionGrants,
} from '../lib/register-grid';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'bank',
  'status',
  'area',
  'q',
  'issues',
  'incomplete',
  'sort',
  'size',
] as const;

// The board frame (`shared/ui/board-scroll.ts`): on a computer the page fills the screen, the
// header and filters keep their place, the pager keeps its place below, and only the grid's rows
// scroll. The loading, failed and empty states sit in a panel the size the grid would take.
const BOARD_PANEL =
  'rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

/** A link that reads as the header's secondary buttons do. */
const LINK_BUTTON =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** A comma list from the URL, keeping only values the server accepts — a stale link cannot 400. */
const readCodes = <T extends string>(
  raw: string | null,
  keep: (value: string) => value is T,
): T[] => (raw ?? '').split(',').filter(keep);

const isStatus = (value: string): value is AtmRegisterStatus =>
  (ATM_REGISTER_STATUSES as readonly string[]).includes(value);
/** A bank by its shape only: the catalog may hold a bank this build has never heard of. */
const isBankCode = (value: string): value is string => ATM_BANK_CODE_PATTERN.test(value);

/** The filters as the URL holds them — what the bar shows. */
export const readRegisterFilters = (sp: URLSearchParams): RegisterFilterValues => {
  const branchParam = sp.get('branch') ?? '';
  return {
    branch: OBJECT_ID.test(branchParam) ? branchParam : '',
    banks: readCodes(sp.get('bank'), isBankCode),
    statuses: readCodes(sp.get('status'), isStatus),
    area: (sp.get('area') ?? '').trim().slice(0, 120),
    q: sp.get('q') ?? '',
    issues: sp.get('issues') === '1',
    incomplete: sp.get('incomplete') === '1',
  };
};

/** The filters as the API reads them — the list and the export send exactly these. */
export const registerFilterParams = (filters: RegisterFilterValues): RegisterListParams => ({
  ...(filters.branch === '' ? {} : { branchId: filters.branch }),
  ...(filters.banks.length === 0 ? {} : { banks: filters.banks }),
  ...(filters.statuses.length === 0 ? {} : { statuses: filters.statuses }),
  ...(filters.area === '' ? {} : { area: filters.area }),
  ...(filters.q.trim() === '' ? {} : { search: filters.q.trim().slice(0, 100) }),
  ...(filters.issues ? { withIssues: true } : {}),
  // DEC-37: «بيانات ناقصة فقط» — the export takes it too, so Efficiency can take the list away.
  ...(filters.incomplete ? { incomplete: true } : {}),
});

type OpenDialog =
  | { action: 'receive' }
  | { action: 'banks' }
  | { action: RegisterRowAction; entry: AtmRegisterEntryDto };

export const RegisterPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const filters = readRegisterFilters(sp);
  const sort = parseRegisterSort(sp.get('sort'));
  const pageSize = parseRegisterPageSize(sp.get('size'));
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  /** The filters as the API reads them — shared by the list and the export. */
  const filterParams = useMemo<RegisterListParams>(
    () => registerFilterParams(filters),
    [paramsKey],
  );
  const listParams = useMemo<RegisterListParams>(
    () => ({
      ...filterParams,
      page,
      pageSize,
      // No sort sent = the sheet's own order, oldest row first (DEC-21).
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
    }),
    [paramsKey],
  );

  const meta = useRegisterMeta();
  const list = useRegisterEntries(listParams);
  const rows = list.data?.items ?? [];
  // The meta carries the whole catalog (archived banks too), so the grid names banks without a
  // request of its own; the six seeds stand in until it answers.
  const lookup = useMemo(() => makeBankLookup(meta.data?.banks), [meta.data]);

  const grants: RegisterActionGrants = {
    edit: can('atmRegister.edit'),
    create: can('atmRegister.create'),
    handover: can('atmRegister.handover'),
    viewSecrets: can('atmRegister.viewSecrets'),
    delete: can('atmRegister.delete'),
  };

  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const close = (): void => setDialog(null);

  const [exporting, setExporting] = useState(false);
  const runExport = async (): Promise<void> => {
    setExporting(true);
    try {
      // The CSV is the server's: every row these filters match, public columns only, audited.
      await exportRegisterEntries(filterParams);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(false);
    }
  };

  // No `EGYCASH-n` is mapped to an ECMS branch yet: nothing can be received, and the reader should
  // know why before they try.
  const noMapping = meta.data !== undefined && meta.data.branches.every((b) => b.branchId === null);

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('atm.register.title')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Can anyOf={['atmBank.create', 'atmBank.edit']}>
                <Button
                  size="sm"
                  variant="secondary"
                  data-register-banks="true"
                  leftIcon={<BuildingIcon className="h-4 w-4" />}
                  onClick={() => setDialog({ action: 'banks' })}
                >
                  {t('atm.bankCatalog.title')}
                </Button>
              </Can>
              <Can permission="atmRegisterReport.view">
                <Link to="/atm/register/report" className={LINK_BUTTON}>
                  <ChartIcon className="h-4 w-4" />
                  {t('atm.register.openReport')}
                </Link>
              </Can>
              <Can permission="atmRegister.import">
                <Link to="/atm/register/import" className={LINK_BUTTON}>
                  <UploadIcon className="h-4 w-4" />
                  {t('atm.register.import')}
                </Link>
              </Can>
              <Can permission="atmRegister.export">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={exporting}
                  leftIcon={<DownloadIcon className="h-4 w-4" />}
                  onClick={() => void runExport()}
                >
                  {t('atm.register.export')}
                </Button>
              </Can>
              <Can permission="atmRegister.create">
                <Button
                  size="sm"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  // The branch list comes with the meta; a receipt cannot name a branch before it.
                  disabled={meta.data === undefined}
                  onClick={() => setDialog({ action: 'receive' })}
                >
                  {t('atm.register.receive')}
                </Button>
              </Can>
            </div>
          }
        />

        {noMapping && (
          <p
            role="status"
            data-register-no-mapping="true"
            className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
          >
            {t('atm.register.noMapping')}
          </p>
        )}

        <RegisterFilters
          values={filters}
          meta={meta.data}
          total={list.data?.meta.totalItems ?? null}
          onChange={(update) => patch(update)}
          // ONE update for every key: clearing them one call at a time would rebuild each URL from
          // this render's params and put the others back.
          onClear={() =>
            patch({
              branch: null,
              bank: null,
              status: null,
              area: null,
              q: null,
              issues: null,
              incomplete: null,
            })
          }
        />

        <div className={BOARD_TABLE_FILL}>
          {list.isPending ? (
            <div className={BOARD_PANEL}>
              <LoadingState />
            </div>
          ) : list.isError ? (
            <div className={BOARD_PANEL}>
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <div className={BOARD_PANEL}>
              <EmptyState title={t('atm.register.empty')} />
            </div>
          ) : (
            <RegisterGrid
              rows={rows}
              sort={sort}
              onSort={(by) => patch({ sort: nextRegisterSort(sort, by) }, false)}
              grants={grants}
              onAction={(action, entry) => setDialog({ action, entry })}
              lookup={lookup}
            />
          )}
        </div>

        {list.data !== undefined && list.data.meta.totalItems > 0 && (
          <Pagination
            meta={list.data.meta}
            pageSizeOptions={REGISTER_PAGE_SIZES}
            onPageChange={(next) => patch({ page: String(next) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      {/* Each dialog is mounted only while open, so it starts from the row as it is NOW and the
          reveal's value cannot outlive the dialog that showed it. */}
      {dialog?.action === 'receive' && <ReceiveEntryDialog meta={meta.data} onClose={close} />}
      {dialog?.action === 'banks' && <BankCatalogDialog open onClose={close} />}
      {dialog !== null && dialog.action === 'edit' && (
        <EditEntryDialog entry={dialog.entry} meta={meta.data} onClose={close} />
      )}
      {dialog !== null && dialog.action === 'receivePending' && (
        <ReceivePendingDialog entry={dialog.entry} meta={meta.data} onClose={close} />
      )}
      {dialog !== null && dialog.action === 'handover' && (
        <HandoverDialog entry={dialog.entry} onClose={close} />
      )}
      {dialog !== null && dialog.action === 'reveal' && (
        <RevealCombinationDialog entry={dialog.entry} onClose={close} />
      )}
      {dialog !== null && dialog.action === 'link' && (
        <LinkEntryDialog entry={dialog.entry} onClose={close} />
      )}
      {dialog !== null && dialog.action === 'delete' && (
        <DeleteEntryDialog entry={dialog.entry} onClose={close} />
      )}
    </PageContainer>
  );
};
