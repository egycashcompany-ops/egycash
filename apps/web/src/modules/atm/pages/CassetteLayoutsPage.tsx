// /atm/settlements/layouts «فئات الكاسيتات» (docs/12-planning/atm-settlements-phase1.md §9.5, S-1,
// S-2) — every active machine of the bank in the work branch, with its cassettes: how many, and
// each one's kind, denomination and currency. Settlements edits them here when a bank changes a
// machine's denominations; every change keeps a version.
//
// ONE BRANCH, THE SERVER'S (DS-22), as on the plan page. `bank` and `status` are remembered; `q` is
// the list's search (as on the unlocated screen) and `machine` a link that opens one machine's
// editor — neither is a narrowing worth keeping.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ATM_BANK_NAMES,
  type AtmBankCode,
  type AtmCassetteLayoutRowDto,
  type Locale,
  type SaveAtmCassetteLayout,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { foldIncludes } from '../../../shared/lib/fold';
import { formatBusinessDateTime, formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Field, Select } from '../../../shared/ui/form';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCassetteLayout,
  useCassetteLayouts,
  useSaveCassetteLayout,
  useSettlementContext,
  useStandardLoads,
} from '../api/settlements-queries';
import { BlockedNotice } from '../components/settlements/DayField';
import { LayoutChips } from '../components/settlements/LineChips';
import { LayoutEditor } from '../components/settlements/LayoutEditor';
import { standardLoadLabel } from '../components/settlements/PlanLinePanel';
import { SettlementFigures } from '../components/settlements/SettlementFigures';
import { StandardLoadsDialog } from '../components/settlements/StandardLoadsDialog';
import { cairoDay, formatPaperDate } from '../lib/settlement-dates';
import {
  blockedKey,
  blockedOf,
  lastImportFigures,
  settlementErrorText,
} from '../lib/settlement-view';

/** Remembered across visits: the bank and the status chip. `q` and `machine` are not filters. */
const REMEMBERED_FILTERS = ['bank', 'status'] as const;

const STATUSES = ['all', 'withLayout', 'withoutLayout'] as const;
type Status = (typeof STATUSES)[number];

export const CassetteLayoutsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  const context = useSettlementContext('layouts');
  const ctx = context.data;
  const banks = ctx?.banks ?? [];
  const bankParam = sp.get('bank');
  const bank: AtmBankCode | null = banks.find((b) => b === bankParam) ?? banks[0] ?? null;
  const statusParam = sp.get('status');
  const status: Status = STATUSES.find((s) => s === statusParam) ?? 'all';
  const query = sp.get('q') ?? '';
  const machineId = sp.get('machine');
  const branchId = ctx?.branch?.id ?? null;
  const ready = ctx !== undefined && ctx.blocked === null && branchId !== null && bank !== null;
  const bankCode: AtmBankCode = bank ?? 'BRK';

  const list = useCassetteLayouts({ bankCode, branchId }, ready);
  const loads = useStandardLoads({ bankCode, branchId }, ready);
  const detail = useCassetteLayout(ready ? machineId : null);
  const save = useSaveCassetteLayout();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadsOpen, setLoadsOpen] = useState(false);
  const blocked = ctx?.blocked ?? blockedOf(list.error) ?? null;
  const dto = list.data;
  const standardLoads = loads.data ?? [];
  const loadName = useMemo(
    () => new Map(standardLoads.map((l) => [l.id, standardLoadLabel(l, locale)])),
    [standardLoads, locale],
  );

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (dto?.rows ?? []).filter((row) => {
      if (status === 'withLayout' && row.layout === null) return false;
      if (status === 'withoutLayout' && row.layout !== null) return false;
      if (text === '') return true;
      return row.machineCode.toLowerCase().startsWith(text) || foldIncludes(row.machineName, query);
    });
  }, [dto, status, query]);

  const onSave = (body: SaveAtmCassetteLayout): void => {
    if (machineId === null) return;
    setSaveError(null);
    save.mutate(
      { machineId, body },
      {
        onError: (error) => {
          const text = settlementErrorText(error, t, locale);
          setSaveError(text);
          toast.error(text);
        },
      },
    );
  };

  const columns: Column<AtmCassetteLayoutRowDto>[] = [
    {
      key: 'code',
      header: t('atm.settlement.machineCode'),
      render: (row) => (
        <span dir="ltr" className="font-medium">
          {row.machineCode}
        </span>
      ),
    },
    { key: 'name', header: t('atm.settlement.machineName'), render: (row) => row.machineName },
    { key: 'area', header: t('atm.settlement.area'), render: (row) => row.area },
    {
      key: 'type',
      header: t('atm.layouts.column.type'),
      render: (row) => row.layout?.typeLabel ?? '—',
    },
    {
      key: 'cassettes',
      header: t('atm.layouts.column.cassettes'),
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {row.layout !== null && <LayoutChips slots={row.layout.slots} />}
          {row.flags
            .filter((flag) => flag !== 'standardLoadOtherBank')
            .map((flag) => (
              <Badge key={flag} tone="warning" size="sm">
                {t(`atm.layouts.flag.${flag}`)}
              </Badge>
            ))}
        </span>
      ),
    },
    {
      key: 'load',
      header: t('atm.layouts.column.standardLoad'),
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {row.layout === null
            ? '—'
            : row.layout.standardLoadId === null
              ? t('atm.plan.panel.standardDefault')
              : (loadName.get(row.layout.standardLoadId) ?? '—')}
          {row.flags.includes('standardLoadOtherBank') && (
            <Badge tone="danger" size="sm">
              {t('atm.layouts.flag.standardLoadOtherBank')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'changed',
      header: t('atm.layouts.column.changed'),
      render: (row) =>
        row.layout === null
          ? '—'
          : [
              formatBusinessDateTime(row.layout.changedAt, locale),
              row.layout.changedByName ?? '—',
              t(`atm.layouts.source.${row.layout.source}`),
            ].join(' · '),
    },
  ];

  const canImport = dto?.can.import ?? ctx?.can.importLayouts ?? false;
  const canManage = dto?.can.manage ?? ctx?.can.manageLayouts ?? false;
  const last = dto?.lastImport ?? null;
  const lastFigures = last === null ? null : lastImportFigures(last.counts);

  if (blocked !== null) {
    return (
      <PageContainer>
        <PageHeader title={t('atm.layouts.title')} />
        <BlockedNotice text={t(blockedKey(blocked))} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('atm.layouts.title')}
        figures={
          <SettlementFigures
            label={t('atm.layouts.title')}
            locale={locale}
            figures={[
              {
                key: 'machines',
                label: t('atm.layouts.figure.machines'),
                value: dto?.figures.machines,
              },
              {
                key: 'withLayout',
                label: t('atm.layouts.figure.withLayout'),
                value: dto?.figures.withLayout,
              },
              {
                key: 'withoutLayout',
                label: t('atm.layouts.figure.withoutLayout'),
                value: dto?.figures.withoutLayout,
              },
            ]}
          />
        }
        actions={
          <>
            {canImport && (
              <Link
                to="/atm/settlements/layouts/import"
                data-layouts-action="import"
                className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {t('atm.layouts.action.import')}
              </Link>
            )}
            <Button variant="secondary" disabled={!ready} onClick={() => setLoadsOpen(true)}>
              {t('atm.layouts.action.standardLoads')}
            </Button>
          </>
        }
      />

      {last !== null && lastFigures !== null && (
        <div
          data-last-import="true"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <span>
            {t('atm.layouts.lastImport', {
              date: formatPaperDate(cairoDay(last.at)),
              rows: formatNumber(lastFigures.rows, locale),
              matched: formatNumber(lastFigures.matched, locale),
              notFound: formatNumber(lastFigures.notFound, locale),
              flags: formatNumber(lastFigures.review, locale),
            })}
          </span>
          {canImport && (
            <Link
              to="/atm/settlements/layouts/import"
              className="text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('atm.layouts.action.lastImport')}
            </Link>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3" data-layouts-filters="true">
        <Field label={t('atm.settlement.bank')} htmlFor="layouts-bank">
          <Select
            id="layouts-bank"
            value={bank ?? ''}
            onChange={(e) => patch({ bank: e.target.value, machine: null })}
          >
            {banks.map((b) => (
              <option key={b} value={b}>
                {ATM_BANK_NAMES[b][locale]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('atm.settlement.status')} htmlFor="layouts-status">
          <Select
            id="layouts-status"
            value={status}
            onChange={(e) => patch({ status: e.target.value === 'all' ? null : e.target.value })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`atm.layouts.filter.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <SearchInput
          className="min-w-64"
          value={query}
          placeholder={t('atm.layouts.search')}
          onChange={(text) => patch({ q: text })}
        />
      </div>

      {context.isLoading ? (
        <LoadingState />
      ) : ctx === undefined && context.error !== null ? (
        <ErrorState
          error={context.error}
          description={settlementErrorText(context.error, t, locale)}
          onRetry={() => void context.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <section aria-label={t('atm.layouts.title')} className="min-w-0 flex-1">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.machineId}
              loading={ready && list.isLoading}
              error={list.error}
              onRetry={() => void list.refetch()}
              onRowClick={(row) =>
                patch({ machine: row.machineId === machineId ? null : row.machineId })
              }
              rowClassName={(row) =>
                row.machineId === machineId ? 'bg-brand-50/70 dark:bg-brand-950/40' : undefined
              }
              dense
            />
          </section>
          {machineId !== null && (
            <aside
              aria-label={t('atm.layouts.editor.title')}
              className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4 lg:w-[460px] dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t('atm.layouts.editor.title')}
              </h2>
              {detail.data === undefined && detail.error !== null ? (
                <ErrorState
                  error={detail.error}
                  description={settlementErrorText(detail.error, t, locale)}
                  onRetry={() => void detail.refetch()}
                />
              ) : detail.data === undefined ? (
                <LoadingState />
              ) : (
                <LayoutEditor
                  detail={detail.data}
                  locale={locale}
                  canManage={canManage}
                  standardLoads={standardLoads}
                  busy={save.isPending}
                  error={saveError}
                  onSave={onSave}
                />
              )}
            </aside>
          )}
        </div>
      )}

      {ready && branchId !== null && (
        <StandardLoadsDialog
          open={loadsOpen}
          loads={standardLoads}
          bankCode={bankCode}
          branchId={branchId}
          canManage={canManage}
          locale={locale}
          onClose={() => setLoadsOpen(false)}
        />
      )}
    </PageContainer>
  );
};
