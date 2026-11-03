// «مطابقة أرصدة الكروت» — the screen's pure half: how its figures are written, and what is ticked,
// decided and refused. Nothing here touches React or the network, so every rule is pinned by
// `fuel-reconcile.spec.ts`.
//
// The selection: a card that DIFFERS is open until it is decided (✓ / ✗). Only open cards can be
// ticked. A card the server refused because its balance or log moved after the sheet was read
// (409 `FLEET_FUEL_RECONCILE_CARD_CHANGED`) can no longer take the sheet's balance from this read:
// it leaves the selection and «تحديد الكل» passes it by; the sheet must be read again.
//
// 6d: a line read while «تصحيح أرقام الكروت» is pending for its card (the 0849 pair, `inRepair`)
// takes no ✓ — its name sits on the other card's record, so the sheet's figure would land on the
// wrong card. «تحديد الكل» passes it by and a bulk ✓ leaves it out; its ✗ stays (nothing moves), so
// it may still be ticked by hand for a bulk ✗.
import {
  ErrorCodes,
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
  type FleetFuelReconcileChargeDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileResultDto,
  type FleetFuelSheetConflict,
  type FleetFuelSheetConflictDto,
  type FleetFuelSheetDuplicateDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { cairoDayOf } from './custody-hold';

// ── Figures ─────────────────────────────────────────────────────────────────────────────────────

/** Latin figures with their two decimals — as every fuel board writes a balance. */
export const money = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «+640.00» · «−1,250.50» · «0.00» — the sign written, a true minus. */
export const signed = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
/** To the piastre, so sums never drift (0.1 + 0.2). */
export const piastres = (value: number): number => Math.round(value * 100);
/** The lines' differences summed to the piastre. */
export const netOf = (lines: readonly FleetFuelReconcileLineDto[]): number =>
  lines.reduce((sum, line) => sum + piastres(line.difference), 0) / 100;
/** The largest |difference| — the bar each row's difference is drawn against. */
export const largestOf = (lines: readonly FleetFuelReconcileLineDto[]): number =>
  lines.reduce((most, line) => Math.max(most, Math.abs(line.difference)), 0);
/** Figures summed to the piastre. */
export const sumOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + piastres(value), 0) / 100;

/** A bulk decision's figures: the cards' balance now, the net difference, and after a ✓. */
export interface ConfirmTotals {
  now: number;
  net: number;
  after: number;
}
export const confirmTotalsOf = (lines: readonly FleetFuelReconcileLineDto[]): ConfirmTotals => ({
  now: sumOf(lines.map((line) => line.card.balance)),
  net: netOf(lines),
  after: sumOf(lines.map((line) => line.sheet.balance)),
});

/** The sheet rows that are never decided, counted as rows (one name may hold several). */
export const conflictRowsOf = (conflicts: readonly FleetFuelSheetConflictDto[]): number =>
  conflicts.reduce((sum, conflict) => sum + conflict.rows.length, 0);
/** The repeated rows beyond each card's first — what «صفوف مكررة» counts. */
export const repeatsOf = (duplicates: readonly FleetFuelSheetDuplicateDto[]): number =>
  duplicates.reduce((sum, row) => sum + row.times - 1, 0);
/** The matched cards whose last four digits differ — the differing and the equal alike. */
export const changedNumbersOf = (result: FleetFuelReconcileDto): FleetFuelReconcileLineDto[] =>
  [...result.differs, ...result.equal].filter((line) => !line.numberMatches);
/** The company the sheet's names say, when it is not the one chosen; else `null`. */
export const wrongCompanyOf = (result: FleetFuelReconcileDto): FleetFuelCardCompany | null =>
  result.sheetCompany !== null && result.sheetCompany !== result.company
    ? result.sheetCompany
    : null;

const two = (n: number): string => String(n).padStart(2, '0');
/** «2026/10/27 09:41» — the reader's own clock. */
export const stampOf = (iso: string): string => {
  const at = new Date(iso);
  return `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
};
/** «09:41». */
export const timeOf = (iso: string): string => {
  const at = new Date(iso);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
};
/** The last four characters of a number, spaces dropped — the sheet shows only those. */
export const lastFour = (number: string): string => number.replace(/\s+/gu, '').slice(-4);
/** A hidden number as the boards write it: «•••• 0021». */
export const dots = (number: string): string => `•••• ${lastFour(number)}`;
/**
 * A sheet's number as the sheet shows it: «548 •••• 0021» — its printed start, then the last four —
 * for a masked number («548**********0021»); any other number as the boards hide one.
 */
export const maskedOf = (number: string): string => {
  const masked = /^(\d*)[*xX•●·#]+(\d{4,})$/u.exec(number.replace(/\s+/gu, ''));
  return masked === null || masked[1] === ''
    ? dots(number)
    : `${masked[1]} •••• ${lastFour(number)}`;
};
/** The printed start of a masked number («548»); '' for any other. */
export const maskedPrefixOf = (number: string): string =>
  /^(\d*)[*xX•●·#]+\d{4,}$/u.exec(number.replace(/\s+/gu, ''))?.[1] ?? '';

// ── «تاريخ الشيت» (M23) ─────────────────────────────────────────────────────────────────────────

/**
 * The day a sheet's file name holds — «رصيد وطنيه 4-10-2026.xlsx» → `2026-10-04`, with the text it
 * was read from («4-10-2026») — day first, as he names his files; `null` when the name holds none.
 */
export const sheetDateOfName = (name: string): { day: string; text: string } | null => {
  const found = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/u.exec(name);
  if (found === null) return null;
  const [text = '', d = '', m = '', y = ''] = found;
  const day = Number(d);
  const month = Number(m);
  const ymd = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // A real calendar day only — «31-2-2026» is not one.
  const at = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== ymd) return null;
  return { day: ymd, text };
};
/** «2026/10/04» from «2026-10-04». */
export const dayText = (ymd: string): string => ymd.slice(0, 10).replace(/-/gu, '/');
/** Whole days from one calendar day to another (`YYYY-MM-DD`); negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Today's Cairo calendar day, `YYYY-MM-DD` — the day «اليوم» means. */
export const cairoToday = (now: Date = new Date()): string => cairoDayOf(now.toISOString());

// ── 6a: a charge the sheet does not show, a request the difference equals ──────────────────────

/** Charges on or before the sheet's date — the only ones that may be pre-ticked. */
export const datedCharges = (line: FleetFuelReconcileLineDto): FleetFuelReconcileChargeDto[] =>
  line.charges.filter((charge) => !charge.afterSheetDate);
/** Charges after the sheet's date — listed apart, never pre-ticked. */
export const laterCharges = (line: FleetFuelReconcileLineDto): FleetFuelReconcileChargeDto[] =>
  line.charges.filter((charge) => charge.afterSheetDate);
/**
 * What the confirm ticks before the reader does (M16): the one charge whose amount is exactly
 * what the sheet is short, or all of them when together they are; never a charge after the
 * sheet's date, and nothing when the sheet is not lower.
 */
export const preTickedCharges = (line: FleetFuelReconcileLineDto): string[] => {
  if (line.difference >= 0) return [];
  const short = -piastres(line.difference);
  const dated = datedCharges(line);
  const one = dated.find((charge) => piastres(charge.amount) === short);
  if (one !== undefined) return [one.id];
  const all = dated.reduce((sum, charge) => sum + piastres(charge.amount), 0);
  return dated.length > 0 && all === short ? dated.map((charge) => charge.id) : [];
};
/** The sheet is HIGHER by exactly the card's pending «طلب رصيد» (M17). */
export const requestMatches = (line: FleetFuelReconcileLineDto): boolean =>
  line.card.requestedAmount !== null &&
  line.difference > 0 &&
  piastres(line.card.requestedAmount) === piastres(line.difference);
/** The charges a ✓ may ask about — only when the sheet is lower. */
export const unseenCharges = (line: FleetFuelReconcileLineDto): FleetFuelReconcileChargeDto[] =>
  line.difference < 0 ? line.charges : [];
/** A row whose ✓ asks first: a charge the sheet does not show, or a request to approve. */
export const asksFirst = (line: FleetFuelReconcileLineDto): boolean =>
  unseenCharges(line).length > 0 || requestMatches(line);

/** M17's two answers when the sheet is higher by exactly the pending request. */
export type RequestChoice = 'approve' | 'adjust';
/** What the confirm holds for one card: the charges ticked to cancel, and the request answer. */
export interface LineChoices {
  cancel: ReadonlySet<string>;
  request: RequestChoice | null;
}
/** A card's choices as the confirm opens: the pre-ticked charges, «اعتماد طلب الرصيد» suggested. */
export const defaultChoices = (line: FleetFuelReconcileLineDto): LineChoices => ({
  cancel: new Set(preTickedCharges(line)),
  request: requestMatches(line) ? 'approve' : null,
});
/** Σ the ticked charges of a card, to the piastre. */
export const markedOf = (line: FleetFuelReconcileLineDto, choice: LineChoices): number =>
  sumOf(
    unseenCharges(line)
      .filter((c) => choice.cancel.has(c.id))
      .map((c) => c.amount),
  );
/** The ticked charges are more than the sheet takes off the card — the server would refuse. */
export const markedTooMuch = (line: FleetFuelReconcileLineDto, choice: LineChoices): boolean =>
  piastres(markedOf(line, choice)) > -piastres(line.difference);

/**
 * A ✓'s body additions: the ticked charges of each card, and the cards whose request is approved —
 * each list only when it names something, so a ✓ that asks nothing sends exactly batch 2's body.
 */
export const decideExtrasOf = (
  lines: readonly FleetFuelReconcileLineDto[],
  choiceOf: (line: FleetFuelReconcileLineDto) => LineChoices,
): Pick<DecideFleetFuelReconcile, 'cancelCharges' | 'approveRequests'> => {
  const cancelCharges = lines.flatMap((line) =>
    unseenCharges(line)
      .filter((charge) => choiceOf(line).cancel.has(charge.id))
      .map((charge) => charge.id),
  );
  const approveRequests = lines
    .filter((line) => requestMatches(line) && choiceOf(line).request === 'approve')
    .map((line) => line.card.id.toLowerCase());
  return {
    ...(cancelCharges.length > 0 ? { cancelCharges } : {}),
    ...(approveRequests.length > 0 ? { approveRequests } : {}),
  };
};

// ── 6c: how the sheet was read ──────────────────────────────────────────────────────────────────

/** Rows the reader is asked to choose between — a number with no name that fits a card or more. */
export const CHOOSE_CONFLICTS: readonly FleetFuelSheetConflict[] = [
  'ambiguousNumber',
  'lastFourOnly',
];
/** The conflicts that list candidates («تحتاج اختيارًا»), and the rest («صفوف لا تُطابَق»). */
export const chooseConflictsOf = (
  conflicts: readonly FleetFuelSheetConflictDto[],
): FleetFuelSheetConflictDto[] => conflicts.filter((c) => CHOOSE_CONFLICTS.includes(c.reason));
export const plainConflictsOf = (
  conflicts: readonly FleetFuelSheetConflictDto[],
): FleetFuelSheetConflictDto[] => conflicts.filter((c) => !CHOOSE_CONFLICTS.includes(c.reason));
/** The card rows a name or a number tied to a card — the differing and the equal. */
export const matchedRowsOf = (result: FleetFuelReconcileDto): number =>
  result.differs.length + result.equal.length;
/**
 * More than half the card rows found no card — the layout was likely misread, or the sheet is
 * another company's: the guard banner says so before anything is applied.
 */
export const mostUnmatched = (result: FleetFuelReconcileDto): boolean =>
  result.cardRows > 0 && matchedRowsOf(result) * 2 < result.cardRows;
/** How the sheet prints its numbers — from its first card row. */
export const numberKindOf = (result: FleetFuelReconcileDto): 'full' | 'masked' | null => {
  const kind =
    [...result.differs, ...result.equal][0]?.sheet.numberKind ?? result.sheetOnly[0]?.numberKind;
  return kind === 'full' || kind === 'masked' ? kind : null;
};

// ── Refusals ────────────────────────────────────────────────────────────────────────────────────

/** The cards a 409 names (`details[i].message`), lower-cased; empty for any other failure. */
export const refusedCardIds = (error: unknown, code: string): string[] =>
  error instanceof ApiError && error.code === code
    ? (error.details ?? [])
        .filter((detail) => detail.field === 'cardIds')
        .map((detail) => detail.message.toLowerCase())
    : [];
/** The cards refused because they moved after the read. */
export const movedCardIds = (error: unknown): string[] =>
  refusedCardIds(error, ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED);
/** The cards already decided in this session. */
export const decidedCardIds = (error: unknown): string[] =>
  refusedCardIds(error, ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED);
/** 6d: the cards whose ✓ waits for «تصحيح أرقام الكروت» (the 0849 pair). */
export const inRepairCardIds = (error: unknown): string[] =>
  refusedCardIds(error, ErrorCodes.FLEET_FUEL_RECONCILE_IN_REPAIR);

/** 6d: a line whose ✓ waits for «تصحيح أرقام الكروت» — ✗ only. */
export const waitsForRepair = (line: FleetFuelReconcileLineDto): boolean => line.inRepair;
/** The lines a ✓ may name — every one but those waiting for the number repair. */
export const applicableLines = (
  lines: readonly FleetFuelReconcileLineDto[],
): FleetFuelReconcileLineDto[] => lines.filter((line) => !waitsForRepair(line));

// ── The selection ───────────────────────────────────────────────────────────────────────────────

export interface ReconcileSelection {
  /** The ticked cards — open ones only. */
  picked: ReadonlySet<string>;
  /** What the server answered for each decided card, by card id. */
  decided: Readonly<Record<string, FleetFuelReconcileResultDto>>;
  /** Cards refused because they moved after the read — never ticked, never ✓ from this read. */
  moved: ReadonlySet<string>;
}

export const NO_SELECTION: ReconcileSelection = {
  picked: new Set(),
  decided: {},
  moved: new Set(),
};

const idOf = (line: FleetFuelReconcileLineDto): string => line.card.id.toLowerCase();

/** A card that can still be ticked: not decided, not moved. */
export const isOpen = (state: ReconcileSelection, id: string): boolean =>
  state.decided[id.toLowerCase()] === undefined && !state.moved.has(id.toLowerCase());
/** The lines still open, in the table's order. */
export const openLines = (
  lines: readonly FleetFuelReconcileLineDto[],
  state: ReconcileSelection,
): FleetFuelReconcileLineDto[] => lines.filter((line) => isOpen(state, idOf(line)));
/** The ticked lines, in the table's order — what a bulk ✓ / ✗ sends. */
export const tickedLines = (
  lines: readonly FleetFuelReconcileLineDto[],
  state: ReconcileSelection,
): FleetFuelReconcileLineDto[] =>
  openLines(lines, state).filter((line) => state.picked.has(idOf(line)));

/** Tick or untick one open card; a decided or moved card is never ticked. */
export const toggle = (state: ReconcileSelection, id: string, on: boolean): ReconcileSelection => {
  const key = id.toLowerCase();
  if (on && !isOpen(state, key)) return state;
  const picked = new Set(state.picked);
  if (on) picked.add(key);
  else picked.delete(key);
  return { ...state, picked };
};
/** What «تحديد الكل» ticks: every open card but one waiting for the number repair (6d). */
export const tickAllLines = (
  lines: readonly FleetFuelReconcileLineDto[],
  state: ReconcileSelection,
): FleetFuelReconcileLineDto[] => applicableLines(openLines(lines, state));
/** «تحديد الكل»: every open card (6d: but the repair's), or none. */
export const tickAll = (
  state: ReconcileSelection,
  lines: readonly FleetFuelReconcileLineDto[],
  on: boolean,
): ReconcileSelection => ({
  ...state,
  picked: on ? new Set(tickAllLines(lines, state).map(idOf)) : new Set(),
});
/** The server's answers: each card decided, and out of the selection. */
export const afterDecisions = (
  state: ReconcileSelection,
  results: readonly FleetFuelReconcileResultDto[],
): ReconcileSelection => {
  const decided = { ...state.decided };
  const picked = new Set(state.picked);
  for (const result of results) {
    const key = result.cardId.toLowerCase();
    decided[key] = result;
    picked.delete(key);
  }
  return { ...state, decided, picked };
};
/**
 * A 409 «changed after the read»: the cards it names are moved — out of the selection, and no
 * longer open. Any other failure leaves the selection as it was (nothing was written).
 */
export const afterMoved = (state: ReconcileSelection, error: unknown): ReconcileSelection => {
  const ids = movedCardIds(error);
  if (ids.length === 0) return state;
  const moved = new Set(state.moved);
  const picked = new Set(state.picked);
  for (const id of ids) {
    moved.add(id);
    picked.delete(id);
  }
  return { ...state, moved, picked };
};

export type ReconcileSelectionAction =
  | { type: 'toggle'; id: string; on: boolean }
  | { type: 'tickAll'; lines: readonly FleetFuelReconcileLineDto[]; on: boolean }
  | { type: 'clear' }
  | { type: 'decided'; results: readonly FleetFuelReconcileResultDto[] }
  | { type: 'refused'; error: unknown }
  | { type: 'reset' };

/** The page's `useReducer` — every change of the selection goes through here. */
export const reconcileSelection = (
  state: ReconcileSelection,
  action: ReconcileSelectionAction,
): ReconcileSelection => {
  switch (action.type) {
    case 'toggle':
      return toggle(state, action.id, action.on);
    case 'tickAll':
      return tickAll(state, action.lines, action.on);
    case 'clear':
      return { ...state, picked: new Set() };
    case 'decided':
      return afterDecisions(state, action.results);
    case 'refused':
      return afterMoved(state, action.error);
    case 'reset':
      return NO_SELECTION;
  }
};

/** The server's answer for a card, once decided. */
export const decisionOf = (
  state: ReconcileSelection,
  id: string,
): FleetFuelReconcileResultDto | undefined => state.decided[id.toLowerCase()];
/** The card's balance as it stands now — the sheet's once applied. */
export const balanceNow = (
  state: ReconcileSelection,
  card: { id: string; balance: number },
): number => decisionOf(state, card.id)?.balance ?? card.balance;
