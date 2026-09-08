// One (vehicle, year)'s own company violations — what the rollup group is made of.
//
// The board shows a car's year as four totals; this is the ledger behind them, and where a single
// company row is corrected or removed. The grievance figure sits at the foot because it belongs to
// the same (vehicle, year) and is what «قبل التظلم» on the board reports.
//
// A LAYER against the left edge rather than a centred dialog, because this list is worked THROUGH
// and not answered: a clerk correcting the third of nine fines needs the board's totals — the very
// figures these rows add up to — still on screen beside them. A modal covers exactly that.
import {
  MAX_PAGE_SIZE,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { SideLayer } from '../../../shared/ui/SideLayer';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatMoney, formatNumber, localized } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { useFleetCatalog, useSetViolationCollected, useViolations } from '../api/fleet-queries';

export const CompanyViolationsDetailLayer = ({
  row,
  onClose,
  onEdit,
  onDelete,
  onGrievance,
}: {
  row: FleetViolationRollupDto | null;
  onClose: () => void;
  onEdit: (violation: FleetViolationDto) => void;
  onDelete: (violation: FleetViolationDto) => void;
  onGrievance: (row: FleetViolationRollupDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const open = row !== null;

  const list = useViolations(
    open
      ? {
          kind: 'vehicle',
          vehicleId: row.vehicleId,
          year: String(row.year),
          pageSize: MAX_PAGE_SIZE,
          sortBy: 'createdAt',
          sortDir: 'asc',
        }
      : { pageSize: 1 },
  );
  const catalog = useFleetCatalog('violationType', 'company');
  const typeName = new Map(
    (catalog.data?.items ?? []).map((item) => [item.id, localized(item.name, locale)]),
  );
  const collect = useSetViolationCollected();
  const rows = open ? (list.data?.items ?? []) : [];

  const toggle = async (violation: FleetViolationDto): Promise<void> => {
    try {
      await collect.mutateAsync({
        id: violation.id,
        body: { collected: !violation.collected, version: violation.version },
      });
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const columns: Column<FleetViolationDto>[] = [
    {
      key: 'seq',
      header: t('fleet.violations.columns.seq'),
      align: 'center',
      render: (_v, index) => formatNumber(index + 1, locale),
    },
    {
      key: 'type',
      header: t('fleet.violations.fields.type'),
      render: (v) => typeName.get(v.violationTypeId) ?? '—',
    },
    {
      key: 'count',
      header: t('fleet.violations.fields.count'),
      align: 'center',
      render: (v) => formatNumber(v.count ?? 0, locale),
    },
    {
      key: 'amount',
      header: t('fleet.violations.fields.amount'),
      align: 'end',
      render: (v) => <span className="tabular-nums">{formatMoney(v.amount, 'EGP', locale)}</span>,
    },
    {
      key: 'actions',
      header: t('fleet.violations.columns.rowActions'),
      align: 'center',
      render: (v) => (
        <span className="flex items-center justify-center gap-1">
          {can('fleetViolation.collect') && (
            <button
              type="button"
              data-detail-collect={v.id}
              aria-pressed={v.collected}
              aria-label={t(
                v.collected ? 'fleet.violations.uncollect' : 'fleet.violations.collect',
              )}
              title={t(v.collected ? 'fleet.violations.uncollect' : 'fleet.violations.collect')}
              onClick={() => void toggle(v)}
              className={[
                'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
                v.collected
                  ? 'text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetViolation.delete') && (
            <button
              type="button"
              data-detail-delete={v.id}
              aria-label={t('fleet.violations.delete')}
              title={t('fleet.violations.delete')}
              onClick={() => onDelete(v)}
              className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:bg-rose-950"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetViolation.edit') && (
            <button
              type="button"
              data-detail-edit={v.id}
              aria-label={t('fleet.violations.edit')}
              title={t('fleet.violations.edit')}
              onClick={() => onEdit(v)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <SideLayer
      open={open}
      onClose={onClose}
      side="left"
      width="lg"
      title={
        row === null
          ? ''
          : t('fleet.violations.detailTitle', { code: row.code, year: String(row.year) })
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div data-detail-panel="true" className="space-y-3">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          loading={open && list.isLoading}
          error={list.isError ? list.error : undefined}
          onRetry={() => void list.refetch()}
          dense
          rowClassName={(v) => (v.collected ? 'bg-emerald-50 dark:bg-emerald-950/40' : undefined)}
        />
        {row !== null && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
            <span>{t('fleet.violations.lines.beforeGrievance')}</span>
            <span className="flex items-center gap-2">
              <span data-detail-grievance className="font-semibold tabular-nums">
                {formatMoney(row.totalBeforeGrievance, 'EGP', locale)}
              </span>
              {can('fleetViolation.grievance') && (
                <button
                  type="button"
                  data-detail-grievance-edit="true"
                  aria-label={t('fleet.violations.grievance')}
                  title={t('fleet.violations.grievance')}
                  onClick={() => onGrievance(row)}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <EditIcon className="h-4 w-4" />
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </SideLayer>
  );
};
