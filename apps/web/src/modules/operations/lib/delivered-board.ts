// «الشحنات المسلَّمة» — Round 33 B, as the screen reads it. The owner: «وعاوز اعمل شاشة جديدة زى
// شاشةاليوم التشغيلى بس يظهر بس اللى اتسلمت سواء يومى او كانت محصنة ف الخونة واسلمت ل بنك هتظهرلى لما
// تكون تم التسليم بس الاجراءات هيكون فيه علامة صح لما ادوس عليها لازم يكون فيه رقم الايصال ويفضل الصورة
// تكون مرفوعه و يحدد البنك من او الى اللى هيتحسب عليه تكلفة نقل الشحنة».
//
// Which rows are on it is the SERVER's (`GET /operations/shipments/delivered?date=` — what reached
// its bank that Cairo day, `isOperationsShipmentDeliveredToBank`). What lives here is the screen's
// own reading of a row — its state and colour, the two sides the ✓ offers, the dialog's checks —
// and the day it opens on. Pure, so each rule is pinned in `delivered-board.spec.ts`.
import {
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX,
  deliveryReceiptNumberProblem,
  isYmd,
  type ConfirmOperationsDelivery,
  type OperationsDeliveredBoardDto,
  type OperationsDeliveredShipmentDto,
  type OperationsDeliveryBilledSide,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { modeStepOf } from './crew-swap';
import { isDeliveryConfirmed, rowTint } from './day-board';

/**
 * Where a delivered row stands — the screen's «الحالة»:
 *
 *   · `awaiting`  «تم التسليم» — the captain delivered it, the ✓ with the receipt is not in yet.
 *                 The day board's own yellow, the captain's «تم التسليم» there;
 *   · `confirmed` «مؤكَّدة» — confirmed with its receipt number and the bank billed. Green, as the
 *                 day board's confirmed rows («الشاشة الجديدة حاجاتها لوحدها» — its own record).
 */
export type DeliveredState = 'awaiting' | 'confirmed';

export const deliveredStateOf = (
  row: Pick<OperationsDeliveredShipmentDto, 'deliveryConfirmation'>,
): DeliveredState => (isDeliveryConfirmed(row) ? 'confirmed' : 'awaiting');

/** The row's colour: the day board's yellow while awaiting, its green once confirmed. */
export const deliveredRowTint = (
  row: Pick<OperationsDeliveredShipmentDto, 'deliveryConfirmation'>,
): string | undefined => rowTint(deliveredStateOf(row) === 'confirmed' ? 'desk' : 'captain');

/**
 * «اختيارية مع تنبيه» — a CONFIRMED row with no receipt photo keeps «بدون صورة» until one is
 * uploaded from its row. A row still awaiting its ✓ says nothing yet: the dialog asks for the photo.
 */
export const lacksReceiptPhoto = (
  row: Pick<OperationsDeliveredShipmentDto, 'deliveryConfirmation' | 'receiptImage'>,
): boolean => isDeliveryConfirmed(row) && row.receiptImage == null;

/**
 * One side of «البنك الذي تُحتسب عليه تكلفة النقل», as the dialog offers it: «من» — the origin
 * branch's bank — or «إلى» — the destination's, each by its bank's name and its branch. A branch
 * whose record is gone cannot name its bank: offered, but not choosable (`available`).
 */
export interface BilledSideOption {
  side: OperationsDeliveryBilledSide;
  bankId: string | null;
  bankName: string;
  branchName: string;
  available: boolean;
}

export const billedSideOptions = (
  row: Pick<OperationsDeliveredShipmentDto, 'origin' | 'destination'>,
): BilledSideOption[] =>
  (['origin', 'destination'] as const).map((side) => {
    const branch = row[side];
    return branch === null
      ? { side, bankId: null, bankName: '', branchName: '', available: false }
      : {
          side,
          bankId: branch.bankId,
          bankName: branch.bankName,
          branchName: branch.code === '' ? branch.name : `${branch.name} (${branch.code})`,
          available: true,
        };
  });

/**
 * Round 33 critic — the two sides are ONE radio group, one Tab stop: the side chosen, or — none
 * chosen yet — the first that can be chosen (null when neither can).
 */
export const billedSideTabStop = (
  options: readonly BilledSideOption[],
  chosen: OperationsDeliveryBilledSide | null,
): OperationsDeliveryBilledSide | null =>
  chosen ?? options.find((option) => option.available)?.side ?? null;

/**
 * Round 33 critic — the arrow keys inside the group move to the next side that can be chosen, and
 * choose it (a radio group's keys), from the side at the Tab stop; past the last they wrap round.
 * The next side lies in the reading direction — left in Arabic, right in English — and down when
 * the two stand in a column on a phone (`modeStepOf`, the swap window's three ways). Null for any
 * other key, or when no side can be chosen.
 */
export const billedSideAfterKey = (
  options: readonly BilledSideOption[],
  chosen: OperationsDeliveryBilledSide | null,
  key: string,
  rtl: boolean,
): OperationsDeliveryBilledSide | null => {
  const by = modeStepOf(key, rtl);
  const open = options.filter((option) => option.available).map((option) => option.side);
  if (by === 0 || open.length === 0) return null;
  const at = open.indexOf(billedSideTabStop(options, chosen) ?? open[0]!);
  if (at === -1) return open[0]!;
  return open[(at + by + open.length) % open.length]!;
};

/**
 * Both branches are of ONE bank: the side is still recorded («من» or «إلى»), and the dialog says
 * the bank billed is the same either way.
 */
export const sameBankBothSides = (
  row: Pick<OperationsDeliveredShipmentDto, 'origin' | 'destination'>,
): boolean =>
  row.origin !== null && row.destination !== null && row.origin.bankId === row.destination.bankId;

/** What the dialog holds before «تأكيد». The photo is the dialog's own state (a picked file). */
export interface DeliveryDraft {
  receiptNumber: string;
  billedSide: OperationsDeliveryBilledSide | null;
}

export const EMPTY_DELIVERY_DRAFT: DeliveryDraft = { receiptNumber: '', billedSide: null };

/** Why «تأكيد» cannot be sent yet, box by box — the server's own two rules, checked first here. */
export interface DeliveryDraftProblems {
  receiptNumber: 'required' | 'tooLong' | null;
  billedSide: 'required' | null;
}

export const deliveryDraftProblems = (draft: DeliveryDraft): DeliveryDraftProblems => ({
  receiptNumber: deliveryReceiptNumberProblem(draft.receiptNumber),
  billedSide: draft.billedSide === null ? 'required' : null,
});

export const deliveryDraftReady = (draft: DeliveryDraft): boolean => {
  const problems = deliveryDraftProblems(draft);
  return problems.receiptNumber === null && problems.billedSide === null;
};

/** The ✓'s body — the number trimmed, the side, the row's version. Nothing names a bank or a person. */
export const deliveryRequestBody = (
  draft: DeliveryDraft,
  version: number,
): ConfirmOperationsDelivery => ({
  receiptNumber: draft.receiptNumber.trim(),
  billedSide: draft.billedSide,
  version,
});

/** The receipt box's longest entry, for its `maxLength` and its hint. */
export const RECEIPT_NUMBER_MAX = OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX;

/**
 * What a refused ✓ means for the dialog:
 *
 *   · `receiptNumber` / `billedSide` — the box the server named (a 422): marked, the dialog stays;
 *   · `stale` — the row moved under the dialog (not delivered any more, confirmed by a colleague, a
 *     newer version): the screen is re-read and the dialog closes onto the row as it now is;
 *   · null — anything else (offline, a 5xx): said plainly, the dialog stays for another try.
 */
export type DeliveryRefusal =
  | { kind: 'receiptNumber'; problem: 'required' | 'tooLong' }
  | { kind: 'billedSide' }
  | { kind: 'stale'; code: string }
  | null;

export const deliveryRefusalOf = (error: unknown): DeliveryRefusal => {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED':
      return { kind: 'receiptNumber', problem: 'required' };
    case 'OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG':
      return { kind: 'receiptNumber', problem: 'tooLong' };
    case 'OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED':
      return { kind: 'billedSide' };
    case 'OPERATIONS_SHIPMENT_NOT_DELIVERED':
    case 'OPERATIONS_DELIVERY_ALREADY_CONFIRMED':
    case 'STALE_DOCUMENT':
    case 'NOT_FOUND':
      return { kind: 'stale', code: error.code };
    default:
      return null;
  }
};

/**
 * The day the screen ASKS FOR — «الأيام اللى فاتت» included: a receipt often comes back days after
 * the delivery. The URL's `date` when it is a real day BEFORE `today`; else null — no day named,
 * and the server answers its own Cairo today (`OperationsDeliveredBoardDto.today`).
 *
 * Round 33 critic — `today` is the SERVER's, once a read has said it; only before the first read is
 * it the PC's clock, as a provisional bound (a day it lets through is answered by the server, and
 * the next render bounds it by the server's word). A PC whose clock runs a day ahead never opens
 * the screen on an empty tomorrow, and one a day behind can still reach the server's today: it is
 * the default, asked for by no name.
 */
export const readDeliveredDay = (params: URLSearchParams, today: string): string | null => {
  const asked = params.get('date');
  return asked !== null && isYmd(asked) && asked < today ? asked : null;
};

/**
 * Round 33 critic — the ✓'s dialog as it was opened: its row, and the day of the read it was opened
 * on (the server's `date`).
 */
export interface OpenedDelivery {
  row: OperationsDeliveredShipmentDto;
  day: string;
}

/**
 * The row the open dialog shows, or null to close it.
 *
 * On a read of the dialog's own day it follows its row — a refetch hands in the row as it now
 * stands, and a row gone from the day (deleted, or its delivery taken back) closes it. Round 33
 * critic: while the screen reads ANOTHER day — Cairo midnight passed on the default day, the new
 * day's read loading or in — or has no read at all, the dialog stays on its row as opened: the
 * number typed, the side chosen and the photo picked are not thrown away. «تأكيد» acts on the row's
 * id and version, and a server's refusal says if it moved since.
 */
export const deliveredDialogRow = (
  opened: OpenedDelivery | null,
  read: Pick<OperationsDeliveredBoardDto, 'date' | 'shipments'> | undefined,
): OperationsDeliveredShipmentDto | null => {
  if (opened === null) return null;
  if (read === undefined || read.date.slice(0, 10) !== opened.day) return opened.row;
  return read.shipments.find((row) => row.id === opened.row.id) ?? null;
};

/**
 * Round 33 critic — the default day moved on under a screen left open (Cairo midnight, on the
 * server's word): the day it left, so the screen can say so once; null otherwise (the first read,
 * the same day, a day picked by name).
 */
export const defaultDayLeft = (before: string | null, now: string | null): string | null =>
  before !== null && now !== null && now > before ? before : null;
