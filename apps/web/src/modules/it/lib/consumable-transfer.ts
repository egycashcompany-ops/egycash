// «تحويل إلى فرع» — «المستهلكات لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني» (2026-11-11): some of
// an item's stock, or several items each with how many, out of ONE branch's store into another's,
// at once and with no paper («السجل كفاية») — the ledger is the record.
//
// The rules the screen applies before it asks, each one the server applies too:
//   · one transfer leaves ONE store — the items ticked on the register must all be of one branch,
//     or the action says so and waits;
//   · it goes to another branch, never back into the store it leaves;
//   · each line moves a whole number, at least one and no more than the store holds. The box starts
//     EMPTY: «how many» is a question to answer, and a default of one would move one mouse nobody
//     counted;
//   · an item with nothing on hand has nothing to send and is left out, said in its row.
// Each line reaches the other store's item of the same name — made there when it has none — which
// only the server can see; it says so in its answer, and the toast passes it on.
import {
  IT_CONSUMABLE_TRANSFER_MAX_LINES,
  type ItConsumableDto,
  type ItConsumableTransferResultDto,
  type Locale,
  type TransferItConsumables,
} from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { custodyPlural } from '../../fleet/lib/custody-words';
import { type Translate } from './register-export';

/** The contract's own bound on any one movement. */
const MAX_QTY = 1_000_000;

/** The facts the rules read — what every row of the register carries. */
export type TransferableItem = Pick<ItConsumableDto, 'id' | 'branchId' | 'onHandQty'>;

/** What the register's «تحويل إلى فرع (n)» can do with what is ticked. */
export type ConsumableTransferSelection =
  | { state: 'none' }
  /** Ticked from two stores or more: one transfer leaves one store. */
  | { state: 'mixedBranches' }
  /** Every ticked item's store holds none of it. */
  | { state: 'nothingOnHand' }
  /** More lines than one transfer carries (`IT_CONSUMABLE_TRANSFER_MAX_LINES`). */
  | { state: 'tooMany'; max: number }
  | { state: 'ready'; fromBranchId: string };

export const consumableTransferSelection = (
  items: readonly TransferableItem[],
): ConsumableTransferSelection => {
  const first = items[0];
  if (first === undefined) return { state: 'none' };
  if (items.some((item) => item.branchId !== first.branchId)) return { state: 'mixedBranches' };
  // The bound is on what is SENT: a ticked item with nothing on hand is listed and left out of the
  // request (`consumableTransferCheck`), so it takes none of the transfer's lines.
  const sending = items.filter((item) => item.onHandQty > 0);
  if (sending.length === 0) return { state: 'nothingOnHand' };
  if (sending.length > IT_CONSUMABLE_TRANSFER_MAX_LINES) {
    return { state: 'tooMany', max: IT_CONSUMABLE_TRANSFER_MAX_LINES };
  }
  return { state: 'ready', fromBranchId: first.branchId };
};

/** One row of the dialog: the item, and how many was typed for it. */
export interface ConsumableTransferDraftLine<T extends TransferableItem = TransferableItem> {
  item: T;
  qty: string;
}

/** Why a row cannot go as typed. `nothingOnHand` is not an error: that row is simply left out. */
export type ConsumableTransferLineProblem =
  'required' | 'wholeNumber' | 'moreThanOnHand' | 'nothingOnHand';

export interface ConsumableTransferLineCheck<T extends TransferableItem = TransferableItem> {
  item: T;
  /** The quantity as a number, when the box holds a whole one. */
  qty: number | null;
  problem: ConsumableTransferLineProblem | null;
}

export interface ConsumableTransferCheck<T extends TransferableItem = TransferableItem> {
  lines: ConsumableTransferLineCheck<T>[];
  /** The store every line leaves — the first line's; '' with no lines. */
  fromBranchId: string;
  /** The rows the request carries: every one with something on hand. */
  sending: ConsumableTransferLineCheck<T>[];
  /** The branch chosen is the store the items leave. */
  sameBranch: boolean;
  ready: boolean;
}

/** A whole number typed into a box, or NaN — «2.5» of a mouse is not a quantity. */
const wholeNumber = (value: string): number => {
  const text = value.trim();
  return /^\d+$/u.test(text) ? Number(text) : Number.NaN;
};

/** One row against its own store: required, whole, at least one, no more than on hand. */
export const consumableTransferLine = <T extends TransferableItem>(
  line: ConsumableTransferDraftLine<T>,
): ConsumableTransferLineCheck<T> => {
  const { item } = line;
  if (item.onHandQty <= 0) return { item, qty: null, problem: 'nothingOnHand' };
  if (line.qty.trim() === '') return { item, qty: null, problem: 'required' };
  const qty = wholeNumber(line.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return { item, qty: null, problem: 'wholeNumber' };
  }
  if (qty > item.onHandQty) return { item, qty, problem: 'moreThanOnHand' };
  return { item, qty, problem: null };
};

/** The whole dialog: every row, the branch chosen, and whether it can be sent. */
export const consumableTransferCheck = <T extends TransferableItem>(
  lines: readonly ConsumableTransferDraftLine<T>[],
  toBranchId: string,
): ConsumableTransferCheck<T> => {
  const checked = lines.map(consumableTransferLine);
  const fromBranchId = lines[0]?.item.branchId ?? '';
  const sending = checked.filter((line) => line.problem !== 'nothingOnHand');
  const sameBranch = toBranchId !== '' && toBranchId === fromBranchId;
  const oneStore = lines.every((line) => line.item.branchId === fromBranchId);
  const ready =
    toBranchId !== '' &&
    !sameBranch &&
    oneStore &&
    sending.length > 0 &&
    sending.length <= IT_CONSUMABLE_TRANSFER_MAX_LINES &&
    sending.every((line) => line.problem === null);
  return { lines: checked, fromBranchId, sending, sameBranch, ready };
};

/** The request — null until the dialog is ready. `at` is the `datetime-local` text, '' for now. */
export const consumableTransferRequest = (
  check: ConsumableTransferCheck,
  toBranchId: string,
  at: string,
  notes: string,
): TransferItConsumables | null => {
  if (!check.ready) return null;
  return {
    toBranchId,
    ...(at === '' ? {} : { at: new Date(at) }),
    ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    lines: check.sending.map((line) => ({ consumableId: line.item.id, qty: line.qty ?? 0 })),
  };
};

/** «حُوِّل ٣ أصناف إلى المهندسين» — the toast, in Arabic's five count forms. */
export const consumablesTransferredWords = (
  t: Translate,
  locale: Locale,
  count: number,
  branch: string,
): string =>
  t(`it.consumables.transfer.done.${custodyPlural(locale, count)}`, {
    count: formatNumber(count, locale),
    branch,
  });

/**
 * The toast's second line, when the other store had no item of some name and the transfer made it
 * there: «أُضيف إلى مخزن المهندسين صنف لم يكن فيه: ماوس». Null when every line reached an item the
 * other store already kept.
 */
export const consumablesCreatedWords = (
  t: Translate,
  locale: Locale,
  result: Pick<ItConsumableTransferResultDto, 'lines'>,
  branch: string,
): string | null => {
  const made = result.lines.filter((line) => line.created);
  if (made.length === 0) return null;
  return t(`it.consumables.transfer.created.${custodyPlural(locale, made.length)}`, {
    count: formatNumber(made.length, locale),
    branch,
    items: made.map((line) => line.name).join(locale === 'ar' ? '، ' : ', '),
  });
};
