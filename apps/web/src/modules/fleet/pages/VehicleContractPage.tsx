// «عقود توريد السيارات» — one contract's page, as the owner's approved sample draws it
// (`zz-contracts-list-details`): the record pages' design (`DesignPageHeader`, the forms' navy
// panel, `SectionHead`, the forms' tables). «إنذار التوريد» at the top while cars are still owed and
// the last supply date is 30 days away or less; «بيانات العقد» — its facts, its figures and the bar
// of its deliveries; «مرفقات العقد»; «بنود العقد» with the totals worked out from «العدد × سعر
// الوحدة» and the VAT note; and «الاستلامات», each delivery with what had arrived after it.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { type FleetVehicleContractDeliveryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useDeleteVehicleContractDelivery,
  useVehicleContract,
} from '../api/vehicle-contract-queries';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { SANS } from '../components/FuelCardDialog';
import { DESIGN_BACK, DesignPageHeader } from '../components/LicenseExpensePaidGroup';
import { CountChip, Money, SectionHead } from '../components/custody-memo-parts';
import { SquarePenIcon } from '../components/row-action-icons';
import {
  CLOCK_ICON,
  CONTRACT_ICON,
  DASH,
  DEADLINE_ICON,
  FIGURE,
  INFO_ICON,
  LINES_ICON,
  NAME_ICON,
  RECEIVE_ICON,
  SUPPLIER_ICON,
  SupplyAlarmStrip,
} from '../components/vehicle-contract-parts';
import {
  ContractDeliveriesTable,
  ContractLinesTable,
  DeliveryBar,
  Fact,
  Figure,
  VatNote,
} from '../components/vehicle-contract-record-parts';
import { ContractFilesSection } from '../components/VehicleContractFilesSection';
import { VehicleContractDeliveryDialog } from '../components/VehicleContractDeliveryDialog';
import { pct } from '../lib/vehicle-contract-figures';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';

/** The forms' panel (`DESIGN_COLUMN`'s colours), as a card of the record page. */
const PANEL = cn(
  SANS,
  'space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 antialiased dark:border-[#2b3b6b] dark:bg-[#121c3f]/95 dark:text-slate-100',
);
/** «تعديل العقد» — `DESIGN_BACK`'s box, the pen in the edit blue. */
const EDIT_BUTTON =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-[15px] font-bold text-slate-900 transition-all hover:bg-slate-100 active:scale-[0.98] dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80';
/** «تسجيل استلام» — the licence editor's print button, the brand gradient. */
const RECEIVE_BUTTON =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-2.5 text-[15px] font-bold text-white shadow-md shadow-brand-700/30 transition-all hover:from-brand-600 hover:to-brand-400 active:scale-[0.98]';

/** The delivery dialog: closed, a new delivery, or one being edited. */
type Delivering = { editing: FleetVehicleContractDeliveryDto | null } | null;

export const VehicleContractPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const words = useVehicleContractWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const contract = useVehicleContract(id);
  const removeDelivery = useDeleteVehicleContractDelivery();
  const [delivering, setDelivering] = useState<Delivering>(null);
  const [deleting, setDeleting] = useState<FleetVehicleContractDeliveryDto | null>(null);
  const c = contract.data;

  // «المرفقات» in the list leads here with `#files`: the section is brought into view once drawn.
  const loaded = c !== undefined;
  useEffect(() => {
    if (loaded && hash === '#files') document.getElementById('files')?.scrollIntoView();
  }, [loaded, hash]);

  if (c === undefined) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-slate-600 dark:text-slate-300">
        {contract.isError ? (
          <>
            <p>{t('fleet.vehicleContracts.loadFailed')}</p>
            <p className="text-xs">{errorMessage(contract.error, locale)}</p>
            <Button variant="secondary" onClick={() => void contract.refetch()}>
              {t('common.retry')}
            </Button>
            <Link to="/fleet/vehicle-contracts" className={DESIGN_BACK}>
              {t('fleet.vehicleContracts.back')}
            </Link>
          </>
        ) : (
          <Spinner className="h-6 w-6" />
        )}
      </div>
    );
  }

  const name = words.contractName(c);
  const mayReceive = can('fleetVehicleContract.receive');
  const reread = (): void => void contract.refetch();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await removeDelivery.mutateAsync({ id: c.id, deliveryId: deleting.id });
      toast.success(t('fleet.vehicleContracts.delivery.deletedToast'));
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const subtitle = [
    t('fleet.vehicleContracts.subtitle', { no: latin(c.no), date: ymd(c.date) }),
    ...(c.deadline === null
      ? []
      : [t('fleet.vehicleContracts.subtitleDeadline', { deadline: ymd(c.deadline) })]),
  ].join(' ');
  const receiveButton = (small: boolean): JSX.Element | null =>
    mayReceive && c.remaining > 0 ? (
      <button
        type="button"
        className={cn(RECEIVE_BUTTON, small && 'px-3.5 py-1.5 text-xs')}
        data-contract-receive-open={small ? 'section' : 'header'}
        onClick={() => setDelivering({ editing: null })}
      >
        <BoardIcon
          d={small ? PATH.plus : RECEIVE_ICON}
          className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'}
          {...(small ? { width: 2.5 } : {})}
        />
        {t('fleet.vehicleContracts.actions.receive')}
      </button>
    ) : null;

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0" data-contract-details={c.id}>
      <DesignPageHeader icon={CONTRACT_ICON} title={name.text} subtitle={subtitle}>
        <Link to="/fleet/vehicle-contracts" className={DESIGN_BACK}>
          {t('fleet.vehicleContracts.back')}
        </Link>
        {can('fleetVehicleContract.edit') && (
          <Link
            to={`/fleet/vehicle-contracts/${encodeURIComponent(c.id)}/edit`}
            className={EDIT_BUTTON}
            data-contract-edit-open="true"
          >
            <SquarePenIcon className="h-4 w-4 text-blue-600 dark:text-[#58a8e8]" />
            {t('fleet.vehicleContracts.actions.edit')}
          </Link>
        )}
        {receiveButton(false)}
      </DesignPageHeader>

      <div
        className="space-y-4 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        data-contract-scroll="true"
      >
        {c.alarm !== null && <SupplyAlarmStrip contract={c} alarm={c.alarm} />}

        <section className={PANEL} data-contract-section="data">
          <SectionHead title={t('fleet.vehicleContracts.section.data')} icon={CONTRACT_ICON} />
          <div className="grid gap-3 lg:grid-cols-12">
            <Fact
              icon={NAME_ICON}
              tone="bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
              label={t('fleet.vehicleContracts.fact.name')}
              className="lg:col-span-3"
            >
              <span
                className={cn(name.unnamed && 'font-normal text-slate-400 dark:text-slate-500')}
                title={name.unnamed ? t('fleet.vehicleContracts.unnamedTitle') : undefined}
              >
                {name.text}
              </span>
            </Fact>
            {/* «تاريخ العقد» and «آخر موعد للتوريد» side by side — the owner's word. */}
            <Fact
              icon={PATH.calendar}
              tone="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
              label={t('fleet.vehicleContracts.fact.date')}
              className="lg:col-span-2"
            >
              <span dir="ltr" className={FIGURE}>
                {ymd(c.date)}
              </span>
            </Fact>
            <Fact
              icon={DEADLINE_ICON}
              tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
              label={t('fleet.vehicleContracts.fact.deadline')}
              className="lg:col-span-2"
            >
              <span data-contract-deadline={c.id}>
                {c.deadline === null ? (
                  DASH
                ) : (
                  <span dir="ltr" className={FIGURE}>
                    {ymd(c.deadline)}
                  </span>
                )}
              </span>
            </Fact>
            <Fact
              icon={SUPPLIER_ICON}
              tone="bg-violet-500/10 text-violet-600 dark:text-violet-300"
              label={t('fleet.vehicleContracts.fact.supplier')}
              className="lg:col-span-5"
            >
              {c.supplier.trim() === '' ? DASH : c.supplier}
            </Fact>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Figure
              className="sm:col-span-2"
              icon={PATH.box}
              tone="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
              label={t('fleet.vehicleContracts.figure.total')}
              value={<Money value={c.total} className="text-2xl" />}
              note={<VatNote />}
            />
            <Figure
              icon={PATH.truck}
              tone="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.vehicleContracts.figure.contracted')}
              value={latin(c.contracted)}
              unit={words.unit('car', c.contracted)}
            />
            <Figure
              icon={RECEIVE_ICON}
              tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              label={t('fleet.vehicleContracts.figure.received')}
              value={latin(c.received)}
              unit={words.unit('car', c.received)}
              note={
                <>
                  <span dir="ltr" className={NUM}>
                    {pct(c.received, c.contracted)}%
                  </span>{' '}
                  {t('fleet.vehicleContracts.stats.ofContracted')}
                </>
              }
            />
            <Figure
              icon={CLOCK_ICON}
              tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              label={t('fleet.vehicleContracts.figure.remaining')}
              value={latin(c.remaining)}
              unit={words.unit('car', c.remaining)}
              note={t('fleet.vehicleContracts.stats.notYet')}
            />
          </div>
          <DeliveryBar contract={c} />
        </section>

        <ContractFilesSection
          contract={c}
          mayAdd={can('fleetVehicleContract.create') || can('fleetVehicleContract.edit')}
          mayChange={can('fleetVehicleContract.edit')}
          onRefused={reread}
          panel={PANEL}
        />

        <section className={PANEL} data-contract-section="lines">
          <SectionHead
            title={t('fleet.vehicleContracts.section.lines')}
            icon={LINES_ICON}
            end={<CountChip>{words.count('line', c.lines.length)}</CountChip>}
          />
          <ContractLinesTable contract={c} />
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
            <BoardIcon d={INFO_ICON} className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <VatNote />
          </p>
        </section>

        <section className={PANEL} data-contract-section="deliveries">
          <SectionHead
            title={t('fleet.vehicleContracts.section.deliveries')}
            icon={RECEIVE_ICON}
            end={
              <span className="flex items-center gap-2">
                <CountChip>{words.count('delivery', c.deliveries.length)}</CountChip>
                {receiveButton(true)}
              </span>
            }
          />
          {c.deliveries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-[#2b3b6b] dark:text-slate-400">
              {t('fleet.vehicleContracts.deliveries.empty')}
            </p>
          ) : (
            <ContractDeliveriesTable
              contract={c}
              onEdit={mayReceive ? (delivery) => setDelivering({ editing: delivery }) : null}
              onDelete={mayReceive ? setDeleting : null}
            />
          )}
        </section>
      </div>

      {delivering !== null && (
        <VehicleContractDeliveryDialog
          key={delivering.editing?.id ?? 'new'}
          open
          onClose={() => setDelivering(null)}
          contract={c}
          editing={delivering.editing}
          onRefused={reread}
        />
      )}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.vehicleContracts.deliveries.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeDelivery.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {deleting === null
            ? ''
            : t('fleet.vehicleContracts.delivery.deleteBody', {
                name: words.deliveryName(deleting.no),
              })}
        </p>
      </Dialog>
    </div>
  );
};
