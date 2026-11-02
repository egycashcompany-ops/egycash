// «شحن الكروت» — which cards a state filter keeps, now that several states can be ticked at once
// («اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت»).
//
// The states OR together: «مطلوب شحنه» and «رصيد قليل» ticked shows a card that is either. Kept
// here, pure, so the rule a reader sees is the rule a node test reads.
import { type FleetFuelCardDto } from '@ecms/contracts';
import { cairoDayOf } from './custody-hold';

export const CHARGING_STATES = ['requested', 'charged', 'low'] as const;
export type ChargingState = (typeof CHARGING_STATES)[number];

/**
 * «الاخضر فى حالة لو اتشحن اليوم» — charged on TODAY's date, the Africa/Cairo calendar day (his
 * standing rule for «اليوم»), not within the last 24 hours: a card charged at 23:30 yesterday is
 * not «today» at 00:30. The row's green and the «شُحنت اليوم» filter both read this.
 */
export const chargedToday = (card: FleetFuelCardDto, now = Date.now()): boolean =>
  card.lastChargedAt !== null &&
  cairoDayOf(card.lastChargedAt) === cairoDayOf(new Date(now).toISOString());

/** The ticked states as the URL holds them — unknown words dropped, each once. */
export const readChargingStates = (raw: string | null): ChargingState[] =>
  CHARGING_STATES.filter((state) => (raw ?? '').split(',').includes(state));

const inState = (card: FleetFuelCardDto, state: ChargingState, yellow: number, now: number) => {
  switch (state) {
    case 'requested':
      return card.requestedAmount !== null;
    case 'low':
      return card.balance < yellow;
    case 'charged':
      return chargedToday(card, now);
  }
};

/** The cards in ANY of the ticked states — every card when none is ticked. */
export const cardsInStates = (
  cards: readonly FleetFuelCardDto[],
  states: readonly ChargingState[],
  yellow: number,
  now = Date.now(),
): FleetFuelCardDto[] =>
  states.length === 0
    ? [...cards]
    : cards.filter((card) => states.some((state) => inState(card, state, yellow, now)));
