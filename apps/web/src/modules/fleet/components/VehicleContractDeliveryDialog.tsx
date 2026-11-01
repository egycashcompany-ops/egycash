// «تسجيل استلام» (and «تعديل الاستلام») — the owner's approved forms sample (`zz-contracts-forms-record`):
// the delivery's ordinal, locked; its date (today by default); the earlier deliveries as chips; and
// per line what was contracted, what came so far, what is left, and the box for what came now —
// never more than what is left. A box over it turns its row rose, says «أكثر من المتبقي (N)» and the
// note under the table names the make; Save waits until nothing is over and something was typed.
// The server checks the same rule against the contract's version, so a dialog left open while
// somebody else recorded a delivery is refused, the contract read again, and the reason said.
import { useState } from 'react';
import {
  type FleetVehicleContractDeliveryDto,
  type FleetVehicleContractDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useSaveVehicleContractDelivery } from '../api/vehicle-contract-queries';
import {
  deliveryCounts,
  deliveryFigures,
  deliveryOrdinal,
  deliveryTyped,
} from '../lib/vehicle-contract-figures';
import {
  REFUSAL_KEY,
  latin,
  useVehicleContractWords,
  vehicleContractRefusalOf,
} from '../lib/vehicle-contract-words';
import { DesignCancel, DesignDialog, DesignSave } from './DesignDialog';
import { DesignField, LOOK, MONO, Stroke, boxTone } from './FuelCardDialog';
import { NUM, PATH, ymd } from './FuelCardBoard';
import { DESIGN_TILE, today } from './LicenseExpensePaidGroup';
import {
  CountChip,
  FACT_CHIP,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  SectionHead,
} from './custody-memo-parts';
import { useMakeName } from './vehicle-contract-parts';

const BOX = boxTone(LOOK.add);
const DATE_BOX = cn(BOX, MONO);

/** Received of contracted, as a bar: what came before (emerald), what comes now (indigo). */
const Progress = ({
  before,
  now = 0,
  of,
  thin = false,
}: {
  before: number;
  now?: number;
  of: number;
  thin?: boolean;
}): JSX.Element => (
  <div
    className={cn(
      'flex overflow-hidden rounded-full bg-slate-200 dark:bg-[#162135]',
      thin ? 'h-1.5' : 'h-3',
    )}
  >
    <div
      className="h-full bg-emerald-500"
      style={{ width: `${of === 0 ? 0 : Math.min(100, (before / of) * 100)}%` }}
    />
    {now > 0 && (
      <div
        className="h-full bg-indigo-500 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.22)_0_6px,transparent_6px_12px)]"
        style={{ width: `${of === 0 ? 0 : Math.min(100, (now / of) * 100)}%` }}
      />
    )}
  </div>
);

export const VehicleContractDeliveryDialog = ({
  open,
  onClose,
  contract,
  editing,
  onRefused,
}: {
  open: boolean;
  onClose: () => void;
  contract: FleetVehicleContractDto;
  /** The delivery being edited; `null` records a new one. */
  editing: FleetVehicleContractDeliveryDto | null;
  /** The contract was changed meanwhile — read it again. */
  onRefused: () => void;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const makeName = useMakeName();
  const save = useSaveVehicleContractDelivery();
  const editingId = editing?.id ?? null;
  const [date, setDate] = useState(() => editing?.date ?? today());
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    deliveryTyped(contract, editingId),
  );
  const figures = deliveryFigures(contract, typed, editingId);
  const no = deliveryOrdinal(contract, date, editingId);
  const earlier = contract.deliveries.filter((delivery) => delivery.id !== editingId);
  const { contracted, receivedBefore, leftBefore, comingNow, after, over } = figures;

  const onSave = async (): Promise<void> => {
    try {
      await save.mutateAsync({
        id: contract.id,
        deliveryId: editingId,
        body: {
          date: new Date(date),
          counts: deliveryCounts(figures.rows),
          version: contract.version,
        },
      });
      toast.success(t('fleet.vehicleContracts.delivery.savedToast'));
      onClose();
    } catch (failure) {
      // Worded here (the hook leaves these to the screen); the contract is read again so the table
      // shows what is owed now, and the dialog stays open on it.
      const refusal = vehicleContractRefusalOf(failure);
      if (refusal !== null) {
        toast.error(t(REFUSAL_KEY[refusal]));
        onRefused();
      }
    }
  };

  const supplier = contract.supplier.trim();
  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      width="3xl"
      icon={PATH.truck}
      title={t(
        editing === null
          ? 'fleet.vehicleContracts.delivery.title'
          : 'fleet.vehicleContracts.delivery.editTitle',
      )}
      subtitle={[words.contractName(contract).text, ...(supplier === '' ? [] : [supplier])].join(
        ' — ',
      )}
      panelProps={{ 'data-contract-delivery': String(no) }}
      footer={
        <>
          <DesignSave
            label={t('fleet.vehicleContracts.delivery.save')}
            onClick={() => void onSave()}
            busy={save.isPending}
            disabled={comingNow === 0 || over.length > 0}
            data-contract-delivery-save="true"
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <section className="space-y-4">
        <SectionHead
          title={t('fleet.vehicleContracts.delivery.section')}
          icon={PATH.calendar}
          end={<CountChip>{words.deliveryName(no)}</CountChip>}
        />
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 sm:gap-5">
          <DesignField label={t('fleet.vehicleContracts.delivery.no')} endAdornment={null}>
            <div
              className={cn(
                BOX,
                'flex items-center gap-2 !bg-slate-100 py-3 !text-slate-700 dark:!bg-[#0f1838] dark:!text-slate-200',
              )}
              data-contract-delivery-no={no}
            >
              <Stroke d={[...PATH.lock]} className="h-4 w-4 text-slate-400" />
              <span className="font-bold">{words.deliveryName(no)}</span>
            </div>
          </DesignField>
          <DesignField label={t('fleet.vehicleContracts.delivery.date')} datePicker>
            {/* The day is the delivery's one required value and it opens filled (today): the box
                keeps a day — clearing it leaves the last one — so Save never waits on it. */}
            <Input
              type="date"
              dir="ltr"
              aria-label={t('fleet.vehicleContracts.delivery.date')}
              value={date}
              onChange={(event) => setDate((held) => event.target.value || held)}
              tone={DATE_BOX}
            />
          </DesignField>
        </div>
        {earlier.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-slate-500 dark:text-slate-400">
              {t('fleet.vehicleContracts.delivery.before')}
            </span>
            {earlier.map((delivery) => (
              <span key={delivery.id} className={FACT_CHIP}>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {words.deliveryName(delivery.no)}
                <span dir="ltr" className={NUM}>
                  {ymd(delivery.date)}
                </span>
                <span className="text-slate-400">·</span>
                {words.count('car', delivery.total)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHead title={t('fleet.vehicleContracts.delivery.counts')} icon={PATH.truck} />
        <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
          {t('fleet.vehicleContracts.delivery.nowHint')}
        </p>
        <div className={FORM_TABLE_WRAP}>
          <table className={FORM_TABLE} data-contract-delivery-table="true">
            <thead className={FORM_THEAD}>
              <tr>
                <th className="!text-start">{t('fleet.vehicleContracts.lines.make')}</th>
                <th>{t('fleet.vehicleContracts.delivery.contracted')}</th>
                <th>{t('fleet.vehicleContracts.delivery.soFar')}</th>
                <th>{t('fleet.vehicleContracts.delivery.left')}</th>
                <th className="w-[9.5rem]">{t('fleet.vehicleContracts.delivery.now')}</th>
              </tr>
            </thead>
            <tbody className={FORM_TBODY}>
              {figures.rows.map(({ line, received, left, over: tooMany }) => (
                <tr
                  key={line.id}
                  data-contract-delivery-line={line.id}
                  {...(tooMany ? { 'data-contract-delivery-over-line': 'true' } : {})}
                  className={cn(tooMany && 'bg-rose-50/70 dark:bg-rose-500/[0.06]')}
                >
                  <td className="!py-3">
                    <div className="space-y-1.5">
                      <span className="block whitespace-nowrap text-start text-[15px] font-bold text-slate-900 dark:text-white">
                        {makeName(line)}
                      </span>
                      <div className="w-40">
                        <Progress before={received} of={line.count} thin />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={cn(NUM, 'text-base')}>{latin(line.count)}</span>
                  </td>
                  <td>
                    <span className={cn(NUM, 'text-base text-emerald-700 dark:text-emerald-400')}>
                      {latin(received)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={cn(
                        NUM,
                        'inline-flex min-w-[2.5rem] justify-center rounded-full border px-2.5 py-0.5 text-base',
                        'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
                      )}
                    >
                      {latin(left)}
                    </span>
                  </td>
                  <td>
                    <div className="mx-auto w-28 space-y-1">
                      <Input
                        aria-label={`${t('fleet.vehicleContracts.delivery.now')} — ${makeName(line)}`}
                        aria-invalid={tooMany || undefined}
                        value={typed[line.id] ?? ''}
                        onChange={(event) =>
                          setTyped((held) => ({ ...held, [line.id]: event.target.value }))
                        }
                        rule="integer"
                        maxLength={5}
                        placeholder="0"
                        tone={cn(
                          BOX,
                          MONO,
                          '!py-2.5 text-center !text-lg font-bold aria-[invalid=true]:!text-rose-600 dark:aria-[invalid=true]:!text-rose-300',
                        )}
                        data-contract-delivery-now={line.id}
                      />
                      {tooMany && (
                        <p
                          role="alert"
                          className="whitespace-nowrap text-[12px] font-bold text-rose-600 dark:text-[#ff6b81]"
                        >
                          {t('fleet.vehicleContracts.delivery.over', { left: latin(left) })}
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-100 text-sm font-black text-slate-800 dark:border-[#2b3b6b] dark:bg-[#0f1838] dark:text-slate-100 [&_td]:px-2.5 [&_td]:py-2.5">
              <tr>
                <td className="text-start">{t('fleet.vehicleContracts.delivery.total')}</td>
                <td className={NUM}>{latin(contracted)}</td>
                <td className={cn(NUM, 'text-emerald-700 dark:text-emerald-400')}>
                  {latin(receivedBefore)}
                </td>
                <td className={cn(NUM, 'text-amber-700 dark:text-amber-300')}>
                  {latin(leftBefore)}
                </td>
                <td
                  className={cn(
                    NUM,
                    over.length > 0
                      ? 'text-rose-600 dark:text-[#ff6b81]'
                      : 'text-indigo-700 dark:text-indigo-300',
                  )}
                >
                  {latin(comingNow)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {over.length > 0 ? (
          <p
            role="alert"
            data-contract-delivery-over="true"
            className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
          >
            <Stroke d={[...PATH.warn]} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {over
                .map((row) =>
                  t('fleet.vehicleContracts.delivery.overNote', {
                    make: makeName(row.line),
                    left: words.count('car', row.left),
                  }),
                )
                .join(' ')}
            </span>
          </p>
        ) : (
          <div className={cn(DESIGN_TILE, 'space-y-2.5 p-4')} data-contract-delivery-after={after}>
            <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-slate-800 dark:text-slate-100">
              <span>
                {t('fleet.vehicleContracts.delivery.after', {
                  after: `⁨${latin(after)}⁩`,
                  total: words.count('car', contracted),
                })}
              </span>
              <span className="text-slate-400">—</span>
              <span className="text-amber-700 dark:text-amber-300">
                {t('fleet.vehicleContracts.delivery.afterLeft', {
                  left: words.count('car', contracted - after),
                })}
              </span>
            </p>
            <Progress before={receivedBefore} now={comingNow} of={contracted} />
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                {t('fleet.vehicleContracts.delivery.soFar')}{' '}
                <b className={NUM}>{latin(receivedBefore)}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />
                {words.deliveryName(no)} <b className={NUM}>{latin(comingNow)}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-[#22304a]" />
                {t('fleet.vehicleContracts.delivery.left')}{' '}
                <b className={NUM}>{latin(contracted - after)}</b>
              </span>
            </p>
          </div>
        )}
      </section>
    </DesignDialog>
  );
};
