// Create/edit an accident file (§4.6), in the Fleet forms' design (`DesignDialog`, like the
// maintenance, receipts and dealership forms): «بيانات الحادث» / «المبالغ» / «أخذ مبلغ من متبقي
// سيارة أخرى (اختياري)», then «ملاحظات» — the owner-approved sample (2026-11-09).
//
// The three amounts are the ENTERED facts, stored as typed; «المتبقي على هذا الحادث» under them is
// shown, never typed — the contract's own formula over the boxes. The vehicle box offers the WHOLE
// registry: an accident is historical paperwork about the day it happened, so a disposed vehicle
// is a legal reference (deliberate contrast with the odometer's refusal). Edits send only the
// changed fields + the document version.
//
// «اختار عربيه و جمبها مبلغ» — optionally, an amount taken from OTHER cars' remaining and added to
// this file. Since 2026-11-09 the amount MAY be typed («هتسمح انه يدخل المبلغ او انت تلقائى اعرف
// المبلغ اللى بالسالب كام وشيله»), which partly reverses the 2026-10-01 «مش انا اللى هكتب المبلغ
// الماخوذ»: an empty box covers the whole negative once a car is picked. Which cars, and how much
// each gives, is `planTransfer` (lib/accident-transfer-plan.ts) — his picks first in his order,
// then the system's, smallest first, each to zero, every car tagged «اختيار يدوي» / «اختيار تلقائي».
// The server checks the same figures again inside the transaction that writes it, and refuses
// (nothing written) a take above this file's negative or above what the cars still hold.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ErrorCodes,
  fleetAccidentRemaining,
  type FleetAccidentDto,
  type Locale,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoney, formatMoneyParts } from '../../../shared/lib/format';
import { Input, Textarea } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import {
  MissingFieldsBanner,
  useRequiredFields,
  type RequiredField,
} from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAccidentCarBalances, useCreateAccident, useUpdateAccident } from '../api/fleet-queries';
import {
  MAX_GIVING_CARS,
  planTransfer,
  repick,
  transferBody,
  type PickSource,
  type PlanProblem,
  type TransferPlan,
} from '../lib/accident-transfer-plan';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DesignField, LOOK, MONO, boxTone, carBoxClass } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { AMOUNT_BOX, useFigure } from './custody-fund-form-parts';
import { FORM_TABLE, FORM_TABLE_WRAP, FORM_TBODY, FORM_THEAD } from './custody-memo-parts';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { RegistryDriverPicker } from './RegistryDriverPicker';
import { useFleetPeopleMap } from './EmployeeName';

// ── The design's boxes — `MaintenanceDialogs`' own, as that form draws them ─────────────────────
const box = boxTone(LOOK.add);
const dateBox = cn(box, MONO);
/** MaintenanceDialogs' `listBox` (it is not exported): the pickers' trigger as a box. */
const listBox = (missing = false): string =>
  cn(
    '[&_button[aria-haspopup]]:!w-full [&_button[aria-haspopup]]:!justify-between [&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!py-3 [&_button[aria-haspopup]]:!ps-4 [&_button[aria-haspopup]]:!text-[15px] [&_button[aria-haspopup]]:!font-medium [&_button[aria-haspopup]]:shadow-inner',
    '[&_button[aria-haspopup]]:!text-slate-900 dark:[&_button[aria-haspopup]]:!text-white [&_button[aria-haspopup]:focus]:!border-indigo-500',
    missing
      ? '[&_button[aria-haspopup]]:!border-rose-500/70 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233] [&_button[aria-haspopup]]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]'
      : '[&_button[aria-haspopup]]:!border-slate-200 dark:[&_button[aria-haspopup]]:!border-[#2b3b6b] [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233]',
    '[&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-slate-200 dark:[&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#131d35] [&_[role=listbox]]:!shadow-2xl',
    '[&_[role=option]:hover]:!bg-brand-500/15 [&_[role=option][aria-selected=true]]:!font-bold [&_[role=option][aria-selected=true]]:!text-brand-700 dark:[&_[role=option][aria-selected=true]]:!text-brand-200',
    '[&>.justify-between]:!rounded-xl [&>.justify-between]:!border-slate-200 dark:[&>.justify-between]:!border-[#2b3b6b] [&>.justify-between]:!bg-slate-50 dark:[&>.justify-between]:!bg-[#0a1233] [&>.justify-between]:!py-3 [&>.justify-between]:!ps-4 [&>.justify-between]:shadow-inner [&>.justify-between_.text-sm]:!text-[15px] [&>.justify-between_.text-sm]:!font-medium',
  );
/**
 * The pickers' words keep the low dots of a final «ي»: `MultiSelect` writes them in a `truncate`
 * span (overflow hidden) whose line box is shorter than Cairo's descent at 15px, so «فتحي» read
 * «فتحى». The clip box grows by 4px each way here, in this form only; the layout does not move.
 */
const LOW_DOTS =
  '[&_button[aria-haspopup]_span.truncate]:py-1 [&_button[aria-haspopup]_span.truncate]:-my-1';
const pickerBox = (missing = false): string => cn(listBox(missing), LOW_DOTS);
/** MaintenanceDialogs' `carBox`: the car box, red over its own frame when missing. */
const carBox = (missing: boolean): string =>
  cn(
    carBoxClass(false),
    missing &&
      '[&&_input]:!border-rose-500/70 dark:[&&_input]:!border-rose-500/70 [&&_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
    missing && '[&_input]:!pe-28 [&_.end-2]:!end-10',
  );
/** MaintenanceDialogs' `notesBox`. */
const notesBox =
  '!rounded-xl !border-slate-200 !bg-slate-50 !px-4 !py-3 !text-[15px] !font-medium !text-slate-900 shadow-inner focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500 dark:!border-[#2b3b6b] dark:!bg-[#0a1233] dark:!text-white';
const GRID = 'grid grid-cols-1 items-start gap-5 md:grid-cols-2';

/** The section's drawings: a banknote for «المبالغ», two arrows for a car's remaining moving. */
const CASH = [
  'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
];
const ARROWS = ['M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'];

/** The pill a car the system added wears — the fuel-card form's «من الشيت» tag, in indigo. */
const AUTO_TAG =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-indigo-300 bg-indigo-50 px-2 py-px text-[11px] font-bold leading-4 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-500/15 dark:text-indigo-200';
/** The pill a car HE picked wears: the same pill, neutral, so the two never read as one. */
const MANUAL_TAG =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-300 bg-white px-2 py-px text-[11px] font-bold leading-4 text-slate-700 dark:border-slate-400/40 dark:bg-slate-400/10 dark:text-slate-200';
const BOLT = 'M13 10V3L4 14h7v7l9-11h-7z';
/** A plain mouse pointer — a car picked by hand (Lucide «mouse-pointer»): no rays, no sparkle. */
const CURSOR = 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3zm10 10l6 6';
const INFO = 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const WARN =
  'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const Glyph = ({ d, className }: { d: string; className: string }): JSX.Element => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * «يكتب جنب العربية انه هو الاختارها او الاختيار كان تلقائى» — one marker per car, the same in the
 * plan table and on the ticked options of the open list.
 */
const SourceTag = ({ source }: { source: PickSource }): JSX.Element => {
  const t = useT();
  return source === 'auto' ? (
    <span className={AUTO_TAG} data-transfer-tag="auto">
      <Glyph d={BOLT} className="h-3 w-3" />
      {t('fleet.accidents.transfer.auto')}
    </span>
  ) : (
    <span className={MANUAL_TAG} data-transfer-tag="manual">
      <Glyph d={CURSOR} className="h-3 w-3" />
      {t('fleet.accidents.transfer.manual')}
    </span>
  );
};

/**
 * A field's refusal, readable on the light panel: `DesignField` writes it #ff6b81, right on the
 * dark panel and about 2.7:1 on white. rose-700 in light, the design's own in dark (its «!» too).
 * Local to this form, as the approved sample drew it.
 */
const ALERT_TONE = cn(
  '[&_p[role=alert]]:text-rose-700 dark:[&_p[role=alert]]:text-[#ff6b81]',
  '[&_p[role=alert]>span:first-child]:text-rose-600 dark:[&_p[role=alert]>span:first-child]:text-rose-400',
);

/** The sign's tone, for the read-only remaining figures. */
const TONE = {
  owing:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/[0.08] dark:text-red-300',
  settled:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-300',
  plain:
    'border-slate-200 bg-slate-100 text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0f1838] dark:text-slate-200',
} as const;

/**
 * `MissingFieldsBanner`'s own box and words, for a save refused by a value that IS entered — the
 * amount above what this accident owes, a typed 0, or the server's own refusal with its figures.
 * Such a value is not «missing», so it is not listed under «أدخل البيانات المطلوبة»; its reason is
 * written instead. Local to this form (the sample's `refused` list beside `missing`).
 */
export const RefusedBanner = ({
  missing,
  refused,
  attempt,
}: {
  missing: readonly RequiredField[];
  refused: string;
  attempt: number;
}): JSX.Element => {
  const t = useT();
  const own = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (attempt > 0) own.current?.scrollIntoView?.({ block: 'nearest' });
  }, [attempt]);
  const fields = missing.map((field) => field.label).join(t('common.validation.separator'));
  return (
    <div
      ref={own}
      role="alert"
      data-missing-fields="true"
      data-refused="true"
      className={cn(
        'rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800',
        'dark:border-red-800 dark:bg-red-950/60 dark:text-red-200',
      )}
    >
      ⚠ <strong>{t('common.validation.notSaved')}</strong>{' '}
      {missing.length > 0 && <>{t('common.validation.enterRequired', { fields })} </>}
      {refused}
    </div>
  );
};

/**
 * `AMOUNT_BOX`, with a refused value readable on the light panel too: `boxTone` writes it rose-300,
 * right on the dark panel and about 1.9:1 on slate-50. Local to this form.
 */
const REFUSABLE_AMOUNT_BOX = cn(
  AMOUNT_BOX,
  '[&[aria-invalid=true][aria-invalid]]:!text-rose-600 dark:[&[aria-invalid=true][aria-invalid]]:!text-rose-300',
);

/** A figure in the figures' face, «ج.م.» after it in the page's own type. */
const Money = ({
  value,
  className,
  unitClass,
}: {
  value: number;
  className?: string;
  unitClass?: string;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const figure = useFigure();
  const { currency } = formatMoneyParts(0, 'EGP', locale);
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span dir="ltr" className={cn(MONO, className)}>
        {figure(value)}
      </span>
      <span className={cn('text-xs font-semibold', unitClass)}>{currency}</span>
    </span>
  );
};

/**
 * What the plan takes, and from which cars — «قبل الأخذ», the table (his cars and the system's,
 * each tagged), the note under it, «بعد الأخذ», and the amber note when the cars are short. Drawn
 * from `planTransfer` alone, so every figure on it is the plan's.
 */
export const TransferPlanView = ({ plan }: { plan: TransferPlan }): JSX.Element => {
  const t = useT();
  // After the taking: red while it still owes (a partial cover), green only once it reaches 0.
  const afterTone = plan.after < 0 ? TONE.owing : plan.after === 0 ? TONE.settled : TONE.plain;
  /** A sentence with its sums in the figures' face: `{{name}}` → <Money>. */
  const figureWords = (template: string, sums: Record<string, number>): ReactNode =>
    template
      .split(/\{\{(\w+)\}\}/u)
      .map((part, index) =>
        index % 2 === 1 ? (
          <Money key={index} value={sums[part] ?? 0} className="font-black" />
        ) : (
          part
        ),
      );
  /** The amber note's words — the limit's, his unticking's, or every car's. */
  const shortWords = (short: NonNullable<TransferPlan['short']>): string =>
    t(
      short.limited
        ? 'fleet.accidents.transfer.shortLimit'
        : short.excluded
          ? 'fleet.accidents.transfer.shortSelected'
          : 'fleet.accidents.transfer.shortAll',
      { max: String(MAX_GIVING_CARS), available: '{{available}}', after: '{{after}}' },
    );
  const head = (words: string, className?: string): ReactNode => (
    <th className={className}>{words}</th>
  );
  return (
    <div data-transfer-plan={plan.mode} className="space-y-3">
      <p
        data-transfer-before="true"
        className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-[15px] font-bold text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0f1838] dark:text-slate-200"
      >
        <span>{t('fleet.accidents.transfer.before')}</span>
        <Money
          value={plan.before}
          className={cn(
            'text-base font-black',
            plan.before < 0 && 'text-red-600 dark:text-red-400',
          )}
        />
      </p>
      <div className={FORM_TABLE_WRAP}>
        <table className={FORM_TABLE} data-transfer-table="true">
          <thead className={FORM_THEAD}>
            <tr>
              {head('#', 'w-10')}
              {head(t('fleet.accidents.transfer.columns.car'))}
              {head(t('fleet.accidents.transfer.columns.available'))}
              {head(t('fleet.accidents.transfer.columns.take'))}
              {head(t('fleet.accidents.transfer.columns.left'))}
            </tr>
          </thead>
          <tbody className={FORM_TBODY}>
            {plan.rows.map((row, i) => (
              <tr
                key={row.vehicleId}
                data-transfer-car={row.code}
                data-transfer-source={row.source}
                {...(row.unneeded ? { 'data-transfer-unneeded': 'true' } : {})}
                {...(row.overLimit ? { 'data-transfer-over-limit': 'true' } : {})}
                className={cn(
                  row.source === 'auto' && 'bg-indigo-50/70 dark:bg-indigo-500/[0.07]',
                  // His pick that was not needed, or past the limit: listed, greyed.
                  (row.unneeded || row.overLimit) && '[&>td]:opacity-60',
                )}
              >
                <td className="!font-medium !text-slate-500 dark:!text-slate-400">
                  <span className={MONO}>{i + 1}</span>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <span dir="ltr" className={cn(MONO, 'text-[15px] font-black')}>
                      {row.code}
                    </span>
                    <SourceTag source={row.source} />
                  </span>
                </td>
                <td>
                  <Money value={row.available} unitClass="text-slate-500 dark:text-slate-400" />
                </td>
                <td>
                  <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Money
                      value={row.take}
                      className={cn(
                        row.unneeded || row.overLimit
                          ? 'text-slate-500 dark:text-slate-400'
                          : 'text-indigo-700 dark:text-indigo-300',
                      )}
                      unitClass="text-slate-500 dark:text-slate-400"
                    />
                    {(row.unneeded || row.overLimit) && (
                      <span
                        data-transfer-unneeded-note="true"
                        className="whitespace-nowrap text-[12px] font-bold text-slate-700 dark:text-slate-200"
                      >
                        {row.overLimit
                          ? t('fleet.accidents.transfer.overLimit', {
                              max: String(MAX_GIVING_CARS),
                            })
                          : t('fleet.accidents.transfer.unneeded')}
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  <Money
                    value={row.left}
                    className={cn(row.left === 0 && 'text-emerald-600 dark:text-emerald-400')}
                    unitClass="text-slate-500 dark:text-slate-400"
                  />
                </td>
              </tr>
            ))}
            {plan.rows.length > 1 && (
              <tr
                data-transfer-total="true"
                className="bg-slate-100 dark:bg-[#0f1838] [&_td]:!font-black"
              >
                <td />
                <td>{t('fleet.accidents.transfer.columns.total')}</td>
                <td>
                  <Money value={plan.total} unitClass="text-slate-500 dark:text-slate-400" />
                </td>
                <td>
                  <Money
                    value={plan.amount}
                    className="text-indigo-700 dark:text-indigo-300"
                    unitClass="text-slate-500 dark:text-slate-400"
                  />
                </td>
                <td>
                  <Money value={plan.leftTotal} unitClass="text-slate-500 dark:text-slate-400" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p
        data-transfer-plan-note="true"
        className="flex items-start gap-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300"
      >
        <Glyph d={INFO} className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" />
        {/* «يُكمل النظام…» only while the system did add a car. */}
        <span>
          {plan.autoIds.length > 0
            ? t('fleet.accidents.transfer.planNote')
            : t('fleet.accidents.transfer.planNoteManual')}
        </span>
      </p>
      <p
        data-transfer-after="true"
        data-transfer-after-tone={plan.after < 0 ? 'owing' : plan.after === 0 ? 'settled' : 'plain'}
        className={cn(
          'flex flex-wrap items-baseline gap-x-2 rounded-xl border-2 px-4 py-2.5 text-[15px] font-bold',
          afterTone,
        )}
      >
        <span>{t('fleet.accidents.transfer.after')}</span>
        <Money value={plan.after} className="text-base font-black" />
      </p>
      {/* The cars together are short (or the limit stopped them): a WARNING, not a
          refusal — what they give is taken, the rest stays owed, saving stays allowed. */}
      {plan.short !== null && (
        <p
          role="status"
          data-transfer-short={
            plan.short.limited ? 'limit' : plan.short.excluded ? 'selected' : 'all'
          }
          className={cn(
            'flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[14px] font-bold text-amber-800',
            'dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200',
          )}
        >
          <Glyph d={WARN} className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <span>
            {figureWords(shortWords(plan.short), {
              available: plan.short.available,
              after: plan.after,
            })}
          </span>
        </p>
      )}
    </div>
  );
};

/** The two refusals the server words with figures, nothing written — the form says them itself. */
const TRANSFER_REFUSALS: readonly string[] = [
  ErrorCodes.FLEET_ACCIDENT_TRANSFER_SHORT,
  ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT,
];
const isTransferRefusal = (error: unknown): boolean =>
  error instanceof ApiError && TRANSFER_REFUSALS.includes(error.code);

/**
 * The server's refusal of a transfer, worded with the figures it sent (`details`: plain decimal
 * strings, «1200.50»), or `null` for any other failure. A take over this file's negative names the
 * negative; cars that no longer hold the amount name what they hold now — the balances were read
 * again (`useAccidentSave`), so the plan on screen is already drawn from the new figures. Without
 * its figures it falls back to the code's own sentence (`errorMessage`).
 */
export const transferRefusalOf = (
  error: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
  money: (value: number) => string,
  locale: Locale,
): string | null => {
  if (!(error instanceof ApiError) || !isTransferRefusal(error)) return null;
  const detail = (field: string): number =>
    Number(error.details?.find((d) => d.field === field)?.message ?? Number.NaN);
  if (error.code === ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT) {
    const deficit = detail('deficit');
    if (!Number.isFinite(deficit)) return errorMessage(error, locale);
    return deficit > 0
      ? t('fleet.accidents.transfer.overDeficit', { max: money(deficit) })
      : t('fleet.accidents.transfer.noDeficit');
  }
  const available = detail('available');
  const amount = detail('amount');
  if (!Number.isFinite(available) || !Number.isFinite(amount)) return errorMessage(error, locale);
  return t('fleet.accidents.transfer.refusedShort', {
    available: money(available),
    amount: money(amount),
  });
};

export const AccidentFormDialog = ({
  open,
  onClose,
  accident,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** null = create; a document = version-aware edit of the freshly loaded row. */
  accident: FleetAccidentDto | null;
  /** Pre-selected vehicle (e.g. arriving filtered from the vehicle profile). */
  initialVehicleId?: string;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  const figure = useFigure();

  // Each field starts from the row being edited (or the carried-over car), so the very first
  // render is already the form's; the effect below sets them again on every open.
  const [vehicleId, setVehicleId] = useState(() => accident?.vehicleId ?? initialVehicleId);
  const [occurredAt, setOccurredAt] = useState(() => accident?.occurredAt?.slice(0, 10) ?? '');
  const [culprit, setCulprit] = useState(() => accident?.culprit ?? '');
  // WHICH drivers, when they were ours — «يقدر يختار اكتر من سواق فى المره الواحده». Kept beside
  // the NAME rather than replacing it: an accident is often a third party's, and a form that could
  // only name employees could not record the commonest kind there is.
  const [culpritEmployeeIds, setCulpritEmployeeIds] = useState<string[]>(
    () => accident?.culpritEmployeeIds ?? [],
  );
  const [statement, setStatement] = useState(() => accident?.statement ?? '');
  const [companyCost, setCompanyCost] = useState(() =>
    accident === null ? '' : String(accident.companyCost),
  );
  const [amountCollected, setAmountCollected] = useState(() =>
    accident === null ? '' : String(accident.amountCollected),
  );
  const [paidAmount, setPaidAmount] = useState(() =>
    accident === null ? '' : String(accident.paidAmount),
  );
  const [notes, setNotes] = useState(() => accident?.notes ?? '');
  // The transfer: his cars IN HIS ORDER, the typed amount ('' = empty — the whole negative once a
  // car is picked), and the cars he unticked, which the system never adds for him again.
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [refused, setRefused] = useState<string[]>([]);
  // The server's own refusal of the last save, worded with its figures — until he changes the
  // transfer or the amounts, or presses «حفظ» again.
  const [serverRefusal, setServerRefusal] = useState<string | null>(null);
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    if (!open) return;
    setVehicleId(accident?.vehicleId ?? initialVehicleId);
    setOccurredAt(accident?.occurredAt?.slice(0, 10) ?? '');
    setCulprit(accident?.culprit ?? '');
    setCulpritEmployeeIds(accident?.culpritEmployeeIds ?? []);
    setStatement(accident?.statement ?? '');
    setCompanyCost(accident === null ? '' : String(accident.companyCost));
    setAmountCollected(accident === null ? '' : String(accident.amountCollected));
    setPaidAmount(accident === null ? '' : String(accident.paidAmount));
    setNotes(accident?.notes ?? '');
    setAwaitingNameFor('');
    // A transfer is one act per save: every open starts with none picked and nothing typed.
    setPicked([]);
    setTyped('');
    setRefused([]);
    setServerRefusal(null);
  }, [open, accident, initialVehicleId]);

  // The picked drivers' NAMES, from the same roster every other fleet screen reads — the WHOLE
  // roster, so a driver picked a moment ago is already in it.
  const roster = useFleetPeopleMap();
  const drivers = new Map([...roster.entries()].map(([id, person]) => [id, person.fullNameAr]));
  /** Several drivers read as one name line, in the order they were picked. */
  const namesOf = (ids: readonly string[]): string | undefined => {
    const names = ids.map((id) => drivers.get(id));
    return names.every((name): name is string => name !== undefined) ? names.join('، ') : undefined;
  };

  /**
   * WHOSE NAME IS STILL BEING LOOKED UP — and the reason this form could not be submitted at all.
   *
   * `drivers` is keyed on the id ALREADY in state, because that is what `useEmployeeRecords` was
   * asked for. Inside the picker's `onChange` the chosen id is by construction NOT that id (and on
   * a create it is the first id there has ever been, so the map is empty), so reading the name out
   * of `drivers` at pick time always missed — and the culprit name, which Save requires and the
   * contract enforces, was written as ''.
   *
   * So the pick is recorded as a REQUEST for a name, and the effect below fills it in when the
   * record arrives. It is deliberately not "always sync the name to the employee's current name":
   * the stored name is the historical fact — a driver renamed next year did not change who caused
   * this accident — so an existing row's name is left exactly as filed until somebody picks again.
   */
  const [awaitingNameFor, setAwaitingNameFor] = useState('');
  // The ids still waiting, comma-joined in state so the effect below compares a string.
  const resolvedName = awaitingNameFor === '' ? undefined : namesOf(awaitingNameFor.split(','));
  useEffect(() => {
    if (awaitingNameFor === '' || resolvedName === undefined) return;
    setCulprit(resolvedName);
    setAwaitingNameFor('');
  }, [awaitingNameFor, resolvedName]);

  // ── The remaining, and the plan ─────────────────────────────────────────────────────────────
  // «يجب كود السيارة المأخوذ منها السيارات اللى المبلغ المتبقى بالموجب بس» — every live car with
  // something left, from the same server figures that cap the save. This accident's own car is not
  // offered: a car cannot pay itself.
  const balances = useAccidentCarBalances(open);
  const offered = (balances.data ?? []).filter((car) => car.vehicleId !== vehicleId);
  // A file that sits on a source car and leaves it in this same save is not that car's to give:
  // the server leaves it out of the cap, and so does the figure the clerk is shown.
  const leavingFrom = (carId: string): number =>
    accident !== null && accident.vehicleId === carId ? fleetAccidentRemaining(accident) : 0;
  // This file's remaining as the form now reads — its own figures, plus what it already took and
  // gave. Its NEGATIVE part is the most a transfer may cover (the server caps it the same way).
  const targetBefore = fleetAccidentRemaining({
    companyCost: Number(companyCost) || 0,
    amountCollected: Number(amountCollected) || 0,
    paidAmount: Number(paidAmount) || 0,
    transferredIn: accident?.transferredIn ?? 0,
    transferredOut: accident?.transferredOut ?? 0,
  });
  // Only an EMPTY box means «the whole negative»; a typed 0 is refused by the plan.
  const typedAmount = typed === '' ? null : Number(typed);
  const plan = planTransfer({
    cars: offered.map((car) => ({
      vehicleId: car.vehicleId,
      code: car.vehicleCode,
      available: Math.max(
        0,
        fleetAccidentRemaining({
          amountCollected: car.remaining,
          companyCost: 0,
          paidAmount: leavingFrom(car.vehicleId),
        }),
      ),
    })),
    picked,
    typed: typedAmount,
    remaining: targetBefore,
    ownVehicleId: vehicleId === '' ? null : vehicleId,
    refused,
  });
  const offeredIds = new Set(offered.map((car) => car.vehicleId));
  const mine = picked.filter((id) => offeredIds.has(id) && id !== vehicleId);
  /** What the picker shows ticked: his cars in his order, then the ones the system added. */
  const ticked = [...mine, ...plan.autoIds];
  const sourceOf = new Map<string, PickSource>([
    ...mine.map((id): [string, PickSource] => [id, 'manual']),
    ...plan.autoIds.map((id): [string, PickSource] => [id, 'auto']),
  ]);
  /** Anything he changes in the transfer or the amounts answers the server's last refusal. */
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      setServerRefusal(null);
      set(value);
    };
  /**
   * «مسح الكل» and the ✕ start the section over: no car, no amount, nothing unticked — so the
   * system has every car to pick from again. (A last pick unticked by hand comes through `pick`.)
   */
  const clearAll = (): void => {
    setServerRefusal(null);
    setPicked([]);
    setRefused([]);
    setTyped('');
  };
  const pick = (next: string[]): void => {
    setServerRefusal(null);
    const after = repick({ ticked, mine, refused, next });
    setPicked(after.picked);
    setRefused(after.refused);
  };
  /** «تغطية السالب كله تلقائياً»: the whole negative into the amount — the system picks the cars. */
  const coverAll = (): void => {
    setServerRefusal(null);
    setTyped(String(Math.round(-targetBefore * 100) / 100));
  };

  const problemText = (problem: PlanProblem): string => {
    switch (problem.kind) {
      case 'noDeficit':
        return t('fleet.accidents.transfer.noDeficit');
      case 'overDeficit':
        return t('fleet.accidents.transfer.overDeficit', { max: money(problem.max) });
      case 'zero':
        return t('fleet.accidents.transfer.zero');
      case 'nothingToTake':
        return t('fleet.accidents.transfer.nothingToTake');
    }
  };
  // What stops the plan itself: the cars' figures could not be read (said once a transfer is
  // asked for — an untouched optional section is not an error), or the plan refuses.
  const planProblem =
    balances.isError && plan.mode !== 'none'
      ? t('fleet.accidents.transfer.loadFailed')
      : plan.problem === null
        ? null
        : problemText(plan.problem);
  // …and what refuses the save: that, or the server's own refusal of the last press. The plan
  // stays on screen under a server refusal — it is already drawn from the figures read again.
  const transferProblem = planProblem ?? serverRefusal;
  // Short of the target is NOT a problem: what the cars have is taken, the rest stays owed.
  // The body carries only the cars that give, in the plan's order, and what they give together.
  const transfer = balances.isError ? undefined : transferBody(plan);
  const transferOk = plan.mode === 'none' || transfer !== undefined;
  /** The refusal sits under what caused it: the amount when one is typed, the cars otherwise. */
  const underAmount = plan.mode === 'typed' && transferProblem !== null;
  const underCars = plan.mode !== 'typed' && transferProblem !== null;

  const create = useCreateAccident(isTransferRefusal);
  const update = useUpdateAccident(isTransferRefusal);
  const pending = create.isPending || update.isPending;
  const amounts = {
    companyCost: Number(companyCost),
    amountCollected: Number(amountCollected),
    paidAmount: Number(paidAmount),
  };
  const isAmount = (v: string): boolean => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  // Save stays pressable: pressing it with any of these empty — or an amount below zero, or a
  // transfer that cannot be made — names them and turns their boxes red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'vehicle', label: t('fleet.odometer.columns.vehicle'), ok: vehicleId !== '' },
      { key: 'occurredAt', label: t('fleet.accidents.fields.occurredAt'), ok: occurredAt !== '' },
      { key: 'culprit', label: t('fleet.accidents.fields.culprit'), ok: culprit.trim() !== '' },
      {
        key: 'statement',
        label: t('fleet.accidents.fields.statement'),
        ok: statement.trim() !== '',
      },
      {
        key: 'companyCost',
        label: t('fleet.accidents.fields.companyCost'),
        ok: isAmount(companyCost),
      },
      {
        key: 'amountCollected',
        label: t('fleet.accidents.fields.amountCollected'),
        ok: isAmount(amountCollected),
      },
      {
        key: 'paidAmount',
        label: t('fleet.accidents.fields.paidAmount'),
        ok: isAmount(paidAmount),
      },
      // A transfer that cannot be made as it stands: refused, with its reason under the field.
      {
        key: 'transfer',
        label:
          plan.mode === 'typed'
            ? t('fleet.accidents.transfer.amount')
            : t('fleet.accidents.transfer.fromVehicle'),
        ok: transferOk,
      },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    setServerRefusal(null);
    try {
      if (accident === null) {
        await create.mutateAsync({
          vehicleId,
          occurredAt: new Date(occurredAt),
          culprit: culprit.trim(),
          culpritEmployeeId: culpritEmployeeIds[0] ?? null,
          culpritEmployeeIds,
          statement: statement.trim(),
          ...amounts,
          notes: notes.trim() === '' ? null : notes.trim(),
          ...(transfer === undefined ? {} : { transfer }),
        });
        toast.success(t('fleet.accidents.created'));
      } else {
        // Send only what changed, plus the version the edit was made against.
        const body: UpdateFleetAccident = { version: accident.version };
        if (vehicleId !== accident.vehicleId) body.vehicleId = vehicleId;
        if (occurredAt !== (accident.occurredAt?.slice(0, 10) ?? ''))
          body.occurredAt = new Date(occurredAt);
        if (culprit.trim() !== accident.culprit) body.culprit = culprit.trim();
        // The whole list when it changed — cleared to none, one, or several.
        if (culpritEmployeeIds.join(',') !== accident.culpritEmployeeIds.join(',')) {
          body.culpritEmployeeIds = culpritEmployeeIds;
        }
        if (statement.trim() !== accident.statement) body.statement = statement.trim();
        if (amounts.companyCost !== accident.companyCost) body.companyCost = amounts.companyCost;
        if (amounts.amountCollected !== accident.amountCollected)
          body.amountCollected = amounts.amountCollected;
        if (amounts.paidAmount !== accident.paidAmount) body.paidAmount = amounts.paidAmount;
        const nextNotes = notes.trim() === '' ? null : notes.trim();
        if (nextNotes !== accident.notes) body.notes = nextNotes;
        // ONE MORE transfer onto this file; the ones it already has stay.
        if (transfer !== undefined) body.transfer = transfer;
        await update.mutateAsync({ id: accident.id, body });
        toast.success(t('fleet.accidents.updated'));
      }
    } catch (error) {
      // A refused transfer is worded here, with its figures; anything else was already toasted by
      // the mutation (`toastUnlessSaid`). Either way the form stays open with what was typed.
      const refusal = transferRefusalOf(error, t, money, locale);
      if (refusal !== null) {
        setServerRefusal(refusal);
        setRefusals((n) => n + 1);
      }
      return;
    }
    onClose();
  };

  // The accident's remaining: red while it owes, green while it holds something, plain at 0.
  const remainingTone =
    targetBefore < 0 ? TONE.owing : targetBefore > 0 ? TONE.settled : TONE.plain;

  // A refused transfer is not a missing one: the banner gives its reason, not «أدخل».
  const refusedSave =
    transferProblem !== null && (required.isMissing('transfer') || serverRefusal !== null);
  const transferLabel =
    plan.mode === 'typed'
      ? t('fleet.accidents.transfer.amount')
      : t('fleet.accidents.transfer.fromVehicle');

  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={accident === null ? t('fleet.accidents.record') : t('fleet.accidents.edit')}
      subtitle={t('fleet.accidents.formHint')}
      icon={PATH.warn}
      width="3xl"
      panelProps={{ 'data-accident-form': accident === null ? 'new' : 'edit' }}
      footer={
        <>
          <DesignSave data-accident-save="true" busy={pending} onClick={required.guard(submit)} />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      {refusedSave && transferProblem !== null ? (
        <RefusedBanner
          missing={required.missing.filter((field) => field.key !== 'transfer')}
          refused={t('fleet.accidents.refusedLine', {
            field: transferLabel,
            reason: transferProblem,
          })}
          attempt={required.attempt + refusals}
        />
      ) : (
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      )}

      {/* ── بيانات الحادث ─────────────────────────────────────────────────────────────────── */}
      <DesignSection
        title={t('fleet.accidents.form.sections.incident')}
        icon={PATH.truck}
        className={ALERT_TONE}
      >
        <div className={GRID}>
          {/* «عاوز اكتب» and «كل العربيات تظهر لما ادوس على كود السياره» — typed or picked, from
              every car in the registry, disposed ones included: an accident is a historical fact. */}
          <DesignField
            label={t('fleet.odometer.columns.vehicle')}
            required
            missing={required.isMissing('vehicle')}
            hint={t('fleet.accidents.vehicleHint')}
          >
            <div className={carBox(required.isMissing('vehicle'))}>
              <VehicleCodeCombobox
                value={vehicleId}
                onChange={edited(setVehicleId)}
                anyStatus
                ariaLabel={t('fleet.odometer.columns.vehicle')}
                placeholder={t('fleet.accidents.vehiclePlaceholder')}
                testId="accident-vehicle"
              />
            </div>
          </DesignField>
          <DesignField
            label={t('fleet.accidents.fields.occurredAt')}
            required
            missing={required.isMissing('occurredAt')}
            datePicker
          >
            <Input
              type="date"
              dir="ltr"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              tone={dateBox}
            />
          </DesignField>
        </div>
        {/* ONE field: «المتسبب», and it is the drivers list. Picking somebody writes their NAME
            into the record as well as their id — the name is what the board, the export and the
            print-out show, and it is the historical fact: a driver renamed next year did not
            change who caused this accident. The id is what makes «every accident سائق X caused» an
            exact question instead of a substring search that matches two people sharing a first
            name. */}
        <DesignField
          label={t('fleet.accidents.fields.culprit')}
          required
          missing={required.isMissing('culprit')}
          // Save refuses until the NAME is in hand, so while it is on its way the form says so
          // rather than leaving a refused press with no reason.
          {...(awaitingNameFor === '' ? {} : { hint: t('fleet.accidents.culpritNameLoading') })}
        >
          <div className={pickerBox(required.isMissing('culprit'))}>
            <RegistryDriverPicker
              value={culpritEmployeeIds}
              multiple
              onChange={(next) => {
                setCulpritEmployeeIds(next);
                // Clearing every driver clears the name with them; picking asks for the names and
                // the effect above writes them the moment the roster answers.
                if (next.length === 0) {
                  setCulprit('');
                  setAwaitingNameFor('');
                  return;
                }
                const known = namesOf(next);
                if (known === undefined) setAwaitingNameFor(next.join(','));
                else {
                  setCulprit(known);
                  setAwaitingNameFor('');
                }
              }}
              fullWidth
              className="w-full"
            />
          </div>
        </DesignField>
        <DesignField
          label={t('fleet.accidents.fields.statement')}
          required
          missing={required.isMissing('statement')}
        >
          <Textarea
            rows={3}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className={notesBox}
          />
        </DesignField>
      </DesignSection>

      {/* ── المبالغ ───────────────────────────────────────────────────────────────────────── */}
      <DesignSection
        title={t('fleet.accidents.form.sections.amounts')}
        icon={CASH}
        className={ALERT_TONE}
      >
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-3">
          <DesignField
            label={t('fleet.accidents.fields.companyCost')}
            required
            missing={required.isMissing('companyCost')}
          >
            <MoneyInput value={companyCost} onChange={edited(setCompanyCost)} tone={AMOUNT_BOX} />
          </DesignField>
          <DesignField
            label={t('fleet.accidents.fields.amountCollected')}
            required
            missing={required.isMissing('amountCollected')}
          >
            <MoneyInput
              value={amountCollected}
              onChange={edited(setAmountCollected)}
              tone={AMOUNT_BOX}
            />
          </DesignField>
          <DesignField
            label={t('fleet.accidents.fields.paidAmount')}
            required
            missing={required.isMissing('paidAmount')}
          >
            <MoneyInput value={paidAmount} onChange={edited(setPaidAmount)} tone={AMOUNT_BOX} />
          </DesignField>
        </div>
        {/* Shown, never typed: the contract's own formula over the three boxes above, plus what
            this file already took from and gave to other cars. */}
        <div
          data-accident-remaining={String(targetBefore)}
          aria-readonly="true"
          className={cn(
            'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-2 px-4 py-3',
            remainingTone,
          )}
        >
          <span className="min-w-0">
            <span className="block text-[15px] font-bold">
              {t('fleet.accidents.form.remaining')}
            </span>
            <span className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {t('fleet.accidents.transfer.amountAuto')}
            </span>
          </span>
          <Money value={targetBefore} className="text-xl font-black" />
        </div>
      </DesignSection>

      {/* ── أخذ مبلغ من متبقي سيارة أخرى (اختياري) ───────────────────────────────────────── */}
      <DesignSection
        title={t('fleet.accidents.transfer.title')}
        icon={ARROWS}
        className={ALERT_TONE}
      >
        <div
          data-accident-transfer="true"
          data-transfer-ok={String(transferOk)}
          className="space-y-5"
        >
          {/* The hints and refusals under the two boxes wrap into even lines, never one orphan word. */}
          <div
            className={cn(GRID, '[&>div>p]:[text-wrap:balance] [&>div>div>p]:[text-wrap:balance]')}
          >
            <DesignField
              label={t('fleet.accidents.transfer.fromVehicle')}
              missing={underCars || (required.isMissing('transfer') && plan.mode !== 'typed')}
              hint={
                balances.isError
                  ? t('fleet.accidents.transfer.loadFailed')
                  : t('fleet.accidents.transfer.pickOrder')
              }
              endAdornment={null}
              {...(underCars && transferProblem !== null ? { error: transferProblem } : {})}
            >
              <div className={pickerBox(underCars)} data-transfer-picker="true">
                <MultiSelect
                  clearable
                  showSelectedValues
                  // Every pick named, in pick order.
                  summaryMax={Math.max(offered.length, 1)}
                  label={t('fleet.accidents.transfer.fromVehicle')}
                  placeholder={t('common.select')}
                  options={offered.map((car) => {
                    const source = sourceOf.get(car.vehicleId);
                    return {
                      value: car.vehicleId,
                      label: `${car.vehicleCode} — ${money(car.remaining)}`,
                      shortLabel: car.vehicleCode,
                      ...(source === undefined ? {} : { tag: <SourceTag source={source} /> }),
                    };
                  })}
                  value={ticked}
                  onChange={pick}
                  onClear={clearAll}
                  // As wide as the box: a code, its remaining and its tag on one line.
                  panelWidth="w-full"
                  fullWidth
                  className="w-full"
                />
              </div>
            </DesignField>
            <div className="space-y-3">
              <DesignField
                label={t('fleet.accidents.transfer.amount')}
                missing={underAmount || (required.isMissing('transfer') && plan.mode === 'typed')}
                // While he has picked no car an empty box takes nothing: «اتركه فارغاً» would be
                // untrue.
                hint={
                  mine.length > 0
                    ? t('fleet.accidents.transfer.amountHint')
                    : t('fleet.accidents.transfer.amountHintNoPick')
                }
                {...(underAmount && transferProblem !== null ? { error: transferProblem } : {})}
              >
                <MoneyInput
                  value={typed}
                  onChange={edited(setTyped)}
                  tone={REFUSABLE_AMOUNT_BOX}
                  aria-label={t('fleet.accidents.transfer.amount')}
                  data-transfer-amount="true"
                  // Left empty while the whole negative is covered: what is being taken, in grey —
                  // a figure shown, not a value written into the box.
                  {...(plan.mode === 'whole' && planProblem === null && plan.amount > 0
                    ? {
                        placeholder: t('fleet.accidents.transfer.amountWorkedOut', {
                          amount: figure(plan.amount),
                        }),
                      }
                    : {})}
                />
              </DesignField>
              {/* «او انت تلقائى اعرف المبلغ اللى بالسالب كام وشيله» — one press puts the whole
                  negative in the amount; offered only while nothing is picked or typed. */}
              {plan.offerCoverAll && planProblem === null && (
                <button
                  type="button"
                  data-transfer-cover-all="true"
                  onClick={coverAll}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-3.5 py-2 text-[14px] font-bold text-indigo-700 transition-colors hover:bg-indigo-100',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                    'dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20',
                  )}
                >
                  <Glyph d={BOLT} className="h-4 w-4" />
                  <span>{t('fleet.accidents.transfer.coverAll')}</span>
                  <span className="text-indigo-400 dark:text-indigo-400/70">·</span>
                  <Money value={-targetBefore} className="text-[14px] font-black" />
                </button>
              )}
            </div>
          </div>

          {plan.rows.length > 0 && planProblem === null && <TransferPlanView plan={plan} />}
        </div>
      </DesignSection>

      <DesignField label={t('fleet.attendance.fields.notes')}>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={notesBox}
        />
      </DesignField>
    </DesignDialog>
  );
};
