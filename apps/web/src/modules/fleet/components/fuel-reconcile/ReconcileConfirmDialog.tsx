// «تأكيد» before a bulk ✓ / ✗ on «مطابقة أرصدة الكروت» (owner decision: bulk asks first; a single
// row's ✓ / ✗ stays one click). The fleet's own dialog (`DesignDialog`, the shell «سجل الكارت» and
// «تأكيد التحويل» wear): what will happen in one sentence with the count, the selection's totals —
// now, the net difference, after — and the list, «name · system ← sheet», in Latin figures. The
// approved batch-2 sample (b2-cards-confirm-apply / -reject), class for class.
//
// 6a (plan §8, M16/M17/M23) adds, for a ✓: the sheet's date, then per card «شحن لا يظهر في الشيت»
// (the charges the sheet does not show, a checklist pre-ticked when the amount is exactly what the
// sheet is short; charges after the sheet's date listed apart, never pre-ticked, with the warning
// «في سجل الكارت حركات بعد تاريخ الشيت») and, when the sheet is higher by exactly the pending «طلب
// رصيد», the choice «اعتماد طلب الرصيد» / «تسوية فقط». A row with either asks here first, even a
// single row's ✓. Those pieces are in `reconcile-confirm-parts.tsx`; on a phone the list stacks.
import {
  type FleetFuelCardCompany,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileLineDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Spinner } from '../../../../shared/ui/Spinner';
import { DesignCancel, DesignDialog } from '../DesignDialog';
import { MONO } from '../FuelCardDialog';
import { CompanyBadge, NUM } from '../FuelCardBoard';
import { CodeChip } from '../custody-memo-parts';
import {
  confirmTotalsOf,
  laterCharges,
  markedTooMuch,
  money,
  preTickedCharges,
  requestMatches,
  signed,
  unseenCharges,
  type LineChoices,
  type RequestChoice,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { FileName } from './reconcile-cells';
import {
  Block,
  CardTag,
  MovedAfterWarning,
  RequestChoiceBox,
  SheetDateLine,
  UnseenCharges,
} from './reconcile-confirm-parts';

/** The check in a circle (✓) and the cross in a circle (✗) — the header's tile. */
const APPLY_ICON = ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'm8 12 3 3 5-6'];
const REJECT_ICON = ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'm15 9-6 6', 'm9 9 6 6'];

const TONE = {
  apply: {
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]',
    ink: 'text-emerald-800 dark:text-emerald-300',
    sign: 'bg-emerald-600 text-white dark:bg-emerald-500',
    button:
      'bg-emerald-600 hover:bg-emerald-500 shadow-[0_6px_22px_rgba(16,185,129,0.40)] dark:bg-emerald-500 dark:hover:bg-emerald-400',
  },
  reject: {
    box: 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/[0.08]',
    ink: 'text-red-800 dark:text-red-300',
    sign: 'bg-slate-700 text-white dark:bg-slate-600',
    button:
      'bg-red-600 hover:bg-red-500 shadow-[0_6px_22px_rgba(220,38,38,0.40)] dark:bg-red-500 dark:hover:bg-red-400',
  },
} as const;

/** One figure of the sum — `FundResult`'s cell, with this dialog's words. */
const Cell = ({
  label,
  value,
  sign = false,
  strong = false,
  tone,
  mark,
}: {
  label: string;
  value: number;
  sign?: boolean;
  strong?: boolean;
  tone: FleetFuelReconcileDecision;
  mark: string;
}): JSX.Element => (
  <div
    data-recon-confirm-cell={mark}
    className={cn(
      'min-w-0 flex-1 rounded-lg border px-3 py-2 text-center',
      strong
        ? cn('border-transparent', TONE[tone].sign)
        : 'border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#0a1233]',
    )}
  >
    <span
      className={cn(
        'block text-xs font-bold',
        strong ? 'text-white/85' : 'text-slate-500 dark:text-slate-400',
      )}
    >
      {label}
    </span>
    <span
      dir="ltr"
      className={cn(
        MONO,
        'text-base font-bold',
        strong
          ? 'text-white'
          : sign && value > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : sign && value < 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-slate-900 dark:text-white',
      )}
    >
      {sign ? signed(value) : money(value)}
    </span>
  </div>
);

const Op = ({ text, tone }: { text: string; tone: FleetFuelReconcileDecision }): JSX.Element => (
  <span
    aria-hidden="true"
    className={cn('shrink-0 text-center text-xl font-black leading-none', TONE[tone].ink)}
  >
    {text}
  </span>
);

const STRUCK = 'text-slate-400 line-through decoration-2 dark:text-slate-500';

export const ReconcileConfirmDialog = ({
  decision,
  lines,
  company,
  fileName,
  busy,
  onConfirm,
  onClose,
  sheetDate,
  choiceOf,
  onToggleCharge,
  onRequest,
}: {
  /** The bulk decision asked about; `null` = closed. */
  decision: FleetFuelReconcileDecision | null;
  /** The ticked lines — what the decision would send. */
  lines: readonly FleetFuelReconcileLineDto[];
  company: FleetFuelCardCompany;
  fileName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** M23 — the session's `sheetDate`. */
  sheetDate: string | null;
  /** A card's choices (lower-case id): the charges ticked to cancel, and the request answer. */
  choiceOf: (line: FleetFuelReconcileLineDto) => LineChoices;
  onToggleCharge: (cardId: string, chargeId: string, on: boolean) => void;
  onRequest: (cardId: string, choice: RequestChoice) => void;
}): JSX.Element | null => {
  const t = useT();
  const count = useReconcileCount();
  if (decision === null) return null;
  const tone = decision;
  const applying = decision === 'apply';
  const { now, net, after } = confirmTotalsOf(lines);
  const currency = t('fleet.fuelCards.board.kpi.currency');
  /** «+28,657.54 ج.م» — the figure in Latin digits, the currency after it. */
  const amount = (text: string): JSX.Element => (
    <>
      <b dir="ltr" className={MONO}>
        {text}
      </b>{' '}
      {currency}
    </>
  );
  // The sentence over the figures, its two amounts in bold: the template is split where they go.
  const [lineBefore = '', lineMiddle = '', lineAfter = ''] = t(
    applying
      ? 'fleet.fuelCards.reconcile.confirm.applyLine'
      : 'fleet.fuelCards.reconcile.confirm.rejectLine',
  ).split(/\{\{\w+\}\}/u);
  const colDiff = t('fleet.fuelCards.reconcile.colDiff');
  // 6a: only a ✓ asks about charges and requests; a ✗ moves nothing.
  const withCharges = applying ? lines.filter((line) => unseenCharges(line).length > 0) : [];
  const withRequest = applying ? lines.filter(requestMatches) : [];
  const movedAfter = withCharges.filter((line) => laterCharges(line).length > 0);
  // More ticked than the sheet takes off a card: the server would refuse it — fix the ticks first.
  const overMarked = withCharges.some((line) => markedTooMuch(line, choiceOf(line)));
  const R = 'fleet.fuelCards.reconcile.';

  return (
    <DesignDialog
      open
      onClose={onClose}
      width="3xl"
      icon={applying ? APPLY_ICON : REJECT_ICON}
      title={
        applying
          ? t('fleet.fuelCards.reconcile.confirm.applyTitle')
          : t('fleet.fuelCards.reconcile.confirm.rejectTitle')
      }
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          {t(`fleet.fuelCards.company.${company}`)} ·
          {/* The file's name in order — its date as he wrote it. */}
          <FileName name={fileName} className="font-semibold" />
        </span>
      }
      panelProps={{ 'data-recon-confirm': decision }}
      footer={
        <>
          <button
            type="button"
            data-recon-confirm-go={decision}
            disabled={busy || overMarked}
            onClick={onConfirm}
            className={cn(
              'flex items-center gap-2 rounded-xl px-8 py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60',
              TONE[tone].button,
            )}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {applying
              ? t('fleet.fuelCards.reconcile.confirm.apply')
              : t('fleet.fuelCards.reconcile.confirm.reject')}
          </button>
          <DesignCancel onClick={onClose} label={t('fleet.fuelCards.history.back')} />
        </>
      }
    >
      <p
        className="text-[15px] font-semibold leading-relaxed text-slate-800 dark:text-slate-100"
        data-recon-confirm-body="true"
      >
        {t(
          applying
            ? 'fleet.fuelCards.reconcile.confirm.applyBody'
            : 'fleet.fuelCards.reconcile.confirm.rejectBody',
          { cards: count.cardsOf(lines.length) },
        )}
      </p>
      {applying && <SheetDateLine sheetDate={sheetDate} fileName={fileName} />}
      {movedAfter.length > 0 && sheetDate !== null && (
        <MovedAfterWarning lines={movedAfter} sheetDate={sheetDate} />
      )}

      {/* The selection's totals — now, the net difference, after. */}
      <div
        className={cn('space-y-3 rounded-xl border-2 px-4 py-3', TONE[tone].box)}
        data-recon-confirm-sum="true"
      >
        <p className={cn('text-[15px] font-bold', TONE[tone].ink)}>
          {lineBefore}
          {amount(applying ? signed(net) : money(now))}
          {lineMiddle}
          {applying && amount(money(after))}
          {lineAfter}
        </p>
        {applying ? (
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <Cell
              tone={tone}
              mark="now"
              label={t('fleet.fuelCards.reconcile.confirm.now')}
              value={now}
            />
            <Op tone={tone} text={net >= 0 ? '+' : '−'} />
            <Cell
              tone={tone}
              mark="net"
              label={t('fleet.fuelCards.reconcile.confirm.net')}
              value={net}
              sign
            />
            <Op tone={tone} text="=" />
            <Cell
              tone={tone}
              mark="after"
              label={t('fleet.fuelCards.reconcile.confirm.after')}
              value={after}
              strong
            />
          </div>
        ) : (
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <Cell
              tone={tone}
              mark="net"
              label={t('fleet.fuelCards.reconcile.confirm.netRejected')}
              value={net}
              sign
            />
            <Cell
              tone={tone}
              mark="stays"
              label={t('fleet.fuelCards.reconcile.confirm.stays')}
              value={now}
              strong
            />
          </div>
        )}
      </div>

      {/* The list — every card the decision touches. */}
      <section className="space-y-2.5" data-recon-confirm-list="true">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
          {t('fleet.fuelCards.reconcile.confirm.list')}
          <span className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {count.cards(lines.length)}
          </span>
        </h3>
        {/* A phone gets the list as stacked rows — the table would scroll sideways at 375. */}
        <ul
          className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white md:hidden dark:divide-[#1c293f] dark:border-[#2b3b6b] dark:bg-[#0a1233]/60"
          data-recon-confirm-phone-list="true"
        >
          {lines.map((line) => (
            <li key={line.card.id} className="space-y-1.5 px-3 py-2.5">
              <span className="flex flex-wrap items-center gap-2">
                <CompanyBadge company={line.card.company} />
                <span
                  dir="ltr"
                  className="whitespace-nowrap font-figures text-[14px] font-bold text-slate-900 dark:text-white"
                >
                  {line.card.name}
                </span>
                {line.card.vehicleCode !== null && <CodeChip code={line.card.vehicleCode} />}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span
                    dir="ltr"
                    className={cn(
                      NUM,
                      'text-[14px] font-bold',
                      applying ? STRUCK : 'text-slate-900 dark:text-white',
                    )}
                  >
                    {money(line.card.balance)}
                  </span>
                  <span aria-hidden className="text-slate-400">
                    ←
                  </span>
                  <span
                    dir="ltr"
                    className={cn(
                      NUM,
                      'text-[14px] font-bold',
                      applying ? 'text-emerald-700 dark:text-emerald-300' : STRUCK,
                    )}
                  >
                    {money(line.sheet.balance)}
                  </span>
                </span>
                <span
                  dir="ltr"
                  className={cn(
                    NUM,
                    'whitespace-nowrap text-[14px] font-black',
                    line.difference > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400',
                  )}
                >
                  {signed(line.difference)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="hidden max-h-80 overflow-y-auto rounded-xl border border-slate-200 md:block dark:border-[#2b3b6b]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-bold text-slate-600 dark:bg-[#0c1530] dark:text-slate-300">
              <tr>
                <th className="w-8 px-3 py-2 text-center">{t('fleet.violations.report.serial')}</th>
                <th className="px-3 py-2 text-start">{t('fleet.fuelCards.reconcile.colCard')}</th>
                <th className="px-3 py-2 text-center">
                  {t('fleet.fuelCards.reconcile.confirm.colSystemToSheet')}
                </th>
                <th className="px-3 py-2 text-center">{colDiff}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-[#1c293f] dark:bg-[#0a1233]/60">
              {lines.map((line, index) => (
                <tr key={line.card.id} data-recon-confirm-row={line.card.id}>
                  <td className="px-3 py-1.5 text-center">
                    <span dir="ltr" className={cn(NUM, 'text-xs text-slate-400')}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-start">
                    <span className="flex items-center gap-2">
                      <CompanyBadge company={line.card.company} />
                      <span
                        dir="ltr"
                        className="whitespace-nowrap font-figures text-[14px] font-bold text-slate-900 dark:text-white"
                      >
                        {line.card.name}
                      </span>
                      {line.card.vehicleCode !== null ? (
                        <CodeChip code={line.card.vehicleCode} />
                      ) : (
                        <span className="whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[12px] font-bold text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
                          {line.card.label ?? '—'}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span
                        dir="ltr"
                        className={cn(
                          NUM,
                          'text-[14px] font-bold',
                          applying ? STRUCK : 'text-slate-900 dark:text-white',
                        )}
                      >
                        {money(line.card.balance)}
                      </span>
                      <span aria-hidden className="text-slate-400">
                        ←
                      </span>
                      <span
                        dir="ltr"
                        className={cn(
                          NUM,
                          'text-[14px] font-bold',
                          applying ? 'text-emerald-700 dark:text-emerald-300' : STRUCK,
                        )}
                      >
                        {money(line.sheet.balance)}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span
                      dir="ltr"
                      className={cn(
                        NUM,
                        'whitespace-nowrap text-[14px] font-black',
                        line.difference > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400',
                        !applying && 'opacity-60',
                      )}
                    >
                      {signed(line.difference)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {withCharges.length > 0 && (
        <Block mark="unseen" tone="violet" title={t(`${R}unseenTitle`)} note={t(`${R}unseenNote`)}>
          {withCharges.map((line) => (
            <div key={line.card.id} className="space-y-2.5">
              {lines.length > 1 && <CardTag line={line} />}
              <UnseenCharges
                line={line}
                choice={choiceOf(line)}
                preTicked={new Set(preTickedCharges(line))}
                sheetDate={sheetDate}
                onToggle={(id, on) => onToggleCharge(line.card.id.toLowerCase(), id, on)}
              />
            </div>
          ))}
        </Block>
      )}
      {withRequest.length > 0 && (
        <Block
          mark="request"
          tone="amber"
          title={t(`${R}requestTitle`)}
          note={t(`${R}requestNote`)}
        >
          {withRequest.map((line) => (
            <div key={line.card.id} className="space-y-2.5">
              {lines.length > 1 && <CardTag line={line} />}
              <RequestChoiceBox
                line={line}
                choice={choiceOf(line).request ?? 'approve'}
                onChoice={(choice) => onRequest(line.card.id.toLowerCase(), choice)}
              />
            </div>
          ))}
        </Block>
      )}
    </DesignDialog>
  );
};
