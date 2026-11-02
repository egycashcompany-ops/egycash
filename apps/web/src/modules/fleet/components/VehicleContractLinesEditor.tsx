// «بنود العقد» in the editor — the owner's approved forms sample (`zz-contracts-forms-editor`): each
// line a make from «قوائم الحركة» (the active ones, and the line's own even if deactivated since),
// how many cars the contract names and the price of one → the line's total, worked out as he types.
// Only the make and a count of 1 or more are required; the price is optional.
//
// On an edit, a line cars already arrived on keeps its bin faded with the reason, and its count may
// not go under what arrived — the server refuses both too.
//
// «المستلم / حتى الآن» (batch 3, the owner's approved sample D): right after the count, how many cars
// of the line already arrived when the contract is registered — «شاشة توريد السيارات وانا بسجل عقد
// يبقى فيه خانة اكتب عدد اللى انا استلمته». Optional (empty is none), never more than the line's
// count: the box turns rose at once, the note under the table names the make, and Save waits (as
// «تسجيل استلام» does). Save records it as the contract's «الاستلام الأول» on the day under the
// table. On an edit the column is the saved figure, locked; without «تسجيل استلام» it is not drawn
// (`ReceivedMode`).
import { type Locale } from '@ecms/contracts';
import { FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { localized } from '../../../shared/lib/format';
import { Input, Select } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { useVehicleTypes } from '../api/fleet-queries';
import {
  editorLineTotal,
  receivedOver,
  typedCount,
  type EditorLine,
  type ReceivedMode,
} from '../lib/vehicle-contract-figures';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { DesignField, LOOK, MONO, Stroke, boxTone } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { CARD_BOX, DESIGN_TILE } from './LicenseExpensePaidGroup';
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
/** «المتبقي 7» under a received box — grey while cars are owed, emerald at 0. */
const LEFT_NOTE = 'mt-1 block whitespace-nowrap text-center text-[12px] font-bold leading-4';
const VC = 'fleet.vehicleContracts';

/** The keys `useRequiredFields` knows a line's two required boxes by. */
export const makeKey = (line: Pick<EditorLine, 'key'>): string => `make-${line.key}`;
export const countKey = (line: Pick<EditorLine, 'key'>): string => `count-${line.key}`;

/**
 * Why a FILLED line still cannot be saved — `null` when it can. (An empty make or count is a
 * missing value, which the form's required-fields guard names.) `receivedOver`: on a new contract,
 * a received box over the line's count.
 */
export const lineInvalid = (
  line: EditorLine,
  received: number,
  mode: ReceivedMode = 'hidden',
): 'belowReceived' | 'receivedOver' | 'price' | null => {
  const count = typedCount(line.count);
  if (count >= 1 && count < received) return 'belowReceived';
  if (mode === 'edit' && receivedOver(line)) return 'receivedOver';
  if (line.price.trim() !== '' && Number(line.price) > FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX) {
    return 'price';
  }
  return null;
};

/** The thin bar of «تسجيل استلام»: what arrives with the contract (indigo) of what it names. */
const Progress = ({ now, of }: { now: number; of: number }): JSX.Element => (
  <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-[#162135]">
    <div
      className="h-full bg-indigo-500 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.22)_0_6px,transparent_6px_12px)]"
      style={{ width: `${of === 0 ? 0 : Math.min(100, (now / of) * 100)}%` }}
    />
  </div>
);

/**
 * The footer's addition once something arrived: «— المستلم 26 · المتبقي 7». While a box is over its
 * line, «المستلم» turns rose and nothing is promised as left.
 */
export const ReceivedTotals = ({
  received,
  left,
  over,
}: {
  received: number;
  left: number;
  over: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <span
      className="flex items-baseline gap-x-2 whitespace-nowrap text-sm font-bold"
      data-contract-footer-received={received}
    >
      <span className="text-slate-400">—</span>
      <span
        className={cn(
          over ? 'text-rose-600 dark:text-[#ff6b81]' : 'text-sky-700 dark:text-sky-300',
        )}
      >
        {t(`${VC}.total.received`, { received: latin(received) })}
      </span>
      {!over && (
        <>
          <span className="text-slate-400">·</span>
          <span className="text-amber-700 dark:text-amber-300">
            {t(`${VC}.total.left`, { left: latin(left) })}
          </span>
        </>
      )}
    </span>
  );
};

export const VehicleContractLinesEditor = ({
  lines,
  receivedOf,
  receivedMode,
  receivedDate,
  onReceivedDate,
  isMissing,
  showInvalid,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: readonly EditorLine[];
  /** What already arrived on a saved line (0 for a new one). */
  receivedOf: (line: EditorLine) => number;
  /** How «المستلم حتى الآن» is offered: typed (a new contract), locked (an edit) or not drawn. */
  receivedMode: ReceivedMode;
  /** «تاريخ الاستلام» of the first delivery, while something is typed in a received box. */
  receivedDate: string;
  onReceivedDate: (day: string) => void;
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
  const withReceived = receivedMode !== 'hidden';
  const typing = receivedMode === 'edit';
  const received = typing ? lines.reduce((sum, line) => sum + typedCount(line.received), 0) : 0;
  const overLines = typing
    ? lines.filter((line) => typedCount(line.count) >= 1 && receivedOver(line))
    : [];
  const makeOf = (line: EditorLine): string => {
    const make = makes.find((each) => each.id === line.typeId);
    return make === undefined ? '—' : localized(make.name, locale);
  };
  return (
    <>
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
                {/* With the received column, the make, count and price columns are trimmed to
                    their content (and the form widened 62% → 68%), so every box stays whole at
                    1536 with the menu open. */}
                <th className={withReceived ? 'w-[12rem]' : 'w-[14.5rem]'}>
                  {t('fleet.vehicleContracts.lines.make')}
                </th>
                {/* Two lines: «العدد» over «المتعاقد عليه», so the column is the box's width. */}
                <th className={cn(withReceived ? 'w-[6.25rem]' : 'w-[7rem]', 'leading-4')}>
                  <span className="block">{t('fleet.vehicleContracts.lines.countTop')}</span>
                  <span className="block">{t('fleet.vehicleContracts.lines.countBottom')}</span>
                </th>
                {/* Two lines like the count's head: «المستلم» over «حتى الآن». */}
                {withReceived && (
                  <th
                    className="w-[4.5rem] !px-1.5 leading-4"
                    data-contract-received-head={receivedMode}
                  >
                    <span className="block">{t(`${VC}.lines.receivedTop`)}</span>
                    <span className="block">{t(`${VC}.lines.receivedBottom`)}</span>
                  </th>
                )}
                <th className={withReceived ? 'w-[7.5rem]' : 'w-[8.5rem]'}>
                  {t('fleet.vehicleContracts.lines.price')}
                </th>
                <th>{t('fleet.vehicleContracts.lines.total')}</th>
                <th className="w-10" aria-label={t('fleet.vehicleContracts.lines.remove')} />
              </tr>
            </thead>
            <tbody className={FORM_TBODY}>
              {lines.map((line, index) => {
                const sum = editorLineTotal(line);
                const saved = receivedOf(line);
                const missingMake = isMissing(makeKey(line));
                const missingCount = isMissing(countKey(line));
                const problem = showInvalid ? lineInvalid(line, saved, receivedMode) : null;
                const count = typedCount(line.count);
                const typed = typedCount(line.received);
                // Live, as «تسجيل استلام» does — not only after Save is pressed.
                const over = typing && count >= 1 && typed > count;
                const left = count - (receivedMode === 'locked' ? saved : typed);
                const showLeft =
                  count >= 1 &&
                  left >= 0 &&
                  (receivedMode === 'locked' || line.received.trim() !== '');
                return (
                  <tr
                    key={line.key}
                    data-contract-line={line.key}
                    className={cn(
                      'group/line align-top',
                      over && 'bg-rose-50/70 dark:bg-rose-500/[0.06]',
                    )}
                  >
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
                          // Never narrower than «مرسيدس اسبرانتر 516».
                          'min-w-[10.75rem]',
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
                      {missingMake && (
                        <p className={ERROR_NOTE}>{t('common.validation.required')}</p>
                      )}
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
                            received: latin(saved),
                          })}
                        </p>
                      )}
                    </td>
                    {withReceived && (
                      <td className="!px-1.5" data-contract-received-cell={line.key}>
                        {typing ? (
                          <Input
                            aria-label={`${t(`${VC}.lines.receivedTop`)} ${t(`${VC}.lines.receivedBottom`)}`}
                            aria-invalid={over || undefined}
                            value={line.received}
                            onChange={(e) => onChange(line.key, { received: e.target.value })}
                            rule="integer"
                            maxLength={5}
                            placeholder="0"
                            density="tight"
                            error={over}
                            tone={cn(
                              CARD_BOX,
                              MONO,
                              'text-center aria-[invalid=true]:!text-rose-600 dark:aria-[invalid=true]:!text-rose-300',
                            )}
                            data-contract-received={line.key}
                          />
                        ) : (
                          // On an edit: the saved figure, faded, with a lock — the locked look of
                          // «رقم الاستلام» in «تسجيل استلام».
                          <span
                            title={t(`${VC}.lines.receivedLocked`)}
                            className={cn(
                              CARD_BOX,
                              MONO,
                              'flex h-[2.375rem] items-center justify-center gap-1.5 px-2 text-sm',
                              '!bg-slate-100 !text-slate-500 dark:!bg-[#0f1838] dark:!text-slate-400',
                            )}
                            data-contract-received-locked={line.key}
                          >
                            <Stroke
                              d={[...PATH.lock]}
                              className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                            />
                            {latin(saved)}
                          </span>
                        )}
                        {over ? (
                          <p
                            className={ERROR_NOTE}
                            role="alert"
                            data-contract-received-over={line.key}
                          >
                            {t(`${VC}.lines.receivedOver`, { count: latin(count) })}
                          </p>
                        ) : (
                          showLeft && (
                            <span
                              className={cn(
                                LEFT_NOTE,
                                left === 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400',
                              )}
                              data-contract-received-left={left}
                            >
                              {t('fleet.vehicleContracts.remaining', { n: latin(left) })}
                            </span>
                          )
                        )}
                      </td>
                    )}
                    <td>
                      <MoneyInput
                        aria-label={t('fleet.vehicleContracts.lines.price')}
                        value={line.price}
                        onChange={(value) => onChange(line.key, { price: value })}
                        density="tight"
                        error={problem === 'price'}
                        tone={cn(CARD_BOX, MONO, 'min-w-[6.25rem] text-center')}
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
                      {saved > 0 ? (
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
          {/* Beside «إضافة بند» where there is room for it, under it on a phone. */}
          <p className="min-w-0 flex-1 basis-[20rem] text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
            {t('fleet.vehicleContracts.lines.liveHint')}
            <br />
            {t('fleet.vehicleContracts.lines.makesHint')}
            {/* The third line: what the box records, and where later arrivals go. */}
            {withReceived && (
              <>
                <br />
                <span data-contract-received-hint={receivedMode}>
                  {t(typing ? `${VC}.lines.receivedHint` : `${VC}.lines.receivedEditHint`)}
                </span>
              </>
            )}
          </p>
        </div>
      </section>

      {/* A box over its line's count: the note names the make (as «تسجيل استلام» does). */}
      {overLines.length > 0 && (
        <p
          role="alert"
          data-contract-received-over-note="true"
          className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
        >
          <Stroke d={[...PATH.warn]} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {overLines
              .map((line) =>
                t(`${VC}.lines.receivedOverNote`, {
                  make: makeOf(line),
                  count: words.count('car', typedCount(line.count)),
                }),
              )
              .join(' ')}
          </span>
        </p>
      )}

      {/* Only while something is typed: the first delivery's day, and what Save records. Clearing
          the day keeps the last one, so Save never waits on it. */}
      {typing && received > 0 && (
        <div
          className={cn(
            DESIGN_TILE,
            'grid grid-cols-1 items-end gap-x-6 gap-y-3 p-4 sm:grid-cols-[12rem_1fr]',
          )}
          data-contract-first-delivery={received}
        >
          <DesignField label={t('fleet.vehicleContracts.delivery.date')} datePicker>
            <Input
              type="date"
              dir="ltr"
              aria-label={t('fleet.vehicleContracts.delivery.date')}
              value={receivedDate}
              onChange={(e) => {
                if (e.target.value !== '') onReceivedDate(e.target.value);
              }}
              tone={cn(boxTone(LOOK.add), MONO)}
              data-contract-received-date="true"
            />
          </DesignField>
          {/* While a box is over, the note above says why and nothing is promised here. */}
          {overLines.length === 0 && (
            <div className="space-y-2 pb-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-slate-800 dark:text-slate-100">
                <span>
                  {t(`${VC}.lines.firstDelivery`, {
                    first: words.deliveryName(1),
                    received: `\u2068${latin(received)}\u2069`,
                    total: words.count('car', cars),
                  })}
                </span>
                <span className="text-slate-400">—</span>
                <span className="text-amber-700 dark:text-amber-300">
                  {t('fleet.vehicleContracts.delivery.afterLeft', {
                    left: words.count('car', Math.max(0, cars - received)),
                  })}
                </span>
              </p>
              <Progress now={received} of={cars} />
            </div>
          )}
        </div>
      )}
    </>
  );
};
