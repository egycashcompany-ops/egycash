// «زرار فى كل صف ... يجيب سجل العربيه خدت من مين او ادت ل مين» — one car's transfers, both ways.
//
// Each line can be removed, which puts the amount back where it came from. The transfer is not
// deleted: the server keeps it on the file, voided, and no figure or log counts it again.
import { useState } from 'react';
import { type FleetAccidentTransferEntryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import { TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import { useAccidentCarTransfers, useVoidAccidentTransfer } from '../api/fleet-queries';

export const AccidentTransferLogDialog = ({
  vehicleId,
  code,
  mayRemove,
  onClose,
}: {
  /** The car the log is about; `null` = closed. */
  vehicleId: string | null;
  code: string;
  /** `fleetAccident.edit` — removing a transfer changes the file that holds it. */
  mayRemove: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const log = useAccidentCarTransfers(vehicleId ?? '', vehicleId !== null);
  const remove = useVoidAccidentTransfer();
  const [removing, setRemoving] = useState<FleetAccidentTransferEntryDto | null>(null);
  const entries = log.data?.entries ?? [];
  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  const total = (direction: 'in' | 'out'): number =>
    entries
      .filter((entry) => entry.direction === direction)
      .reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  const label = (entry: FleetAccidentTransferEntryDto): string =>
    t(entry.direction === 'in' ? 'fleet.accidents.log.paidFrom' : 'fleet.accidents.log.paidTo');

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    await remove.mutateAsync({ accidentId: removing.accidentId, transferId: removing.transferId });
    toast.success(t('fleet.accidents.log.removed'));
    setRemoving(null);
  };

  return (
    <>
      <Dialog
        open={vehicleId !== null && removing === null}
        onClose={onClose}
        size="lg"
        title={t('fleet.accidents.log.title', { code })}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        {log.data !== undefined && (
          <p
            data-transfer-log-remaining="true"
            className="mb-3 text-sm text-slate-600 dark:text-slate-300"
          >
            {t('fleet.accidents.log.remaining', { amount: money(log.data.remaining) })}
          </p>
        )}
        {log.isError ? (
          // A failed read is not an empty log — «no transfers» would be a claim about the car.
          <p role="alert" className="py-6 text-center text-sm text-red-700 dark:text-red-300">
            {t('fleet.accidents.log.loadFailed')}
          </p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {log.isPending ? t('common.loading') : t('fleet.accidents.log.empty')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table data-transfer-log="true" className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">
                      {t('fleet.accidents.log.date')}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t('fleet.accidents.log.direction')}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t('fleet.accidents.log.otherCar')}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t('fleet.accidents.log.amount')}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t('fleet.accidents.log.by')}
                    </th>
                    {mayRemove && (
                      <th className="px-3 py-2">
                        <span className="sr-only">{t('fleet.vehicles.columns.actions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={`${entry.transferId}:${entry.direction}`}
                      data-transfer-entry={entry.transferId}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-3 py-2 tabular-nums">{formatDate(entry.at, locale)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={entry.direction === 'in' ? 'success' : 'warning'}>
                          {label(entry)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                        {entry.otherVehicleCode ?? '—'}
                      </td>
                      <td
                        className={[
                          'px-3 py-2 text-end font-medium tabular-nums',
                          entry.direction === 'in'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-amber-700 dark:text-amber-300',
                        ].join(' ')}
                      >
                        {money(entry.amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {entry.byName ?? '—'}
                      </td>
                      {mayRemove && (
                        <td className="px-3 py-2 text-end">
                          <button
                            type="button"
                            data-transfer-remove={entry.transferId}
                            aria-label={t('fleet.accidents.log.remove')}
                            title={t('fleet.accidents.log.remove')}
                            onClick={() => setRemoving(entry)}
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-300"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-4 text-sm">
              <span>
                {t('fleet.accidents.log.totalPaidFrom')}:{' '}
                <b className="tabular-nums text-emerald-700 dark:text-emerald-300">
                  {money(total('in'))}
                </b>
              </span>
              <span>
                {t('fleet.accidents.log.totalPaidTo')}:{' '}
                <b className="tabular-nums text-amber-700 dark:text-amber-300">
                  {money(total('out'))}
                </b>
              </span>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('fleet.accidents.log.removeTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmRemove()}
            >
              {t('fleet.accidents.log.remove')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {removing === null
            ? ''
            : t('fleet.accidents.log.removeBody', {
                amount: money(removing.amount),
                // Where the money CAME FROM: the other car on a «تم الدفع من» line, this car on a
                // «تم الدفع لـ» one.
                code: (removing.direction === 'in' ? removing.otherVehicleCode : code) ?? '—',
              })}
        </p>
      </Dialog>
    </>
  );
};
