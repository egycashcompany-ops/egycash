// The mobile-line register (FR-19) — «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز أعملهم صفحة
// لإدارتهم وتسليمهم وبردو بفلتر لكل شبكة مع بيانات كل شبكة»: the company's lines on its three
// networks, who holds each one, and their hand-over and return.
//
// THE NETWORK CARDS ARE THE NETWORK FILTER. «عايزك تستخدم الـ 3 لوجوهات فى الفلتر وفى الجدول جنب
// كل خط تابع لشركته»: one card per network, with its logo and its figures («مع بيانات كل شبكة» —
// how many lines, in stock, handed over, suspended, and the account numbers they are billed on),
// and pressing a card narrows the table to that network; pressing another adds it, pressing it
// again takes it off, and none pressed is every network. The figures are the server's, under the
// table's OTHER filters (`/summary`), so a card always says what pressing it would show. In the
// table, every line carries its network's logo beside the network's name.
//
// URL-synced like every IT register — a filtered view is a link, and the filters are remembered
// across visits. Everything on a row is a server fact: the status follows from the named actions
// alone, and each action is offered only where the line's status allows it and the reader's grant
// does — the same `itAsset.*` grants as the assets, which a line is handed over under.
//
// Excel and PDF, before the screen's own action, as on the other registers: every line the filters
// match, in the table's order (`lib/mobile-line-register-export.ts`).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IT_MOBILE_LINE_HOLDER_KINDS,
  IT_MOBILE_LINE_STATUSES,
  IT_MOBILE_NETWORKS,
  type ItMobileLineDto,
  type ItMobileNetwork,
  type ItMobileNetworkSummaryDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import {
  CheckIcon,
  EditIcon,
  HistoryIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  UsersIcon,
} from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import * as api from '../api/it-api';
import {
  useItBranchOptions,
  useItMobileLines,
  useItMobileLinesSummary,
  useItPerson,
} from '../api/it-queries';
import { EmployeePicker } from '../components/EmployeePicker';
import { MobileNetworkBadge, MobileNetworkLogo } from '../components/MobileNetworkLogo';
import { MobileLineStatusBadge } from '../components/MobileLineStatusBadge';
import { MobileLineReceiptActions } from '../components/MobileLineReceipt';
import {
  HandOverMobileLineDialog,
  MobileLineFormDialog,
  MobileLineHistoryDialog,
  MobileLineStatusDialog,
  ReturnMobileLineDialog,
} from '../components/MobileLineDialogs';
import { RegisterExportButtons } from '../components/RegisterExportButtons';
import { saveSheet } from '../../fleet/lib/fleet-sheet';
import {
  mobileLineRegisterFilters,
  mobileLineRegisterHeader,
  mobileLineRegisterLine,
  mobileLineRegisterReport,
  mobileLineRegisterSubtitle,
} from '../lib/mobile-line-register-export';
import { gatherRegister, printItRegister } from '../lib/register-export';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'holder',
  'kind',
  'network',
  'q',
  'size',
  'sort',
  'status',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** The `network` param — the cards pressed, in the networks' own order; anything else is dropped. */
const pressedNetworks = (raw: string): ItMobileNetwork[] => {
  const named = new Set(raw.split(','));
  return IT_MOBILE_NETWORKS.filter((network) => named.has(network));
};

type LineDialog =
  | { kind: 'create' }
  | {
      kind: 'edit' | 'handOver' | 'return' | 'suspend' | 'reactivate' | 'history';
      line: ItMobileLineDto;
    };

/**
 * One network's card — its logo, name and figures — and the toggle that narrows the table to it.
 * A button, pressed or not (`aria-pressed`), because that is what it is.
 */
const NetworkCard = ({
  network,
  summary,
  pressed,
  onToggle,
}: {
  network: ItMobileNetwork;
  summary: ItMobileNetworkSummaryDto | undefined;
  pressed: boolean;
  onToggle: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const name = t(`it.mobileLines.network.${network}`);
  const accounts = summary?.accounts ?? [];
  return (
    <button
      type="button"
      data-network-pick={network}
      aria-pressed={pressed}
      title={t('it.mobileLines.card.toggle', { network: name })}
      onClick={onToggle}
      className={cn(
        'relative flex flex-col gap-3 rounded-2xl border p-4 text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        pressed
          ? 'border-brand-500 bg-brand-50/70 ring-2 ring-brand-500/30 dark:border-brand-400 dark:bg-brand-950/30'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
      )}
    >
      {pressed && (
        <span className="absolute -top-2 -end-2 rounded-full bg-brand-600 p-0.5 text-white shadow">
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="flex items-center gap-3">
        <MobileNetworkLogo network={network} size="lg" decorative />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-semibold text-slate-900 dark:text-white">{name}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.mobileLines.card.total')}{' '}
            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {formatNumber(summary?.total, locale)}
            </span>
          </span>
        </span>
      </span>
      <span className="grid grid-cols-3 gap-2 text-center">
        {IT_MOBILE_LINE_STATUSES.map((status) => (
          <span
            key={status}
            data-network-count={status}
            className="rounded-lg bg-slate-50 px-1 py-1.5 dark:bg-slate-800/60"
          >
            <span className="block text-base font-semibold tabular-nums text-slate-900 dark:text-white">
              {formatNumber(summary?.[status], locale)}
            </span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t(`it.mobileLines.status.${status}`)}
            </span>
          </span>
        ))}
      </span>
      {accounts.length > 0 && (
        <span className="flex flex-col gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('it.mobileLines.card.accounts')}
          </span>
          {accounts.map((account) => (
            <span
              key={account.value ?? ''}
              className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200"
            >
              {account.value === null ? (
                <span className="text-slate-500 dark:text-slate-400">
                  {t('it.mobileLines.card.noAccount')}
                </span>
              ) : (
                <span className="font-mono" dir="ltr">
                  {account.value}
                </span>
              )}
              <span className="tabular-nums">{formatNumber(account.count, locale)}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
};

export const MobileLinesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const networks = pressedNetworks(sp.get('network') ?? '');
  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branch') ?? '';
  // Who holds it NOW — an employee id, so the filter survives a rename and can be linked.
  const holderId = sp.get('holder') ?? '';
  const kind = sp.get('kind') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  // No sort chosen is the register's own order — by network, then by number — which the server
  // keeps when no `sortBy` is sent.
  const sortParam = sp.get('sort') ?? '';
  const [sortByRaw, sortDirRaw] = sortParam.split(':');
  const sort =
    sortParam === '' || sortByRaw === undefined || sortByRaw === ''
      ? null
      : { by: sortByRaw, dir: sortDirRaw === 'desc' ? ('desc' as const) : ('asc' as const) };
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  const changeSort = (by: string): void => {
    const dir = sort !== null && sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };
  const toggleNetwork = (network: ItMobileNetwork): void => {
    const next = networks.includes(network)
      ? networks.filter((n) => n !== network)
      : [...networks, network];
    patch({ network: IT_MOBILE_NETWORKS.filter((n) => next.includes(n)).join(',') || null });
  };
  const hasActiveFilters =
    networks.length > 0 ||
    search !== '' ||
    status !== '' ||
    branchId !== '' ||
    holderId !== '' ||
    kind !== '';

  // Every filter but the network: what the cards' figures are counted under, so each card says
  // what pressing it would show.
  const filters = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      branchId: branchId || undefined,
      holderEmployeeId: holderId || undefined,
      holderKind: kind || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
      networks: networks.length === 0 ? undefined : networks.join(','),
      ...filters,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItMobileLines(params);
  const summary = useItMobileLinesSummary(filters);
  const rows = data?.items ?? [];

  // The holder chip's label: the pick supplies it, kept WITH the id it was picked for (back and
  // forward change the id underneath); arriving on a link with only an id, the rows name the
  // person, and failing that the person is resolved by id — the custody register's rule.
  const [pickedHolder, setPickedHolder] = useState({ id: '', label: '' });
  const pickedHere = pickedHolder.id === holderId && pickedHolder.label !== '';
  const rowHolder = rows.find((line) => line.holder?.employeeId === holderId)?.holder ?? null;
  const rowHolderName =
    rowHolder === null || rowHolder.employeeName === null
      ? null
      : `${rowHolder.employeeName}${rowHolder.employeeCode === null ? '' : ` (${rowHolder.employeeCode})`}`;
  const holderPerson = useItPerson(holderId, !pickedHere && rowHolderName === null);
  const holderLabel = pickedHere
    ? pickedHolder.label
    : (rowHolderName ??
      (holderPerson.data === undefined
        ? ''
        : `${holderPerson.data.fullNameAr} (${holderPerson.data.code})`));

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  const [dialog, setDialog] = useState<LineDialog | null>(null);
  const close = (): void => setDialog(null);

  // ── The register as a file: Excel and PDF, of everything the filters match ──────────────────
  const exportContext = { t, locale, branchName };
  // Every line the filters match, in the table's order — the table's own params, unpaged.
  const allRows = () => gatherRegister(params, api.listMobileLines);
  const toExcel = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('it.nav.mobileLines'),
      serialHeader: t('it.export.serial'),
      header: mobileLineRegisterHeader(t),
      rows: all.map((row) => mobileLineRegisterLine(row, exportContext, '')),
    });
  };
  const toPdf = (): Promise<boolean> =>
    printItRegister(async () => {
      const all = await allRows();
      const subtitle = mobileLineRegisterSubtitle(t, {
        ...mobileLineRegisterFilters({
          networks,
          search,
          status,
          branchId,
          branchName,
          holderId,
          holderLabel,
          kind,
          rows: all,
        }),
        asOf: formatDate(new Date().toISOString(), locale),
      });
      return mobileLineRegisterReport(all, exportContext, subtitle);
    }, t('it.export.preparing'));

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';
  const action = (
    line: ItMobileLineDto,
    kind: Exclude<LineDialog['kind'], 'create'>,
    label: string,
    icon: JSX.Element,
  ): JSX.Element => (
    <button
      type="button"
      data-line-action={kind}
      className={actionButton}
      aria-label={`${label} — ${line.phoneNumber}`}
      title={label}
      onClick={() => setDialog({ kind, line })}
    >
      {icon}
    </button>
  );

  const columns: Column<ItMobileLineDto>[] = [
    {
      key: 'network',
      header: t('it.mobileLines.columns.network'),
      sortable: true,
      render: (line) => <MobileNetworkBadge network={line.network} />,
    },
    {
      // A number is an identifier, not a quantity: as the network writes it, never re-digited.
      key: 'phoneNumber',
      header: t('it.mobileLines.columns.number'),
      sortable: true,
      render: (line) => (
        <span className="font-mono text-xs" dir="ltr">
          {line.phoneNumber}
        </span>
      ),
    },
    {
      key: 'ratePlan',
      header: t('it.mobileLines.columns.plan'),
      sortable: true,
      render: (line) => line.ratePlan ?? '—',
    },
    {
      key: 'simSerial',
      header: t('it.mobileLines.columns.simSerial'),
      render: (line) =>
        line.simKind === 'esim' ? (
          <Badge tone="brand" size="sm">
            {t('it.mobileLines.esim')}
          </Badge>
        ) : line.simSerial === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {line.simSerial}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      sortable: true,
      render: (line) => <MobileLineStatusBadge status={line.status} />,
    },
    {
      key: 'holder',
      header: t('it.custody.holder'),
      render: (line) => {
        const holder = line.holder;
        if (holder === null) return '—';
        if (holder.kind === 'vehicle') {
          return (
            <span className="flex flex-col leading-tight" data-line-holder="vehicle">
              <span>{t('it.mobileLines.holderKind.vehicle')}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {holder.vehicleCode === null ? null : (
                  <bdi className="font-mono" dir="ltr">
                    {holder.vehicleCode}
                  </bdi>
                )}
                {holder.vehicleCode !== null && holder.vehiclePlate !== null ? ' — ' : null}
                {holder.vehiclePlate === null ? null : <bdi>{holder.vehiclePlate}</bdi>}
              </span>
            </span>
          );
        }
        const name = holder.employeeName ?? holder.employeeId ?? '—';
        return (
          <span className="flex flex-col leading-tight" data-line-holder="employee">
            {holder.employeeId === null ? (
              <span>{name}</span>
            ) : (
              <Link to={`/it/employees/${holder.employeeId}`} className="hover:underline">
                {name}
              </Link>
            )}
            {holder.employeeCode === null ? null : (
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {holder.employeeCode}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (line) => branchName.get(line.branchId) ?? '—',
    },
    {
      key: 'assignedAt',
      header: t('it.custody.assignedAt'),
      render: (line) =>
        line.holder === null ? (
          '—'
        ) : (
          <span className="tabular-nums">{formatDate(line.holder.assignedAt, locale)}</span>
        ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (line) => (
        <span className="flex flex-wrap items-center justify-end gap-1">
          {/* The acknowledgment the employee signed: print it again, file or view the copy. */}
          {line.holder !== null && line.holder.receiptId !== null && (
            <MobileLineReceiptActions
              receiptId={line.holder.receiptId}
              receiptSigned={line.holder.receiptSigned}
            />
          )}
          {line.status === 'inStock' &&
            can('itAsset.assign') &&
            action(
              line,
              'handOver',
              t('it.mobileLines.actions.handOver'),
              <UsersIcon className="h-4 w-4" />,
            )}
          {line.status === 'inStock' &&
            can('itAsset.edit') &&
            action(
              line,
              'suspend',
              t('it.mobileLines.actions.suspend'),
              <PauseIcon className="h-4 w-4" />,
            )}
          {line.status === 'assigned' &&
            can('itAsset.assign') &&
            action(
              line,
              'return',
              t('it.mobileLines.actions.return'),
              <ResetIcon className="h-4 w-4" />,
            )}
          {line.status === 'suspended' &&
            can('itAsset.edit') &&
            action(
              line,
              'reactivate',
              t('it.mobileLines.actions.reactivate'),
              <PlayIcon className="h-4 w-4" />,
            )}
          {can('itAsset.edit') &&
            action(line, 'edit', t('it.mobileLines.edit'), <EditIcon className="h-4 w-4" />)}
          {action(
            line,
            'history',
            t('it.mobileLines.actions.history'),
            <HistoryIcon className="h-4 w-4" />,
          )}
        </span>
      ),
    },
  ];

  const byNetwork = new Map(
    (summary.data?.networks ?? []).map((entry) => [entry.network, entry] as const),
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.mobileLines')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.mobileLines') },
        ]}
        actions={
          <>
            {/* The files first, the form's action after them, as on the other registers. Not
                offered when the list failed: the file behind them would be short. */}
            {!isError && (
              <RegisterExportButtons name="it-mobile-lines" onExcel={toExcel} onPdf={toPdf} />
            )}
            <Can permission="itAsset.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setDialog({ kind: 'create' })}
              >
                {t('it.mobileLines.create')}
              </Button>
            </Can>
          </>
        }
      />

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {IT_MOBILE_NETWORKS.map((network) => (
              <NetworkCard
                key={network}
                network={network}
                summary={byNetwork.get(network)}
                pressed={networks.includes(network)}
                onToggle={() => toggleNetwork(network)}
              />
            ))}
          </div>
          {summary.isError ? (
            // The cards still filter; only their figures are missing — say so, and offer again.
            <p
              className="flex flex-wrap items-center gap-2 text-xs text-red-600 dark:text-red-400"
              role="alert"
            >
              {errorMessage(summary.error, locale)}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={() => void summary.refetch()}
              >
                {t('common.retry')}
              </button>
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('it.mobileLines.networksHint')}
            </p>
          )}
        </div>

        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => {
            setPickedHolder({ id: '', label: '' });
            patch({ network: null, q: null, status: null, branch: null, holder: null, kind: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.mobileLines.searchPlaceholder')}
            aria-label={t('it.mobileLines.searchPlaceholder')}
            className="w-72"
          />
          <Select
            aria-label={t('it.assets.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.mobileLines.allStatuses')}</option>
            {IT_MOBILE_LINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`it.mobileLines.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.assets.columns.branch')}
            value={branchId}
            onChange={(e) => patch({ branch: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.assets.allBranches')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.mobileLines.filterKind')}
            value={kind}
            onChange={(e) => patch({ kind: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.mobileLines.allHolderKinds')}</option>
            {IT_MOBILE_LINE_HOLDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`it.mobileLines.heldBy.${k}`)}
              </option>
            ))}
          </Select>
          {/* A SEARCH: everybody HR has, leavers included — a leaver may still hold a line. */}
          <EmployeePicker
            includeExited
            value={holderId}
            valueLabel={holderLabel}
            ariaLabel={t('it.custody.filterHolder')}
            onChange={(id, label) => {
              setPickedHolder({ id, label });
              patch({ holder: id || null });
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(line) => line.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          {...(sort === null ? {} : { sort })}
          onSortChange={changeSort}
          empty={t('it.mobileLines.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <MobileLineFormDialog
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onClose={close}
        line={dialog !== null && dialog.kind === 'edit' ? dialog.line : null}
      />
      {dialog !== null && dialog.kind === 'handOver' && (
        <HandOverMobileLineDialog open onClose={close} line={dialog.line} />
      )}
      {dialog !== null && dialog.kind === 'return' && (
        <ReturnMobileLineDialog open onClose={close} line={dialog.line} />
      )}
      {dialog !== null && (dialog.kind === 'suspend' || dialog.kind === 'reactivate') && (
        <MobileLineStatusDialog open onClose={close} line={dialog.line} action={dialog.kind} />
      )}
      {dialog !== null && dialog.kind === 'history' && (
        <MobileLineHistoryDialog open onClose={close} line={dialog.line} />
      )}
    </PageContainer>
  );
};
