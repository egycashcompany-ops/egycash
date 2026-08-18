// Secured delivery: assign and dispatch (B4) — the legacy `/tash4ela_mohasana` and
// `/deliver_mohsana` screens, which read the SAME list and differ only in what they do to it.
//
// WHAT THE TWO LEGACY SCREENS WERE (discovery §7.1, §7.3, §7.4):
//   · `/tash4ela_mohasana` (:4380-4499) — assign a captain and vehicle to each due shipment. It
//     wrote exactly `leader2` + `car_num2` and NOTHING else: assignment never changed status.
//   · `/deliver_mohsana` (:1624-1750) — release the load. It set `car_status: 1` on the crew row
//     and `status: 3` on each shipment, with NO transaction and NO check that the shipment was
//     actually in the vault. A partial failure left mixed state (quirk Q18).
//
// Both filters were `$nin:[0,1,3]` — effectively "in the vault" — plus the delivery date
// (:1690/:4450). That `$nin` also matched documents MISSING the field entirely, a real quirk
// (Q9), normalized here to an explicit held-and-due query on the server.
//
// One screen, because they are one workflow over one list: assign each shipment its crew, then
// release what a vehicle is carrying. Dispatch is now ONE transaction (Q18 NORMALIZE) and refuses
// a shipment that never reached the vault.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type OperationsShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import {
  useAssignSecuredDelivery,
  useDispatchSecured,
  useOperationsBanks,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useOperationsCurrencies,
  useSecuredDue,
} from '../api/operations-queries';
import { totalsByCurrency } from '../lib/day-board';
import { ShipmentStatusBadge } from '../components/ShipmentBadges';

/** The due list is keyed on a REQUIRED delivery date — unlike the backlog, this is a day's work. */
export const resolveDueDate = (raw: string | null): string =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);

export const SecuredDispatchPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((s) => s.locale.locale);
  const [sp, setSp] = useSearchParams();
  const date = resolveDueDate(sp.get('date'));

  const due = useSecuredDue(date);
  const board = useOperationsCrewBoard(date);
  const directory = useOperationsCrewDirectory(date);
  const banks = useOperationsBanks({ page: 1, pageSize: 200 });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: 100 });
  const assign = useAssignSecuredDelivery();
  const dispatch = useDispatchSecured();

  const canAssign = can('operationsShipment.edit');
  const canDispatch = can('operationsVault.dispatch');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [crewAssignmentId, setCrewAssignmentId] = useState('');

  // Only vehicles that HAVE a captain can carry a secured load — the delivery leg needs a captain.
  const crews = useMemo(
    () => (board.data?.rows ?? []).filter((row) => row.crew?.captainEmployeeId != null),
    [board.data],
  );
  const captainOf = (employeeId: string | null | undefined): string =>
    directory.data?.members.find((m) => m.employeeId === employeeId)?.fullNameAr ?? '—';

  const shipments = due.data ?? [];

  const assignOne = async (shipment: OperationsShipmentDto): Promise<void> => {
    const crew = crews.find((c) => c.vehicleId === crewAssignmentId);
    if (crew === undefined || crew.crew === null) {
      toast.error(t('operations.secured.dispatch.pickCrew'));
      return;
    }
    try {
      await assign.mutateAsync({
        id: shipment.id,
        body: {
          // The crew ROW is the legacy tashghela row; the captain comes from it, never typed.
          crewAssignmentId: crew.fleetDutyAssignmentId,
          captainEmployeeId: crew.crew.captainEmployeeId ?? '',
          version: shipment.version,
        },
      });
      toast.success(t('operations.secured.dispatch.assigned'));
    } catch {
      toast.error(t('operations.secured.dispatch.assignFailed'));
    }
  };

  const release = async (): Promise<void> => {
    if (selected.size === 0 || crewAssignmentId === '') return;
    const crew = crews.find((c) => c.vehicleId === crewAssignmentId);
    if (crew === undefined) return;
    if (!window.confirm(t('operations.secured.dispatch.confirm', { count: selected.size }))) return;
    try {
      await dispatch.mutateAsync({
        crewAssignmentId: crew.fleetDutyAssignmentId,
        shipmentIds: [...selected],
      });
      toast.success(t('operations.secured.dispatch.done', { count: selected.size }));
      setSelected(new Set());
    } catch {
      // The domain refuses a shipment that never reached the vault — the check legacy lacked.
      toast.error(t('operations.secured.dispatch.failed'));
    }
  };

  const columns: Column<OperationsShipmentDto>[] = [
    {
      key: 'select',
      header: '',
      render: (row) => (
        <input
          type="checkbox"
          className="h-4 w-4"
          aria-label={`${t('operations.secured.dispatch.select')} ${row.id}`}
          checked={selected.has(row.id)}
          disabled={!canDispatch}
          onChange={(e) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (e.target.checked) next.add(row.id);
              else next.delete(row.id);
              return next;
            })
          }
        />
      ),
    },
    {
      key: 'bank',
      header: t('operations.shipment.mainBank'),
      render: (row) => banks.data?.items.find((b) => b.id === row.mainBankId)?.opsName ?? '—',
    },
    {
      key: 'amount',
      header: t('operations.shipment.amount'),
      render: (row) => (
        <div className="space-y-0.5">
          {totalsByCurrency(row).map((total) => (
            <div key={total.currencyId} className="whitespace-nowrap tabular-nums">
              {formatNumber(total.amount, locale)}{' '}
              {currencies.data?.items.find((c) => c.id === total.currencyId)?.name ?? ''}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ShipmentStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        canAssign ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={crewAssignmentId === '' || assign.isPending}
            onClick={() => void assignOne(row)}
          >
            {t('operations.secured.dispatch.assign')}
          </Button>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.secured.dispatch.title')}
        description={t('operations.secured.dispatch.subtitle')}
        actions={
          canDispatch ? (
            <Button
              disabled={selected.size === 0 || crewAssignmentId === '' || dispatch.isPending}
              onClick={() => void release()}
            >
              {t('operations.secured.dispatch.release', { count: selected.size })}
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">
              {t('operations.shipment.deliveryDate')}
            </span>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                next.set('date', e.target.value);
                setSp(next);
              }}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">
              {t('operations.secured.dispatch.vehicle')}
            </span>
            <Select
              value={crewAssignmentId}
              onChange={(e) => setCrewAssignmentId(e.target.value)}
            >
              <option value="">{t('common.select')}</option>
              {crews.map((crew) => (
                <option key={crew.vehicleId} value={crew.vehicleId}>
                  {crew.vehicleCode} — {captainOf(crew.crew?.captainEmployeeId)}
                </option>
              ))}
            </Select>
          </label>
          {crews.length === 0 && !board.isLoading && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('operations.secured.dispatch.noCrew')}
            </p>
          )}
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={shipments}
        rowKey={(row) => row.id}
        loading={due.isLoading}
        error={due.error}
        onRetry={() => void due.refetch()}
        empty={t('operations.secured.dispatch.empty')}
      />
    </PageContainer>
  );
};
