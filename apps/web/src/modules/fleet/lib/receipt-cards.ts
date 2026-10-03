// What the receipt modal knows about the picked car's fuel cards — «لما اختار العربيه يشيل رسالة
// اختر سيارة ويجيب بقى هل فى كارت واحد على العربيه او اتنين او مفيش».
//
// Four honest answers, and the modal says each one: no car yet, still loading, could not load,
// and the car's cards (none, one or two). «Still loading» is its own answer because the cards
// query keeps the PREVIOUS car's list on screen while the new one arrives — read as an answer, that
// list filters to nothing and the modal would claim a car with two cards has none.
import { type FleetFuelCardDto } from '@ecms/contracts';

export type ReceiptCardsState =
  | { kind: 'noCar' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; cards: FleetFuelCardDto[] };

export const receiptCardsState = (input: {
  vehicleId: string;
  /** The picked car's code — '' until the registry has resolved it. */
  code: string;
  items: readonly FleetFuelCardDto[] | undefined;
  /** The query is still showing an earlier key's list. */
  placeholder: boolean;
  failed: boolean;
}): ReceiptCardsState => {
  if (input.vehicleId === '') return { kind: 'noCar' };
  if (input.failed) return { kind: 'failed' };
  if (input.code === '' || input.items === undefined || input.placeholder) {
    return { kind: 'loading' };
  }
  return { kind: 'ready', cards: input.items.filter((card) => card.vehicleId === input.vehicleId) };
};

/**
 * The card the receipt points at once the car's cards are known: the ONLY card when there is one,
 * the clerk's pick while it is still one of this car's, and nothing otherwise. Until the cards are
 * known the current pick is kept — an edit opens with its card already chosen.
 */
export const settleReceiptCardId = (state: ReceiptCardsState, current: string): string => {
  if (state.kind !== 'ready') return current;
  const [only] = state.cards;
  if (state.cards.length === 1 && only !== undefined) return only.id;
  return state.cards.some((card) => card.id === current) ? current : '';
};
