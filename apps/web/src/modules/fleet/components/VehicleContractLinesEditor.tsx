// «بنود العقد» in the editor — the owner's approved forms sample (`zz-contracts-forms-editor`): each
// line a make from «قوائم الحركة» (the active ones, and the line's own even if deactivated since),
// how many cars the contract names and the price of one → the line's total, worked out as he types.
// Only the make and a count of 1 or more are required; the price is optional.
//
// On an edit, a line cars already arrived on keeps its bin faded with the reason, and its count may
// not go under what arrived — the server refuses both too.
import { type Locale } from '@ecms/contracts';
import { FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { localized } from '../../../shared/lib/format';
import { Input, Select } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { useVehicleTypes } from '../api/fleet-queries';
import { editorLineTotal, typedCount, type EditorLine } from '../lib/vehicle-contract-figures';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { MONO, Stroke } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { CARD_BOX } from './LicenseExpensePaidGroup';
import {
  CountChip,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  Money,
  SectionHead,
} from './custody-memo-parts';
import { actionTone } from './row-actions-look';
import { Trash2Icon } from './row-action-icons';
import { LockedRowAction } from './LockedRowAction';

/** The vehicle form's «نوع السيارة» select, a step down for a table row. */
const MAKE_BOX = cn(
  '!h-auto !rounded-xl !py-2 !ps-3 !text-sm !font-bold !text-slate-900 shadow-inner dark:!text-white',
  '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
  'focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
);
const ERROR_NOTE = 'mt-1 text-[12px] font-bold leading-4 text-rose-600 dark:text-[#ff6b81]';

/** The keys `useRequiredFields` knows a line's two required boxes by. */
export const makeKey = (line: Pick<EditorLine, 'key'>): string => `make-${line.key}`;
export const countKey = (line: Pick<EditorLine, 'key'>): string => `count-${line.key}`;

/**
 * Why a FILLED line still cannot be saved — `null` when it can. (An empty make or count is a
 * missing value, which the form's required-fields guard names.)
 */
export const lineInvalid = (
  line: EditorLine,
  received: number,
): 'belowReceived' | 'price' | null => {
  const count = typedCount(line.count);
  if (count >= 1 && count < received) return 'belowReceived';
  if (line.price.trim() !== '' && Number(line.price) > FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX) {
    return 'price';
  }
  return null;
};

export const VehicleContractLinesEditor = ({
  lines,
  receivedOf,
  isMissing,
  showInvalid,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: readonly EditorLine[];
  /** What already arrived on a saved line (0 for a new one). */
  receivedOf: (line: EditorLine) => number;
  /** The form's required-fields guard: is this box missing right now? */
  isMissing: (key: string) => boolean;
  /** Save was pressed: a filled line says what is still wrong with it. */
  showInvalid: boolean;
  onChange: (key: string, change: Partial<EditorLine>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const types = useVehicleTypes();
  const makes = types.data?.items ?? [];
  const cars = lines.reduce((sum, line) => sum + typedCount(line.count), 0);
  return (
    <section className="space-y-3" data-contract-lines="true">
      <SectionHead
        title={t('fleet.vehicleContracts.section.lines')}
        icon={PATH.truck}
        end={<CountChip>{words.count('car', cars)}</CountChip>}
      />
      <div className={FORM_TABLE_WRAP}>
        <table className={FORM_TABLE}>
          <thead className={FORM_THEAD}>
            <tr>
              <th className="w-9">{t('fleet.vehicleContracts.lines.no')}</th>
              <th className="w-[14.5rem]">{t('fleet.vehicleContracts.lines.make')}</th>
              {/* Two lines: «العدد» over «المتعاقد عليه», so the column is the box's width. */}
              <th className="w-[7rem] leading-4">
                <span className="block">{t('fleet.vehicleContracts.lines.countTop')}</span>
                <span className="block">{t('fleet.vehicleContracts.lines.countBottom')}</span>
              </th>
              <th className="w-[8.5rem]">{t('fleet.vehicleContracts.lines.price')}</th>
              <th>{t('fleet.vehicleContracts.lines.total')}</th>
              <th className="w-10" aria-label={t('fleet.vehicleContracts.lines.remove')} />
            </tr>
          </thead>
          <tbody className={FORM_TBODY}>
            {lines.map((line, index) => {
              const sum = editorLineTotal(line);
              const received = receivedOf(line);
              const missingMake = isMissing(makeKey(line));
              const missingCount = isMissing(countKey(line));
              const problem = showInvalid ? lineInvalid(line, received) : null;
              return (
                <tr key={line.key} data-contract-line={line.key} className="group/line align-top">
                  <td>
                    <span className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[13px] text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                      {latin(index + 1)}
                    </span>
                  </td>
                  <td>
                    <Select
                      aria-label={t('fleet.vehicleContracts.lines.make')}
                      value={line.typeId}
                      onChange={(e) => onChange(line.key, { typeId: e.target.value })}
                      density="tight"
                      error={missingMake}
                      className={cn(
                        MAKE_BOX,
                        missingMake && '!border-rose-500 dark:!border-rose-500',
                      )}
                      data-contract-make={line.key}
                    >
                      <option value="">{t('fleet.vehicleContracts.lines.pickMake')}</option>
                      {makes
                        .filter((make) => make.isActive || make.id === line.typeId)
                        .map((make) => (
                          <option key={make.id} value={make.id}>
                            {localized(make.name, locale)}
                          </option>
                        ))}
                    </Select>
                    {missingMake && <p className={ERROR_NOTE}>{t('common.validation.required')}</p>}
                  </td>
                  <td>
                    <Input
                      aria-label={t('fleet.vehicleContracts.lines.count')}
                      value={line.count}
                      onChange={(e) => onChange(line.key, { count: e.target.value })}
                      rule="integer"
                      maxLength={5}
                      density="tight"
                      error={missingCount || problem === 'belowReceived'}
                      tone={cn(CARD_BOX, MONO, 'text-center')}
                      data-contract-count={line.key}
                    />
                    {missingCount && (
                      <p className={ERROR_NOTE}>{t('common.validation.required')}</p>
                    )}
                    {problem === 'belowReceived' && (
                      <p className={ERROR_NOTE} data-contract-below-received={line.key}>
                        {t('fleet.vehicleContracts.lines.belowReceived', {
                          received: latin(received),
                        })}
                      </p>
                    )}
                  </td>
                  <td>
                    <MoneyInput
                      aria-label={t('fleet.vehicleContracts.lines.price')}
                      value={line.price}
                      onChange={(value) => onChange(line.key, { price: value })}
                      density="tight"
                      error={problem === 'price'}
                      tone={cn(CARD_BOX, MONO, 'text-center')}
                      data-contract-price={line.key}
                    />
                    {problem === 'price' && (
                      <p className={ERROR_NOTE}>
                        {t('fleet.vehicleContracts.lines.priceMax', {
                          max: latin(FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX),
                        })}
                      </p>
                    )}
                  </td>
                  <td data-contract-line-total={line.key}>
                    {sum === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="mt-1 inline-flex rounded-lg px-2 py-1 transition-colors group-focus-within/line:bg-indigo-500/10 group-focus-within/line:ring-1 group-focus-within/line:ring-indigo-500/40">
                        <Money value={sum} small />
                      </span>
                    )}
                  </td>
                  <td>
                    {received > 0 ? (
                      <LockedRowAction
                        kind="delete"
                        reason={t('fleet.vehicleContracts.lines.removeLocked')}
                        mark="contract-line-remove"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </LockedRowAction>
                    ) : (
                      <button
                        type="button"
                        className={cn(actionTone('delete'), 'mt-1.5')}
                        aria-label={t('fleet.vehicleContracts.lines.remove')}
                        title={t('fleet.vehicleContracts.lines.remove')}
                        disabled={lines.length === 1}
                        onClick={() => onRemove(line.key)}
                        data-contract-line-remove={line.key}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          data-contract-add-line="true"
          onClick={onAdd}
          className="flex w-56 shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-2 text-sm font-bold text-indigo-600 transition hover:border-indigo-500/50 hover:bg-indigo-500/5 dark:border-[#2b3b6b] dark:text-indigo-300"
        >
          <Stroke d={['M12 4v16m8-8H4']} className="h-4 w-4" />
          {t('fleet.vehicleContracts.lines.add')}
        </button>
        <p className="text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
          {t('fleet.vehicleContracts.lines.liveHint')}
          <br />
          {t('fleet.vehicleContracts.lines.makesHint')}
        </p>
      </div>
    </section>
  );
};
