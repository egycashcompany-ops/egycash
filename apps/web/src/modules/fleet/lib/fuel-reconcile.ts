// «مطابقة أرصدة الكروت» — the screen's pure half: how its figures are written, and what is ticked,
// decided and refused. Nothing here touches React or the network, so every rule is pinned by
// `fuel-reconcile.spec.ts`.
//
// The selection: a card that DIFFERS is open until it is decided (✓ / ✗). Only open cards can be
// ticked. A card the server refused because its balance or log moved after the sheet was read
// (409 `FLEET_FUEL_RECONCILE_CARD_CHANGED`) can no longer take the sheet's balance from this read:
// it leaves the selection and «تحديد الكل» passes it by; the sheet must be read again.
import {
  ErrorCodes,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

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

// ── The selection ───────────────────────────────────────────────────────────────────────────────

export interface ReconcileSelection {
  /** The ticked cards — open ones only. */
  picked: ReadonlySet<string>;
  /** What the server answered for each decided card, by card id. */
  decided: Readonly<Record<string, FleetFuelReconcileResultDto>>;
  /** Cards refused because they moved after the read — never ticked, never ✓ from this read. */
  moved: ReadonlySet<string>;
}

export const NO_SELECTION: ReconcileSelection = { picked: new Set(), decided: {}, moved: new Set() };

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
/** «تحديد الكل»: every open card, or none. */
export const tickAll = (
  state: ReconcileSelection,
  lines: readonly FleetFuelReconcileLineDto[],
  on: boolean,
): ReconcileSelection => ({
  ...state,
  picked: on ? new Set(openLines(lines, state).map(idOf)) : new Set(),
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
