// «عقود توريد السيارات» — the contract page's own pieces, ported from the owner's approved sample
// (`zz-contracts-list-details`): the facts and the figures, the delivery bar, the
// lines table with its totals and the VAT note, and «الاستلامات» — each delivery with its date, its
// cars per line, what had arrived after it and what was still owed.
import { type ReactNode } from 'react';
import {
  type FleetVehicleContractDeliveryDto,
  type FleetVehicleContractDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { pct } from '../lib/vehicle-contract-figures';
import { BoardIcon, NUM, PATH, ymd } from './FuelCardBoard';
import { DESIGN_TILE } from './LicenseExpensePaidGroup';
import { FORM_TABLE, FORM_TABLE_WRAP, FORM_TBODY, FORM_THEAD, Money } from './custody-memo-parts';
import { ACTION_GROUP, actionTone } from './row-actions-look';
import { SquarePenIcon, Trash2Icon } from './row-action-icons';
import { DASH, FIGURE, useMakeName } from './vehicle-contract-parts';

/** One fact of the contract: its drawing, its name, its value. */
export const Fact = ({
  icon,
  tone,
  label,
  children,
  className,
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <div className={cn(DESIGN_TILE, 'flex min-w-0 items-center gap-3 px-4 py-3', className)}>
    <span className={cn('shrink-0 rounded-lg p-2', tone)}>
      <BoardIcon d={icon} className="h-4 w-4" />
    </span>
    <span className="min-w-0 leading-tight">
      <span className="block text-[12px] font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="mt-0.5 block text-[15px] font-bold text-slate-900 dark:text-white">
        {children}
      </span>
    </span>
  </div>
);

/** A figure of the contract — `FigureChip`'s face, on the forms' tile. */
export const Figure = ({
  icon,
  tone,
  label,
  value,
  unit,
  note,
  className,
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  className?: string;
}): JSX.Element => (
  <div className={cn(DESIGN_TILE, 'flex min-w-0 items-center gap-3 px-4 py-3', className)}>
    <span className={cn('shrink-0 rounded-lg p-2.5', tone)}>
      <BoardIcon d={icon} className="h-5 w-5" />
    </span>
    <span className="min-w-0 leading-tight">
      <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span className={cn('text-2xl font-black text-slate-900 dark:text-white', NUM)}>
          {value}
        </span>
        {unit !== undefined && (
          <span className="text-xs text-slate-500 dark:text-slate-400">{unit}</span>
        )}
      </span>
      {note !== undefined && (
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{note}</span>
      )}
    </span>
  </div>
);

/** Each delivery's colour on the bar and in its table row — calm, none of them a warning. */
const DELIVERY_TONE = [
  'bg-emerald-500',
  'bg-teal-400',
  'bg-cyan-400',
  'bg-sky-400',
  'bg-indigo-400',
];
export const deliveryTone = (index: number): string =>
  DELIVERY_TONE[index % DELIVERY_TONE.length] ?? 'bg-emerald-500';

/** «تم استلام 32 من 33 سيارة» — each delivery a segment of its own colour, what is left the track. */
export const DeliveryBar = ({
  contract,
}: {
  contract: Pick<FleetVehicleContractDto, 'contracted' | 'received' | 'remaining' | 'deliveries'>;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const { contracted: all, received: got } = contract;
  return (
    <div className={cn(DESIGN_TILE, 'space-y-2.5 px-4 py-3')} data-contract-progress="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.vehicleContracts.progress', { received: latin(got), contracted: latin(all) })}
          <span
            dir="ltr"
            className={cn(
              NUM,
              'ms-2 rounded bg-emerald-500/15 px-1.5 text-[12px] text-emerald-700 dark:text-emerald-300',
            )}
          >
            {pct(got, all)}%
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
          {contract.deliveries.map((delivery, index) => (
            <span key={delivery.id} className="inline-flex items-center gap-1.5">
              <i className={cn('h-2.5 w-2.5 rounded-sm', deliveryTone(index))} />
              {words.deliveryName(delivery.no)}
              <span dir="ltr" className={cn(NUM, 'text-slate-900 dark:text-white')}>
                {latin(delivery.total)}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-[#1c2740]" />
            {t('fleet.vehicleContracts.figure.remaining')}
            <span dir="ltr" className={cn(NUM, 'text-slate-900 dark:text-white')}>
              {latin(contract.remaining)}
            </span>
          </span>
        </span>
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-200 dark:bg-[#1c2740]">
        {contract.deliveries.map((delivery, index) => (
          <span
            key={delivery.id}
            className={cn('h-full first:rounded-s-full', deliveryTone(index))}
            style={{ width: `${all === 0 ? 0 : (delivery.total / all) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
};

/** «8 من 33» — a count of a whole, the whole muted. */
export const Of = ({ n, of, ink }: { n: number; of: number; ink?: string }): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span
        dir="ltr"
        className={cn(FIGURE, 'text-[15px]', ink ?? 'text-slate-900 dark:text-white')}
      >
        {latin(n)}
      </span>
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {t('fleet.vehicleContracts.of')}
      </span>
      <span dir="ltr" className={cn(FIGURE, 'text-slate-500 dark:text-slate-400')}>
        {latin(of)}
      </span>
    </span>
  );
};

/** The VAT rate on his contract — fixed text, as the samples show it on every contract. */
const VAT_RATE = '14%';

/** «غير شامل ضريبة القيمة المضافة 14%» — the rate left to right, as the boards write a share. */
export const VatNote = (): JSX.Element => {
  const t = useT();
  const [before = '', after = ''] = t('fleet.vehicleContracts.vatNote', { rate: '' }).split('');
  return (
    <>
      {before}
      <span dir="ltr" className={NUM}>
        {VAT_RATE}
      </span>
      {after}
    </>
  );
};

/** The figures in a table's foot and cells — the boards' monospace, a size up. */
const BIG = cn(FIGURE, 'text-[16px]');
const INK = {
  plain: 'text-slate-900 dark:text-white',
  got: 'text-emerald-700 dark:text-emerald-400',
  left: 'text-amber-700 dark:text-amber-400',
};
const FOOT_ROW =
  'border-t-2 border-emerald-500 bg-slate-100 text-[14px] font-black dark:bg-[#0f1838] [&>td]:px-2.5 [&>td]:py-3';

/** «بنود العقد»: each line's make, price, count, received, remaining and total; the sums in the foot. */
export const ContractLinesTable = ({
  contract,
}: {
  contract: Pick<
    FleetVehicleContractDto,
    'lines' | 'contracted' | 'received' | 'remaining' | 'total'
  >;
}): JSX.Element => {
  const t = useT();
  const makeName = useMakeName();
  return (
    <div className={FORM_TABLE_WRAP}>
      <table className={FORM_TABLE}>
        <thead className={FORM_THEAD}>
          <tr>
            <th className="w-10">{t('fleet.vehicleContracts.lines.no')}</th>
            <th>{t('fleet.vehicleContracts.lines.make')}</th>
            <th>{t('fleet.vehicleContracts.lines.price')}</th>
            <th>{t('fleet.vehicleContracts.lines.count')}</th>
            <th>{t('fleet.vehicleContracts.lines.received')}</th>
            <th>{t('fleet.vehicleContracts.lines.remaining')}</th>
            <th>{t('fleet.vehicleContracts.lines.total')}</th>
          </tr>
        </thead>
        <tbody className={FORM_TBODY}>
          {contract.lines.map((line, index) => (
            <tr key={line.id} data-contract-line={line.id}>
              <td>
                <span dir="ltr" className={cn(FIGURE, 'text-slate-500 dark:text-slate-400')}>
                  {latin(index + 1)}
                </span>
              </td>
              <td>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[13.5px] dark:border-[#2b3b6b] dark:bg-[#0a1233]">
                  <BoardIcon
                    d={PATH.truck}
                    className="h-4 w-4 text-slate-500 dark:text-slate-400"
                  />
                  {makeName(line)}
                </span>
              </td>
              <td>{line.unitPrice === null ? DASH : <Money value={line.unitPrice} small />}</td>
              <td>
                <span dir="ltr" className={cn(BIG, INK.plain)}>
                  {latin(line.count)}
                </span>
              </td>
              <td>
                <span dir="ltr" className={cn(BIG, INK.got)}>
                  {latin(line.received)}
                </span>
              </td>
              <td>
                <span dir="ltr" className={cn(BIG, INK.left)}>
                  {latin(line.remaining)}
                </span>
              </td>
              <td>{line.total === null ? DASH : <Money value={line.total} small />}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={FOOT_ROW}>
            <td colSpan={3} className="!text-start">
              <span className="ps-2 text-slate-900 dark:text-white">
                {t('fleet.vehicleContracts.lines.foot')}
              </span>
            </td>
            <td>
              <span dir="ltr" className={cn(BIG, INK.plain)}>
                {latin(contract.contracted)}
              </span>
            </td>
            <td>
              <span dir="ltr" className={cn(BIG, INK.got)}>
                {latin(contract.received)}
              </span>
            </td>
            <td>
              <span dir="ltr" className={cn(BIG, INK.left)}>
                {latin(contract.remaining)}
              </span>
            </td>
            <td className="bg-emerald-50 dark:bg-[#122238]">
              <Money value={contract.total} className="text-[16px] font-black" />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

/**
 * «الاستلامات»: each delivery with its date, its cars per line (one column per line, «· من 22»
 * after the make), its count, what had arrived after it and what was still owed; edit and delete
 * for whoever may record deliveries.
 */
export const ContractDeliveriesTable = ({
  contract,
  onEdit,
  onDelete,
}: {
  contract: Pick<
    FleetVehicleContractDto,
    'lines' | 'deliveries' | 'contracted' | 'received' | 'remaining'
  >;
  onEdit: ((delivery: FleetVehicleContractDeliveryDto) => void) | null;
  onDelete: ((delivery: FleetVehicleContractDeliveryDto) => void) | null;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const makeName = useMakeName();
  const all = contract.contracted;
  const mayAct = onEdit !== null || onDelete !== null;
  return (
    <div className={FORM_TABLE_WRAP}>
      <table className={FORM_TABLE}>
        <thead className={FORM_THEAD}>
          <tr>
            <th>{t('fleet.vehicleContracts.deliveries.col')}</th>
            <th>{t('fleet.vehicleContracts.deliveries.date')}</th>
            {contract.lines.map((line) => (
              <th key={line.id}>
                <span className="inline-flex items-baseline gap-1.5">
                  <span>{makeName(line)}</span>
                  <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                    · {t('fleet.vehicleContracts.deliveries.of', { of: latin(line.count) })}
                  </span>
                </span>
              </th>
            ))}
            <th>{t('fleet.vehicleContracts.deliveries.cars')}</th>
            <th>{t('fleet.vehicleContracts.deliveries.running')}</th>
            <th>{t('fleet.vehicleContracts.deliveries.left')}</th>
            {mayAct && <th>{t('fleet.vehicles.columns.actions')}</th>}
          </tr>
        </thead>
        <tbody className={FORM_TBODY}>
          {contract.deliveries.map((delivery, index) => (
            <tr key={delivery.id} data-contract-delivery-row={delivery.id}>
              <td>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <i className={cn('h-2.5 w-2.5 rounded-sm', deliveryTone(index))} />
                  <span className="text-[14px] text-slate-900 dark:text-white">
                    {words.deliveryName(delivery.no)}
                  </span>
                </span>
              </td>
              <td>
                <span dir="ltr" className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}>
                  {ymd(delivery.date)}
                </span>
              </td>
              {contract.lines.map((line) => {
                const got = delivery.counts.find((entry) => entry.lineId === line.id)?.count ?? 0;
                return (
                  <td key={line.id}>
                    {got === 0 ? (
                      DASH
                    ) : (
                      <span dir="ltr" className={cn(BIG, INK.plain)}>
                        {latin(got)}
                      </span>
                    )}
                  </td>
                );
              })}
              <td>
                <span className="inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded-full bg-emerald-500/15 px-2 text-emerald-800 dark:text-emerald-300">
                  <span dir="ltr" className={cn(FIGURE, 'text-[15px]')}>
                    {latin(delivery.total)}
                  </span>
                </span>
              </td>
              <td>
                <span className="mx-auto inline-flex w-36 flex-col gap-1">
                  <Of n={delivery.receivedAfter} of={all} />
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-[#1c2740]">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct(delivery.receivedAfter, all)}%` }}
                    />
                  </span>
                </span>
              </td>
              <td>
                <span dir="ltr" className={cn(BIG, INK.left)}>
                  {latin(delivery.remainingAfter)}
                </span>
              </td>
              {mayAct && (
                <td>
                  <span className={ACTION_GROUP}>
                    {onEdit !== null && (
                      <button
                        type="button"
                        title={t('fleet.vehicleContracts.deliveries.edit')}
                        aria-label={t('fleet.vehicleContracts.deliveries.edit')}
                        data-contract-delivery-edit={delivery.id}
                        onClick={() => onEdit(delivery)}
                        className={actionTone('edit')}
                      >
                        <SquarePenIcon className="h-4 w-4" />
                      </button>
                    )}
                    {onDelete !== null && (
                      <button
                        type="button"
                        title={t('fleet.vehicleContracts.deliveries.delete')}
                        aria-label={t('fleet.vehicleContracts.deliveries.delete')}
                        data-contract-delivery-delete={delivery.id}
                        onClick={() => onDelete(delivery)}
                        className={actionTone('delete')}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={FOOT_ROW}>
            <td className="text-slate-900 dark:text-white">
              {t('fleet.vehicleContracts.deliveries.foot')}
            </td>
            <td>{DASH}</td>
            {contract.lines.map((line) => (
              <td key={line.id}>
                <Of n={line.received} of={line.count} ink={INK.got} />
              </td>
            ))}
            <td>
              <Of n={contract.received} of={all} ink={INK.got} />
            </td>
            <td>{DASH}</td>
            <td>
              <span dir="ltr" className={cn(BIG, INK.left)}>
                {latin(contract.remaining)}
              </span>
            </td>
            {mayAct && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
