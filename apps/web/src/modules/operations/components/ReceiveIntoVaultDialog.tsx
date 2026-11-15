// «إستلام محصنة» — Round 18: «عاوز اخلى الفورم دا لما اجى استلم محصنة», the legacy vault receive form
// (receive_mohsana.ejs) in the app's look. Opened from the vault's ✓ on «استلام الخزينة».
//
// THREE BANDS, as legacy drew them:
//
//   1. THE SHIPMENT'S DATA, prefilled from the row and EDITABLE — «تعدّلها عادي». The very boxes and
//      rules of the shipment form (`ShipmentDraftFields` — bank → branch with the inline add, the
//      area from the TO branch, the money lines in the catalog's order, the dates' floors), so the
//      two forms cannot disagree about a valid shipment. Only what CHANGED is sent (`shipmentPatch`);
//      the server applies it in the receipt's own transaction and «السجل» shows it as an edit by the
//      receiver. The captain and the van are SHOWN, not edited: re-crewing a shipment moves a stop
//      between captains' days, which is the crew screens' act (the shipment form's rule), and the
//      contract's correction carries no crew. «سيريال» is the receipt's own: «بتتعرف عند الاستلام
//      اذا كان سيريال او لا» — the vault decides it here.
//   2. THE RECEIPT: «عدد الورق من كل فئة» on a row of its own, OVER the rest — Round 18b, «خلى الفئات
//      لوحدها كدا فوق رقم الايصال والكلام دا», as legacy drew it — a count under each pound
//      denomination, 0.25 … 200, with what they come to beside the shipment's pound amount and a
//      gentle word when the two differ; then «رقم الإيصال», «عدد الحقائب» with its «2×»/«3×», «عدد
//      الصناديق», «عدد الكراتين» — the cartons a plain count: «والكراتين اقدر اكتب رقم بس ملهاش سيريال
//      ولا الكلام دا رقم عادى», no seal box drawn for them.
//   3. THE SEALS: «باركود الحقائب» (bags × the radio) and «باركود الصناديق» (two per box) — one box
//      per seal, growing and shrinking with the counts without losing what was typed, each list
//      under its legacy summary line («[1 - 4]», «[6 - 8] - [10 - 11] - 13», the lone ones red). A
//      barcode scanner types the number and sends Enter: Enter moves to the next box. Round 18b:
//      the first and the last box hold numbers → the boxes between take the numbers between, in
//      order («يملى اللى ف النص بالترتيب بينهم»; the rules are `fillSealRange`'s). Round 21: «مينفعش
//      يكون فيه رقم للحقائب و الصناديق زى بعض برضو» — a seal is named ONCE in the receipt, bags and
//      boxes together: every box holding a repeat is red, one notice under the seals says which
//      numbers and where, and «استلام» waits until they are corrected (`sealRepeats`).
//
// «انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله اختيارى»: NO NAMES — the two
// treasurers (Q2's dual control) are gone, with «يجب أن يستلم كل شحنة شخصان مختلفان»; the receiver
// is the signed-in user, recorded by the server from the token and never sent. And NOTHING of the
// receipt is required, its number included. No box carries the rose star either — not even the
// shipment's own: they arrive filled in, and the vault only corrects them. What the vault cannot do
// is EMPTY one the stored shipment must keep (its banks, branches, days, a money line): that box is
// said, as the shipment form says it, and nothing is sent.
//
// «إيصال» PRINTS the vault's receipt on the company's report form (`vault-receipt-print.ts`) —
// before «استلام» as a draft («مسودة»), and after it with the receiver and the time the server
// answered. After «استلام» the form stays open, locked, so the receipt can be printed at once.
//
// A refusal is said where the server's code allows (`receiveRefusal`): a branch, a bank, a
// currency, a date under its box, in the shipment form's words; the rest as a toast. One that says
// this shipment can no longer be received from here (someone received it meanwhile, or it is
// locked) closes the form over a board that re-reads.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_VAULT_BAG_SEALS_PER_BAG,
  OPERATIONS_VAULT_DENOMINATIONS,
  type OperationsDayBoardShipmentDto,
  type OperationsVaultBagSealsPerBag,
  type OperationsVaultReceiptDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatAmount, formatBusinessDateTime, fullName } from '../../../shared/lib/format';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { DesignField, LOOK, MONO, Stroke, boxTone } from '../../fleet/components/FuelCardDialog';
import { printFleetReport } from '../../fleet/lib/fleet-report-print';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useReceiveIntoVault,
} from '../api/operations-queries';
import { currencyKind } from '../lib/day-board';
import { SHIPMENT_DATE_PROBLEM_KEY, secondaryBankFor } from '../lib/shipment-form';
import { cairoToday } from '../lib/shipment-history';
import {
  BOX_SEALS_PER_BOX,
  NO_SEAL_LIST,
  denominationCheck,
  denominationLabel,
  denominationLines,
  denominationsTotal,
  draftSlots,
  fillSealRange,
  parseCount,
  poundAmount,
  receiveRefusal,
  receiveRequest,
  sealPartText,
  sealRangeNote,
  sealRepeatNotice,
  sealRepeatTitle,
  sealRepeats,
  sealSummary,
  sealsToSend,
  shipmentPatch,
  shownSeals,
  typeSeal,
  type ReceiptDraft,
  type ReceiveField,
  type SealList,
  type ShipmentDraftValues,
} from '../lib/vault-receipt';
import { vaultReceiptReport } from '../lib/vault-receipt-print';
import {
  AddLineButton,
  AreaBox,
  CollectionDateField,
  DeliveryDateField,
  DraftBranchCreate,
  DraftBranchSide,
  MainBankField,
  MoneyLines,
  NotesField,
  hasUsableLine,
  toShipmentLines,
  useShipmentDraft,
} from './ShipmentDraftFields';
import { SHIPMENT_PATH } from './shipment-icons';

const NO_COUNTS: readonly string[] = OPERATIONS_VAULT_DENOMINATIONS.map(() => '');

/**
 * A band of the form — legacy's three white blocks, in the dialog's own panels. No heading of its
 * own, as legacy had none: its boxes' labels say what it holds, and the height a heading would take
 * is what keeps the whole form on a laptop screen without a scroll. Round 18b's row of notes, alone
 * over the receipt's fields, is paid for by tighter bands (py-3, 10px between rows): the form still
 * fits 1440 × 900, its seals filled.
 */
const Band = ({
  children,
  ...rest
}: { children: ReactNode } & Record<`data-${string}`, string>): JSX.Element => (
  <section
    {...rest}
    className="space-y-2.5 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 dark:border-[#2b3b6b] dark:bg-[#0f1838]/40"
  >
    {children}
  </section>
);

/** A read-only box — the crew the shipment rides with, set on the crew screens. */
const HeldBox = ({
  label,
  value,
  hint,
  mono = false,
  ...rest
}: {
  label: string;
  value: string;
  hint: string;
  mono?: boolean;
} & Record<`data-${string}`, string>): JSX.Element => (
  <div className="space-y-2" title={hint}>
    <span className="block text-[15px] font-bold text-slate-900 dark:text-white">{label}</span>
    <div
      {...rest}
      role="textbox"
      aria-readonly="true"
      tabIndex={0}
      aria-label={label}
      aria-description={hint}
      className={cn(
        'flex min-h-[3.125rem] items-center truncate rounded-xl border border-dashed px-4 text-[15px] font-medium',
        'border-slate-300 bg-slate-100/70 text-slate-900 dark:border-[#2b3b6b] dark:bg-[#0a1233]/50 dark:text-white',
        mono && MONO,
      )}
    >
      {value === '' ? <span className="text-slate-400 dark:text-slate-500">—</span> : value}
    </div>
  </div>
);

/**
 * The summary line over a list of seals, as legacy wrote it — a run bracketed, a lone seal RED.
 * Written right to left on an Arabic page as legacy's was: «[6 - 8] - [10 - 11] - 13». A seal typed
 * twice is listed once here; since Round 21 the repeat is a refusal, said ONCE for the whole
 * receipt under the seals (`SealRepeatNotice`) — no longer an amber «مكرر» beside each list.
 */
export const SealSummaryLine = ({ seals }: { seals: readonly string[] }): JSX.Element | null => {
  const summary = sealSummary(seals);
  if (summary.parts.length === 0) return null;
  return (
    <span
      data-seal-summary="true"
      className={cn('inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[15px]', MONO)}
    >
      {summary.parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-slate-400 dark:text-slate-500">-</span>}
          <span
            data-seal-part={part.kind}
            className={cn(
              'font-bold',
              part.kind === 'single'
                ? 'text-rose-600 dark:text-rose-400'
                : part.kind === 'run'
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300',
            )}
          >
            {sealPartText(part)}
          </span>
        </Fragment>
      ))}
    </span>
  );
};

/**
 * Round 21 — the ONE notice under the seals: which numbers repeat and where («الرقم 1 مكرر — في
 * الحقائب والصناديق»), and the rule it breaks. Red, as the boxes it explains; announced as it
 * appears, so a scanner's operator hears it too. `id` is what «استلام» points at for its reason.
 */
export const SealRepeatNotice = ({ id, text }: { id: string; text: string }): JSX.Element => {
  const t = useT();
  const at = useRef<HTMLDivElement>(null);
  // It appears under the last seal box, where the form may end below the fold (1440 × 900 with
  // both lists filled): brought into view once, as it appears — the least scroll that shows it,
  // never again while it stays, so a scanner's typing is not moved about. A block body on purpose:
  // a browser whose `scrollIntoView` hands back a value would have React call it as the cleanup.
  useEffect(() => {
    at.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div
      ref={at}
      id={id}
      role="alert"
      data-seal-repeat="true"
      className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-[13px] dark:border-rose-500/50 dark:bg-rose-500/10"
    >
      {/* The triangle stays beside the words at every width; the words wrap on a phone. */}
      <Stroke
        d={[...SHIPMENT_PATH.alert]}
        className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
      />
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-bold text-rose-800 dark:text-rose-200">{text}</span>
        <span className="font-medium text-rose-700/90 dark:text-rose-300/90">
          {t('operations.secured.receive.sealRepeatRule')}
        </span>
      </p>
    </div>
  );
};

/**
 * A scanner types the number and sends Enter: the next seal box takes the focus (its text selected,
 * so a box already filled is overwritten, not appended to). The last box keeps it — the next Enter
 * must not be a click on «استلام».
 */
const toNextSeal = (current: HTMLInputElement): void => {
  const all = Array.from(
    current
      .closest('[data-receive-seals]')
      ?.querySelectorAll<HTMLInputElement>('input[data-seal-input]') ?? [],
  );
  const next = all[all.indexOf(current) + 1];
  if (next !== undefined) {
    next.focus();
    next.select();
  }
};

/**
 * One list of seal boxes — bags or boxes — under its summary line. A box the range fill wrote
 * (`list.filled`) is tinted, so what the form wrote is told apart from what was scanned. When the
 * two ends are numbers whose run does not fit the boxes, the bar says so beside the summary line it
 * explains — and under the title when the line is too narrow for both — so a wide screen spends no
 * height on it and the form keeps to 1440 × 900.
 */
export const SealBoxes = ({
  kind,
  title,
  hint,
  list,
  slots,
  perUnit,
  repeated = [],
  onChange,
}: {
  kind: 'bag' | 'box';
  title: string;
  /** A word at the heading's far end — how a scanner moves on, said once. */
  hint?: string;
  list: SealList;
  slots: number;
  perUnit: number;
  /**
   * Round 21 — per box on screen, where else in the receipt its seal is (`sealRepeatTitle`); null
   * (or nothing) for a box whose seal is its own. A box with a word here is drawn red.
   */
  repeated?: readonly (string | null)[];
  onChange: (index: number, value: string) => void;
}): JSX.Element => {
  const t = useT();
  const shown = shownSeals(list, slots);
  const note = sealRangeNote(list, slots);
  return (
    <div data-seal-list={kind} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 pb-1 dark:border-[#2b3b6b]/60">
        <span className="inline-flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
          <Stroke
            d={[...SHIPMENT_PATH.barcode]}
            className="h-4 w-4 text-indigo-500 dark:text-indigo-400"
          />
          {title}
        </span>
        <SealSummaryLine seals={sealsToSend(list.seals, slots)} />
        {note.kind === 'mismatch' && (
          <span
            role="status"
            data-seal-range="mismatch"
            className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          >
            {t('operations.secured.receive.rangeMismatch', {
              from: note.from,
              to: note.to,
              boxes: note.boxes,
            })}
          </span>
        )}
        {hint !== undefined && (
          <span className="ms-auto text-[12px] font-medium text-slate-500 dark:text-slate-400">
            {hint}
          </span>
        )}
      </div>
      {slots === 0 ? (
        <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
          {t('operations.secured.receive.sealsEmpty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
          {shown.map((value, index) => {
            const label = t(
              kind === 'bag'
                ? 'operations.secured.receive.bagSealInput'
                : 'operations.secured.receive.boxSealInput',
              { unit: Math.floor(index / perUnit) + 1, seal: (index % perUnit) + 1 },
            );
            const filled = list.filled[index] === true;
            // A repeat is the box's problem whoever wrote it — the range fill's number too: red
            // wins over the fill's tint, and the title says where else the seal is.
            const repeat = repeated[index] ?? null;
            return (
              <input
                // A box is a POSITION (legacy's): its index is its identity.
                key={index}
                type="text"
                dir="ltr"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => onChange(index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  toNextSeal(e.currentTarget);
                }}
                data-seal-input={kind}
                data-seal-filled={filled ? 'true' : undefined}
                data-seal-repeat={repeat === null ? undefined : 'true'}
                aria-invalid={repeat === null ? undefined : true}
                aria-label={label}
                title={[
                  label,
                  ...(filled ? [t('operations.secured.receive.sealFilled')] : []),
                  ...(repeat === null ? [] : [repeat]),
                ].join(' — ')}
                className={cn(
                  'h-9 w-full rounded-lg border px-2 text-center text-[15px] font-semibold shadow-inner transition-colors',
                  repeat !== null
                    ? 'border-2 border-rose-500 bg-rose-50 text-rose-800 focus:border-rose-600 focus:ring-rose-500 dark:border-rose-400 dark:bg-rose-500/15 dark:text-rose-100'
                    : filled
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-800 focus:border-indigo-500 focus:ring-indigo-500 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-200'
                      : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-white',
                  'focus:outline-none focus:ring-1',
                  MONO,
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * «استلام» — legacy's dark red button. HELD while a seal is named twice in the receipt (Round 21):
 * `blocked` is the notice's own words, said again as its title, and the button points at the
 * notice (`describedBy`) — a refusal the server would answer anyway is not sent.
 */
export const ReceiveSaveButton = ({
  busy,
  blocked,
  describedBy,
  onClick,
}: {
  busy: boolean;
  /** Why «استلام» is held — the repeat notice's text; null when nothing holds it. */
  blocked: string | null;
  describedBy?: string;
  onClick: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-receive-save="true"
      data-receive-blocked={blocked === null ? undefined : 'seals'}
      aria-busy={busy}
      disabled={busy || blocked !== null}
      title={blocked ?? undefined}
      aria-describedby={blocked === null ? undefined : describedBy}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-xl px-8 py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
        // Legacy's «إستلام» was the form's dark red button; the design's gradient keeps
        // that colour, so the act reads as the one the vault answers for.
        'bg-gradient-to-r from-rose-800 to-red-700 shadow-[0_6px_24px_rgba(159,18,57,0.45)] hover:from-rose-700 hover:to-red-600',
      )}
    >
      {busy ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <Stroke d={[...SHIPMENT_PATH.check]} className="h-4 w-4" />
      )}
      <span>{t('operations.secured.receive.action')}</span>
    </button>
  );
};

export const ReceiveIntoVaultDialog = ({
  shipment,
  onClose,
}: {
  /** The row the vault's ✓ was pressed on — a board row, its branches and crew resolved. */
  shipment: OperationsDayBoardShipmentDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const receive = useReceiveIntoVault();
  const open = shipment !== null;

  // The board's own two catalog reads (same keys, so a cache hit): the vault's grant reads both.
  const banks = useOperationsBanks(
    { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' },
    open,
  );
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE }, open);
  const bankList = useMemo(() => banks.data?.items ?? [], [banks.data]);
  const currencyList = useMemo(() => currencies.data?.items ?? [], [currencies.data]);
  const draft = useShipmentDraft({
    open,
    shipment,
    createType: 'secured',
    banks: bankList,
    currencies: currencyList,
  });

  // ── The receipt, as typed ───────────────────────────────────────────────────────────────────────
  const [receiptNumber, setReceiptNumber] = useState('');
  const [bagCount, setBagCount] = useState('');
  const [boxCount, setBoxCount] = useState('');
  const [cartonCount, setCartonCount] = useState('');
  const [perBag, setPerBag] = useState<OperationsVaultBagSealsPerBag>(2);
  const [bagSeals, setBagSeals] = useState<SealList>(NO_SEAL_LIST);
  const [boxSeals, setBoxSeals] = useState<SealList>(NO_SEAL_LIST);
  const [counts, setCounts] = useState<readonly string[]>(NO_COUNTS);
  const [serialTracked, setSerialTracked] = useState(false);
  /** Save found a box of the shipment's data emptied. */
  const [tried, setTried] = useState(false);
  /** A server refusal said under its box. */
  const [refused, setRefused] = useState<{ field: ReceiveField; text: string } | null>(null);
  /** The receipt the server took — the form is locked from then on, and «إيصال» prints it. */
  const [taken, setTaken] = useState<OperationsVaultReceiptDto | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (shipment === null) return;
    setReceiptNumber('');
    setBagCount('');
    setBoxCount('');
    setCartonCount('');
    setPerBag(2);
    setBagSeals(NO_SEAL_LIST);
    setBoxSeals(NO_SEAL_LIST);
    setCounts(NO_COUNTS);
    // «سيريال» opens on what the shipment says; the vault decides it here.
    setSerialTracked(shipment.serialTracked);
    setTried(false);
    setRefused(null);
    setTaken(null);
  }, [shipment]);

  const receipt: ReceiptDraft = {
    receiptNumber,
    bagCount,
    boxCount,
    cartonCount,
    bagSealsPerBag: perBag,
    bagSeals: bagSeals.seals,
    boxSeals: boxSeals.seals,
    denominations: counts,
    serialTracked,
  };
  const slots = draftSlots(receipt);
  // A box typed into is the typist's; typed into the first or the last box, the range fill runs.
  const setSeal =
    (set: (update: (prev: SealList) => SealList) => void, boxes: number) =>
    (index: number, value: string): void =>
      set((prev) => typeSeal(prev, boxes, index, value));
  // The count or «2×»/«3×» moves the last box: the fill follows the ends now on screen (the same
  // list comes back when nothing changes, so this draws nothing more).
  useEffect(() => setBagSeals((list) => fillSealRange(list, slots.bags)), [slots.bags]);
  useEffect(() => setBoxSeals((list) => fillSealRange(list, slots.boxes)), [slots.boxes]);

  // ── One seal, once per receipt (Round 21) ──────────────────────────────────────────────────────
  // «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو»: the boxes ON SCREEN, both lists read as
  // one — a box the range fill wrote counts like one typed. Every box of a repeat is red, the
  // notice says which numbers and where, and «استلام» waits: the contract would refuse it.
  const repeats = sealRepeats(shownSeals(bagSeals, slots.bags), shownSeals(boxSeals, slots.boxes));
  const repeatNotice = sealRepeatNotice(repeats.repeats, t, locale);
  const noticeId = useId();
  const repeatedAt = (list: 'bag' | 'box', marks: typeof repeats.bags): (string | null)[] =>
    marks.map((repeat, index) =>
      repeat === null ? null : sealRepeatTitle(repeat, { list, index }, perBag, t, locale),
    );
  // A seal the server refused is said until the seals change — then it is no longer what it refused.
  useEffect(
    () => setRefused((prev) => (prev?.field === 'seals' ? null : prev)),
    [bagSeals.seals, boxSeals.seals, slots.bags, slots.boxes],
  );

  // ── «عدد الورق من كل فئة» against the shipment's pound ─────────────────────────────────────────
  const counted = denominationsTotal(denominationLines(counts));
  const shipmentPound = poundAmount(toShipmentLines(draft.lines), (currencyId) => {
    const currency = currencyList.find((c) => c.id === currencyId);
    return currencyKind(currency) === 'pound';
  });
  const check = denominationCheck(counted, shipmentPound);

  // ── What the shipment's data must keep ─────────────────────────────────────────────────────────
  const emptied = {
    mainBank: draft.mainBankId === '',
    origin: draft.originBranchId === '',
    destination: draft.destinationBranchId === '',
    collectionDate: draft.collectionDate === '',
    deliveryDate: draft.needsDeliveryDate && draft.deliveryDate === '',
    lines: !hasUsableLine(draft.lines),
  };
  // A refusal said under a box stands until that part of the shipment's data is changed — then it
  // is no longer what the server refused.
  useEffect(
    () => setRefused(null),
    [
      draft.mainBankId,
      draft.toBankId,
      draft.originBranchId,
      draft.destinationBranchId,
      draft.lines,
      draft.collectionDate,
      draft.deliveryDate,
    ],
  );
  const missing = (field: keyof typeof emptied): boolean => tried && emptied[field];
  const refusedOn = (field: ReceiveField): string | undefined =>
    refused?.field === field ? refused.text : undefined;
  // What the seals' notice says: the repeat on screen, or — when the server refused one the form
  // did not see — the server's refusal in the same words.
  const sealsSaid = repeatNotice !== '' ? repeatNotice : (refusedOn('seals') ?? '');

  const values = (): ShipmentDraftValues => ({
    mainBankId: draft.mainBankId,
    secondaryBankId: secondaryBankFor(draft.mainBankId, draft.toBankId),
    originBranchId: draft.originBranchId,
    destinationBranchId: draft.destinationBranchId,
    areaName: draft.areaName.trim() === '' ? null : draft.areaName.trim(),
    lines: toShipmentLines(draft.lines),
    collectionDate: draft.collectionDate,
    deliveryDate: draft.deliveryDate,
    notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
  });

  const submit = async (): Promise<void> => {
    if (shipment === null || sending.current) return;
    // A seal named twice is never sent — the button is held; this is its second lock.
    if (repeatNotice !== '') return;
    setRefused(null);
    // The dates' floors are said here first, as the shipment form says them — against today read
    // at this moment.
    const problems = draft.dateProblems(cairoToday());
    const problem = problems.collection ?? problems.delivery;
    if (problem !== null) {
      toast.error(t(SHIPMENT_DATE_PROBLEM_KEY[problem]));
      return;
    }
    if (Object.values(emptied).some(Boolean)) {
      setTried(true);
      toast.error(t('operations.secured.receive.shipmentIncomplete'));
      return;
    }
    const body = receiveRequest(receipt, shipmentPatch(shipment, values()), shipment.version);
    sending.current = true;
    try {
      const result = await receive.mutateAsync({ id: shipment.id, body });
      setTaken(result.receipt);
      toast.success(t('operations.secured.receive.done'));
    } catch (error) {
      const refusal = receiveRefusal(error);
      // A seal refused as named twice is said in the words the form says it in, read from what
      // was sent; the refusal's own key only if those find no repeat.
      const sealWords =
        refusal.field === 'seals'
          ? sealRepeatNotice(
              sealRepeats(body.bagSeals ?? [], body.boxSeals ?? []).repeats,
              t,
              locale,
            )
          : '';
      const text =
        sealWords !== ''
          ? sealWords
          : refusal.key === null
            ? errorMessage(error, locale)
            : t(refusal.key);
      toast.error(text);
      if (refusal.field !== null) setRefused({ field: refusal.field, text });
      if (refusal.closes) onClose();
    } finally {
      sending.current = false;
    }
  };

  // ── «إيصال» ────────────────────────────────────────────────────────────────────────────────────
  const bankName = (id: string): string => bankList.find((bank) => bank.id === id)?.opsName ?? '';
  const print = (): void => {
    const report = vaultReceiptReport({
      t,
      shipment: {
        mainBank: bankName(draft.mainBankId),
        origin: draft.branchNames.origin,
        originBank: bankName(draft.fromBankId),
        destination: draft.branchNames.destination,
        destinationBank: bankName(draft.toBankId),
        area: draft.areaName,
        lines: toShipmentLines(draft.lines).map((line) => ({
          currency: currencyList.find((c) => c.id === line.currencyId)?.name ?? '…',
          amount: line.amount,
        })),
        captain: shipment?.crew?.captainName ?? '',
        vehicle: shipment?.crew?.vehicleCode ?? '',
        collectionDate: draft.collectionDate,
        deliveryDate: draft.deliveryDate,
        notes: draft.notes.trim(),
        serialTracked,
      },
      receipt: {
        receiptNumber,
        bagCount: taken?.bagCount ?? parseCount(bagCount),
        cartonCount: taken?.cartonCount ?? parseCount(cartonCount),
        boxCount: taken?.boxCount ?? parseCount(boxCount),
        bagSealsPerBag: taken?.bagSealsPerBag ?? perBag,
        bagSeals: sealsToSend(bagSeals.seals, slots.bags),
        boxSeals: sealsToSend(boxSeals.seals, slots.boxes),
        denominations: taken?.denominations ?? denominationLines(counts),
      },
      taken:
        taken === null
          ? null
          : {
              receivedAt: taken.receivedAt,
              receivedByName: taken.receivedByName,
              receiptNumber: taken.receiptNumber,
            },
      amount: (value) => formatAmount(value, locale),
      // On paper the counts stand beside money — «1,500 = 300,000» — so they are written in the
      // money's Latin digits, not the screen's Arabic-Indic counts: one paper, one set of digits.
      count: (value) => formatAmount(value, locale),
      when: (iso) => formatBusinessDateTime(iso, locale),
    });
    try {
      printFleetReport(report);
    } catch {
      toast.error(t('operations.reportExport.popupBlocked'));
    }
  };

  const locked = taken !== null;
  const busy = receive.isPending;
  const crew = shipment?.crew ?? null;
  const crewHint = t('operations.secured.receive.crewReadOnly');
  const box = boxTone(LOOK.add);
  const countBox = cn(box, MONO, 'text-center');
  // A denomination's tile is narrower than the design's box: its own padding and size, not laid
  // over `boxTone`'s (`cn` joins, it does not merge — two `!px-` would be decided by stylesheet
  // order, and a four-figure count would be cut).
  const tileBox = cn(
    MONO,
    '!rounded-xl border text-center font-semibold shadow-inner transition-all',
    '!px-0.5 !pb-1 !pt-[15px] !text-[14px]',
    'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-white dark:placeholder:text-slate-500',
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
  );

  return (
    <>
      <DesignDialog
        open={open}
        // Escape inside the branch form closes THAT form only (the shipment form's rule).
        onClose={() => {
          if (draft.adding === null) onClose();
        }}
        title={t('operations.secured.receive.formTitle')}
        subtitle={t('operations.secured.receive.formSubtitle')}
        icon={SHIPMENT_PATH.shipment}
        width="7xl"
        dense
        panelProps={{ 'data-receive-form': locked ? 'received' : 'open' }}
        footer={
          <div className="flex w-full flex-wrap items-center gap-3">
            {!locked && (
              <ReceiveSaveButton
                busy={busy}
                blocked={repeatNotice === '' ? null : repeatNotice}
                describedBy={noticeId}
                onClick={() => void submit()}
              />
            )}
            <button
              type="button"
              data-receive-print={locked ? 'final' : 'draft'}
              onClick={print}
              title={t('operations.secured.receive.printHint')}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-6 py-2.5 text-[15px] font-bold transition-all active:scale-[0.98]',
                locked
                  ? 'border-transparent bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] text-white shadow-[0_6px_24px_rgba(91,76,255,0.55)]'
                  : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-100 dark:hover:bg-slate-600/70',
              )}
            >
              <Stroke d={[...SHIPMENT_PATH.printer]} className="h-4 w-4" />
              <span>{t('operations.secured.receive.print')}</span>
            </button>
            {locked ? (
              <DesignCancel onClick={onClose} label={t('common.close')} />
            ) : (
              <DesignCancel onClick={onClose} />
            )}
            {/* «انا مش عاوز اى اسماء»: nobody is picked — who receives is who is signed in. */}
            {!locked && me !== null && (
              <span
                data-receive-receiver="true"
                className="ms-auto text-[13px] font-medium text-slate-500 dark:text-slate-400"
              >
                {t('operations.secured.receive.receiverNote', { name: fullName(me.name, locale) })}
              </span>
            )}
          </div>
        }
      >
        {locked && (
          <p
            role="status"
            data-receive-taken="true"
            className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-[15px] font-semibold text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100"
          >
            <Stroke d={[...SHIPMENT_PATH.checkCircle]} className="h-5 w-5 shrink-0" />
            {t('operations.secured.receive.takenBanner', {
              at: formatBusinessDateTime(taken.receivedAt, locale),
              name: taken.receivedByName ?? '—',
            })}
          </p>
        )}

        {/* After «استلام» everything is locked, as since Round 10 — the form stays for «إيصال». */}
        <fieldset disabled={locked} className="min-w-0 space-y-3 disabled:opacity-90">
          {/* 1 — THE SHIPMENT'S DATA, editable: «تعدّلها عادي». */}
          <Band data-receive-band="shipment">
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-2.5 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1.3fr)]">
              <div className="grid grid-cols-1 items-start gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <MainBankField
                  draft={draft}
                  starred={false}
                  missing={missing('mainBank')}
                  refused={refusedOn('mainBank')}
                />
                <DraftBranchSide
                  draft={draft}
                  side="origin"
                  compact
                  starred={false}
                  missing={missing('origin')}
                  refused={refusedOn('origin')}
                />
                <DraftBranchSide
                  draft={draft}
                  side="destination"
                  compact
                  starred={false}
                  missing={missing('destination')}
                  refused={refusedOn('destination')}
                  bankRefused={refusedOn('toBank')}
                />
                <AreaBox areaName={draft.areaName} labelled />
                <HeldBox
                  label={t('operations.shipment.form.captain')}
                  value={crew?.captainName ?? ''}
                  hint={crewHint}
                  data-receive-captain="true"
                />
                <HeldBox
                  label={t('operations.shipment.form.vehicle')}
                  value={crew?.vehicleCode ?? ''}
                  hint={crewHint}
                  mono
                  data-receive-vehicle="true"
                />
                <CollectionDateField
                  draft={draft}
                  starred={false}
                  missing={missing('collectionDate')}
                  refused={refusedOn('collectionDate')}
                />
                <DeliveryDateField
                  draft={draft}
                  hint={false}
                  starred={false}
                  missing={missing('deliveryDate')}
                  refused={refusedOn('deliveryDate')}
                />
                <div className="sm:col-span-2 lg:col-span-3">
                  <NotesField draft={draft} />
                </div>
                {/* «سيريال» — «بتتعرف عند الاستلام اذا كان سيريال او لا». */}
                <div className="space-y-2" title={t('operations.secured.receive.serialHint')}>
                  <span className="block text-[15px] font-bold text-slate-900 dark:text-white">
                    {t('operations.secured.receive.serial')}
                  </span>
                  <label
                    className={cn(
                      'flex min-h-[3.125rem] cursor-pointer items-center gap-3 rounded-xl border px-4 text-[15px] font-semibold transition-colors',
                      serialTracked
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-900 dark:border-indigo-400/60 dark:bg-indigo-500/15 dark:text-indigo-100'
                        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={serialTracked}
                      onChange={(e) => setSerialTracked(e.target.checked)}
                      data-receive-serial="true"
                      className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {t('operations.secured.receive.serialBox')}
                  </label>
                </div>
              </div>

              {/* The money — legacy's «العملة ✓ / قيمة الشحنة» column, a line per currency. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold text-slate-900 dark:text-white">
                    {t('operations.secured.receive.money')}
                  </span>
                  <AddLineButton draft={draft} />
                </div>
                <MoneyLines
                  draft={draft}
                  labelled={false}
                  columns="grid-cols-[minmax(0,6fr)_minmax(0,5fr)_auto]"
                  missing={missing('lines')}
                  refused={
                    refusedOn('lines') ??
                    (missing('lines') ? t('common.validation.required') : undefined)
                  }
                />
              </div>
            </div>
          </Band>

          {/* 2 — THE RECEIPT: «عدد الورق من كل فئة» on a row of its own, then the number and the
              packages — «خلى الفئات لوحدها كدا فوق رقم الايصال والكلام دا». */}
          <Band data-receive-band="receipt">
            {/* «عدد الورق من كل فئة» — legacy's row of boxes, alone over the receipt's fields as legacy
                drew it: 0.25 … 200, a count in each, the denomination written inside its box. On a
                wide screen the words and what the notes come to stand at the row's start, so the
                row is one box tall and the whole form keeps to a laptop's screen; narrower, they go
                over the boxes. */}
            <div
              data-receive-denominations="true"
              className="grid grid-cols-1 items-center gap-x-5 gap-y-2 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold">
                  <span className="text-[15px] font-bold text-slate-900 dark:text-white">
                    {t('operations.secured.receive.denominations')}
                  </span>
                  {check.state === 'match' && (
                    <span
                      data-receive-total-note="match"
                      title={t('operations.secured.receive.denominationsMatch')}
                      className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    >
                      {t('operations.secured.receive.denominationsMatched')}
                    </span>
                  )}
                  {check.state === 'mismatch' && (
                    // Gentle, never a refusal: «كله اختيارى».
                    <span
                      data-receive-total-note="mismatch"
                      title={t('operations.secured.receive.denominationsMismatch', {
                        difference: formatAmount(Math.abs(check.difference), locale),
                      })}
                      className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                    >
                      {t('operations.secured.receive.denominationsDiffer', {
                        difference: formatAmount(Math.abs(check.difference), locale),
                      })}
                    </span>
                  )}
                </div>
                <span
                  data-receive-total={check.state}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-slate-600 dark:text-slate-300"
                >
                  <span>
                    {t('operations.secured.receive.denominationsTotal')}{' '}
                    <bdi className={cn('font-black text-slate-900 dark:text-white', MONO)}>
                      {formatAmount(counted, locale)}
                    </bdi>
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>
                    {t('operations.secured.receive.shipmentPound')}{' '}
                    <bdi className={cn('font-black text-slate-900 dark:text-white', MONO)}>
                      {formatAmount(shipmentPound, locale)}
                    </bdi>
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
                {OPERATIONS_VAULT_DENOMINATIONS.map((value, index) => (
                  <label key={value} className="relative min-w-0">
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-0 top-1 text-center text-[11px] font-bold leading-none text-indigo-600 dark:text-indigo-300',
                        MONO,
                      )}
                    >
                      {denominationLabel(value)}
                    </span>
                    <Input
                      rule="integer"
                      value={counts[index] ?? ''}
                      onChange={(e) =>
                        setCounts((prev) =>
                          prev.map((count, i) => (i === index ? e.target.value : count)),
                        )
                      }
                      placeholder="0"
                      aria-label={t('operations.secured.receive.denominationInput', {
                        value: denominationLabel(value),
                      })}
                      tone={tileBox}
                      data-receive-denomination={denominationLabel(value)}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* The receipt's own fields under the row of notes, in the shipment's four columns above
                them — the cartons a plain count, with no seal box: «ملهاش سيريال ولا الكلام دا رقم
                عادى». */}
            <div className="grid grid-cols-1 gap-x-4 border-t border-slate-200 pt-2.5 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1.3fr)] dark:border-[#2b3b6b]/60">
              <div className="grid grid-cols-2 items-start gap-x-4 gap-y-3 sm:grid-cols-4">
                <DesignField label={t('operations.secured.receive.receiptNumber')}>
                  <Input
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                    dir="ltr"
                    tone={cn(box, MONO, 'text-center')}
                    data-receive-number="true"
                  />
                </DesignField>
                {/* A whole row on a phone: its label shares the line with the radio. */}
                <div className="col-span-2 space-y-2 sm:col-span-1">
                  <div className="flex h-[22px] items-center justify-between gap-2">
                    <span className="whitespace-nowrap text-[15px] font-bold text-slate-900 dark:text-white">
                      {t('operations.secured.receive.bags')}
                    </span>
                    {/* «2×» / «3×» — how many seals close each bag. */}
                    <div
                      role="radiogroup"
                      aria-label={t('operations.secured.receive.sealsPerBag')}
                      title={t('operations.secured.receive.sealsPerBag')}
                      className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-[#2b3b6b]"
                    >
                      {OPERATIONS_VAULT_BAG_SEALS_PER_BAG.map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          dir="ltr"
                          aria-checked={perBag === option}
                          data-receive-per-bag={String(option)}
                          onClick={() => setPerBag(option)}
                          className={cn(
                            'rounded-md px-2 text-[13px] font-bold leading-5 transition-colors',
                            MONO,
                            perBag === option
                              ? 'bg-indigo-600 text-white shadow'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60',
                          )}
                        >
                          {/* A multiplier, the same in both languages — legacy's «2×» / «3×». */}
                          {`${option}×`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    rule="integer"
                    value={bagCount}
                    onChange={(e) => setBagCount(e.target.value)}
                    placeholder="0"
                    aria-label={t('operations.secured.receive.bags')}
                    tone={countBox}
                    data-receive-count="bags"
                  />
                </div>
                <DesignField label={t('operations.secured.receive.boxes')}>
                  <Input
                    rule="integer"
                    value={boxCount}
                    onChange={(e) => setBoxCount(e.target.value)}
                    placeholder="0"
                    tone={countBox}
                    data-receive-count="boxes"
                  />
                </DesignField>
                <DesignField label={t('operations.secured.receive.cartons')}>
                  <Input
                    rule="integer"
                    value={cartonCount}
                    onChange={(e) => setCartonCount(e.target.value)}
                    placeholder="0"
                    tone={countBox}
                    data-receive-count="cartons"
                  />
                </DesignField>
              </div>
            </div>
          </Band>

          {/* 3 — THE SEALS, one box each, under legacy's summary line. */}
          <Band data-receive-band="seals" data-receive-seals="true">
            <SealBoxes
              kind="bag"
              hint={t('operations.secured.receive.scanHint')}
              title={t('operations.secured.receive.bagSeals')}
              list={bagSeals}
              slots={slots.bags}
              perUnit={perBag}
              repeated={repeatedAt('bag', repeats.bags)}
              onChange={setSeal(setBagSeals, slots.bags)}
            />
            <SealBoxes
              kind="box"
              title={t('operations.secured.receive.boxSeals')}
              list={boxSeals}
              slots={slots.boxes}
              perUnit={BOX_SEALS_PER_BOX}
              repeated={repeatedAt('box', repeats.boxes)}
              onChange={setSeal(setBoxSeals, slots.boxes)}
            />
            {/* Round 21 — one notice for the whole receipt, under both lists. */}
            {sealsSaid !== '' && <SealRepeatNotice id={noticeId} text={sealsSaid} />}
          </Band>
        </fieldset>
      </DesignDialog>
      <DraftBranchCreate draft={draft} />
    </>
  );
};
